# Dev Notes 34 — Runtime Action Envelope Contract v1

**Date:** 2026-06-14  
**Branch:** `runtime-action-envelope-contract-v1`  
**Repo:** `Main-Michael-Sparks/runtime-dev-repo`  
**Status:** Merged to `main` via PR #13 / merge commit `ebaf104`. Michael-local syntax, contract smoke, helper, and public-entrypoint checks passed before merge. Direct GitHub source/file verification was completed after push and again after merge. The branch remains contract-only and does not touch runtime execution, worker behavior, lifecycle behavior, cancellation, context creation, prompt streaming, or model/native execution.

---

## Purpose

Add contract-only Runtime Dev substrate modules for the future Capability Bus action surface defined by Runtime System Blueprint v1.

This branch establishes typed local contracts for:

```text
validation/reporting helpers
capability taxonomy
context references
action envelopes
result envelopes
action events
```

The branch keeps Runtime Dev graph-compatible without making it graph-dependent. It creates reusable contract modules only; it does not implement action execution.

---

## Files added

```text
runtime/bus/contractValidation.mjs
runtime/bus/capabilityTaxonomy.mjs
runtime/bus/contextRefs.mjs
runtime/bus/actionEnvelope.mjs
runtime/bus/resultEnvelope.mjs
runtime/bus/actionEvent.mjs
tests/smokeTestActionEnvelopeContract.mjs
docs/dev-notes.34
```

## Files modified

```text
README.md
docs/current-architecture.md
docs/README.md
```

The docs changes are limited to source-shape/index propagation for the new contract-only `runtime/bus/` namespace.

## File that should not remain on main

```text
STAGED-BRANCH-NOTES.md
```

`STAGED-BRANCH-NOTES.md` was useful in the staged handoff package, but it contains stale pre-merge language and should be removed from `main` in a docs-only cleanup commit. The durable branch record is this dev note plus the normal repo history.

---

## Modular design shape

The new `runtime/bus/` namespace is intentionally split by contract responsibility:

```text
contractValidation.mjs       shared validation result/error helpers and safe object checks
capabilityTaxonomy.mjs       frozen v1 capability/status/event/source-kind constants
contextRefs.mjs              context reference validation and normalization
actionEnvelope.mjs           action request contract validation/normalization
resultEnvelope.mjs           normalized result/error contract validation/creation
actionEvent.mjs              action event contract validation/creation
```

This shape avoids creating a broad bus executor or router prematurely.

Later Capability Bus branches may import these helpers, but this branch does not wire them into runtime execution.

---

## Contract behavior summary

### Validation helpers

`runtime/bus/contractValidation.mjs` provides structured validation results:

```js
{
    ok: false,
    value: null,
    errors: [
        {
            path: "capability",
            code: "unknown_capability",
            message: "Unknown capability: text.foo"
        }
    ]
}
```

It also provides shared guards for plain objects, non-empty strings, finite non-negative numbers, forbidden key detection, and assertion conversion from validation result to thrown `Error`.

### Capability taxonomy

`runtime/bus/capabilityTaxonomy.mjs` defines frozen v1 constants and helpers for:

```text
CAPABILITIES
ACTION_STATUSES
ACTION_EVENT_TYPES
ACTION_SOURCE_KINDS
```

The v1 capability surface remains blueprint-aligned:

```text
text.generate
text.embed
text.rerank
retrieval.search
memory.search
memory.read
memory.write
checkpoint.export
checkpoint.import
vision.chat
tool.call
```

No `knowledge.*` capability was added in this branch. Knowledge DB / recall semantics remain future design work.

### Context references

`runtime/bus/contextRefs.mjs` treats context as references only, not path strings, model paths, file paths, raw payloads, or backend-specific shapes.

Accepted examples include:

```text
ctx_1
mem_project_runtime_001
doc:runtime-blueprint
checkpoint:last-safe
trace:run_123
artifact:report_1
```

Rejected examples include path/model-path-like values such as:

```text
../secret.txt
C:\models\model.gguf
/home/user/model.gguf
modelPath:../../../base/model.gguf
```

### Action envelopes

`runtime/bus/actionEnvelope.mjs` validates and normalizes future action intents for fields such as:

```text
actionId
runId
source.kind
capability
intent
input
input.contextRefs
requirements
policy
trace
```

