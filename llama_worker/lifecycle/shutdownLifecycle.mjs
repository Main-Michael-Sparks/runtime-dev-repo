export function createShutdownLifecycle({
    state,
    requests,
    boundaries,
    createPromptAbortError,
    disposeModelStack
}) {
    async function shutdownWorker() {
        state.shuttingDown = true;

        const records = requests.abortActiveRequests(
            () => true,
            (record) => createPromptAbortError("Runtime shutdown", {
                requestId: record.id,
                sessionId: record.sessionId
            })
        );

        await boundaries.waitForActiveRequestBoundaries(records);
        await disposeModelStack({ operation: "shutdown" });
    }

    return {
        shutdownWorker
    };
}
