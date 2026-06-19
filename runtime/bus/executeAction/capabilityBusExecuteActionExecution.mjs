import {
    assertCapabilityBusExecuteActionOrchestrationDescriptor
} from "./capabilityBusExecuteActionOrchestration.mjs";
import {
    createCapabilityBusExecuteActionCancelledOutcome,
    createCapabilityBusExecuteActionCompletedOutcome,
    createCapabilityBusExecuteActionFailedOutcome,
    createCapabilityBusExecuteActionStartedOutcome,
    createCapabilityBusExecuteActionTimeoutOutcome
} from "./capabilityBusExecuteActionOutcome.mjs";
import {
    runNativeWorkerAction
} from "../../backends/nativeWorker/nativeWorkerBackendExecution.mjs";
import {
    NATIVE_WORKER_BACKEND_KIND
} from "../../backends/nativeWorker/nativeWorkerBackendAdapterDefinition.mjs";

function createUnsupportedExecutionError(message, details = {}) {
    const err = new Error(message);
    err.code = details.code ?? "unsupported_execute_action_execution";
    err.kind = details.kind ?? "unsupported_route";
    err.details = { ...details };
    return err;
}

function normalizeError(err, defaults = {}) {
    return {
        message: err?.message || defaults.message || "Capability Bus execute-action failed",
        code: err?.code || defaults.code || "capability_bus_execute_action_failed",
        kind: err?.kind || defaults.kind || "runtime",
        retryable: err?.retryable === true,
        details: {
            ...(defaults.details ?? {}),
            ...(err?.details && typeof err.details === "object" ? err.details : {})
        }
    };
}

function isCancellationError(err) {
    const message = String(err?.message ?? err ?? "").toLowerCase();
    const code = String(err?.code ?? "").toLowerCase();
    const kind = String(err?.kind ?? "").toLowerCase();

    return (
        kind.includes("cancel") ||
        code.includes("cancel") ||
        message.includes("cancel") ||
        message.includes("canceled") ||
        message.includes("cancelled")
    );
}

function isTimeoutError(err) {
    const message = String(err?.message ?? err ?? "").toLowerCase();
    const code = String(err?.code ?? "").toLowerCase();
    const kind = String(err?.kind ?? "").toLowerCase();

    return kind.includes("timeout") || code.includes("timeout") || message.includes("timeout");
}

function getInvocation(orchestrationDescriptor) {
    return orchestrationDescriptor.backendAdapterInvocationDescriptor.invocation;
}

function selectExecutableAdapter(invocation) {
    if (invocation.backendKind === NATIVE_WORKER_BACKEND_KIND) {
        return runNativeWorkerAction;
    }

    throw createUnsupportedExecutionError(
        `Unsupported execute-action backendKind: ${invocation.backendKind}`,
        {
            code: "unsupported_execute_action_backend_kind",
            backendKind: invocation.backendKind,
            supportedBackendKinds: [NATIVE_WORKER_BACKEND_KIND]
        }
    );
}

function createTrace(startedAt, finishedAt) {
    return {
        startedAt,
        finishedAt,
        durationMs: Math.max(0, finishedAt - startedAt)
    };
}

function mapDoneToOutcome(orchestration, startedAt, donePromise) {
    return donePromise
        .then((resultText) => {
            const finishedAt = Date.now();

            return createCapabilityBusExecuteActionCompletedOutcome(orchestration, {
                result: {
                    text: resultText
                },
                trace: createTrace(startedAt, finishedAt)
            });
        })
        .catch((err) => {
            const finishedAt = Date.now();
            const trace = createTrace(startedAt, finishedAt);

            if (isCancellationError(err)) {
                return createCapabilityBusExecuteActionCancelledOutcome(
                    orchestration,
                    normalizeError(err, {
                        code: "capability_bus_execute_action_cancelled",
                        kind: "cancellation"
                    }),
                    { trace }
                );
            }

            if (isTimeoutError(err)) {
                return createCapabilityBusExecuteActionTimeoutOutcome(
                    orchestration,
                    normalizeError(err, {
                        code: "capability_bus_execute_action_timeout",
                        kind: "timeout"
                    }),
                    { trace }
                );
            }

            return createCapabilityBusExecuteActionFailedOutcome(
                orchestration,
                normalizeError(err),
                { trace }
            );
        });
}

export async function runExecuteAction(orchestrationDescriptor, deps = {}, options = {}) {
    const orchestration = assertCapabilityBusExecuteActionOrchestrationDescriptor(orchestrationDescriptor);
    const invocation = getInvocation(orchestration);
    const adapter = selectExecutableAdapter(invocation);
    const startedAt = Date.now();
    const backendHandle = await adapter(orchestration, deps, options);
    const startedOutcome = createCapabilityBusExecuteActionStartedOutcome(orchestration, {
        trace: {
            startedAt
        }
    });

    return {
        actionId: backendHandle.actionId,
        ...(backendHandle.runId === undefined ? {} : { runId: backendHandle.runId }),
        capability: backendHandle.capability,
        requestId: backendHandle.requestId,
        backend: backendHandle.backend,
        stream: backendHandle.stream,
        startedOutcome,
        done: mapDoneToOutcome(orchestration, startedAt, backendHandle.done)
    };
}
