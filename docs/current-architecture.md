# Current Runtime Architecture

Date: 2026-06-18

This document summarizes the current repo shape after the parent-runtime and Worker Layout Option C modularization arcs.

## Public entrypoints

```text
runtime.mjs                 public runtime API / composition root
workerBridge.mjs            singleton worker bridge
llama_worker/llama.mjs      worker composition root and model/native boundary
```

`runtime.mjs` should remain the consumer-facing module. It exports:

```text
cancelPrompt
initModel
prompt
resetModel
resetSession
shutdownRuntime
```

The guard for that contract is:

```bash
node ./tests/smokeTestRuntimePublicEntrypointContract.mjs
```

## Parent runtime layout

```text
runtime/bus/
  contractValidation.mjs
  capabilityTaxonomy.mjs
  capabilityDefinition.mjs
  capabilityRegistryContract.mjs
  capabilityBusContract.mjs
  capabilityBusResult.mjs
  capabilityBusEvents.mjs
  executeAction/
    capabilityBusExecuteActionCommon.mjs
    capabilityBusExecuteActionPlan.mjs
    capabilityBusExecuteActionResult.mjs
    capabilityBusExecuteActionContract.mjs
  capabilityServiceCommon.mjs
  capabilityServiceDefinition.mjs
  capabilityServiceRegistry.mjs
  capabilityServicePlan.mjs
  capabilityServiceContract.mjs
  capabilityRouterCommon.mjs       compatibility barrel to runtime/router/
  capabilityRouteDefinition.mjs    compatibility barrel to runtime/router/
  capabilityRouterRegistry.mjs     compatibility barrel to runtime/router/
  capabilityRoutePlan.mjs          compatibility barrel to runtime/router/
  capabilityRouterContract.mjs     compatibility barrel to runtime/router/
  contextRefs.mjs
  actionEnvelope.mjs
  resultEnvelope.mjs
  actionEvent.mjs

runtime/router/
  capabilityRouterCommon.mjs
  capabilityRouteDefinition.mjs
  capabilityRouterRegistry.mjs
  capabilityRoutePlan.mjs
  capabilityRouteModelBundlePlan.mjs
  capabilityRouterContract.mjs

runtime/backends/
  backendAdapterCommon.mjs
  backendAdapterDefinition.mjs
  backendAdapterRegistry.mjs
  backendAdapterPlan.mjs
  backendAdapterContract.mjs
  nativeWorker/
    nativeWorkerBackendAdapterDefinition.mjs
    nativeWorkerBackendContract.mjs

runtime/execution/
  capabilityExecutionCommon.mjs
  capabilityExecutionPlan.mjs
  capabilityExecutorSkeletonCommon.mjs
  capabilityExecutorSkeletonPlan.mjs
  capabilityExecutorContract.mjs

runtime/models/
  modelBundleCommon.mjs
  modelBundleDefinition.mjs
  modelBundleRegistry.mjs
  modelBundleContract.mjs

runtime/profiles/
  hardwareProfileCommon.mjs
  hardwareProfileDefinition.mjs
  hardwareProfileRegistry.mjs
  hardwareProfileContract.mjs

runtime/config/
  config.mjs
  configOverride.mjs
  contextRetryProfiles.mjs
  hardwareProbe.mjs
  retryProfiles.mjs

runtime/lifecycle/
  nativeBoundaryCoordinator.mjs
  nativeOperationPolicy.mjs
  runtimeInitCoordinator.mjs
  runtimeLifecycleState.mjs
  runtimeModelResetCoordinator.mjs
  runtimeSessionResetCoordinator.mjs
  runtimeShutdownCoordinator.mjs
  workerProtocolRouter.mjs

runtime/observability/
  observer.mjs

runtime/request/
  request.mjs
  runtimeRequestSettlement.mjs
  scheduler.mjs

runtime/stream/
  normalizer.mjs
  streamController.mjs
```

`runtime/bus/` is contract-only through `capability-bus-execute-action-contract-v1`. It records the action/result/event/context surface shape, capability definition and registry metadata, bus skeleton intake/result/event helpers, the bus-facing execute-action contract seam under `runtime/bus/executeAction/`, capability service metadata/registry/plan validation helpers, and compatibility barrels for older capability router import paths, but it does not execute actions, call services, call backends, change public runtime APIs, or touch worker behavior.

`runtime/router/` is contract-only through `runtime-model-bundle-route-validation-v1`. It owns capability router metadata/registry/plan validation helpers plus route/model-bundle/hardware-profile compatibility validation for future Capability Router branches, but it does not execute actions, call services, call backends, change public runtime APIs, or touch worker behavior.

