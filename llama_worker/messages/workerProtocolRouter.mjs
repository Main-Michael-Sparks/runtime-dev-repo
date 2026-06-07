export function createWorkerProtocolRouter({
    state,
    enqueueWorkerOperation,
    modelLifecycle,
    sessionService,
    resetLifecycle,
    shutdownLifecycle,
    promptRunner,
    requests,
    createPromptAbortError,
    postResetDone,
    postModelResetDone,
    postShutdownDone,
    postWorkerError
}) {
    const {
        assertWorkerReadyForNativeCommand,
        setActiveInitConfig,
        initModel
    } = modelLifecycle;
    const { resetSession } = sessionService;
    const { resetModel } = resetLifecycle;
    const { shutdownWorker } = shutdownLifecycle;
    const { handlePromptMessage } = promptRunner;
    const {
        getActiveRequest,
        abortActiveRequestById
    } = requests;

    return async function handleWorkerMessage(msg) {
        try {
            if (msg.type === "init") {
                setActiveInitConfig(msg);
                await initModel();
                return;
            }

            if (msg.type === "cancel") {
                const record = getActiveRequest(msg.id);
                const reason = createPromptAbortError(msg.reason ?? "Prompt canceled", {
                    requestId: msg.id,
                    sessionId: msg.sessionId ?? record?.sessionId ?? null
                });

                abortActiveRequestById(msg.id, reason);
                return;
            }

            if (msg.type === "shutdown") {
                await enqueueWorkerOperation("shutdown", async () => {
                    await shutdownWorker();
                    postShutdownDone();
                });
                return;
            }

            if (msg.type === "reset_session") {
                await enqueueWorkerOperation("reset_session", async () => {
                    assertWorkerReadyForNativeCommand();
                    await resetSession(msg.sessionId);
                    postResetDone({
                        sessionId: msg.sessionId
                    });
                });
                return;
            }

            if (msg.type === "reset_model") {
                await enqueueWorkerOperation("reset_model", async () => {
                    assertWorkerReadyForNativeCommand();
                    await resetModel();
                    postModelResetDone();
                });
                return;
            }

            if (msg.type === "prompt") {
                assertWorkerReadyForNativeCommand();
                await handlePromptMessage(msg);
            }
        } catch (err) {
            const initErrorMeta = msg.type === "init" || msg.initAttemptId !== undefined
                ? {
                      initAttemptId: msg.initAttemptId ?? state.activeInitAttemptId,
                      profileName: msg.profileName ?? state.activeProfileName
                  }
                : {};

            postWorkerError({
                id: msg.id,
                initErrorMeta,
                err,
                sessionId: msg.sessionId || null
            });
        }
    };
}
