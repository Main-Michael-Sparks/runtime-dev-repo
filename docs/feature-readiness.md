# Feature Readiness Notes

Date: 2026-06-09

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

`runtime-native-worker-backend-execution-integration-v1` added the first narrow real execution seam for accepted execute-action orchestration descriptors. `runtime-execute-action-public-envelope-dispatch-v1` extends the public `executeAction(...)` input surface upward so raw action envelopes for the built-in `text.generate -> nativeWorkerBackend` route compose through the existing descriptor chain before reaching that seam. Future capability execution branches should preserve this shape:

```text
raw action envelope where supported
  -> accepted upstream descriptor chain
  -> execute-action behavior seam
  -> selected executable backend adapter
  -> shared parent-owned runtime substrate where applicable
```

Do not bypass the Capability Bus / Router / Service / backend invocation chain by calling `workerBridge` or `llama_worker` directly from backend adapters. New backends should define explicit adapter execution modules and should receive required runtime substrate functions through dependency injection rather than importing `runtime.mjs`.

Likely future branches:

```text
runtime-cancel-action-v1
runtime-action-event-subscription-v1
```

Questions to resolve before broader execute-action work:

```text
additional capability registry defaults beyond text.generate/nativeWorkerBackend
actionId -> requestId cancellation registry
action event subscription/storage surface
per-action timeout scheduling
stream delta materialization policy
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