It also rejects backend/model/tool-process leakage keys so graph/control-layer callers cannot smuggle backend-specific execution details into action contracts.

### Result envelopes

`runtime/bus/resultEnvelope.mjs` validates and creates normalized result envelopes for fields such as:

```text
actionId
runId
capability
status
result
error
usage
warnings
trace
outputRefs
artifactRefs
partial
retryable
cancellationReason
policyReason
```

`usage.backend` and `usage.modelBundle` are metadata only. They do not execute backends, select models, alter model paths, or expand config override behavior.

### Action events

`runtime/bus/actionEvent.mjs` validates and creates action event contracts for event types including:

```text
action.accepted
action.started
action.stream.delta
action.completed
action.failed
action.cancelled
action.timeout
action.policyDenied
```

Error-reporting rules are explicit:

```text
action.failed requires data.error
action.timeout requires data.error or data.cancellationReason
action.cancelled requires data.cancellationReason or data.error
action.policyDenied requires data.error or data.policyReason
```

This is still a contract only. No event emitter, observer sink, subscription registry, or trace writer was added.

---

## Explicit non-goals

This branch does not include runtime execution surfaces.

In short:

```text
No Capability Bus execution, no router, no backend adapters, no graph runtime, and no worker/native changes.
```

Detailed non-goals:

```text
Capability Bus execution
executeAction()
Capability Router
Capability Registry
Capability Services
Backend Adapter contracts
backend execution
MCP inbound adapter
MCP outbound backend
Knowledge DB / memory DB implementation
graph runtime implementation
graph node contracts
graph scheduler
graph context assembler
runtime.mjs public API changes
prompt() behavior changes
init/reset/shutdown behavior changes
scheduler changes
workerBridge changes
llama_worker changes
configOverride expansion
model path/model identity changes
tool process execution
observer/trace wiring
streaming behavior changes
cleanup unrelated to this contract branch
optimization changes
```

---

## Architecture boundaries preserved

```text
queue-based concurrency remains unchanged
worker remains the model/native execution boundary
parent runtime still owns request lifecycle
parent-side stream shaping remains unchanged
config remains the tuning surface
prompt/output semantics are unchanged
model identity/path is not made overrideable
worker protocol shape is unchanged
init/reset/shutdown behavior is unchanged
```

---

## Propagation review

Confirmed in the merged branch scope:

```text
runtime.mjs unchanged
workerBridge.mjs unchanged
runtime/config/** unchanged
runtime/lifecycle/** unchanged
runtime/request/** unchanged
runtime/stream/** unchanged
runtime/observability/** unchanged
llama_worker/** unchanged
existing fixture helper manifest unchanged
public runtime exports unchanged
```

Docs propagation:

```text
README.md adds runtime/bus/ as contract-only namespace
docs/current-architecture.md adds runtime/bus/ layout and contract-only note
docs/README.md indexes dev-notes.34
```

The new smoke test imports only the new `runtime/bus/` contract modules and does not copy or instantiate the runtime/worker fixture tree.

---

## Validation performed

Michael-local checks after applying the branch:

```bash
find . -name '*.mjs' -print0 | sort -z | xargs -0 -n1 node --check
node ./tests/smokeTestActionEnvelopeContract.mjs
node ./tests/tools/checkRuntimeFixtureCoverage.mjs
node ./tests/tools/checkWorkerImportCycles.mjs
node ./tests/smokeTestRuntimePublicEntrypointContract.mjs
```

Observed local results:

```text
All action envelope contract smoke checks finished.
runtime fixture coverage passed for 39 file(s); local arrays: 0.
worker import hygiene passed for 18 worker file(s).
All runtime public entrypoint contract checks finished.
```

Candidate package verification before handoff:

```text
artifact guard passed for the staged package with no failing findings
package contents inspected
patch generated against uploaded main mirror
```

---

## Real-runtime note

Real-runtime testing was not required for this branch because it remained contract-only and did not touch:

```text
runtime execution
worker behavior
init/reset/shutdown
request cancellation boundaries
context creation
prompt streaming
native/model behavior
```

If future slices wire these contracts into `runtime.mjs`, `workerBridge.mjs`, capability execution, prompt routing, cancellation, stream binding, policy enforcement, or backend adapters, then real-runtime testing should be reconsidered for merge readiness.

