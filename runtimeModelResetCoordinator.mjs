function cancelRequestsForModelReset(ctx, reason) {
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

export async function resetModelCoordinator(ctx) {
    const {
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
        assertNoSessionResetInProgress,
        reinitializeModelAfterReset,
        createInitCoordinatorContext
    } = ctx;

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

    cancelRequestsForModelReset(ctx, "Model reset");

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
