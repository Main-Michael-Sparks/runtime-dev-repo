export function createModelLifecycle({
    state,
    baseConfig,
    deepFreeze,
    getLlama,
    disposeAllSessions,
    disposeModelWithPolicy,
    resolveModelDisposalPolicy,
    postReady
}) {
    function assertWorkerReadyForNativeCommand() {
        if (state.resetting || state.shuttingDown) {
            throw new Error("Model is resetting");
        }

        if (!state.ready || !state.model) {
            throw new Error("Worker not ready");
        }
    }

    function setActiveInitConfig(msg) {
        if (state.initPromise || state.model || state.ready) return;

        state.activeConfig = msg.configSnapshot
            ? deepFreeze(msg.configSnapshot)
            : baseConfig;
        state.activeInitAttemptId = msg.initAttemptId ?? null;
        state.activeProfileName = msg.profileName ?? "base";
    }

    function resetActiveInitConfig() {
        state.activeConfig = baseConfig;
        state.activeInitAttemptId = null;
        state.activeProfileName = null;
    }

    async function disposeModelStack({ operation } = {}) {
        await disposeAllSessions(state.sessions);

        const modelDisposalPolicy = resolveModelDisposalPolicy({ operation });
        const modelDisposalOutcome = await disposeModelWithPolicy({
            model: state.model,
            policy: modelDisposalPolicy
        });

        state.model = null;
        state.ready = false;
        state.initPromise = null;
        resetActiveInitConfig();

        return modelDisposalOutcome;
    }

    async function initModel() {
        if (state.initPromise) return state.initPromise;

        state.initPromise = (async () => {
            const llama = await getLlama();

            state.model = await llama.loadModel({
                modelPath: state.modelPath,
                gpuLayers: state.activeConfig.modelLoad.gpuLayers,
                useMmap: state.activeConfig.modelLoad.useMmap,
                useMlock: state.activeConfig.modelLoad.useMlock,
                ignoreMemorySafetyChecks: state.activeConfig.modelLoad.ignoreMemorySafetyChecks
            });

            state.ready = true;
            state.resetting = false;
            state.shuttingDown = false;

            postReady({
                initAttemptId: state.activeInitAttemptId,
                profileName: state.activeProfileName
            });
        })();

        return state.initPromise;
    }

    return {
        assertWorkerReadyForNativeCommand,
        setActiveInitConfig,
        resetActiveInitConfig,
        disposeModelStack,
        initModel
    };
}
