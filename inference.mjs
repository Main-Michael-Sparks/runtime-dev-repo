import { config } from "./config.mjs";
import { normalizeToken } from "./normalizer.mjs";
import {
  traceQueued,
  traceRunning,
  traceDone,
  traceError,
  traceCanceled,
  traceDelete,
} from "./observer.mjs";
import { createRequest } from "./request.mjs";
import {
  pushStream,
  closeStream,
  errorStream,
  cancelStream,
} from "./streamController.mjs";
import {
  onWorkerMessage,
  sendToWorker,
  terminateWorker,
  recreateWorker,
} from "./workerBridge.mjs";
import { createScheduler } from "./scheduler.mjs";

let initStarted = false;
let initResolved = false;
let resolveReady;
let rejectReady;

const sessionsResetting = new Set();
const sessionResetWaiters = new Map();
let runtimeResetting = false;
let runtimeShuttingDown = false;
let modelResetWaiter = null;
let shutdownWaiter = null;

function createReadyPromise() {
  return new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
}

let readyPromise = createReadyPromise();

const scheduler = createScheduler({
  maxInFlight: config.runtime.maxInFlight,
  sendToWorker,
  onDispatch(req) {
    traceRunning(req);
  },
});

function toErrorObject(raw) {
  if (raw instanceof Error) return raw;

  if (raw && typeof raw === "object") {
    const err = new Error(raw.message || "Worker error");
    if (raw.stack) err.stack = raw.stack;
    if (raw.phase) err.phase = raw.phase;
    if (raw.sessionId) err.sessionId = raw.sessionId;
    return err;
  }

  return new Error(String(raw));
}

onWorkerMessage((msg) => {
  if (msg.type === "ready") {
    initResolved = true;
    scheduler.setReady(true);
    resolveReady();
    return;
  }

  if (msg.type === "reset_done") {
    if (msg.sessionId) {
      sessionsResetting.delete(msg.sessionId);

      const waiter = sessionResetWaiters.get(msg.sessionId);
      if (waiter) {
        sessionResetWaiters.delete(msg.sessionId);
        waiter.resolve();
      }
    }
    return;
  }

  if (msg.type === "model_reset_done") {
    const waiter = modelResetWaiter;
    modelResetWaiter = null;

    if (waiter) {
      waiter.resolve();
    }
    return;
  }

  if (msg.type === "shutdown_done") {
    const waiter = shutdownWaiter;
    shutdownWaiter = null;

    if (waiter) {
      waiter.resolve();
    }
    return;
  }

  if (msg.type === "stream") {
    const req = scheduler.getRequest(msg.id);
    if (!req || req.status === "canceled" || req.status === "done") return;

    const token = normalizeToken(msg.token, config);
    req.finalText += token;
    pushStream(req, token, config);
    return;
  }

  if (msg.type === "done") {
    const req = scheduler.complete(msg.id);
    if (!req) return;

    const resultText = req.streamEnabled
      ? req.finalText
      : (msg.res ?? req.finalText);

    closeStream(req);
    traceDone(req);
    req.resolveDone(resultText);
    traceDelete(req.id);
    return;
  }

  if (msg.type === "error") {
    const err = toErrorObject(msg.error);

    // model reset failure path
    if (
      (msg.id === undefined || msg.id === null) &&
      runtimeResetting &&
      modelResetWaiter
    ) {
      const waiter = modelResetWaiter;
      modelResetWaiter = null;
      waiter.reject(err);
      return;
    }

    // shutdown failure path
    if (
      (msg.id === undefined || msg.id === null) &&
      runtimeShuttingDown &&
      shutdownWaiter
    ) {
      const waiter = shutdownWaiter;
      shutdownWaiter = null;
      waiter.reject(err);
      return;
    }

    // init failure path
    if (
      (msg.id === undefined || msg.id === null) &&
      !initResolved &&
      !msg.sessionId
    ) {
      rejectReady(err);
      return;
    }

    // session reset failure path
    if (
      (msg.id === undefined || msg.id === null) &&
      msg.sessionId &&
      sessionResetWaiters.has(msg.sessionId)
    ) {
      sessionsResetting.delete(msg.sessionId);

      const waiter = sessionResetWaiters.get(msg.sessionId);
      sessionResetWaiters.delete(msg.sessionId);
      waiter.reject(err);
      return;
    }

    const req = scheduler.fail(msg.id);
    if (!req) return;

    traceError(req, err);
    errorStream(req, err);
    req.rejectDone(err);
    traceDelete(req.id);
  }
});

