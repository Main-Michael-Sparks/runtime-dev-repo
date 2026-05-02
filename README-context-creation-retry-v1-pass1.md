# Context Creation Retry v1 — Staged Files Pass 1

Base: uploaded exact-main reference `runtime-dev-repo-main-reference-Material-contextRetry.zip`.

Status: staged full replacement files for local review/application.

Files included:

```text
config.mjs
contextRetryProfiles.mjs
inference.mjs
llama_worker/llama.mjs
```

Sandbox validation passed:

```text
node --check config.mjs
node --check contextRetryProfiles.mjs
node --check inference.mjs
node --check llama_worker/llama.mjs
node _helper_check.mjs
```

Expected active local smoke tests after application:

```bash
node ./tests/smokeTestHardwareAwareInitRetry.mjs
node ./tests/smokeTestLifecycleRegression.mjs
```

A context-retry-specific smoke test is still recommended before final branch closeout.
