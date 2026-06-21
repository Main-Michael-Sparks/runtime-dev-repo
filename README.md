# Runtime Dev Runtime

This repository is the active development tree for Michael Sparks' local `node-llama-cpp` runtime.

The current codebase is organized around a stable public runtime entrypoint, a parent-side runtime layer, and a worker-side model/native execution boundary.

## Current source shape

```text
runtime.mjs                 public runtime API / composition root
workerBridge.mjs            stable worker bridge to ./llama_worker/llama.mjs
runtime/                    parent runtime modules
  bus/                      action/result/event/context contracts plus first execute-action behavior seam
  router/                   contract-only capability router metadata, registry, and route-plan helpers
  backends/                 backend adapter contracts plus executable nativeWorker adapter seam
  execution/                contract-only capability execution descriptor and executor skeleton handoff helpers
  models/                   contract-only model bundle metadata and registry helpers
  profiles/                 contract-only hardware profile metadata and registry helpers
  config/                   base config, config override validation, retry/profile helpers
  lifecycle/                init/reset/shutdown/native-boundary coordinators
  observability/            trace helpers
  request/                  request creation, scheduler, settlement helpers
  stream/                   token normalization and parent-side stream shaping
llama_worker/               worker/native/model boundary modules
  llama.mjs                 worker composition root
  cancellation/             active request registry and request-boundary helpers
  context/                  context options and context retry service
  errors/                   worker prompt abort error helper
  lifecycle/                model/reset/shutdown lifecycle services
  messages/                 worker outbound messages and protocol router
  prompt/                   chunk creation and prompt runner
  serialization/            worker operation queue
  session/                  session service and disposal helpers
  state/                    worker state factory
```

Public consumers should import from `runtime.mjs`. Internal modules should preserve the existing parent/runtime and worker/native boundaries.

`runtime/bus/` remains contract-first, but the execute-action namespace now includes a public dispatch composition seam, a narrow action/request registry, a live action-event subscription registry, a bounded in-memory action-event history/readback helper, a small retained-replay/live-join helper, a live-only action stream-delta observer helper, and a contract-first future event-log store seam plus a no-adapter runtime integration helper under `runtime/bus/actionEventLog/`. `runtime/bus/actionEventHistory.mjs` owns retained event history, retention, sequence assignment, and read/query behavior for `readActionEvents(...)`. `runtime/bus/actionEventReplay.mjs` owns optional in-process retained replay plus the live join buffer/dedupe path for `subscribeActionEvents(..., { replay: true })`. `runtime/bus/actionStreamDeltaEvents.mjs` maps injected parent-side request stream observations into opt-in live `action.stream.delta` events without owning stream shaping, retention, replay, durable storage, worker routing, or backend execution. `runtime/bus/executeAction/capabilityBusExecuteActionDispatch.mjs` accepts raw action envelopes for the built-in `text.generate -> nativeWorkerBackend` route, composes them through the existing Capability Bus / Router / Service / Backend Adapter / Execution Plan chain, normalizes the accepted plan into an orchestration descriptor, and then delegates to the existing execute-action behavior seam. The default route registry lives in `runtime/bus/executeAction/defaultExecuteActionRegistries.mjs`. `runtime/bus/executeAction/actionRequestRegistry.mjs` tracks active `actionId -> requestId` mappings so public `cancelAction(actionId)` can delegate to the existing `cancelPrompt(requestId)` path and so parent-side stream observations can map request IDs back to active actions. `runtime/bus/actionEventSubscriptionRegistry.mjs` owns in-process listener registration, actionId/runId/type/capability filtering, unsubscribe behavior, stream-delta opt-in gating, and live publication of normalized action events from the execute-action outcome/stream-observation seams. `runtime/bus/actionEventLog/actionEventLogIntegration.mjs` owns the optional append handoff to an injected event-log adapter and defaults to a no-adapter no-op; it does not choose a DB/file backend, expose a public setter, read durable events, or retain stream deltas. These modules do not own scheduler state, import `workerBridge`, import `llama_worker`, or bypass the upstream descriptor chain.

`runtime/router/` is currently a contract-only namespace. It owns capability router metadata, registry, route-plan validation, and route/model-bundle/hardware-profile compatibility helpers for future Capability Router work; it does not execute actions, call services, call backends, change public runtime APIs, or touch worker behavior.

