import { config } from "./config.mjs";
import { resolveNativeOperationHardStopConfig } from "./nativeOperationPolicy.mjs";
import {
    assertRuntimeHealthy,
    markRuntimeUnhealthy,
    waitForNativeOperationBoundary
} from "./nativeBoundaryCoordinator.mjs";
import { resetSessionCoordinator } from "./runtimeSessionResetCoordinator.mjs";
import { shutdownRuntimeCoordinator } from "./runtimeShutdownCoordinator.mjs";
import {
    settleCompletedRequest,
    settleFailedRequest
} from "./runtimeRequestSettlement.mjs";
import { createRuntimeLifecycleState } from "./runtimeLifecycleState.mjs";
import {
    initModelCoordinator,
    ensureModelReadyCoordinator,
    reinitializeModelAfterReset
} from "./runtimeInitCoordinator.mjs";
import { normalizeToken } from "./normalizer.mjs";
import {
    traceQueued,
    traceRunning,
    traceDone,
    traceError,
    traceCanceled,
    traceDelete
} from "./observer.mjs";
import { createRequest } from "./request.mjs";
import {
    pushStream,
    closeStream,
    errorStream,
    cancelStream
} from "./streamController.mjs";
import {
    onWorkerMessage,
    sendToWorker,
    terminateWorker,
    recreateWorker
} from "./workerBridge.mjs";
import { createScheduler } from "./scheduler.mjs";


const lifecycle = createRuntimeLifecycleState();

const scheduler = createScheduler({
    maxInFlight: config.runtime.maxInFlight,
    sendToWorker,
    onDispatch(req) {
        traceRunning(req);
    }
});

function createInitCoordinatorContext() {
    return {
        config,
        lifecycle,
        scheduler,
        sendToWorker,
        terminateWorker,
        recreateWorker,
        assertRuntimeHealthy
    };
}

function isSessionResetWaiterActive(waiter) {
    return waiter && waiter.timedOut !== true;
}

function assertNoActiveSessionResetInProgress(operationName) {
    for (const waiter of lifecycle.sessionResetWaiters.values()) {
        if (isSessionResetWaiterActive(waiter)) {
            throw new Error(`${operationName} cannot start while a session reset is in progress`);
        }
    }
}

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
        if (msg.initAttemptId !== lifecycle.activeInitAttemptId) return;

        lifecycle.initResolved = true;
        scheduler.setReady(true);
        lifecycle.resolveReady();
        return;
    }

    if (msg.type === "reset_done") {
        if (msg.sessionId) {
            lifecycle.sessionsResetting.delete(msg.sessionId);

            const waiter = lifecycle.sessionResetWaiters.get(msg.sessionId);
            if (waiter) {
                lifecycle.sessionResetWaiters.delete(msg.sessionId);

                if (!waiter.timedOut) {
                    waiter.resolve();
                }
            }
        }
        return;
    }

    if (msg.type === "model_reset_done") {
        const waiter = lifecycle.modelResetWaiter;
        lifecycle.modelResetWaiter = null;

        if (waiter) {
            waiter.resolve();
        }
        return;
    }

    if (msg.type === "shutdown_done") {
        const waiter = lifecycle.shutdownWaiter;
        lifecycle.shutdownWaiter = null;

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

        settleCompletedRequest(req, msg, {
            closeStream,
            traceDone,
            traceDelete
        });
        return;
    }

    if (msg.type === "error") {
        const err = toErrorObject(msg.error);

        if (msg.initAttemptId !== undefined && msg.initAttemptId !== null) {
            if (msg.initAttemptId !== lifecycle.activeInitAttemptId) return;
            lifecycle.rejectReady(err);
            return;
        }

        if ((msg.id === undefined || msg.id === null) && lifecycle.runtimeResetting && lifecycle.modelResetWaiter) {
            const waiter = lifecycle.modelResetWaiter;
            lifecycle.modelResetWaiter = null;
            waiter.reject(err);
            return;
        }

        if ((msg.id === undefined || msg.id === null) && lifecycle.runtimeShuttingDown && lifecycle.shutdownWaiter) {
            const waiter = lifecycle.shutdownWaiter;
            lifecycle.shutdownWaiter = null;
            waiter.reject(err);
            return;
        }

        if ((msg.id === undefined || msg.id === null) && !lifecycle.initResolved && !msg.sessionId) {
            lifecycle.rejectReady(err);
            return;
        }

        if ((msg.id === undefined || msg.id === null) && msg.sessionId && lifecycle.sessionResetWaiters.has(msg.sessionId)) {
            lifecycle.sessionsResetting.delete(msg.sessionId);

            const waiter = lifecycle.sessionResetWaiters.get(msg.sessionId);
            lifecycle.sessionResetWaiters.delete(msg.sessionId);

            if (!waiter.timedOut) {
                waiter.reject(err);
            }
            return;
        }

        const req = scheduler.fail(msg.id);
        if (!req) return;

        settleFailedRequest(req, err, {
            errorStream,
            traceError,
            traceDelete
        });
    }
});

