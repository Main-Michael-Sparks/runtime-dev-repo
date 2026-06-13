# Runtime System Blueprint v1

**Date:** 2026-06-11  
**Project:** Runtime Dev greater system  
**Artifact type:** Design / blueprint / plan-spec  
**Status:** Proposed — design-only; not implementation-ready until Michael reviews and approves  
**Current source basis:** `/mnt/data/runtime-dev-repo-main.zip` inspected locally; GitHub remains active source truth before any branch implementation  
**Recommended branch name:** `runtime-system-blueprint-v1`

---

## 1. Executive summary

This blueprint defines the full Runtime Dev architecture direction and the narrower current Runtime Dev substrate boundary.

The guiding principle is:

```text
Runtime Dev is the execution substrate.
The Cognitive Graph Runtime is the future control layer.
The Capability Bus is the compatibility/action boundary.
Capabilities are typed abilities.
Backends are replaceable execution mechanisms.
```

The important scope correction is:

```text
Make Runtime Dev graph-compatible without making it graph-dependent.
```

The full future system includes the Cognitive Graph Runtime. The current Runtime Dev implementation track should build the substrate and compatibility seams that a future graph/control layer can use. It should not implement the graph kernel, cognitive node contracts, operator kit, graph scheduler, verifier/lock manager, or repair/escalation controller yet.

The Cognitive Graph Runtime is part of the greater Runtime Dev system, but it may be developed as a separate control-layer package, sibling package, future hosted track, or separate repository that consumes Runtime Dev through typed capability surfaces. Its physical hosting location should not change the boundary rule: it must use the Capability Bus and must not import backend, worker, adapter, or tool-process internals.

---

## 2. Current repo baseline

The current repository is already modularized across the parent runtime and worker boundary.

### 2.1 Stable public/runtime entrypoints

```text
runtime.mjs                 public runtime API / composition root
workerBridge.mjs            singleton worker bridge
llama_worker/llama.mjs      worker composition root and model/native boundary
```

`runtime.mjs` currently exports:

```text
cancelPrompt
initModel
prompt
resetModel
resetSession
shutdownRuntime
```

### 2.2 Parent runtime layout

```text
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

Parent-side responsibilities remain:

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

### 2.3 Worker layout

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

Worker-side responsibilities remain:

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

---

## 3. Full future system architecture

This section describes the full intended architecture, including the future Cognitive Graph Runtime.

```text
Public Facade
  -> Direct Runtime APIs
  -> Graph / Task / Run APIs
  -> Memory / Inspection / Checkpoint APIs

Cognitive Graph Runtime
  -> thinking-structure control layer

Capability Bus
  -> policy / boundary / typed action envelope

Capability Router
  -> resolver

Capability Services
  -> typed abilities

Backend Adapters
  -> replaceable execution mechanisms
```

Expanded:

```text
Public Facade
  ├─ Direct Runtime APIs
  │    ├─ prompt()
  │    ├─ embedText()
  │    ├─ rerank()
  │    ├─ retrieve()
  │    ├─ visionChat()
  │    └─ callTool()
  │
  ├─ Graph / Task / Run APIs       [future-facing]
  │    ├─ runTask()
  │    ├─ runGraph()
  │    ├─ stepGraph()
  │    ├─ resumeGraph()
  │    ├─ cancelGraph()
  │    └─ inspectGraphState()
  │
  └─ Memory / Inspection APIs      [future-facing]
       ├─ inspectMemory()
       ├─ inspectTrace()
       ├─ exportCheckpoint()
       └─ importCheckpoint()

Cognitive Graph Runtime             [future control-layer track]
  ├─ Graph Kernel
  ├─ Cognitive Node Contracts
  ├─ Cognitive Operator Kit
  ├─ Structure Selector
  ├─ Scheduler / Readiness Engine
  ├─ Routing / Gating
  ├─ Context Assembler
  ├─ Node Executor
  ├─ Verifier / Lock Manager
  ├─ Repair / Escalation Controller
  ├─ Memory / State Traversal
  └─ Action Intent Emitter

Capability Bus                       [current Runtime Dev substrate target]
  ├─ validates action envelopes
  ├─ enforces policy / budget / approval
  ├─ binds cancellation / timeout / streaming
  ├─ logs trace events
  └─ forwards allowed actions

Capability Router                    [current Runtime Dev substrate target]
  ├─ resolves capability service
  ├─ resolves model bundle
  ├─ resolves hardware profile
  └─ selects backend adapter

Capability Services                  [current Runtime Dev substrate target]
  ├─ text.generate
  ├─ text.embed
  ├─ text.rerank
  ├─ retrieval.search
  ├─ memory.search
  ├─ memory.read
  ├─ memory.write
  ├─ checkpoint.export
  ├─ checkpoint.import
  ├─ vision.chat
  └─ tool.call

