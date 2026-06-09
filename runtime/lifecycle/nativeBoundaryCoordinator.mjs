import { createNativeOperationTimeoutError } from "./nativeOperationPolicy.mjs";

export function createRuntimeUnhealthyError(lifecycle) {
    const details = lifecycle.runtimeUnhealthy;
    const err = new Error(
        details?.message ??
        "Runtime is unhealthy after native operation timeout; process restart required"
    );

    if (details) {
        err.phase = details.phase;
        err.operation = details.operation;
        err.sessionId = details.sessionId;
        err.timeoutMs = details.timeoutMs;
    }

    return err;
}

export function assertRuntimeHealthy(lifecycle) {
    if (lifecycle.runtimeUnhealthy) {
        throw createRuntimeUnhealthyError(lifecycle);
    }
}

export function markRuntimeUnhealthy(lifecycle, { operation, sessionId = null, timeoutMs }) {
    if (!lifecycle.runtimeUnhealthy) {
        const err = createNativeOperationTimeoutError({ operation, sessionId, timeoutMs });
        lifecycle.runtimeUnhealthy = {
            phase: err.phase,
            operation,
            sessionId,
            timeoutMs,
            message: err.message,
            at: Date.now()
        };
    }

    return createRuntimeUnhealthyError(lifecycle);
}

export async function waitForNativeOperationBoundary(promise, timeoutMs, label, hardStopConfig) {
    if (!hardStopConfig.enabled || timeoutMs <= 0) {
        await promise;
        return { timedOut: false };
    }

    let timer;

    const boundaryPromise = promise.then(
        () => ({ timedOut: false }),
        (err) => {
            throw err;
        }
    );

    const timeoutPromise = new Promise((resolve) => {
        timer = setTimeout(() => {
            resolve({ timedOut: true, label, timeoutMs });
        }, timeoutMs);
    });

    return Promise.race([boundaryPromise, timeoutPromise]).finally(() => {
        clearTimeout(timer);
    });
}
