export async function resetSessionCoordinator(ctx, sessionId = "default") {
    const {
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
    } = ctx;

    assertRuntimeHealthy(lifecycle);

    if (lifecycle.runtimeResetting) {
        throw new Error("Runtime is resetting");
    }

    if (lifecycle.runtimeShuttingDown) {
        throw new Error("Runtime is shutting down");
    }

    const hardStopConfig = resolveNativeOperationHardStopConfig(config);

    const existing = lifecycle.sessionResetWaiters.get(sessionId);
    if (existing?.timedOut) {
        throw new Error(`Session is resetting: ${sessionId}`);
    }

    if (existing) {
        return existing.promise;
    }

    lifecycle.sessionsResetting.add(sessionId);

    let resolveReset;
    let rejectReset;
    const workerBoundary = new Promise((resolve, reject) => {
        resolveReset = resolve;
        rejectReset = reject;
    });

    workerBoundary.catch(() => {});

    const waiter = {
        promise: workerBoundary,
        resolve: resolveReset,
        reject: rejectReset,
        timedOut: false
    };

    lifecycle.sessionResetWaiters.set(sessionId, waiter);

    const reason = `Session reset: ${sessionId}`;
    const canceled = scheduler.cancelBySession(sessionId);
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

    sendToWorker({
        type: "reset_session",
        sessionId
    });

    const result = await waitForNativeOperationBoundary(
        workerBoundary,
        hardStopConfig.resetSessionTimeoutMs,
        `resetSession(${sessionId})`,
        hardStopConfig
    );

    if (result.timedOut) {
        waiter.timedOut = true;
        throw new Error(
            `Session reset timed out after ${hardStopConfig.resetSessionTimeoutMs}ms: ${sessionId}; ` +
            `session remains blocked until reset completes or process restart recovers it`
        );
    }
}
