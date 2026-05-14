export const config = {
    modelLoad: {
        baseModel: "../../../base/mistral-7b-instruct-v0.2.Q4_K_M.gguf",
        gpuLayers: 0,
        useMmap: true,
        useMlock: false,
        ignoreMemorySafetyChecks: false
    },

    context: {
        contextSize: "auto",
        batchSize: 512,
        threads: {
            ideal: 0,
            min: 1
        },
        flashAttention: false,
        performanceTracking: false,
        sequences: 1,
        failedCreationRemedy: {
            retries: 6,
            autoContextSizeShrink: 0.16
        },
        ignoreMemorySafetyChecks: false,

        creationRetry: {
            enabled: true,
            maxAttempts: 4,
            fallbackContextSize: {
                min: 1024,
                max: 4096
            },
            allowHardwareDerivedBounds: true,
            minContextSize: 1024,
            maxContextSize: 4096,
            contextSizeShrinkRatio: 0.5,
            allowBatchReduction: true,
            fallbackBatchSize: 256,
            allowThreadFallback: true,
            fallbackThreads: {
                ideal: 0,
                min: 1
            },
            allowFlashAttentionFallback: true
        }
    },

    model: {
        maxTokens: 512,
        temperature: 0.6,
        topK: 40,
        topP: 0.9,
        repeatPenalty: 1.1
    },

    runtime: {
        maxQueueSize: 50,
        maxInFlight: 2,

        enableMicroBatching: true,
        microBatchMs: 5,
        flushOnBoundary: true,
        minBoundaryFlushChars: 8,
        maxBufferedChars: 64,

        initRetry: {
            enabled: true,
            attempts: 2,
            readyTimeoutMs: 120000,
            retryDelayMs: 1000,
            strategy: "same-config-cold-worker",

            hardwareAware: {
                enabled: false,
                probe: true,
                maxProfiles: 3,
                allowCpuModelLoadFallback: true,
                allowBatchReduction: true,
                allowContextAutoFallback: true
            }
        },

        nativeOperationHardStop: {
            enabled: true,
            resetModelTimeoutMs: 120000,
            shutdownTimeoutMs: 120000,
            resetSessionTimeoutMs: 120000,
            timeoutAction: "mark-unhealthy"
        }
    },

    sessions: {
        maxCount: 50
    },

    stream: {
        enableAnsiCleanup: true,
        debugStdout: false
    }
};