export async function initModel(options = {}) {
    return initModelCoordinator(createInitCoordinatorContext(), options);
}

function assertPromptAdmissionAllowed(sessionId) {
    assertRuntimeHealthy(lifecycle);

    if (lifecycle.runtimeResetting) {
        throw new Error("Runtime is resetting");
    }

    if (lifecycle.runtimeShuttingDown) {
        throw new Error("Runtime is shutting down");
    }

    if (lifecycle.sessionsResetting.has(sessionId)) {
        throw new Error(`Session is resetting: ${sessionId}`);
    }
}

function assertNoSessionResetInProgress(operationName) {
    assertNoActiveSessionResetInProgress(operationName);
}

function notifyRequestCancellationRequested(req, reason = "Prompt canceled") {
    if (!req?.parentCancelPort || req.status !== "running") return;

    try {
        req.parentCancelPort.postMessage({
            type: "cancel",
            id: req.id,
            sessionId: req.sessionId,
            reason
        });
    } catch {
        // no-op: port may already be closed during cleanup
    }
}

function notifyRequestsCancellationRequested(requests, reason) {
    for (const req of requests) {
        notifyRequestCancellationRequested(req, reason);
    }
}

export async function prompt(text, options = {}) {
    const sessionId = options.sessionId || "default";

    assertPromptAdmissionAllowed(sessionId);

    await ensureModelReadyCoordinator(createInitCoordinatorContext());

    assertPromptAdmissionAllowed(sessionId);

    if (scheduler.queuedCount() >= config.runtime.maxQueueSize) {
        throw new Error("Backpressure: queue full");
    }

    const req = createRequest(text, options);
    traceQueued(req);
    scheduler.enqueue(req);

    return {
        id: req.id,
        stream: req.stream,
        done: req.done
    };
}

export function cancelPrompt(promptId) {
    const existing = scheduler.getRequest(promptId);
    notifyRequestCancellationRequested(existing, "Prompt canceled");

    sendToWorker({
        type: "cancel",
        id: promptId,
        sessionId: existing?.sessionId ?? null,
        reason: "Prompt canceled"
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
    return resetSessionCoordinator({
        config,
        lifecycle,
        scheduler,
        sendToWorker,
        resolveNativeOperationHardStopConfig,
        assertRuntimeHealthy,
        waitForNativeOperationBoundary,
        notifyRequestsCancellationRequested,
        cancelStream,
        traceCanceled,
        traceDelete
    }, sessionId);
}

export async function resetModel() {
    assertRuntimeHealthy(lifecycle);

    if (lifecycle.runtimeResetting) {
        throw new Error("Runtime is resetting");
    }

    if (lifecycle.runtimeShuttingDown) {
        throw new Error("Runtime is shutting down");
    }

    const hardStopConfig = resolveNativeOperationHardStopConfig(config);
    assertNoSessionResetInProgress("Model reset");

    lifecycle.runtimeResetting = true;
    scheduler.setReady(false);

    const canceled = scheduler.cancelAll();
    notifyRequestsCancellationRequested(canceled, "Model reset");

    for (const req of canceled) {
        sendToWorker({
            type: "cancel",
            id: req.id,
            sessionId: req.sessionId,
            reason: "Model reset"
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

    waitForWorkerReset.catch(() => {});

    lifecycle.modelResetWaiter = {
        resolve: resolveReset,
        reject: rejectReset
    };

    try {
        sendToWorker({
            type: "reset_model"
        });

        const result = await waitForNativeOperationBoundary(
            waitForWorkerReset,
            hardStopConfig.resetModelTimeoutMs,
            "resetModel",
            hardStopConfig
        );

        if (result.timedOut) {
            const err = markRuntimeUnhealthy(lifecycle, {
                operation: "resetModel",
                timeoutMs: hardStopConfig.resetModelTimeoutMs
            });
            throw err;
        }

        lifecycle.sessionsResetting.clear();
        lifecycle.sessionResetWaiters.clear();

        await terminateWorker();
        recreateWorker();

        await reinitializeModelAfterReset(createInitCoordinatorContext());
    } finally {
        lifecycle.runtimeResetting = false;
        lifecycle.modelResetWaiter = null;
    }
}

export async function shutdownRuntime(options = {}) {
    return shutdownRuntimeCoordinator({
        config,
        lifecycle,
        scheduler,
        sendToWorker,
        terminateWorker,
        resolveNativeOperationHardStopConfig,
        assertRuntimeHealthy,
        markRuntimeUnhealthy,
        waitForNativeOperationBoundary,
        assertNoSessionResetInProgress,
        notifyRequestsCancellationRequested,
        cancelStream,
        traceCanceled,
        traceDelete
    }, options);
}
