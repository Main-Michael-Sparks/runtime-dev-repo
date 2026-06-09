export function toContextCreateOptions(contextConfig) {
    return {
        contextSize: contextConfig.contextSize,
        batchSize: contextConfig.batchSize,
        threads: contextConfig.threads,
        flashAttention: contextConfig.flashAttention,
        performanceTracking: contextConfig.performanceTracking,
        sequences: contextConfig.sequences,
        failedCreationRemedy: contextConfig.failedCreationRemedy,
        ignoreMemorySafetyChecks: contextConfig.ignoreMemorySafetyChecks
    };
}

export function buildContextCreationError({ sessionId, attemptedProfiles, lastError }) {
    const err = new Error(
        `Context creation failed after ${attemptedProfiles.length} attempt(s). ` +
        `Session: ${sessionId}. ` +
        `Attempted profiles: ${attemptedProfiles.join(", ")}. ` +
        `Last error: ${lastError?.message ?? String(lastError)}`
    );

    err.sessionId = sessionId;
    err.attemptedContextProfiles = attemptedProfiles;
    err.lastError = lastError;

    return err;
}