Backend Adapters                     [current Runtime Dev substrate target]
  ├─ nativeWorkerBackend
  ├─ nativeEmbeddingBackend
  ├─ llamaMtmdCliBackend
  ├─ llamaServerBackend
  ├─ vectorStoreBackend
  ├─ graphStoreBackend
  ├─ checkpointStoreBackend
  ├─ documentStoreBackend             [future optional memory/storage backend]
  ├─ artifactStoreBackend             [future optional output/media/artifact backend]
  ├─ eventLogStoreBackend             [future optional trace/action-event backend]
  ├─ keyValueStateStoreBackend        [future optional lightweight state backend]
  ├─ relationalMetadataStoreBackend   [future optional structured metadata backend]
  └─ toolBackend
```

---

## 4. Current Runtime Dev substrate scope

Runtime Dev should now focus on graph-compatible substrate seams, not graph implementation.

### 4.1 In scope for Runtime Dev substrate

```text
stable public direct runtime APIs
capability-shaped request contracts
typed action envelopes
result envelopes
Capability Bus skeleton
Capability Router
Capability Registry
Capability Services
Backend Adapter contracts
Storage Backend Registry / memory DB adapter contracts
Model Bundle Registry
Hardware Profiles
Trace / cancellation / timeout / streaming contracts
policy / budget / approval hooks
```

### 4.2 Out of scope for current Runtime Dev implementation

```text
graph kernel implementation
cognitive node contract implementation
cognitive operator kit implementation
structure selector implementation
graph scheduler/readiness engine implementation
verifier/lock manager implementation
repair/escalation controller implementation
full graph memory traversal implementation
real task/hypothesis/constraint graph execution
```

These belong to a separate control-layer track within the greater Runtime Dev system. They may be documented as future extension points, but should not be implemented in the current substrate branch family.

---

## 5. Core invariant

Preserve this invariant across all future feature branches:

```text
Cognitive Graph Runtime decides what should be thought or done next.
Capability Bus decides whether the requested action is allowed.
Capability Router decides how to fulfill the allowed action.
Capability Services define the typed ability.
Backend Adapters perform the action.
```

Hard rule:

```text
The Cognitive Graph Runtime never calls backends directly.
```

Bad:

```text
graph -> native worker
graph -> llama-server
graph -> llama-mtmd-cli
graph -> vector DB
graph -> tool process
```

Good:

```text
graph -> Capability Bus -> Capability Router -> Capability Service -> Backend Adapter
```


---

## 6. Graph Integration Contract

The Cognitive Graph Runtime integrates with Runtime Dev only through typed runtime surfaces. This section is the explicit bridge contract between the future graph/control layer and the current substrate.

The graph belongs to a separate control-layer track within the greater Runtime Dev system. It may eventually be hosted inside this repo, in `runtime/graph/`, in a sibling package such as `packages/cognitive-graph-runtime/`, or in a separate package/repo. Regardless of placement, it must consume Runtime Dev through the same typed surfaces.

### 6.1 Allowed graph-to-runtime surfaces

```text
executeAction(actionEnvelope)
cancelAction(actionId)
subscribeActionEvents(actionId or runId)
readResult(resultEnvelope)
resolveContextRefs(contextRefs)
memory.search / memory.read / memory.write
checkpoint.export / checkpoint.import
```

### 6.2 Forbidden graph-to-runtime access

```text
importing workerBridge directly
importing llama_worker modules
importing backend adapters directly
passing raw model paths or projector paths from graph nodes
executing tool processes directly
constructing backend-specific request shapes inside graph nodes
bypassing Capability Bus policy, budget, approval, cancellation, or trace surfaces
```

### 6.3 Graph-to-runtime bridge surfaces

#### 1. Action Surface

The graph emits typed action intents.

```text
executeAction(actionEnvelope)
```

Purpose:

```text
request text generation, embedding, reranking, retrieval, vision, memory, checkpoint, or tool actions
```

Rule:

```text
graph emits intent
runtime validates and executes
graph does not call backend adapters
```

#### 2. Result Surface

Runtime returns normalized result envelopes.

Purpose:

```text
provide status, output, warnings, usage, trace, backend, model bundle, artifacts, and errors
```

Recommended future fields:

```text
outputRefs
artifactRefs
errorKind
retryable
partial
cancellationReason
```

#### 3. Event Surface

Runtime emits action/run events.

Example future events:

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

Purpose:

```text
allow future graph runs to observe streaming, cancellation, progress, and failure without knowing backend internals
```

#### 4. Context Surface

The graph controls context policy. Runtime Dev may materialize approved context references.

```text
contextRefs: ["ctx_1", "ctx_2"]
```

Rules:

```text
graph decides what context matters
runtime may fetch, pack, or materialize approved references
capability services do not decide cognitive relevance
backend adapters do not interpret context semantically
```

#### 5. Memory / Storage Surface

Runtime provides storage, query, checkpoint, and persistence capabilities. The graph owns memory interpretation.

Possible future capabilities:

```text
memory.search
memory.read
memory.write
memory.delete            [future optional; policy-sensitive]
memory.link              [future optional; relationship write surface]
checkpoint.export
checkpoint.import
checkpoint.store         [future optional]
checkpoint.restore       [future optional]
trace.query              [future optional]
artifact.read            [future optional]
artifact.write           [future optional]
```

Memory/store backends are a family, not one database. Runtime Dev may eventually support multiple storage adapters because different memory types need different indexes and persistence behavior.

Candidate backend family:

```text
vectorStoreBackend
  semantic/vector search, embeddings, nearest-neighbor lookup, similarity indexes