`runtime/backends/` is contract-only through `runtime-native-worker-backend-contract-v1`. It records generic backend adapter descriptor, registry, and service-plan compatibility metadata plus the canonical `native-worker.default` native worker backend descriptor contract under `runtime/backends/nativeWorker/`. The native worker backend contract identifies the current built-in text-generation worker path by metadata only; it does not implement backend execution, call services, call `workerBridge`, import `llama_worker`, enqueue runtime requests, load models, change public runtime APIs, or touch worker behavior.

`runtime/execution/` is contract-only through `runtime-capability-bus-executor-skeleton-v1`. It records metadata-only capability execution descriptors derived from approved backend adapter plans plus executor skeleton handoff descriptors for future behavior-wiring branches. It does not implement `executeAction()`, call services, call backend adapters, enqueue runtime requests, change public runtime APIs, or touch worker behavior.

`runtime/models/` is contract-only through `runtime-model-bundle-registry-v1`. It records model bundle metadata, definition validation, registry validation, and lookup helpers for future routing/backend execution work. Route/model-bundle compatibility validation consumes this metadata from `runtime/router/` without moving model-bundle ownership into the router. Model bundle definitions are static metadata only: requests and plans should use `modelBundleId`, while artifact layout details such as model/projector paths stay inside registry metadata. This namespace does not load models, check filesystem paths, change public runtime APIs, expand `configOverride`, or touch worker behavior.

`runtime/profiles/` is contract-only through `runtime-hardware-profile-registry-v1`. It records hardware profile metadata, definition validation, registry validation, and lookup helpers for future routing/backend/model-bundle planning work. Hardware profile definitions are static metadata only: requests and plans should use `hardwareProfileId`, while runtime hardware probing and init retry/degraded configuration remain in runtime/config and lifecycle surfaces. Cross-registry route/profile existence and compatibility validation now lives in `runtime/router/`; this namespace does not probe hardware, change public runtime APIs, expand `configOverride`, execute backends, or touch worker behavior.

Parent-side responsibilities:

```text
request lifecycle ownership
queue-based concurrency
prompt admission
request cancellation/settlement
init/reset/shutdown coordination
native timeout/unhealthy-state handling
parent-side stream shaping
worker message routing
```

## Worker layout

```text
llama_worker/llama.mjs
llama_worker/cancellation/
llama_worker/context/
llama_worker/errors/
llama_worker/lifecycle/
llama_worker/messages/
llama_worker/prompt/
llama_worker/serialization/
llama_worker/session/
llama_worker/state/
```

Worker-side responsibilities:

```text
model loading and disposal
session/context creation and disposal
context creation retry
active request tracking
native prompt cancellation boundaries
worker operation serialization
prompt execution
worker outbound protocol messages
```

The worker remains the model/native execution boundary. Parent runtime modules should not import `node-llama-cpp` directly.

## Boundaries to preserve

```text
queue-based concurrency stays parent-side
worker remains model/native execution boundary
parent runtime owns request lifecycle
stream shaping remains parent-side
config remains the primary tuning surface
model identity/path must not become overrideable accidentally
prompt/output semantics must not drift during cleanup
worker protocol shape must remain stable
init/reset/shutdown behavior must stay carefully guarded
```

## Test organization

Current-contract smoke tests live under `tests/`. Legacy/reference tests live under `tests/legacy/`.

Shared fixture helpers live under:

```text
tests/helpers/runtimeFixtureFiles.mjs
tests/helpers/copyRuntimeFixture.mjs
tests/helpers/directWorkerHarness.mjs
```

The runtime fixture manifest is the authoritative list for fixture-copy tests. Guard it with:

```bash
node ./tests/tools/checkRuntimeFixtureCoverage.mjs
```

Worker import shape is guarded by:

```bash
node ./tests/tools/checkWorkerImportCycles.mjs
```

## Diagnostic real-runtime test

`tests/smokeTestRealRuntimeContextCancelShutdownDiagnostics.mjs` is a diagnostic real-runtime investigation test, not a default always-run smoke. Keep it available for native/runtime investigation, but do not treat it as part of the fast mock baseline.

## Real-runtime note

Mock/sandbox smoke tests are valuable for regression control, but they do not prove native/model behavior. Branches that touch init, reset, shutdown, worker cancellation, context creation, or prompt streaming still need real-runtime verification unless Michael explicitly waives it.