---

## GitHub verification status

Direct GitHub verification was completed after push and again after merge.

Confirmed:

```text
Branch existed and contained expected runtime/bus modules.
docs/dev-notes.34 existed by direct blob/raw file inspection.
docs/README.md indexed dev-notes.34.
main received the merge via PR #13 / merge commit ebaf104.
main contains runtime/bus/*, docs/dev-notes.34, docs/README.md, README.md, docs/current-architecture.md, and tests/smokeTestActionEnvelopeContract.mjs.
The merge commit file tree did not include runtime.mjs, workerBridge.mjs, runtime/lifecycle/**, runtime/request/**, runtime/stream/**, runtime/config/**, or llama_worker/**.
```

Caveat from verification:

```text
Some GitHub directory/listing views lagged or rendered inconsistently during review.
Direct blob/raw/source file URLs and the merge commit file tree were treated as stronger evidence than stale listings.
```

---

## Caveats / known risks

### Finding: The new contracts are intentionally not wired into execution.

**Affected surface:** Future Capability Bus branches.

**Why it matters:** Passing this branch proves contract helper shape and smoke coverage. It does not prove action execution, routing, backend selection, cancellation propagation, stream binding, policy enforcement, or graph integration.

**Smallest safe correction:** Keep the next execution-related branch separate. Do not add `executeAction()` or routing by inertia.

**What still needs verification:** Future bus/router/backend branches must prove behavior with targeted tests and, when runtime execution surfaces are touched, real-runtime checks as applicable.

---

### Finding: The capability taxonomy may need future expansion or renaming.

**Affected surface:** Capability naming and compatibility contracts.

**Why it matters:** Names like `memory.search` and `retrieval.search` become compatibility surfaces once consumers import them.

**Smallest safe correction:** Treat v1 taxonomy as a narrow starting surface. Add or rename capabilities only in explicit compatibility branches.

**What still needs verification:** Future embedding/rerank/retrieval/memory backend work should re-check naming against actual backend/service implementations.

---

### Finding: Context refs are reference-only and deliberately reject path-like values.

**Affected surface:** Future context materialization and storage adapters.

**Why it matters:** This preserves model-path and backend-boundary safety, but future adapters may need structured refs beyond simple strings.

**Smallest safe correction:** Keep string refs for v1. Add object-shaped context refs only with a later compatibility plan/spec.

**What still needs verification:** Future context materialization branches should define accepted ref schemes and adapter behavior.

---

### Finding: `STAGED-BRANCH-NOTES.md` should be removed from `main`.

**Affected surface:** Root repo documentation / branch status clarity.

**Why it matters:** It contains staged/not-merge-ready language that is stale after PR #13 merged.

**Smallest safe correction:** Delete `STAGED-BRANCH-NOTES.md` in a docs-only cleanup commit.

**What still needs verification:** After cleanup push, direct-check that `STAGED-BRANCH-NOTES.md` no longer exists on `main`.

---

## Future work not included

Recommended future branches:

```text
runtime-capability-registry-contract-v1
runtime-capability-bus-skeleton-v1
runtime-capability-router-v1
runtime-backend-adapter-contracts-v1
runtime-model-bundle-registry-v1
runtime-text-generate-capability-native-worker-adapter-v1
runtime-embedding-capability-v1
runtime-rerank-capability-v1
runtime-retrieval-capability-v1
runtime-memory-storage-surfaces-plan-spec-v1
runtime-mcp-inbound-adapter-plan-spec-v1
runtime-mcp-outbound-backend-plan-spec-v1
cognitive-graph-runtime-control-layer-plan-spec-v1
```

---

## Recommended next step

Perform a docs-only cleanup commit:

```text
Delete:
  STAGED-BRANCH-NOTES.md

Modify:
  docs/dev-notes.34
```

Then direct-check `main` again for:

```text
STAGED-BRANCH-NOTES.md absent
docs/dev-notes.34 status updated
runtime/bus/* still present
docs/README.md still indexes dev-notes.34
README.md and docs/current-architecture.md still describe runtime/bus as contract-only
```

After that, start the next feature branch from updated `main`.

Recommended next branch:

```text
runtime-capability-registry-contract-v1
```
