# Current Runtime Architecture

Date: 2026-06-21

This document summarizes the current repo shape after the parent-runtime and Worker Layout Option C modularization arcs.

## Public entrypoints

```text
runtime.mjs                 public runtime API / composition root
workerBridge.mjs            singleton worker bridge
llama_worker/llama.mjs      worker composition root and model/native boundary
```

`runtime.mjs` should remain the consumer-facing module. It exports:

```text
cancelAction
cancelPrompt
executeAction
initModel
prompt
readActionEvents
subscribeActionEvents
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
  actionEventHistory.mjs
  actionEventSubscriptionRegistry.mjs
  actionEventReplay.mjs
  actionStreamDeltaEvents.mjs
  actionEventLog/
    actionEventLogCommon.mjs
    actionEventLogEntry.mjs
    actionEventLogStoreContract.mjs
    actionEventLogIntegration.mjs
  executeAction/
    actionRequestRegistry.mjs
    capabilityBusExecuteActionCommon.mjs
    capabilityBusExecuteActionPlan.mjs
    capabilityBusExecuteActionResult.mjs
    capabilityBusExecuteActionOrchestrationCommon.mjs
    capabilityBusExecuteActionOrchestration.mjs
    capabilityBusExecuteActionOutcomeCommon.mjs
    capabilityBusExecuteActionOutcome.mjs
    capabilityBusExecuteActionExecution.mjs
    defaultExecuteActionRegistries.mjs
    capabilityBusExecuteActionDispatch.mjs
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
  backendAdapterInvocationCommon.mjs
  backendAdapterInvocationDescriptor.mjs
  backendAdapterContract.mjs
  nativeWorker/
    nativeWorkerBackendAdapterDefinition.mjs
    nativeWorkerBackendExecution.mjs
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

`runtime/bus/` is contract-first, with a narrow public execute-action dispatch composition seam above the existing behavior seam, a small action/request registry for public action cancellation, and a live action-event subscription registry for in-process observation. It records the action/result/event/context surface shape, capability definition and registry metadata, bus skeleton intake/result/event helpers, execute-action contract/orchestration descriptors, execute-action result/event outcome descriptors, capability service metadata/registry/plan validation helpers, and compatibility barrels for older capability router import paths. `runtime/bus/executeAction/capabilityBusExecuteActionDispatch.mjs` accepts raw action envelopes for the built-in `text.generate -> nativeWorkerBackend` route, supplies the default registry bundle from `defaultExecuteActionRegistries.mjs`, composes through the accepted descriptor chain, and delegates to `capabilityBusExecuteActionExecution.mjs`. `runtime/bus/executeAction/actionRequestRegistry.mjs` reserves active action IDs before backend request creation, binds accepted actions to request IDs, releases entries when mapped outcomes settle, and lets `cancelAction(actionId)` delegate to the existing `cancelPrompt(requestId)` behavior. `runtime/bus/actionEventSubscriptionRegistry.mjs` owns live subscription registration, actionId/runId/type filtering, normalized event publication, listener-error isolation, and idempotent unsubscribe behavior. The execution seam still owns only orchestration-descriptor execution, selected backend-adapter dispatch, and publication of existing started/terminal outcome events through an injected publisher. These modules do not own queueing, import `workerBridge`, import `llama_worker`, or bypass the upstream descriptor chain.

`runtime/router/` is contract-only through `runtime-model-bundle-route-validation-v1`. It owns capability router metadata/registry/plan validation helpers plus route/model-bundle/hardware-profile compatibility validation for future Capability Router branches, but it does not execute actions, call services, call backends, change public runtime APIs, or touch worker behavior.

`runtime/backends/` records generic backend adapter descriptors, registries, service-plan compatibility metadata, backend adapter invocation descriptors, and the canonical `native-worker.default` native worker backend descriptor contract under `runtime/backends/nativeWorker/`. `runtime/backends/nativeWorker/nativeWorkerBackendExecution.mjs` now implements the first executable adapter seam for accepted nativeWorkerBackend/text.generate orchestration descriptors. The adapter calls an injected parent-owned native text request helper and therefore reuses the existing scheduler, request lifecycle, stream shaping, settlement, lifecycle coordinators, `workerBridge`, and worker boundary indirectly. It does not import `runtime.mjs`, call `workerBridge` directly, import `llama_worker`, create a backend-owned scheduler, or load models.

`runtime/execution/` remains contract-only. It records metadata-only capability execution descriptors derived from approved backend adapter plans plus executor skeleton handoff descriptors. The new execute-action behavior seam consumes those accepted upstream descriptors through the orchestration/backend invocation chain; `runtime/execution/` itself still does not call services, call backend adapters, enqueue runtime requests, change public runtime APIs, or touch worker behavior.

`runtime/models/` is contract-only through `runtime-model-bundle-registry-v1`. It records model bundle metadata, definition validation, registry validation, and lookup helpers for future routing/backend execution work. Route/model-bundle compatibility validation consumes this metadata from `runtime/router/` without moving model-bundle ownership into the router. Model bundle definitions are static metadata only: requests and plans should use `modelBundleId`, while artifact layout details such as model/projector paths stay inside registry metadata. This namespace does not load models, check filesystem paths, change public runtime APIs, expand `configOverride`, or touch worker behavior.

`runtime/profiles/` is contract-only through `runtime-hardware-profile-registry-v1`. It records hardware profile metadata, definition validation, registry validation, and lookup helpers for future routing/backend/model-bundle planning work. Hardware profile definitions are static metadata only: requests and plans should use `hardwareProfileId`, while runtime hardware probing and init retry/degraded configuration remain in runtime/config and lifecycle surfaces. Cross-registry route/profile existence and compatibility validation now lives in `runtime/router/`; this namespace does not probe hardware, change public runtime APIs, expand `configOverride`, execute backends, or touch worker behavior.

Parent-side responsibilities:

```text
request lifecycle ownership
queue-based concurrency
prompt admission
request cancellation/settlement
actionId-to-requestId cancellation mapping
live action-event subscription, bounded in-memory action-event readback, optional retained in-memory replay/live join, started/terminal event publication, opt-in live-only stream-delta publication for executeAction, contract-only future event-log store adapter validation, and metadata-only future event-log backend definition/policy descriptors
init/reset/shutdown coordination
native timeout/unhealthy-state handling
parent-side stream shaping
worker message routing
executeAction dependency injection through the public raw-envelope dispatch seam into the first nativeWorkerBackend seam
cancelAction mapping through the execute-action registry into the existing cancelPrompt path
subscribeActionEvents mapping through the bus-level replay helper, live action-event subscription registry, and bounded in-memory history helper when replay is enabled
readActionEvents mapping through the bus-level bounded in-memory action-event history helper
```


## Action event surface

The action-event surface is intentionally split across small bus modules:

```text
actionEvent.mjs
  validation and normalization of action-event envelopes

