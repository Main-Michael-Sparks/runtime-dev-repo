import { parentPort } from "worker_threads";
import { getLlama, LlamaChatSession } from "node-llama-cpp";
import path from "path";
import { fileURLToPath } from "url";
import { config } from "../config.mjs";
import { deepFreeze } from "../configOverride.mjs";
import { buildContextRetryProfiles } from "../contextRetryProfiles.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modelPath = path.resolve(
    __dirname,
    `${config.modelLoad.baseModel}`
);

let model = null;
let ready = false;
let initPromise = null;
let resetting = false;
let shuttingDown = false;
let activeConfig = config;
let activeInitAttemptId = null;
let activeProfileName = null;

const sessions = new Map();
const activeRequests = new Map();

function setActiveInitConfig(msg) {
    if (initPromise || model || ready) return;

    activeConfig = msg.configSnapshot
        ? deepFreeze(msg.configSnapshot)
        : config;
    activeInitAttemptId = msg.initAttemptId ?? null;
    activeProfileName = msg.profileName ?? "base";
}

function resetActiveInitConfig() {
    activeConfig = config;
    activeInitAttemptId = null;
    activeProfileName = null;
}

async function disposeSessionEntry(entry) {
    if (!entry) return;

    const cleanupErrors = [];

    if (entry.session?.disposed !== true && typeof entry.session?.dispose === "function") {
        try {
            entry.session.dispose({
                disposeSequence: true
            });
        } catch (err) {
            cleanupErrors.push(err);
        }
    }

    if (entry.context?.disposed !== true && typeof entry.context?.dispose === "function") {
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
    resetActiveInitConfig();
}

async function initModel() {
    if (initPromise) return initPromise;

    initPromise = (async () => {
        const llama = await getLlama();

        model = await llama.loadModel({
            modelPath,
            gpuLayers: activeConfig.modelLoad.gpuLayers,
            useMmap: activeConfig.modelLoad.useMmap,
            useMlock: activeConfig.modelLoad.useMlock,
            ignoreMemorySafetyChecks: activeConfig.modelLoad.ignoreMemorySafetyChecks
        });

        ready = true;
        resetting = false;
        shuttingDown = false;

        parentPort.postMessage({
            type: "ready",
            initAttemptId: activeInitAttemptId,
            profileName: activeProfileName
        });
    })();

    return initPromise;
}

function toContextCreateOptions(contextConfig) {
    return {
        contextSize: contextConfig.contextSize,
        batchSize: contextConfig.batchSize,
        threads: contextConfig.threads,
        flashAttention: contextConfig.flashAttention,
        performanceTracking: contextConfig.performanceTracking,
        sequences: contextConfig.sequences,
        failedCreationRemedy: contextConfig.failedCreationRemedy,
        ignoreMemorySafetyChecks: contextConfig.ignoreMemorySafetyChecks
    };
}

function buildContextCreationObsoleteError(requestId) {
    if (requestId !== null && requestId !== undefined && !activeRequests.has(requestId)) {
        return new Error("Prompt canceled");
    }

    if (resetting || shuttingDown || !ready || !model) {
        return new Error("Model is resetting");
    }

    return null;
}

async function disposePartialSessionArtifacts({ session, context }) {
    const cleanupErrors = [];

    if (session?.disposed !== true && typeof session?.dispose === "function") {
        try {
            session.dispose({
                disposeSequence: true
            });
        } catch (err) {
            cleanupErrors.push(err);
        }
    }

    if (context?.disposed !== true && typeof context?.dispose === "function") {
        try {
            await context.dispose();
        } catch (err) {
            cleanupErrors.push(err);
        }
    }

    if (cleanupErrors.length > 0) {
        throw cleanupErrors[0];
    }
}

function buildContextCreationError({ sessionId, attemptedProfiles, lastError }) {
    const err = new Error(
        `Context creation failed after ${attemptedProfiles.length} attempt(s). ` +
        `Session: ${sessionId}. ` +
        `Attempted profiles: ${attemptedProfiles.join(", ")}. ` +
        `Last error: ${lastError?.message ?? String(lastError)}`
    );

    err.sessionId = sessionId;
    err.attemptedContextProfiles = attemptedProfiles;
    err.lastError = lastError;

    return err;
}

async function createSessionContextWithRetry(sessionId, requestId = null) {
    const profiles = buildContextRetryProfiles({
        baseContextConfig: activeConfig.context,
        creationRetry: activeConfig.context.creationRetry,
        hardwareProbe: activeConfig.hardwareProbe ?? null
    });

    const attemptedProfiles = [];
    let lastError = null;

    for (const profile of profiles) {
        const obsoleteBeforeAttempt = buildContextCreationObsoleteError(requestId);
        if (obsoleteBeforeAttempt) throw obsoleteBeforeAttempt;

        attemptedProfiles.push(profile.name);

        let context = null;
        let session = null;

        try {
            context = await model.createContext(toContextCreateOptions(profile.context));

            if (typeof context.getSequence !== "function") {
                throw new Error("Context does not expose getSequence()");
            }

            const sequence = context.getSequence();

            session = new LlamaChatSession({
                contextSequence: sequence
            });
        } catch (err) {
            lastError = err;
            await disposePartialSessionArtifacts({ session, context });

            const obsoleteAfterFailure = buildContextCreationObsoleteError(requestId);
            if (obsoleteAfterFailure) throw obsoleteAfterFailure;

            continue;
        }

        const wrapper = {
            session,
            context,
            contextProfile: profile.name,
            contextConfig: profile.context
        };

        const obsoleteAfterSuccess = buildContextCreationObsoleteError(requestId);
        if (obsoleteAfterSuccess) {
            await disposePartialSessionArtifacts(wrapper);
            throw obsoleteAfterSuccess;
        }

        return wrapper;
    }

    throw buildContextCreationError({
        sessionId,
        attemptedProfiles,
        lastError
    });
}

async function getSession(sessionId, requestId = null) {
    if (!model) throw new Error("Model not initialized");

    if (sessions.has(sessionId)) return sessions.get(sessionId);

    if (sessions.size >= activeConfig.sessions.maxCount) {
        const oldest = sessions.keys().next().value;
        await disposeSessionById(oldest);
    }

    const wrapper = await createSessionContextWithRetry(sessionId, requestId);
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
            setActiveInitConfig(msg);
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
                sessionId: msg.sessionId
            });
            return;
        }

        if (msg.type === "reset_model") {
            await resetModel();
            parentPort.postMessage({ type: "model_reset_done" });
            return;
        }

        if (msg.type === "prompt") {
            const {
                id,
                text,
                sessionId = "default",
                stream = true
            } = msg;

            activeRequests.set(id, true);

            const { session } = await getSession(sessionId, id);

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
                maxTokens: activeConfig.model.maxTokens,
                temperature: activeConfig.model.temperature,
                topK: activeConfig.model.topK,
                topP: activeConfig.model.topP,
                repeatPenalty: activeConfig.model.repeatPenalty,

                onToken: stream
                    ? (t) => {
                          if (!activeRequests.has(id)) return;

                          const chunk = toChunk(t);

                          parentPort.postMessage({
                              type: "stream",
                              id,
                              token: chunk
                          });
                      }
                    : undefined
            });

            activeRequests.delete(id);

            parentPort.postMessage({
                type: "done",
                id,
                res: stream ? undefined : result
            });
        }
    } catch (err) {
        if (msg.type === "prompt" && msg.id !== undefined && msg.id !== null) {
            activeRequests.delete(msg.id);
        }

        const initErrorMeta = msg.type === "init" || msg.initAttemptId !== undefined
            ? {
                  initAttemptId: msg.initAttemptId ?? activeInitAttemptId,
                  profileName: msg.profileName ?? activeProfileName
              }
            : {};

        parentPort.postMessage({
            type: "error",
            id: msg.id,
            ...initErrorMeta,
            error: {
                message: err.message,
                stack: err.stack,
                phase: "worker",
                sessionId: msg.sessionId || null
            }
        });
    }
});
