# Runtime Dev Docs Index

This directory contains current architecture docs plus historical branch notes.

## Current docs

```text
current-architecture.md      current source layout, public entrypoints, boundaries, and tests
feature-readiness.md         cleanup/readiness notes for future features such as embeddings, tool calling, and multimodal research
runtime-system-blueprint-v1.md  greater-system blueprint and Runtime Dev substrate direction
```

## Historical branch notes

The `dev-notes.*` files are preserved as branch-history checkpoints. They are intentionally not renamed to avoid noisy path churn and broken historical references.

| File | Topic | Status |
| --- | --- | --- |
| `dev-notes.01` | early branch / feature caveats | historical |
| `dev-notes.02` | hardware-aware init retry + context creation retry | historical/current contract background |
| `dev-notes.03` | drain shutdown v1 | historical/current contract background |
| `dev-notes.04` | worker native cancellation boundary v1 | historical/current contract background |
| `dev-notes.05` | context creation cancel boundary v1 | historical/current contract background |
| `dev-notes.06` | native operation timeout policy v1 / Option A | historical/current contract background |
| `dev-notes.07` | worker operation serialization v1 | historical/current contract background |
| `dev-notes.08` | init then reset without prior prompt test v1 | historical/current contract background |
| `dev-notes.09` | runtime lifecycle first clean module | historical modularization branch |
| `dev-notes.10` | runtime request settlement helper | historical modularization branch |
| `dev-notes.11` | runtime lifecycle state container | historical modularization branch |
| `dev-notes.12` | native boundary coordinator | historical modularization branch |
| `dev-notes.13` | runtime session reset coordinator | historical modularization branch |
| `dev-notes.14` | runtime shutdown coordinator | historical modularization branch |
| `dev-notes.15` | runtime init coordinator | historical modularization branch |
| `dev-notes.16` | runtime model reset coordinator | historical modularization branch |
| `dev-notes.17` | parent worker protocol router extraction | historical modularization branch |
| `dev-notes.18` | final cleanup / runtime entrypoint rename | historical layout branch |
| `dev-notes.19` | runtime layout folder structure v1 | historical layout branch |
| `dev-notes.20` | runtime layout config/profile helper unit | historical layout branch |
| `dev-notes.21` | Worker Layout Option C preflight tests | historical/current guard background |
| `dev-notes.22` | Worker Layout Option C state core | historical worker modularization branch |
| `dev-notes.23` | Worker Layout Option C disposal primitives | historical worker modularization branch |
| `dev-notes.24` | Worker Layout Option C cancellation core | historical worker modularization branch |
| `dev-notes.25` | Worker Layout Option C context/session | historical worker modularization branch |
| `dev-notes.26` | Worker Layout Option C lifecycle services | historical worker modularization branch |
| `dev-notes.27` | Worker Layout Option C prompt runner | historical worker modularization branch |
| `dev-notes.28` | Worker Layout Option C router | historical worker modularization branch |
| `dev-notes.29` | Worker Layout Option C test contract cleanup | historical/current guard background |
| `dev-notes.30` | Worker Layout Option C finalize | historical/current guard background |
| `dev-notes.31` | runtime public entrypoint contract | current final guard for the modularization arc |
| `dev-notes.32` | runtime consolidation cleanup v1 | current cleanup checkpoint |
| `dev-notes.33` | runtime system blueprint v1 | current design/checkpoint background |
| `dev-notes.34` | runtime action envelope contract v1 | current contract checkpoint |
| `dev-notes.35` | runtime capability registry contract v1 | current contract checkpoint |
| `dev-notes.36` | runtime capability bus skeleton v1 | current contract checkpoint |
| `dev-notes.37` | runtime capability router contract v1 | current contract checkpoint |
| `dev-notes.38` | runtime capability service contract v1 | current contract checkpoint |
| `dev-notes.39` | runtime backend adapter contract v1 | current contract checkpoint |
| `dev-notes.40` | capability router namespace cleanup v1 | current namespace cleanup checkpoint |
| `dev-notes.41` | capability executor contract v1 | current contract checkpoint |
| `dev-notes.42` | capability bus execute-action contract v1 | current contract checkpoint |
| `dev-notes.43` | runtime model bundle registry v1 | current contract checkpoint |
| `dev-notes.44` | runtime hardware profile registry v1 | current contract checkpoint |
| `dev-notes.45` | runtime memory module blueprint reconciliation v1 | current design/checkpoint background |
| `dev-notes.46` | runtime model-bundle route validation v1 | current contract checkpoint |
| `dev-notes.47` | runtime native worker backend contract v1 | current contract checkpoint |
| `dev-notes.48` | runtime capability bus executor skeleton v1 | current contract/skeleton checkpoint |
| `dev-notes.49` | runtime backend adapter execution interface v1 | current contract checkpoint |
| `dev-notes.50` | runtime capability execute-action orchestration v1 | current contract checkpoint |
| `dev-notes.51` | runtime capability result/event envelope integration v1 | current contract checkpoint |
| `dev-notes.52` | runtime native worker backend execution integration v1 | current behavior-wiring checkpoint |
| `dev-notes.53` | runtime execute-action public envelope dispatch v1 | current public dispatch checkpoint |
| `dev-notes.54` | runtime cancel action v1 | current public cancellation checkpoint |

## Reading order for new feature work

1. `current-architecture.md`
2. `feature-readiness.md`
3. `dev-notes.31`
4. Relevant historical `dev-notes.*` for the surface being changed

For example, embedding support should start from `feature-readiness.md`, then inspect runtime config/lifecycle docs and any test helper notes relevant to fixture propagation.
