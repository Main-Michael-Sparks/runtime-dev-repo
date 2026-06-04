const VALID_SHUTDOWN_MODES = new Set([
    "abort",
    "drain",
    "drain-with-timeout"
]);

function isPlainObject(value) {
    if (value === null || typeof value !== "object") return false;

    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}

function assertPlainObjectOrUndefined(value, name) {
    if (value !== undefined && !isPlainObject(value)) {
        throw new Error(`${name} must be a plain object`);
    }
}

function assertPositiveInteger(value, name) {
    if (!Number.isInteger(value) || value < 1) {
        throw new Error(`${name} must be a positive integer`);
    }
}

function validateShutdownOptions(options = {}) {
    assertPlainObjectOrUndefined(options, "shutdown options");

    const {
        mode = "abort",
        timeoutMs
    } = options;

    if (!VALID_SHUTDOWN_MODES.has(mode)) {
        throw new Error(`Unsupported shutdown mode: ${mode}`);
    }

    if (mode === "drain-with-timeout") {
        if (timeoutMs === undefined) {
            throw new Error("timeoutMs is required for drain-with-timeout shutdown");
        }

        assertPositiveInteger(timeoutMs, "timeoutMs");
    } else if (timeoutMs !== undefined) {
        throw new Error("timeoutMs is only supported for drain-with-timeout shutdown");
    }

    return { mode, timeoutMs };
}

function isInitActive(lifecycle) {
    return lifecycle.initInProgress || (lifecycle.initStarted && !lifecycle.initResolved);
}

function cancelRequestsForShutdown(ctx, reason) {
    const {
        scheduler,
        notifyRequestsCancellationRequested,
        sendToWorker,
        cancelStream,
        traceCanceled,
        traceDelete
    } = ctx;

    const canceled = scheduler.cancelAll();
    notifyRequestsCancellationRequested(canceled, reason);

    for (const req of canceled) {
        sendToWorker({
            type: "cancel",
            id: req.id,
            sessionId: req.sessionId,
            reason
        });

        cancelStream(req);
        traceCanceled(req);
        req.rejectDone(new Error(reason));
        traceDelete(req.id);
    }

    return canceled;
}

async function finalizeWorkerShutdown(ctx) {
    const {
        config,
        lifecycle,
        sendToWorker,
        terminateWorker,
        resolveNativeOperationHardStopConfig,
        markRuntimeUnhealthy,
        waitForNativeOperationBoundary
    } = ctx;

    const hardStopConfig = resolveNativeOperationHardStopConfig(config);

    let resolveShutdown;
    let rejectShutdown;
    const waitForShutdown = new Promise((resolve, reject) => {
        resolveShutdown = resolve;
        rejectShutdown = reject;
    });

    waitForShutdown.catch(() => {});

    lifecycle.shutdownWaiter = {
        resolve: resolveShutdown,
        reject: rejectShutdown
    };

    try {
        sendToWorker({
            type: "shutdown"
        });

        const result = await waitForNativeOperationBoundary(
            waitForShutdown,
            hardStopConfig.shutdownTimeoutMs,
            "shutdown",
            hardStopConfig
        );

        if (result.timedOut) {
            const err = markRuntimeUnhealthy(lifecycle, {
                operation: "shutdown",
                timeoutMs: hardStopConfig.shutdownTimeoutMs
            });
            throw err;
        }

        lifecycle.sessionsResetting.clear();
        lifecycle.sessionResetWaiters.clear();

        await terminateWorker();
    } finally {
        lifecycle.shutdownWaiter = null;
    }
}

async function shutdownAbort(ctx) {
    const { lifecycle, scheduler } = ctx;

    lifecycle.runtimeShuttingDown = true;
    scheduler.setReady(false);
    cancelRequestsForShutdown(ctx, "Runtime shutdown");
    await finalizeWorkerShutdown(ctx);
}

async function shutdownDrain(ctx) {
    const { lifecycle, scheduler } = ctx;

    lifecycle.runtimeShuttingDown = true;
    await scheduler.waitForIdle();
    await finalizeWorkerShutdown(ctx);
}

function waitForSchedulerIdleOrTimeout(scheduler, timeoutMs) {
    let timer;

    const idlePromise = scheduler.waitForIdle().then(() => true);
    const timeoutPromise = new Promise((resolve) => {
        timer = setTimeout(() => {
            resolve(false);
        }, timeoutMs);
    });

    return Promise.race([idlePromise, timeoutPromise]).finally(() => {
        clearTimeout(timer);
    });
}

async function shutdownDrainWithTimeout(ctx, timeoutMs) {
    const { lifecycle, scheduler } = ctx;

    lifecycle.runtimeShuttingDown = true;

    const finishedBeforeTimeout = await waitForSchedulerIdleOrTimeout(scheduler, timeoutMs);

    if (!finishedBeforeTimeout) {
        scheduler.setReady(false);
        cancelRequestsForShutdown(ctx, "Runtime shutdown timeout");
    }

    await finalizeWorkerShutdown(ctx);
}

export async function shutdownRuntimeCoordinator(ctx, options = {}) {
    const {
        config,
        lifecycle,
        resolveNativeOperationHardStopConfig,
        assertRuntimeHealthy,
        assertNoSessionResetInProgress
    } = ctx;

    const { mode, timeoutMs } = validateShutdownOptions(options);
    resolveNativeOperationHardStopConfig(config);
    assertRuntimeHealthy(lifecycle);

    if (lifecycle.runtimeResetting) {
        throw new Error("Runtime is resetting");
    }

    if (lifecycle.runtimeShuttingDown) {
        throw new Error("Runtime is shutting down");
    }

    if (isInitActive(lifecycle)) {
        throw new Error("Model initialization is in progress");
    }

    assertNoSessionResetInProgress("Runtime shutdown");

    if (mode === "abort") {
        await shutdownAbort(ctx);
        return;
    }

    if (mode === "drain") {
        await shutdownDrain(ctx);
        return;
    }

    if (mode === "drain-with-timeout") {
        await shutdownDrainWithTimeout(ctx, timeoutMs);
        return;
    }

    throw new Error(`Shutdown mode is not implemented yet: ${mode}`);
}
