export function createContextRetryService({
    state,
    LlamaChatSession,
    buildContextRetryProfiles,
    requests,
    toContextCreateOptions,
    buildContextCreationError,
    disposePartialSessionArtifacts
}) {
    function buildContextCreationObsoleteError(requestId) {
        const requestObsoleteError = requests.buildRequestObsoleteError(requestId);
        if (requestObsoleteError) return requestObsoleteError;

        if (state.resetting || state.shuttingDown || !state.ready || !state.model) {
            return new Error("Model is resetting");
        }

        return null;
    }

    async function createSessionContextWithRetry(sessionId, requestId = null) {
        const profiles = buildContextRetryProfiles({
            baseContextConfig: state.activeConfig.context,
            creationRetry: state.activeConfig.context.creationRetry,
            hardwareProbe: state.activeConfig.hardwareProbe ?? null
        });

        const attemptedProfiles = [];
        let lastError = null;

        for (const profile of profiles) {
            const obsoleteBeforeAttempt = buildContextCreationObsoleteError(requestId);
            if (obsoleteBeforeAttempt) throw obsoleteBeforeAttempt;

            attemptedProfiles.push(profile.name);

            let context = null;
            let session = null;
            let contextController = null;
            const record = requests.getActiveRequest(requestId);

            try {
                contextController = new AbortController();

                if (record) {
                    record.contextController = contextController;
                    requests.synchronizeExternalCancellation(record, "Context creation canceled");
                }

                const obsoleteBeforeCreate = buildContextCreationObsoleteError(requestId);
                if (obsoleteBeforeCreate) throw obsoleteBeforeCreate;

                context = await state.model.createContext({
                    ...toContextCreateOptions(profile.context),
                    createSignal: contextController.signal
                });

                if (typeof context.getSequence !== "function") {
                    throw new Error("Context does not expose getSequence()");
                }

                const sequence = context.getSequence();

                session = new LlamaChatSession({
                    contextSequence: sequence
                });
            } catch (err) {
                lastError = err;
                await disposePartialSessionArtifacts({ session, context });

                const obsoleteAfterFailure = buildContextCreationObsoleteError(requestId);
                if (obsoleteAfterFailure) throw obsoleteAfterFailure;

                continue;
            } finally {
                if (record?.contextController === contextController) {
                    record.contextController = null;
                }
            }

            const wrapper = {
                session,
                context,
                contextProfile: profile.name,
                contextConfig: profile.context
            };

            const obsoleteAfterSuccess = buildContextCreationObsoleteError(requestId);
            if (obsoleteAfterSuccess) {
                await disposePartialSessionArtifacts(wrapper);
                throw obsoleteAfterSuccess;
            }

            return wrapper;
        }

        throw buildContextCreationError({
            sessionId,
            attemptedProfiles,
            lastError
        });
    }

    return {
        buildContextCreationObsoleteError,
        createSessionContextWithRetry
    };
}
