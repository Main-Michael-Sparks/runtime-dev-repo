# Staged Branch Notes — runtime-action-envelope-contract-v1

Status: staged candidate package only. Syntax-checked, helper-checked, contract-smoke-tested, and artifact-guarded locally against the uploaded main mirror. Not repo-verified after push. Not merge-ready.

## Source posture

GitHub `main` remains active source truth. This package was staged against the uploaded formatted main mirror used in preflight.

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

## Explicit non-goals

```text
No runtime.mjs behavior change.
No workerBridge change.
No runtime lifecycle/request/stream/config changes.
No llama_worker changes.
No Capability Bus executor.
No Capability Router.
No backend adapters.
No MCP implementation.
No Knowledge DB implementation.
No graph runtime implementation.
No public API behavior change.
No model path/model identity change.
No configOverride expansion.
```

## Checks run

```bash
node ./tests/smokeTestActionEnvelopeContract.mjs
find . -name '*.mjs' -print0 | sort -z | xargs -0 -n1 node --check
node ./tests/tools/checkRuntimeFixtureCoverage.mjs
node ./tests/tools/checkWorkerImportCycles.mjs
node ./tests/smokeTestRuntimePublicEntrypointContract.mjs
```

All listed checks passed in the staged candidate repo.

## Next step

Apply to branch `runtime-action-envelope-contract-v1`, rerun checks locally, push, and perform direct GitHub source/file verification.
