import path from "path";
import { fileURLToPath } from "url";

export function resolveWorkerModelPath(importMetaUrl, config) {
    const __dirname = path.dirname(fileURLToPath(importMetaUrl));
    return path.resolve(
        __dirname,
        `${config.modelLoad.baseModel}`
    );
}

export function createWorkerState({ baseConfig, modelPath }) {
    return {
        modelPath,
        model: null,
        ready: false,
        initPromise: null,
        resetting: false,
        shuttingDown: false,
        activeConfig: baseConfig,
        activeInitAttemptId: null,
        activeProfileName: null,
        nextActiveRequestSequence: 0,
        sessions: new Map(),
        activeRequests: new Map(),
        workerOperationChain: Promise.resolve()
    };
}