`runtime/backends/` still owns generic backend adapter metadata, registries, plans, and backend invocation descriptors. `runtime/backends/nativeWorker/nativeWorkerBackendExecution.mjs` now adds the first executable adapter seam for the canonical `native-worker.default` text-generation route. The adapter validates the accepted upstream nativeWorkerBackend/text.generate selection and calls an injected parent-owned `runNativeTextRequest()` helper; it does not own queueing, stream shaping, lifecycle, worker messaging, model loading, or direct `workerBridge`/`llama_worker` access.

`runtime/execution/` is currently a contract-only namespace. It defines metadata-only capability execution plan descriptors from approved backend adapter plans and executor skeleton handoff descriptors for future execution wiring; it does not implement `executeAction()`, call services, call backend adapters, enqueue requests, stream tokens, or touch worker behavior.

`runtime/models/` is currently a contract-only namespace. It defines model bundle metadata and registry validation helpers for future routing/backend execution work. Requests and plans should refer to model bundles by `modelBundleId`; raw model paths, projector paths, backend process details, and config override payloads remain out of request-facing surfaces. This namespace does not load models, check filesystem paths, change `configOverride`, call backends, or touch worker behavior.

`runtime/profiles/` is currently a contract-only namespace. It defines hardware profile metadata and registry validation helpers for future routing/backend/model-bundle planning work. Requests and plans should refer to configured profiles by `hardwareProfileId`; runtime hardware probing, init retry/degraded config behavior, executable route selection, and backend admission remain separate future/runtime surfaces. This namespace does not probe hardware, change `configOverride`, call backends, validate model-bundle/profile existence, or touch worker behavior.

## Public API

`runtime.mjs` currently exports exactly:

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


### Action event subscription and history v1

`subscribeActionEvents(...)` is a live in-process observation surface for execute-action lifecycle events. It supports all-action listeners plus optional `{ actionId }`, `{ runId }`, `{ type }`, and `{ capability }` filters, and it returns an idempotent unsubscribe function. By default it remains live-only and excludes high-volume `action.stream.delta` events.

```js
const unsubscribe = subscribeActionEvents({ actionId: "act_123" }, (event) => {
    // event.type: action.started, action.completed, action.failed,
    // action.cancelled, or action.timeout for the current v1 execution path.
});

unsubscribe();
```

`subscribeActionEvents(...)` also supports opt-in retained in-memory replay from the existing history helper:

```js
const unsubscribeReplay = subscribeActionEvents({ actionId: "act_123" }, (event) => {
    // Retained matching events are delivered first, then future live events.
}, {
    replay: true,
    afterSequence: 12,
    limit: 25
});

const unsubscribeReplayAll = subscribeActionEvents((event) => {
    // Listener-first replay shorthand.
}, {
    replay: true
});
```

Replay is sequence-deduped at the live join boundary and remains same-process / in-memory only. It is not durable storage. Stream deltas are live-only and are not retained or replayed from history.

`subscribeActionEvents(...)` can observe live stream deltas only when explicitly opted in:

```js
const unsubscribeDeltas = subscribeActionEvents({ actionId: "act_123" }, (event) => {
    // event.type === "action.stream.delta"
    // event.data.delta contains the normalized text chunk.
}, {
    includeStreamDeltas: true
});
```

Stream deltas are published from a parent-side observer after token normalization and before parent stream shaping. They do not receive retained history sequence numbers.

`readActionEvents(filter = {}, options = {})` returns bounded in-memory history/readback for retained started and terminal action events. It supports filters by `actionId`, `runId`, `type`, `capability`, timestamp range, and `afterSequence`, plus a `limit` option.

```js
const history = readActionEvents({ actionId: "act_123" }, { limit: 10 });

console.log(history.events);
console.log(history.cursor.lastSequence);
```

This event surface does not add durable persistence, process-restart recovery, cross-process pub/sub, retained/durable stream-delta storage, or a real `eventLogStoreBackend`. `runtime/bus/actionEventLog/` now defines the contract shape a future event-log store adapter must satisfy and includes a no-adapter runtime integration helper that can observe append failures without changing execute-action behavior. Runtime publication still has no concrete durable adapter, no database/file backend, and no durable read API. Retained/replayable stream-delta policy remains future work.

The static public-entrypoint guard is:

```bash
node ./tests/smokeTestRuntimePublicEntrypointContract.mjs
```

