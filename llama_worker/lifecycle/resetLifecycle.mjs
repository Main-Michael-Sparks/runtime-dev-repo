export function createResetLifecycle({
    state,
    requests,
    boundaries,
    createPromptAbortError,
    disposeModelStack
}) {
    async function resetModel() {
        state.resetting = true;

        const records = requests.abortActiveRequests(
            () => true,
            (record) => createPromptAbortError("Model reset", {
                requestId: record.id,
                sessionId: record.sessionId
            })
        );

        await boundaries.waitForActiveRequestBoundaries(records);
        await disposeModelStack({ operation: "reset_model" });
    }

    return {
        resetModel
    };
}