graphStoreBackend
  graph-shaped nodes/edges/relationships, graph traversal primitives, structural query

checkpointStoreBackend
  graph/runtime snapshots, run checkpoints, restore records, bootstrap/carry-forward state

documentStoreBackend
  raw documents, chunks, normalized text, source records, long-form durable content

artifactStoreBackend
  generated files, media, image/video/audio artifacts, external output references

eventLogStoreBackend
  append-only action events, trace events, run timelines, audit records

keyValueStateStoreBackend
  lightweight state, cursors, leases, small metadata, cache-like records

relationalMetadataStoreBackend
  optional structured metadata/index joins when a relational shape is better than graph/vector/kv
```

Rule:

```text
Runtime Dev stores, indexes, queries, checkpoints, and returns references.
Cognitive Graph Runtime interprets, traverses, promotes, locks, repairs, and decides meaning.
```

A storage backend should not become a cognitive authority. A vector DB, graph DB, checkpoint DB, or other memory DB may recommend candidates or persist state, but the Cognitive Graph Runtime decides how that information is used.

---

## 7. Cognitive Graph Runtime as future thinking-structure layer

The Cognitive Graph Runtime should be treated as the explicit home of thinking structure, not as a vague orchestrator.

### 6.1 Future CGR responsibilities

#### 1. Graph Kernel

```text
graph state
nodes
edges
run state
snapshots/checkpoints
node status: pending/runnable/running/verified/failed/blocked/stale
```

#### 2. Cognitive Node Contracts

```text
input contract
output contract
success criteria
failure modes
verification rule
dependencies
required capability actions
model reliability requirements
```

#### 3. Cognitive Operator Kit

The brain is not one method. It is a kit of thinking structures.

```text
task/dependency graph
hypothesis/evidence graph
constraint/invariant graph
verification graph
repair loop
search/decision graph
memory/context traversal
integration/synthesis node
```

#### 4. Structure Selector

```text
chooses which thinking structure applies
may use rules
may use reranker/DB soft recommendations
may use model-assisted selection for larger models
becomes harder/rule-bound for smaller models
```

#### 5. Scheduler / Readiness Engine

```text
finds runnable nodes
enforces dependency order
blocks nodes with missing inputs
prioritizes high-control-gain work
handles required completion order
```

#### 6. Routing / Gating

```text
hard gates: dependency, budget, policy, recursion, required evidence
soft gates: reranker relevance, expected usefulness, uncertainty reduction
model-size-aware gates
```

#### 7. Context Assembler

```text
builds bounded context for the next node
pulls relevant graph state
pulls memory
pulls retrieval/RAG context
avoids dumping the whole world into the model
```

#### 8. Node Executor

```text
turns node contract into model/tool request
requests capability actions through the Capability Bus
does not call backends directly
```

#### 9. Verifier / Lock Manager

```text
checks output against node contract
marks verified nodes as locked
rejects fake progress
triggers repair or decomposition if needed
```

#### 10. Repair / Escalation Controller

```text
creates repair nodes
retries bounded failures
escalates to hypothesis/debug mode
escalates to larger model or stricter structure if available
```

#### 11. Memory / State Traversal

```text
searches prior graph state
retrieves durable project memory
links current nodes to prior decisions/failures
promotes reusable patterns into node library
```

#### 12. Action Intent Emitter

```text
emits typed capability action envelopes
never directly executes tools/models/backends
```

### 6.2 Why this matters for Runtime Dev now

Runtime Dev should not implement the Cognitive Graph Runtime yet, but it should expose a clean action surface that future graph nodes can use.

The future graph should be able to request:

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

Runtime Dev should fulfill those requests without caring whether they came from:

```text
a direct human API call
a task graph node
a hypothesis node
a verification node
a repair loop
a future agent/controller
```

---

## 8. Capability Bus

The Capability Bus is the controlled action boundary.

It is broader than a command bridge. It carries typed action requests from direct APIs, future graph APIs, and internal runtime flows into validated capability execution.

### 7.1 Bus responsibilities

```text
action envelope validation
result envelope normalization
capability permission checks
budget limits
timeout limits
human approval requirements
tool safety checks
model/path guardrails
trace logging
cancellation propagation
stream binding
policy audit events
```

### 7.2 Action envelope candidate

```js
const actionEnvelope = {
    actionId: "act_123",
    runId: "run_456",
    source: {
        kind: "graph-node",
        nodeId: "node_hypothesis_debug_1"
    },

    capability: "text.generate",
    intent: "execute_cognitive_node",

    input: {
        prompt: "...",
        schema: "ranked_hypotheses_v1",
        contextRefs: ["ctx_1", "ctx_2"]
    },

    requirements: {
        modelClass: "reasoning-7b",
        contextNeed: "medium",
        stream: false,
        timeoutMs: 60000
    },

    policy: {
        maxTokens: 800,
        approvalRequired: false,
        allowTools: false
    },

    trace: {
        parentNodeId: "node_failure_observation_1",
        operator: "hypothesis_graph"
    }
};
```

### 7.3 Result envelope candidate

```js
const resultEnvelope = {
    actionId: "act_123",
    runId: "run_456",
    capability: "text.generate",
    status: "completed",

    result: {
        text: "..."
    },

    usage: {
        backend: "nativeWorkerBackend",
        modelBundle: "example-text-local",
        profile: "laptopFallback"
    },

    warnings: [],

    trace: {
        startedAt: 1780000000000,
        finishedAt: 1780000022500,
        durationMs: 22500
    }
};
```

### 7.4 Direct API action envelope source

Direct calls should also route through the same bus once the capability layer exists.

Example:

```text
prompt("hello")
  -> direct runtime API
  -> action envelope: text.generate
  -> Capability Bus
  -> Capability Router
  -> text.generate capability
  -> nativeWorkerBackend
