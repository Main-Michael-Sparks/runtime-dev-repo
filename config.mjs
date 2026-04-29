export const config = {
  modelLoad: {
    // Relative path from the worker file location.
    // Example:
    // baseModel: "../../../base/mistral-7b-instruct-v0.2.Q4_K_M.gguf"
    baseModel: "../../../base/mistral-7b-instruct-v0.2.Q4_K_M.gguf",

    // Passed directly into llama.loadModel().
    // Keep conservative until hardware-specific tuning is validated.
    gpuLayers: 0,
    useMmap: true,
    useMlock: false,

    // Model-load memory guard.
    // false → stop if the MODEL itself is too large for available memory/VRAM.
    // true  → try loading anyway. This can help on edge systems, but may also
    //         crash the process if the model really does not fit.
    //
    // This is different from context.ignoreMemorySafetyChecks below:
    // - this one protects MODEL LOADING
    // - the other one protects CONTEXT CREATION / KV-cache allocation
    ignoreMemorySafetyChecks: false,
  },
  context: {
    // - Very small context sizes can also indirectly constrain practical batching.
    contextSize: "auto",

    // Evaluation batch size inside the context.
    // Higher can improve throughput but also increases memory pressure.
    // Keep this at or below your practical context capacity on constrained hardware.
    batchSize: 512,

    // CPU thread hint for token evaluation.
    // Use 0 for maximum available hardware threads.
    // Can also be an object: { ideal, min }.
    threads: {
      ideal: 0,
      min: 1,
    },

    // Flash attention can improve performance on supported setups, but may
    // change memory/performance characteristics. Keep false until validated.
    flashAttention: false,

    // Enables extra context-level timing / metrics overhead for diagnostics.
    performanceTracking: false,

    // Number of sequences allocated in the context.
    // More sequences require more memory.
    // Keep this at 1 unless you intentionally support multiple concurrent
    // generations inside the same context.
    sequences: 1,

    // Automatic fallback only for auto/bounded context sizing.
    // If contextSize is a fixed number, this will not rescue oversized settings.
    failedCreationRemedy: {
      retries: 6,
      autoContextSizeShrink: 0.16,
    },

    // Context-creation memory guard.
    // false → stop if the CONTEXT / KV-cache allocation is too large.
    // true  → try creating the context anyway. This can help on edge systems,
    //         but may also crash the process if there is not enough memory.
    //
    // This is separate from modelLoad.ignoreMemorySafetyChecks:
    // - modelLoad.* affects loading the model weights/backend resources
    // - context.* affects per-context allocation and evaluation memory
    ignoreMemorySafetyChecks: false,
  },

  model: {
    maxTokens: 512,
    temperature: 0.6,
    topK: 40,
    topP: 0.9,
    repeatPenalty: 1.1,
  },

  runtime: {
    // Maximum queued requests only.
    // This does NOT include currently running in-flight requests.
    maxQueueSize: 50,

    // Maximum concurrently running requests.
    // Applied at startup when the scheduler is created; this config is
    // currently treated as static, not hot-reloaded at runtime.
    maxInFlight: 2,

    // Micro-batching smooths stream transport only.
    // Lower = more immediate output, more IPC overhead.
    // Higher = smoother / fewer IPC messages, slightly more latency.
    enableMicroBatching: true,
    microBatchMs: 5,

    // Hybrid chunk shaping:
    // - flush early on whitespace / punctuation boundaries once the buffer is
    //   large enough to avoid tiny fragments
    // - flush immediately if the buffer grows too large
    // - still keep the timer fallback so output does not stall
    flushOnBoundary: true,

    // Avoid flushing extremely small fragments just because they happen to end
    // in a boundary character.
    minBoundaryFlushChars: 8,

    // Safety valve: flush even without boundaries once the buffered chunk grows
    // beyond this size.
    maxBufferedChars: 64,

    // Init retry v1:
    // - same-config cold-worker retry only
    // - attempts means total attempts, including the first attempt
    // - if enabled is false, attempts is forced to 1
    // - readyTimeoutMs still applies when enabled is false
    // - degraded config retry / hardware probing are future phases
    initRetry: {
      enabled: true,
      attempts: 2,
      readyTimeoutMs: 120000,
      retryDelayMs: 1000,
      strategy: "same-config-cold-worker",
    },
  },

  sessions: {
    maxCount: 50,
  },

  stream: {
    // Removes ANSI terminal escape sequences from streamed chunks.
    enableAnsiCleanup: true,

    // Reserved for a future optional debug output path.
    // Not currently wired into the staged modules.
    debugStdout: false,
  },
};
