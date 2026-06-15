# Current Runtime Architecture

Date: 2026-06-15

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
  capabilityRouterCommon.mjs
  capabilityRouteDefinition.mjs
  capabilityRouterRegistry.mjs
  capabilityRoutePlan.mjs
  capabilityRouterContract.mjs
  capabilityServiceCommon.mjs
  capabilityServiceDefinition.mjs
  capabilityServiceRegistry.mjs
  capabilityServicePlan.mjs
  capabilityServiceContract.mjs
  contextRefs.mjs
  actionEnvelope.mjs
  resultEnvelope.mjs
  actionEvent.mjs

runtime/backends/
  backendAdapterCommon.mjs
  backendAdapterDefinition.mjs
  backendAdapterRegistry.mjs
  backendAdapterPlan.mjs
  backendAdapterContract.mjs

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

`runtime/bus/` is contract-only through `capability-service-contract-v1`. It records the action/result/event/context surface shape, capability definition and registry metadata, bus skeleton intake/result/event helpers, capability router metadata/plan validation helpers, and capability service metadata/registry/plan validation helpers for future Capability Bus branches, but it does not execute actions, call services, call backends, change public runtime APIs, or touch worker behavior.

`runtime/backends/` is contract-only through `backend-adapter-contract-v1`. It records backend adapter descriptor, registry, and service-plan compatibility metadata for future backend adapter selection, but it does not implement backend execution, call services, enqueue runtime requests, change public runtime APIs, or touch worker behavior.

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