```

This keeps direct API behavior and future graph-driven behavior on one controlled execution surface.

---

## 9. Capability Router

The Capability Router is the resolver. It should not think deeply and should not execute backends directly.

### 8.1 Router responsibilities

```text
resolve capability service
resolve model bundle
resolve hardware profile
resolve backend adapter
check capability/backend compatibility
check requested stream/non-stream support
check request shape and capability schema
produce executable capability invocation
```

### 8.2 Router non-responsibilities

```text
no graph reasoning
no context assembly policy
no direct tool execution
no direct model process spawning
no model path override policy expansion
no worker lifecycle ownership
```

---

## 10. Capability Services

Capabilities are stable typed abilities. They should express what can be done, not how a backend does it.

### 9.1 Initial capability taxonomy

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

### 9.2 Capability service responsibilities

Each capability service should own:

```text
capability-specific input validation
capability-specific result normalization
capability-specific option schema
capability-specific cancellation/stream expectations
backend selection constraints passed to the router
```

### 9.3 Capability service non-responsibilities

Capability services should not own:

```text
cognitive graph scheduling
graph node verification
context assembly policy for the full graph
raw backend process execution
model path/config override expansion
```

### 9.4 RAG and context assembly note

`rag.assemble` should not be a primary low-level capability at first.

Reason:

```text
Context assembly is often a cognitive/control decision.
The Cognitive Graph Runtime should decide why context is relevant,
which node needs it, what budget applies, and what should be excluded.
```

Prefer:

```text
Capability Services:
  retrieval.search
  text.embed
  text.rerank
  memory.search / memory.read / memory.write

Cognitive Graph Runtime:
  context assembler / RAG-style assembler / graph-state assembler
```

A lower-level helper named `rag.assemble` may exist later, but it should not own the main reasoning context policy.

---

## 11. Backend Adapters

Backends are replaceable execution mechanisms.

### 10.1 Candidate backends

```text
nativeWorkerBackend
  current text generation runtime using workerBridge + llama_worker/llama.mjs

nativeEmbeddingBackend
  future node-llama-cpp embedding/rerank path if confirmed

llamaMtmdCliBackend
  future one-shot or managed CLI multimodal path

llamaServerBackend
  future server/service backend for multimodal, embeddings, rerank, or OpenAI-compatible routes

vectorStoreBackend
  future vector search storage/index backend

graphStoreBackend
  future graph-shaped memory/state backend

checkpointStoreBackend
  future snapshot/checkpoint/restore backend

documentStoreBackend
  future document/chunk/source-record backend

artifactStoreBackend
  future output/media/file artifact backend

eventLogStoreBackend
  future append-only trace/action/run event backend

