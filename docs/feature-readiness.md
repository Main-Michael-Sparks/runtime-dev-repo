# Feature Readiness Notes

Date: 2026-06-20

This document records what the current runtime shape makes easier for future feature branches. It is not a feature implementation document.

## General feature branch rule

Feature work should be scoped into explicit branches and should not be mixed with cleanup or optimization.

Before implementation, create a branch plan/spec that identifies:

```text
source base
public API proposal
affected runtime and worker modules
config surface changes
worker protocol changes, if any
tests and real-runtime requirements
explicit non-goals
```

## Execute-action / backend execution readiness

`runtime-native-worker-backend-execution-integration-v1` added the first narrow real execution seam for accepted execute-action orchestration descriptors. `runtime-execute-action-public-envelope-dispatch-v1` extends the public `executeAction(...)` input surface upward so raw action envelopes for the built-in `text.generate -> nativeWorkerBackend` route compose through the existing descriptor chain before reaching that seam. `runtime-cancel-action-v1` adds public `cancelAction(actionId)` by mapping active action IDs to existing request IDs and then delegating to `cancelPrompt(requestId)`, without adding a second worker cancellation path. `runtime-action-event-subscription-v1` adds public `subscribeActionEvents(...)` as a live in-process observation surface for execute-action started and terminal outcome events. `runtime-action-event-history-contract-v1` adds public `readActionEvents(...)` as bounded in-memory history/readback for those same started and terminal events. `runtime-action-event-replay-contract-v1` extends `subscribeActionEvents(...)` with opt-in retained in-memory replay from the existing history helper, using sequence-based live-join dedupe without durable persistence, process-restart recovery, cross-process pub/sub, retained stream deltas, or worker protocol changes. `runtime-action-stream-delta-events-v1` adds opt-in live-only `action.stream.delta` publication from a parent-side stream observer without retaining/replaying deltas or changing worker/backend ownership. `runtime-event-log-store-contract-v1` defines the future event-log store adapter contract under `runtime/bus/actionEventLog/`. `runtime-event-log-store-runtime-wiring-v1` adds a no-adapter runtime integration seam that observes the retained in-memory action event and can hand it to an injected adapter later without adding a concrete durable backend. `runtime-event-log-store-backend-contract-v1` defines metadata-only `eventLogStoreBackend` definition and append/read policy descriptors under `runtime/backends/eventLogStore/`; best-effort, buffered, and fail-closed are policy vocabulary only until a later runtime integration branch wires behavior. Future capability execution branches should preserve this shape:

```text
raw action envelope where supported
  -> accepted upstream descriptor chain
  -> execute-action behavior seam
  -> selected executable backend adapter
  -> shared parent-owned runtime substrate where applicable
cancelAction(actionId)
  -> actionId/requestId registry
  -> existing cancelPrompt(requestId) path
subscribeActionEvents(filter, listener, options)
  -> bus-level replay helper and live action-event subscription registry
  -> live-only by default
  -> optional retained in-memory replay when options.replay is true
  -> opt-in live-only action.stream.delta events when options.includeStreamDeltas is true
  -> stream deltas are not retained or replayed from history
readActionEvents(filter, options)
  -> bus-level bounded in-memory action-event history/readback
  -> no durability, process-restart recovery, cross-process pub/sub, or retained stream-delta materialization
actionEventLog contract and integration helpers
  -> future durable-log adapter entry/result validation plus no-adapter append handoff seam
  -> no database/file backend, no durable read API, and no stream-delta durability by default
eventLogStoreBackend metadata contract
  -> future backend definition and append/read policy descriptors
  -> best-effort, buffered, and fail-closed are vocabulary only; no runtime backend selection or fail-closed behavior exists yet
```

Do not bypass the Capability Bus / Router / Service / backend invocation chain by calling `workerBridge` or `llama_worker` directly from backend adapters. New backends should define explicit adapter execution modules and should receive required runtime substrate functions through dependency injection rather than importing `runtime.mjs`.

Likely future branches:

```text
runtime-event-log-store-backend-integration-plan-spec
runtime-action-event-cross-process-bridge-plan-spec
```

Questions to resolve before broader execute-action work:

```text
additional capability registry defaults beyond text.generate/nativeWorkerBackend
durable action event storage/replay integration beyond the contract-only event-log adapter seam and metadata-only eventLogStoreBackend descriptor
per-action timeout scheduling
retained/durable stream-delta policy
backend lane scheduling for non-text capabilities
real-runtime test requirements per backend
```

## Embedding support readiness

The repo is structurally ready for an embedding-support planning branch because parent/runtime and worker/model responsibilities are now separated.

Likely future branch:

```text
runtime-embedding-support-v1-plan-spec
```

Questions to resolve before code:

```text
same worker or separate embedding worker
shared model instance or separate embedding model/context
new public API versus prompt option
embedding request scheduler lane or shared scheduler
output shape and size limits
config surface for embedding settings
model identity/path guardrails for embedding models
real-runtime test requirements
```

Do not add embedding config or public APIs during cleanup.

## Tool/function calling readiness

Tool/function calling should be a feature-specific branch. It may touch prompt protocol, request options, output shaping, and security boundaries, so it should not be folded into docs cleanup.

Likely future branch:

```text
runtime-tool-calling-support-v1-plan-spec
```

Questions to resolve before code:

```text
tool schema representation
runtime-side tool registry ownership
worker prompt formatting responsibilities
streaming behavior during tool calls
cancellation and reset behavior while tools are pending
security policy and allowed tool surface
test harness shape
```

## Vision / multimodal readiness

Vision or multimodal input needs a research/spec branch before implementation. Upstream llama.cpp has multimodal paths, but this repo should not assume a stable `node-llama-cpp` vision API without confirming the exact supported API and model/projector requirements at implementation time.

Likely future branches:

```text
runtime-vision-support-research-v1
runtime-multimodal-input-support-v1-plan-spec
```

Questions to resolve before code:

```text
whether node-llama-cpp exposes the required multimodal API directly
whether a projector/mmproj file is required
how model identity/path guardrails extend to model/projector pairs
whether multimodal input belongs in prompt options or a separate API
how binary/image data crosses parent runtime -> worker boundary
how cancellation/reset/shutdown apply during multimodal preprocessing
what real-runtime assets are required for testing
```

Do not rename current prompt APIs or config surfaces around vision until the API is confirmed.

## Cleanup outcome from this branch

This cleanup branch prepares the repo for feature work by:

```text
adding current architecture docs
adding feature-readiness docs
indexing historical dev notes
reducing duplicated test fixture manifests
keeping runtime/worker behavior unchanged
```