## Fast local checks

Use these before packaging or uploading branch candidates:

```bash
find . -name '*.mjs' -print0 | sort -z | xargs -0 -n1 node --check
node ./tests/tools/checkRuntimeFixtureCoverage.mjs
node ./tests/tools/checkWorkerImportCycles.mjs
node ./tests/smokeTestRuntimePublicEntrypointContract.mjs
node ./tests/smokeTestActionEventHistory.mjs
node ./tests/smokeTestActionEventSubscription.mjs
node ./tests/smokeTestActionEventReplay.mjs
node ./tests/smokeTestActionStreamDeltaEvents.mjs
node ./tests/smokeTestActionEventLogStoreContract.mjs
node ./tests/smokeTestActionEventLogIntegration.mjs
node ./tests/smokeTestActionEnvelopeContract.mjs
node ./tests/smokeTestCapabilityRegistryContract.mjs
node ./tests/smokeTestCapabilityBusContract.mjs
node ./tests/smokeTestCapabilityRouterContract.mjs
node ./tests/smokeTestModelBundleRouteValidation.mjs
node ./tests/smokeTestCapabilityServiceContract.mjs
node ./tests/smokeTestBackendAdapterContract.mjs
node ./tests/smokeTestBackendAdapterExecutionInterface.mjs
node ./tests/smokeTestNativeWorkerBackendContract.mjs
node ./tests/smokeTestCapabilityExecutorContract.mjs
node ./tests/smokeTestCapabilityBusExecutorSkeleton.mjs
node ./tests/smokeTestCapabilityBusExecuteActionContract.mjs
node ./tests/smokeTestCapabilityExecuteActionOrchestration.mjs
node ./tests/smokeTestCapabilityExecuteActionOutcome.mjs
node ./tests/smokeTestNativeWorkerBackendExecutionIntegration.mjs
node ./tests/smokeTestExecuteActionPublicEnvelopeDispatch.mjs
node ./tests/smokeTestExecuteActionCancellation.mjs
node ./tests/smokeTestModelBundleRegistryContract.mjs
node ./tests/smokeTestHardwareProfileRegistryContract.mjs
```

Broader static/mock checks used by recent branches include:

```bash
node ./tests/smokeTestWorkerProtocolContract.mjs
node ./tests/smokeTestWorkerStreamOrdering.mjs
node ./tests/smokeTestWorkerModelPathImmutability.mjs
node ./tests/smokeTestWorkerModelDisposalPolicy.mjs
SKIP_REAL_RUNTIME=1 node ./tests/smokeTestNativeOperationHardStopPolicy.mjs
SKIP_REAL_RUNTIME=1 node ./tests/smokeTestWorkerOperationSerialization.mjs
SKIP_REAL_RUNTIME=1 node ./tests/smokeTestInitThenResetWithoutPriorPrompt.mjs
SKIP_REAL_RUNTIME=1 node ./tests/smokeTestContextCreationRetry.mjs
SKIP_REAL_RUNTIME=1 node ./tests/smokeTestContextCreationCancelBoundary.mjs
SKIP_REAL_RUNTIME=1 node ./tests/smokeTestWorkerNativeCancellationBoundary.mjs
SKIP_REAL_RUNTIME=1 node ./tests/smokeTestDrainShutdown.mjs
SKIP_RUNTIME=1 node ./tests/smokeTestHardwareAwareInitRetry.mjs
```

Real-runtime tests require a working local `node-llama-cpp` and model setup. Mock/sandbox tests are useful regression guards, but they do not prove native/model behavior.

## Documentation

Start with:

```text
docs/README.md
docs/current-architecture.md
docs/feature-readiness.md
```

Historical branch notes are preserved as `docs/dev-notes.01` through the latest `docs/dev-notes.*` file. They are useful checkpoints and caveat records, but current architecture decisions should be read through the current docs first.

## Feature branch guidance

Future features such as embeddings, tool/function calling, or multimodal input should be planned as separate feature branches. Cleanup work should stay separate from feature work and optimization work.

Do not change these boundaries casually:

```text
queue-based concurrency
worker as model/native execution boundary
parent runtime owns request lifecycle
parent-side stream shaping
config as primary tuning surface
careful init/reset/shutdown behavior
prompt/output semantics
model identity/path guardrails
worker protocol shape
```
