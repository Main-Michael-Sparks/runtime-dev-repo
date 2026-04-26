import { parentPort } from "worker_threads";
import { getLlama, LlamaChatSession } from "node-llama-cpp";
import path from "path";
import { fileURLToPath } from "url";
import { config } from "../config.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modelPath = path.resolve(__dirname, `${config.modelLoad.baseModel}`);

let model = null;
let ready = false;
let initPromise = null;
let resetting = false;
let shuttingDown = false;

const sessions = new Map();
const activeRequests = new Map();

async function disposeSessionEntry(entry) {
  if (!entry) return;

  const cleanupErrors = [];

  if (
    entry.session?.disposed !== true &&
    typeof entry.session?.dispose === "function"
  ) {
    try {
      entry.session.dispose({
        disposeSequence: true,
      });
    } catch (err) {
      cleanupErrors.push(err);
    }
  }

  if (
    entry.context?.disposed !== true &&
    typeof entry.context?.dispose === "function"
  ) {
    try {
      await entry.context.dispose();
    } catch (err) {
      cleanupErrors.push(err);
    }
  }

  if (cleanupErrors.length > 0) {
    throw cleanupErrors[0];
  }
}

async function disposeSessionById(sessionId) {
  const entry = sessions.get(sessionId);
  if (!entry) return;

  await disposeSessionEntry(entry);
  sessions.delete(sessionId);
}

async function disposeAllSessions() {
  const cleanupErrors = [];

  for (const [sessionId, entry] of sessions.entries()) {
    try {
      await disposeSessionEntry(entry);
    } catch (err) {
      cleanupErrors.push({ sessionId, err });
    }
  }

  sessions.clear();

  if (cleanupErrors.length > 0) {
    throw cleanupErrors[0].err;
  }
}

async function disposeModelStack() {
  await disposeAllSessions();

  if (model?.disposed !== true && typeof model?.dispose === "function") {
    await model.dispose();
  }

  model = null;
  ready = false;
  initPromise = null;
}

async function initModel() {
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const llama = await getLlama();

    model = await llama.loadModel({
      modelPath,
      gpuLayers: config.modelLoad.gpuLayers,
      useMmap: config.modelLoad.useMmap,
      useMlock: config.modelLoad.useMlock,
      ignoreMemorySafetyChecks: config.modelLoad.ignoreMemorySafetyChecks,
    });

    ready = true;
    resetting = false;
    shuttingDown = false;

    parentPort.postMessage({ type: "ready" });
  })();

  return initPromise;
}

async function getSession(sessionId) {
  if (!model) throw new Error("Model not initialized");

  if (sessions.has(sessionId)) return sessions.get(sessionId);

  if (sessions.size >= config.sessions.maxCount) {
    const oldest = sessions.keys().next().value;
    await disposeSessionById(oldest);
  }

  const context = await model.createContext({
    contextSize: config.context.contextSize,
    batchSize: config.context.batchSize,
    threads: config.context.threads,
    flashAttention: config.context.flashAttention,
    performanceTracking: config.context.performanceTracking,
    sequences: config.context.sequences,
    failedCreationRemedy: config.context.failedCreationRemedy,
    ignoreMemorySafetyChecks: config.context.ignoreMemorySafetyChecks,
  });

  if (typeof context.getSequence !== "function") {
    throw new Error("Context does not expose getSequence()");
  }

  const sequence = context.getSequence();

  const session = new LlamaChatSession({
    contextSequence: sequence,
  });

  const wrapper = { session, context };
  sessions.set(sessionId, wrapper);

  return wrapper;
}

async function resetSession(sessionId) {
  await disposeSessionById(sessionId);
}

async function resetModel() {
  resetting = true;
  activeRequests.clear();

  await disposeModelStack();
}

async function shutdownWorker() {
  shuttingDown = true;
  activeRequests.clear();

  await disposeModelStack();
}

parentPort.on("message", async (msg) => {
  try {
    if (msg.type === "init") {
      await initModel();
      return;
    }

    if (msg.type === "cancel") {
      activeRequests.delete(msg.id);
      return;
    }

    if (msg.type === "shutdown") {
      await shutdownWorker();
      parentPort.postMessage({ type: "shutdown_done" });
      return;
    }

    if (resetting || shuttingDown) {
      throw new Error("Model is resetting");
    }

    if (!ready || !model) {
      throw new Error("Worker not ready");
    }

    if (msg.type === "reset_session") {
      await resetSession(msg.sessionId);
      parentPort.postMessage({
        type: "reset_done",
        sessionId: msg.sessionId,
      });
      return;
    }

    if (msg.type === "reset_model") {
      await resetModel();
      parentPort.postMessage({ type: "model_reset_done" });
      return;
    }

    if (msg.type === "prompt") {
      const { id, text, sessionId = "default", stream = true } = msg;

      activeRequests.set(id, true);

      const { session } = await getSession(sessionId);

      let lastTokens = [];

      function toChunk(t) {
        if (Array.isArray(t)) {
          const chunk = model.detokenize(t, false, lastTokens);
          lastTokens = [...lastTokens, ...t].slice(-8);
          return chunk;
        }

        if (typeof t === "number") {
          const tokens = [t];
          const chunk = model.detokenize(tokens, false, lastTokens);
          lastTokens = [...lastTokens, ...tokens].slice(-8);
          return chunk;
        }

        return String(t);
      }

      const result = await session.prompt(text, {
        maxTokens: config.model.maxTokens,
        temperature: config.model.temperature,
        topK: config.model.topK,
        topP: config.model.topP,
        repeatPenalty: config.model.repeatPenalty,

        onToken: stream
          ? (t) => {
              if (!activeRequests.has(id)) return;

              const chunk = toChunk(t);

              parentPort.postMessage({
                type: "stream",
                id,
                token: chunk,
              });
            }
          : undefined,
      });

      activeRequests.delete(id);

      parentPort.postMessage({
        type: "done",
        id,
        res: stream ? undefined : result,
      });
    }
  } catch (err) {
    parentPort.postMessage({
      type: "error",
      id: msg.id,
      error: {
        message: err.message,
        stack: err.stack,
        phase: "worker",
        sessionId: msg.sessionId || null,
      },
    });
  }
});
