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

export function createWorkerProtocolRouter(ctx) {
    const {
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
        settleFailedRequest,
        observeStreamDelta
    } = ctx;

    return function handleWorkerMessage(msg) {
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

            if (typeof observeStreamDelta === "function") {
                try {
                    observeStreamDelta(req.id, token, req);
                } catch {
                    // Stream observers must not affect prompt streaming behavior.
                }
            }

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
    };
}