keyValueStateStoreBackend
  future lightweight state/cache/metadata backend

relationalMetadataStoreBackend
  future optional structured metadata backend

toolBackend
  future controlled external tool execution backend
```

### 10.2 Backend adapter rules

```text
Adapters execute only after Capability Bus and Router approval.
Adapters do not reinterpret graph intent.
Adapters do not broaden model path override behavior.
Adapters normalize low-level errors into result envelopes.
Adapters must expose cancellation/timeout behavior explicitly.
Adapters must preserve parent-side stream shaping rules where applicable.
```

---

## 12. Model Bundle Registry

Requests should choose model bundle IDs, not arbitrary file paths.

### 11.1 Why model bundles

Model bundle IDs preserve identity and compatibility guardrails.

The current runtime already protects model identity/path by rejecting `modelLoad.baseModel` override in `configOverride`. Future model bundles should keep that spirit: model files and projector files belong in configuration, not ad hoc per-request overrides.

### 11.2 Model bundle candidate schema

```js
const modelBundles = {
    "mistral-text-local": {
        capabilities: ["text.generate"],
        backend: "nativeWorkerBackend",
        artifactLayout: {
            kind: "gguf-text",
            modelPath: "../../../base/mistral-7b-instruct-v0.2.Q4_K_M.gguf"
        },
        defaultProfile: "laptopFallback"
    },

    "example-vl-local": {
        capabilities: ["vision.chat", "text.generate"],
        backend: "llamaMtmdCliBackend",
        artifactLayout: {
            kind: "gguf-mmproj",
            modelPath: "../../../models/qwen-vl/model.gguf",
            mmprojPath: "../../../models/qwen-vl/mmproj.gguf"
        },
        defaultProfile: "rtx3060_12gb"
    },

    "example-hf-vision": {
        capabilities: ["vision.chat"],
        backend: "llamaServerBackend",
        artifactLayout: {
            kind: "hf-multimodal",
            repo: "vendor/model-repo"
        },
        defaultProfile: "rtx3060_12gb"
    },

    "example-server-managed": {
        capabilities: ["vision.chat", "multimodal.chat"],
        backend: "llamaServerBackend",
        artifactLayout: {
            kind: "server-managed",
            endpoint: "http://127.0.0.1:8080"
        },
        defaultProfile: "highVram24gb"
    }
};
```

### 11.3 Artifact layouts

```text
gguf-text
  single local text model file

gguf-mmproj
  local model GGUF + multimodal projector/mmproj artifact

hf-multimodal
  model bundle resolved by supported Hugging Face loading path

server-managed
  model loaded and owned by an external/local server process

native-vision
  reserved future layout if direct native node-llama-cpp vision support becomes available
```

### 11.4 Model bundle invariant

```text
Requests select capabilities and model bundle IDs.
Config owns model files, projector files, backend type, and hardware profile.
```

---

## 13. Hardware Profiles

Hardware should be a configurable profile layer, not a hardcoded assumption.

### 12.1 Hardware profile candidate schema

```js
const hardwareProfiles = {
    laptopFallback: {
        label: "Laptop fallback",
        maxConcurrentVision: 1,
        preferBackend: "llamaMtmdCliBackend",
        processMode: "oneshot-cli",
        maxImageBytes: 4000000,
        maxImagePixels: 1500000,
        imageResize: {
            enabled: true,
            maxWidth: 1024,
            maxHeight: 1024
        },
        timeoutMs: 180000,
        gpuLayers: 0,
        threads: {
            ideal: 2,
            min: 1
        }
    },

    rtx3060_12gb: {
        label: "RTX 3060 12GB class",
        maxConcurrentVision: 1,
        preferBackend: "llamaServerBackend",
        processMode: "service",
        maxImageBytes: 12000000,
        maxImagePixels: 4000000,
        imageResize: {
            enabled: true,
            maxWidth: 1536,
            maxHeight: 1536
        },
        timeoutMs: 120000,
        gpuLayers: "auto",
        threads: {
            ideal: 4,
            min: 2
        }
    },

    highVram24gb: {
        label: "24GB+ VRAM class",
        maxConcurrentVision: 2,
        preferBackend: "llamaServerBackend",
        processMode: "service",
        maxImageBytes: 25000000,
        maxImagePixels: 9000000,
        imageResize: {
            enabled: true,
            maxWidth: 2048,
            maxHeight: 2048
        },
        timeoutMs: 90000,
        gpuLayers: "auto",
        threads: {
            ideal: 8,
            min: 2
        }
    }
};
```

### 12.2 Hardware profile rules

```text
Profiles tune admission and backend execution.
Profiles do not rewrite public API semantics.
Profiles do not bypass model bundle validation.
Profiles do not expand configOverride surfaces without a feature plan.
```

---

## 14. Scheduling and lanes

The current text prompt scheduler should not be blindly reused for every capability.

Future capabilities may need separate scheduler lanes to avoid slow vision/video/tool work starving text generation.

Candidate:

```js
const schedulerLanes = {
    text: {
        maxInFlight: 2,
        maxQueueSize: 50
    },
    vision: {
        maxInFlight: 1,
        maxQueueSize: 5
    },
    embedding: {
        maxInFlight: 1,
        maxQueueSize: 100
    },
    tool: {
        maxInFlight: 1,
        maxQueueSize: 20
    }
};
```

Do not change the existing text scheduler in the blueprint branch. This is future design guidance only.

---

## 15. Vision / multimodal lane

Vision should be first-class at the capability/model-bundle level, even if the first backend implementation uses `llama-mtmd-cli` or `llama-server`.

### 14.1 Vision capability request candidate

```js
await visionChat({
    model: "example-vl-local",
    profile: "rtx3060_12gb",
    image: "./screenshots/chart.png",
    prompt: "Describe the chart and identify key support/resistance levels."
});
```

Internally:

```text
visionChat(...)
  -> direct runtime API
  -> action envelope: vision.chat
  -> Capability Bus
  -> Capability Router
  -> vision.chat capability
  -> llamaMtmdCliBackend or llamaServerBackend
