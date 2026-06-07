export function createSessionService({
    state,
    boundaries,
    contextRetryService,
    disposeSessionById,
    requests,
    createPromptAbortError
}) {
    function findEvictableSessionId() {
        for (const sessionId of state.sessions.keys()) {
            if (!boundaries.hasActiveRequestForSession(sessionId)) {
                return sessionId;
            }
        }

        return null;
    }

    async function getSession(sessionId, requestId = null) {
        if (!state.model) throw new Error("Model not initialized");

        if (state.sessions.has(sessionId)) return state.sessions.get(sessionId);

        if (state.sessions.size >= state.activeConfig.sessions.maxCount) {
            const evictableSessionId = findEvictableSessionId();

            if (!evictableSessionId) {
                throw new Error("Cannot create session: all sessions are active");
            }

            await disposeSessionById(state.sessions, evictableSessionId);
        }

        const wrapper = await contextRetryService.createSessionContextWithRetry(sessionId, requestId);
        state.sessions.set(sessionId, wrapper);

        return wrapper;
    }

    async function resetSession(sessionId) {
        const records = requests.abortActiveRequests(
            (record) => record.sessionId === sessionId,
            (record) => createPromptAbortError(`Session reset: ${sessionId}`, {
                requestId: record.id,
                sessionId
            })
        );

        await boundaries.waitForActiveRequestBoundaries(records);
        await disposeSessionById(state.sessions, sessionId);
    }

    return {
        findEvictableSessionId,
        getSession,
        resetSession
    };
}
