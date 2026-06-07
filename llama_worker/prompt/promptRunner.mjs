export function createPromptRunner({
    state,
    requests,
    boundaries,
    sessionService,
    createChunkFactory,
    postStream,
    postDone
}) {
    async function runPromptTask(record, msg) {
        const {
            id,
            text,
            sessionId = "default",
            stream = true
        } = msg;

        await boundaries.waitForPriorSessionRequestBoundaries(sessionId, id);
        requests.synchronizeExternalCancellation(record);

        const obsoleteBeforeSession = requests.buildRequestObsoleteError(id);
        if (obsoleteBeforeSession) throw obsoleteBeforeSession;

        const { session } = await sessionService.getSession(sessionId, id);
        requests.synchronizeExternalCancellation(record);

        const toChunk = createChunkFactory(state.model);

        const result = await session.prompt(text, {
            maxTokens: state.activeConfig.model.maxTokens,
            temperature: state.activeConfig.model.temperature,
            topK: state.activeConfig.model.topK,
            topP: state.activeConfig.model.topP,
            repeatPenalty: state.activeConfig.model.repeatPenalty,
            signal: record.controller.signal,
            stopOnAbortSignal: false,

            onToken(t) {
                requests.synchronizeExternalCancellation(record);
                if (requests.isRequestObsolete(id)) return;
                if (!stream) return;

                const chunk = toChunk(t);

                postStream({
                    id,
                    token: chunk
                });
            }
        });

        const obsoleteAfterPrompt = requests.buildRequestObsoleteError(id);
        if (obsoleteAfterPrompt) throw obsoleteAfterPrompt;

        postDone({
            id,
            res: result
        });
    }

    async function handlePromptMessage(msg) {
        const {
            id,
            sessionId = "default",
            cancelPort = null
        } = msg;

        const record = requests.createActiveRequestRecord({ id, sessionId, cancelPort });
        state.activeRequests.set(id, record);

        record.promise = (async () => {
            try {
                await runPromptTask(record, msg);
            } catch (err) {
                record.error = err;

                if (requests.isPromptAbortError(record, err)) {
                    return;
                }

                throw err;
            } finally {
                record.state = "done";
                state.activeRequests.delete(id);

                try {
                    record.cancelPort?.close();
                } catch {
                    // no-op: port may already be closed
                }
            }
        })();

        await record.promise;
    }

    return {
        runPromptTask,
        handlePromptMessage
    };
}
