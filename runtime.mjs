import { config } from "./runtime/config/config.mjs";
import { resolveNativeOperationHardStopConfig } from "./runtime/lifecycle/nativeOperationPolicy.mjs";
import {
    assertRuntimeHealthy,
    markRuntimeUnhealthy,
    waitForNativeOperationBoundary
} from "./runtime/lifecycle/nativeBoundaryCoordinator.mjs";
import { resetSessionCoordinator } from "./runtime/lifecycle/runtimeSessionResetCoordinator.mjs";
import { shutdownRuntimeCoordinator } from "./runtime/lifecycle/runtimeShutdownCoordinator.mjs";
import { resetModelCoordinator } from "./runtime/lifecycle/runtimeModelResetCoordinator.mjs";
import { createWorkerProtocolRouter } from "./runtime/lifecycle/workerProtocolRouter.mjs";
import {
    notifyRequestCancellationRequested,
    notifyRequestsCancellationRequested,
    settleCompletedRequest,
    settleFailedRequest
} from "./runtime/request/runtimeRequestSettlement.mjs";
import { createRuntimeLifecycleState } from "./runtime/lifecycle/runtimeLifecycleState.mjs";
import {
    initModelCoordinator,
    ensureModelReadyCoordinator,
    reinitializeModelAfterReset
} from "./runtime/lifecycle/runtimeInitCoordinator.mjs";
import { normalizeToken } from "./runtime/stream/normalizer.mjs";
import {
    traceQueued,
    traceRunning,
    traceDone,
    traceError,
    traceCanceled,
    traceDelete
} from "./runtime/observability/observer.mjs";
import { createRequest } from "./runtime/request/request.mjs";
import {
    pushStream,
    closeStream,
    errorStream,
    cancelStream
} from "./runtime/stream/streamController.mjs";
import {
    onWorkerMessage,
    sendToWorker,
    terminateWorker,
    recreateWorker
} from "./workerBridge.mjs";
import { createScheduler } from "./runtime/request/scheduler.mjs";
import {
    runExecuteAction
} from "./runtime/bus/executeAction/capabilityBusExecuteActionExecution.mjs";


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

onWorkerMessage(createWorkerProtocolRouter({
    config,
    lifecycle,
    scheduler,
    normalizeToken,
    pushStream,
    closeStream,
    errorStream,
    traceDone,
    traceError,
    traceDelete,
    settleCompletedRequest,
    settleFailedRequest
}));

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


async function runNativeTextRequest(text, options = {}) {
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

export async function prompt(text, options = {}) {
    return runNativeTextRequest(text, options);
}

export async function executeAction(orchestrationDescriptor, options = {}) {
    return runExecuteAction(orchestrationDescriptor, {
        runNativeTextRequest
    }, options);
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
    return resetModelCoordinator({
        config,
        lifecycle,
        scheduler,
        sendToWorker,
        terminateWorker,
        recreateWorker,
        resolveNativeOperationHardStopConfig,
        assertRuntimeHealthy,
        markRuntimeUnhealthy,
        waitForNativeOperationBoundary,
        assertNoSessionResetInProgress: assertNoActiveSessionResetInProgress,
        notifyRequestsCancellationRequested,
        cancelStream,
        traceCanceled,
        traceDelete,
        reinitializeModelAfterReset,
        createInitCoordinatorContext
    });
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
        assertNoSessionResetInProgress: assertNoActiveSessionResetInProgress,
        notifyRequestsCancellationRequested,
        cancelStream,
        traceCanceled,
        traceDelete
    }, options);
}
