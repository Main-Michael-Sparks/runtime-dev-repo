export const RUNTIME_FIXTURE_FILES = [
    "runtime/config/config.mjs",
    "runtime/config/configOverride.mjs",
    "runtime/config/contextRetryProfiles.mjs",
    "runtime/config/hardwareProbe.mjs",
    "runtime.mjs",
    "runtime/lifecycle/nativeOperationPolicy.mjs",
    "runtime/lifecycle/nativeBoundaryCoordinator.mjs",
    "runtime/request/runtimeRequestSettlement.mjs",
    "runtime/lifecycle/runtimeLifecycleState.mjs",
    "runtime/lifecycle/runtimeSessionResetCoordinator.mjs",
    "runtime/lifecycle/runtimeShutdownCoordinator.mjs",
    "runtime/lifecycle/runtimeInitCoordinator.mjs",
    "runtime/lifecycle/runtimeModelResetCoordinator.mjs",
    "runtime/lifecycle/workerProtocolRouter.mjs",
    "runtime/stream/normalizer.mjs",
    "runtime/observability/observer.mjs",
    "runtime/request/request.mjs",
    "runtime/config/retryProfiles.mjs",
    "runtime/request/scheduler.mjs",
    "runtime/stream/streamController.mjs",
    "workerBridge.mjs",
    "llama_worker/llama.mjs"
];

export const WORKER_ENTRYPOINT = "llama_worker/llama.mjs";