```

### 14.2 Vision request rules

```text
Requests pass image input and model bundle ID.
Requests do not pass raw modelPath/mmprojPath unless a future advanced debug mode is explicitly designed.
Media input is validated and normalized before backend execution.
Model bundle config determines whether the backend uses model+mmproj, HF bundle, server-managed model, or future native vision API.
```

### 14.3 Video posture

Do not treat video as native live VLM support first.

Preferred design:

```text
video input
  -> frame sampler
  -> keyframe selector
  -> vision.chat per frame/batch
  -> temporal summary store
  -> text.generate final synthesis
```

This belongs to a future research/design branch, not the substrate blueprint implementation.

---

## 16. Embedding / rerank / retrieval lanes

Embedding, rerank, and retrieval should be designed as typed capabilities that can serve both direct APIs and future graph routing.

### 15.1 Embeddings are not only RAG

Embeddings may support:

```text
semantic search
clustering
memory activation
node selection
edge scoring
similar prior task lookup
RAG retrieval
```

### 15.2 Reranker is advisory, not sovereign

Future graph flow:

```text
Cognitive Graph Runtime needs candidate memory/thinking nodes
  -> emits retrieval.search action
  -> Capability Bus validates
  -> Router selects retrieval backend
  -> returns candidates

Cognitive Graph Runtime wants ranking
  -> emits text.rerank action
  -> Capability Bus validates
  -> Router selects rerank backend
  -> returns ranked candidates

Cognitive Graph Runtime applies hard gates
  -> dependency gate
  -> budget gate
  -> policy gate
  -> recursion gate
  -> evidence gate

Scheduler chooses next runnable node
```

---

## 17. Graph memory placeholder

Keep `memory.search / memory.read / memory.write` as a future capability placeholder, but do not implement cognitive graph reasoning in Runtime Dev yet.

### 16.1 Runtime Dev may eventually provide

```text
memory.search / memory.read / memory.write capability
graphStoreBackend
checkpointStoreBackend
other future memory/storage backends
memory inspection contracts
checkpoint-compatible state storage
```

### 16.2 Cognitive Graph Runtime should eventually own

```text
how memory is interpreted
how graph state is traversed
which nodes are promoted
which outputs are locked
which contradictions trigger repair
which prior decisions are relevant
```

Rule:

```text
Runtime Dev may store/query graph-shaped memory, vector memory, checkpoint state, artifacts, event logs, and other durable memory DB records.
Cognitive Graph Runtime decides how that memory is interpreted and used.
```

---

## 18. Tool capability placeholder

`tool.call` should be a typed capability with strict policy boundaries.

Future tool support should include:

```text
tool registry ownership
tool schema representation
permission and approval policy
input/output validation
cancellation/timeout behavior
trace events
safe error normalization
```

The Cognitive Graph Runtime may request tools later, but tools must execute only through:

```text
Cognitive Graph Runtime -> Capability Bus -> tool.call -> toolBackend
```

No direct graph-to-tool execution.

---

## 19. Proposed future module layout

This is not a code-change proposal for the blueprint branch. It is a direction map for future implementation branches.

```text
runtime.mjs

runtime/public/
  directRuntimeApi.mjs
  graphRuntimeApi.mjs             [future-facing]
  inspectionApi.mjs               [future-facing]

runtime/bus/
  capabilityBus.mjs
  actionEnvelope.mjs
  resultEnvelope.mjs
  busPolicy.mjs
  busTrace.mjs
  busCancellation.mjs