actionEventSubscriptionRegistry.mjs
  live same-process listener registration, actionId/runId/type/capability filtering, stream-delta opt-in gating, publication, and unsubscribe behavior

actionEventHistory.mjs
  bounded in-memory retention, sequence assignment, duplicate retained eventId rejection, and read/query behavior

actionEventReplay.mjs
  optional retained in-memory replay plus live-join buffering/dedupe for subscribeActionEvents(..., { replay: true })

actionStreamDeltaEvents.mjs
  live-only action.stream.delta mapping from injected parent-side request stream observations

actionEventLog/
  future event-log store constants, append/read entry validation, adapter validation, cursor/read-result shape validation, high-volume event policy, and a no-adapter runtime integration helper for optional append handoff

runtime/backends/eventLogStore/
  metadata-only event-log backend definition and append/read policy descriptors for future eventLogStoreBackend implementations
```

Replay is opt-in. Default `subscribeActionEvents(...)` behavior remains live-only. High-volume `action.stream.delta` events are also opt-in through `{ includeStreamDeltas: true }`, are published live-only, and are not retained in `actionEventHistory` or replayed from history. Replay uses retained in-memory history only. `runtime/bus/actionEventLog/` defines the v1 append/read adapter contract for future durable event-log adapters and provides a no-adapter runtime integration seam. `runtime/backends/eventLogStore/` defines metadata-only backend definition and policy descriptors for future `eventLogStoreBackend` implementations. It names best-effort, buffered, and fail-closed policy vocabulary, but it does not add concrete durable persistence, process-restart recovery, cross-process pub/sub, retained/durable stream-delta storage, durable read APIs, runtime backend selection, or active fail-closed behavior.

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

Mock/sandbox smoke tests are valuable for regression control, but they do not prove native/model behavior. Branches that touch init, reset, shutdown, worker cancellation, context creation, prompt streaming, or real execute-action/backend execution still need real-runtime verification unless Michael explicitly waives it.