export async function initModel() {
  if (runtimeShuttingDown) {
    throw new Error("Runtime is shutting down");
  }

  if (!initStarted) {
    initStarted = true;
    sendToWorker({ type: "init" });
  }

  return readyPromise;
}

export async function prompt(text, options = {}) {
  const sessionId = options.sessionId || "default";

  if (runtimeResetting) {
    throw new Error("Runtime is resetting");
  }

  if (runtimeShuttingDown) {
    throw new Error("Runtime is shutting down");
  }

  if (sessionsResetting.has(sessionId)) {
    throw new Error(`Session is resetting: ${sessionId}`);
  }

  await initModel();

  if (scheduler.queuedCount() >= config.runtime.maxQueueSize) {
    throw new Error("Backpressure: queue full");
  }

  const req = createRequest(text, options);
  traceQueued(req);
  scheduler.enqueue(req);

  return {
    id: req.id,
    stream: req.stream,
    done: req.done,
  };
}

export function cancelPrompt(promptId) {
  sendToWorker({
    type: "cancel",
    id: promptId,
  });

  const req = scheduler.cancel(promptId);
  if (!req) return false;

  cancelStream(req);
  traceCanceled(req);
  req.rejectDone(new Error("Prompt canceled"));
  traceDelete(req.id);

  return true;
}

export async function resetSession(sessionId = "default") {
  if (runtimeResetting) {
    throw new Error("Runtime is resetting");
  }

  if (runtimeShuttingDown) {
    throw new Error("Runtime is shutting down");
  }

  const existing = sessionResetWaiters.get(sessionId);
  if (existing) {
    return existing.promise;
  }

  sessionsResetting.add(sessionId);

  let resolveReset;
  let rejectReset;
  const promise = new Promise((resolve, reject) => {
    resolveReset = resolve;
    rejectReset = reject;
  });

  sessionResetWaiters.set(sessionId, {
    promise,
    resolve: resolveReset,
    reject: rejectReset,
  });

  const canceled = scheduler.cancelBySession(sessionId);

  for (const req of canceled) {
    sendToWorker({
      type: "cancel",
      id: req.id,
    });

    cancelStream(req);
    traceCanceled(req);
    req.rejectDone(new Error(`Session reset: ${sessionId}`));
    traceDelete(req.id);
  }

  sendToWorker({
    type: "reset_session",
    sessionId,
  });

  return promise;
}

export async function resetModel() {
  if (runtimeResetting) {
    throw new Error("Runtime is resetting");
  }

  if (runtimeShuttingDown) {
    throw new Error("Runtime is shutting down");
  }

  runtimeResetting = true;
  scheduler.setReady(false);

  const canceled = scheduler.cancelAll();

  for (const req of canceled) {
    sendToWorker({
      type: "cancel",
      id: req.id,
    });

    cancelStream(req);
    traceCanceled(req);
    req.rejectDone(new Error("Model reset"));
    traceDelete(req.id);
  }

  let resolveReset;
  let rejectReset;
  const waitForWorkerReset = new Promise((resolve, reject) => {
    resolveReset = resolve;
    rejectReset = reject;
  });

  modelResetWaiter = {
    resolve: resolveReset,
    reject: rejectReset,
  };

  try {
    sendToWorker({
      type: "reset_model",
    });

    await waitForWorkerReset;
    await terminateWorker();
    recreateWorker();

    initStarted = false;
    initResolved = false;
    readyPromise = createReadyPromise();

    await initModel();
  } finally {
    runtimeResetting = false;
    modelResetWaiter = null;
  }
}

export async function shutdownRuntime({ mode = "abort" } = {}) {
  if (mode !== "abort") {
    throw new Error(`Unsupported shutdown mode: ${mode}`);
  }

  if (runtimeResetting) {
    throw new Error("Runtime is resetting");
  }

  if (runtimeShuttingDown) {
    throw new Error("Runtime is shutting down");
  }

  runtimeShuttingDown = true;
  scheduler.setReady(false);

  const canceled = scheduler.cancelAll();

  for (const req of canceled) {
    sendToWorker({
      type: "cancel",
      id: req.id,
    });

    cancelStream(req);
    traceCanceled(req);
    req.rejectDone(new Error("Runtime shutdown"));
    traceDelete(req.id);
  }

  let resolveShutdown;
  let rejectShutdown;
  const waitForShutdown = new Promise((resolve, reject) => {
    resolveShutdown = resolve;
    rejectShutdown = reject;
  });

  shutdownWaiter = {
    resolve: resolveShutdown,
    reject: rejectShutdown,
  };

  try {
    sendToWorker({
      type: "shutdown",
    });

    await waitForShutdown;
    await terminateWorker();
  } finally {
    shutdownWaiter = null;
  }
}