runtime/capabilities/
  capabilityRouter.mjs
  capabilityRegistry.mjs

runtime/capabilities/text/
  textGenerationCapability.mjs

runtime/capabilities/embedding/
  embeddingCapability.mjs
  rerankCapability.mjs

runtime/capabilities/retrieval/
  retrievalCapability.mjs

runtime/capabilities/memory/
  memorySearchCapability.mjs
  memoryReadCapability.mjs
  memoryWriteCapability.mjs

runtime/capabilities/checkpoint/
  checkpointExportCapability.mjs
  checkpointImportCapability.mjs

runtime/capabilities/vision/
  visionChatCapability.mjs
  mediaInputNormalizer.mjs
  mediaValidation.mjs

runtime/capabilities/tools/
  toolCapability.mjs
  toolRegistry.mjs
  toolPolicy.mjs

runtime/backends/
  nativeWorkerBackend.mjs
  nativeEmbeddingBackend.mjs
  llamaMtmdCliBackend.mjs
  llamaServerBackend.mjs
  vectorStoreBackend.mjs
  graphStoreBackend.mjs
  checkpointStoreBackend.mjs
  documentStoreBackend.mjs             [future optional]
  artifactStoreBackend.mjs             [future optional]
  eventLogStoreBackend.mjs             [future optional]
  keyValueStateStoreBackend.mjs        [future optional]
  relationalMetadataStoreBackend.mjs   [future optional]
  toolBackend.mjs

runtime/models/
  modelBundleRegistry.mjs
  modelBundleValidation.mjs
  hardwareProfiles.mjs

runtime/graph/                       [future optional hosted Cognitive Graph Runtime track; not current substrate implementation; may instead live outside runtime/ as a sibling package]
  cognitiveGraphRuntime.mjs
  graphKernel.mjs
  graphStateStore.mjs
  cognitiveNodeContract.mjs
  cognitiveOperatorKit.mjs
  structureSelector.mjs
  readinessScheduler.mjs
  gateEngine.mjs
  contextAssembler.mjs
  nodeExecutor.mjs
  verifierLockManager.mjs
  repairEscalationController.mjs
  memoryStateTraversal.mjs
  actionIntentEmitter.mjs
```

Do not create `runtime/graph/` in the substrate branch family unless a specific future graph-track branch is approved. For now, this layout is only a compatibility map showing how a future hosted graph layer could connect.

---

## 20. Branch plan: `runtime-system-blueprint-v1`

### 19.1 Purpose

Define the full Runtime + Cognitive Graph architecture and the current Runtime Dev substrate boundary, so future graph/control work can connect through typed capability seams without making Runtime Dev graph-dependent.

### 19.2 Status

```text
Proposed / design-only
```

### 19.3 Non-goals

```text
No production code.
No graph implementation.
No vision implementation.
No embedding implementation.
No rerank implementation.
No retrieval implementation.
No tool execution.
No public API changes.
No worker changes.
No scheduler changes.
No configOverride expansion.
No model path/model identity changes.
No prompt/output semantic changes.
```

### 19.4 Likely files affected

For the design-only branch:

```text
Added:
  docs/runtime-system-blueprint-v1.md
  docs/dev-notes.33

Modified:
  docs/README.md
  possibly README.md, only to link the blueprint

Out of scope:
  runtime.mjs
  workerBridge.mjs
  runtime/** production modules
  llama_worker/** production modules
  tests/** unless adding docs-only guard is explicitly approved
```

### 19.5 Acceptance criteria

```text
Blueprint clearly separates full future architecture from current Runtime Dev substrate scope.
Blueprint preserves current runtime architecture boundaries.
Blueprint identifies Capability Bus as the action boundary.
Blueprint defines explicit graph integration surfaces: action, result, event, context, and memory/storage.
Blueprint defines typed capabilities and backend adapters without implementing them.
Blueprint reserves the Cognitive Graph Runtime as future control-layer work.
Blueprint does not imply graph implementation is part of current Runtime Dev substrate branches.
Blueprint includes non-goals and future branch sequence.
```

---

## 21. Proposed future branch sequence

This sequence is tentative and should be reviewed after each branch.

```text
1. runtime-system-blueprint-v1
   Design-only blueprint.

2. runtime-action-envelope-contract-v1
   Define action/result envelope schemas and validation helpers.
   No runtime behavior change unless wrappers are mock-only.

3. runtime-capability-bus-skeleton-v1
   Add a bus skeleton with validation/policy stubs and trace hooks.
   Keep direct public APIs behavior-compatible.

4. runtime-model-bundle-registry-v1
   Add model bundle registry and validation surface.
   Do not change existing model path behavior yet.

5. runtime-capability-router-v1
   Add router and registry plumbing.
   No new model features yet.

6. runtime-text-generation-capability-adapter-v1
   Wrap existing prompt path as text.generate capability.
   Must preserve current prompt/cancel/reset/shutdown behavior.

7. runtime-embedding-capability-v1
   Feature-specific plan/spec first, then implementation if approved.

8. runtime-rerank-capability-v1
   Separate from embeddings unless Michael approves combining.

9. runtime-retrieval-capability-v1
   Retrieval/vector store adapter planning and implementation.

10. runtime-memory-storage-surfaces-plan-spec-v1
   Plan memory.search/read/write, checkpoint import/export, and storage backend family boundaries before any memory DB implementation.

11. runtime-checkpoint-store-adapter-v1
   Separate checkpoint storage adapter branch if approved.

12. runtime-vision-cli-adapter-mock-v1
    Mock vision adapter first to validate contracts without model assets.

13. runtime-vision-cli-adapter-real-v1
    Real `llama-mtmd-cli` or selected backend after research confirms API/assets.

14. runtime-tool-capability-plan-spec-v1
    Tool calling requires separate security/policy design.
```

Cognitive graph implementation should remain separate:

```text
runtime-cognitive-graph-runtime-research-v1       research-only
runtime-cognitive-graph-kernel-plan-spec-v1       future, not substrate track
```

---

## 22. Testing implications for future implementation branches

The blueprint branch itself is docs-only, so production tests are not required unless docs tooling is added.

For future implementation branches touching production code, preserve the current regression posture:

```bash
find . -name '*.mjs' -print0 | sort -z | xargs -0 -n1 node --check
node ./tests/tools/checkRuntimeFixtureCoverage.mjs
node ./tests/tools/checkWorkerImportCycles.mjs
node ./tests/smokeTestRuntimePublicEntrypointContract.mjs
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

Real-runtime testing remains required for merge readiness when a branch touches:

```text
init/reset/shutdown
worker cancellation
context creation
prompt streaming
model path/model identity
native/model execution
```

---

## 23. Risks and guardrails

### 22.1 Primary risk

```text
Risk:
  The blueprint could accidentally imply that Runtime Dev should now implement the Cognitive Graph Runtime.

Guardrail:
  Explicitly separate full future system architecture from current Runtime Dev substrate scope.
```

### 22.2 Architecture bloat risk

```text
Risk:
  Capability Bus / Router / Services could become broad abstractions before any feature needs them.

Guardrail:
  First implementation branches should be skeleton/contract-focused and then wrap existing text generation before adding new capabilities.
```

### 22.3 Lifecycle regression risk

```text
Risk:
  Wrapping existing prompt behavior behind text.generate could drift prompt/cancel/reset/shutdown semantics.

Guardrail:
  Treat textGenerationCapability as an adapter over existing behavior, not a rewrite.
```

### 22.4 Model identity risk

```text
Risk:
  Model bundle registry could accidentally reopen model path override surfaces.

Guardrail:
  Requests select bundle IDs; config owns paths. No ad hoc per-request modelPath/mmprojPath overrides.
```

### 22.5 RAG overreach risk

```text
Risk:
  Retrieval/RAG could become the only memory abstraction.

Guardrail:
  Keep memory/search/checkpoint/storage surfaces and future Cognitive Graph Runtime memory/state traversal distinct from vector retrieval.
```

### 23.6 Memory DB over-compression risk

```text
Risk:
  Future memory work could be forced into one database shape, such as only vector, only graph, or only checkpoint storage.

Guardrail:
  Treat memory/storage backends as a family. Vector, graph, checkpoint, document, artifact, event-log, key-value, and relational metadata stores may all be valid for different memory surfaces.
```

---

## 24. Final recommended wording

Use this as the project-level summary:

```text
Runtime Dev is the execution substrate.
It provides stable public direct APIs, typed action envelopes, a Capability Bus,
a Capability Router, typed Capability Services, replaceable Backend Adapters,
model bundles, hardware profiles, storage backend registries, tracing, cancellation, streaming, and lifecycle safety.

The Cognitive Graph Runtime is the future control layer.
It owns thinking structures, graph state, node contracts, scheduling, verification,
repair, and memory/state traversal.

Runtime Dev should be graph-compatible without being graph-dependent.
```

---

## 25. Recommended next action

Review this blueprint with Michael.

If approved, create a docs-only branch:

```text
runtime-system-blueprint-v1
```

Then add the final reviewed version as:

```text
docs/runtime-system-blueprint-v1.md
docs/dev-notes.33
```

Do not implement Capability Bus, Capability Router, model bundles, vision, embeddings, retrieval, tools, or graph code in the blueprint branch.
