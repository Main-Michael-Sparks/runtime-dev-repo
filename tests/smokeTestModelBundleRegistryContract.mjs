// smokeTestModelBundleRegistryContract.mjs
//
// Purpose:
// - Contract smoke for Runtime Dev model bundle registry v1.
// - Validates metadata-only model bundle definitions and registries without wiring
//   runtime.mjs, workerBridge, executable backends, or llama_worker modules.
//
// Run:
//   node ./tests/smokeTestModelBundleRegistryContract.mjs

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

import {
    MODEL_BUNDLE_ARTIFACT_LAYOUT_KINDS,
    MODEL_BUNDLE_CONTRACT_VERSION,
    MODEL_BUNDLE_REGISTRY_SCHEMA_VERSION,
    MODEL_BUNDLE_STATUSES,
    assertModelBundleDefinition,
    assertModelBundleRegistry,
    createModelBundleRegistry,
    getModelBundle,
    hasModelBundle,
    isKnownModelBundleArtifactLayoutKind,
    isKnownModelBundleRequirementSupportLevel,
    isKnownModelBundleStatus,
    isSelectableModelBundleStatus,
    listModelBundles,
    listModelBundlesForBackendKind,
    listModelBundlesForCapability,
    normalizeModelBundleDefinition,
    normalizeModelBundleRegistry,
    validateModelBundleDefinition,
    validateModelBundleRegistry
} from "../runtime/models/modelBundleContract.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

function fail(message) {
    throw new Error(`[FAIL] ${message}`);
}

function ok(message) {
    console.log(`[OK] ${message}`);
}

function assert(condition, message) {
    if (!condition) fail(message);
}

function assertIncludes(array, value, label) {
    assert(array.includes(value), `${label} missing ${value}`);
}

function assertErrorCode(result, code, label) {
    const found = result.errors.some((error) => error.code === code);
    assert(found, `${label} missing error code ${code}: ${JSON.stringify(result.errors)}`);
}

function assertErrorCodeIncludes(result, codeFragment, label) {
    const found = result.errors.some((error) => error.code.includes(codeFragment));
    assert(found, `${label} missing error code fragment ${codeFragment}: ${JSON.stringify(result.errors)}`);
}

function assertThrowsValidation(label, fn, code) {
    try {
        fn();
        fail(`${label} should throw`);
    } catch (err) {
        if (String(err.message).startsWith("[FAIL]")) throw err;
        assert(Array.isArray(err.validationErrors), `${label} should carry validationErrors`);
        assert(
            err.validationErrors.some((error) => error.code === code),
            `${label} missing validation error code ${code}: ${JSON.stringify(err.validationErrors)}`
        );
    }
}

async function readSource(relativePath) {
    return fs.readFile(path.join(repoRoot, relativePath), "utf8");
}

function createValidModelBundle(overrides = {}) {
    return {
        bundleId: "mistral-text-local",
        status: "configured",
        label: "Mistral 7B local text",
        capabilities: ["text.generate"],
        backendKind: "nativeWorkerBackend",
        backendId: "native-worker.default",
        defaultHardwareProfileId: "laptopFallback",
        artifactLayout: {
            kind: "gguf-text",
            modelPath: "../../../base/mistral-7b-instruct-v0.2.Q4_K_M.gguf"
        },
        requirements: {
            streaming: "supported",
            cancellation: "supported",
            timeout: "supported"
        },
        metadata: {
            notes: "static metadata only"
        },
        ...overrides
    };
}

function createBundleForLayout(kind) {
    const base = createValidModelBundle({
        bundleId: `bundle-${kind}`,
        artifactLayout: {
            kind,
            modelPath: "../../../models/model.gguf"
        }
    });

    if (kind === "gguf-mmproj") {
        return {
            ...base,
            artifactLayout: {
                kind,
                modelPath: "../../../models/model.gguf",
                mmprojPath: "../../../models/mmproj.gguf"
            }
        };
    }

    if (kind === "hf-multimodal") {
        return {
            ...base,
            artifactLayout: {
                kind,
                repo: "vendor/model-repo"
            }
        };
    }

    if (kind === "server-managed") {
        return {
            ...base,
            artifactLayout: {
                kind,
                endpoint: "http://127.0.0.1:8080"
            }
        };
    }

    if (kind === "native-vision") {
        return {
            ...base,
            capabilities: ["vision.chat"],
            artifactLayout: {
                kind,
                modelPath: "../../../models/vision-model.gguf",
                mmprojPath: "../../../models/mmproj.gguf"
            }
        };
    }

    return base;
}

async function testConstants() {
    assert(MODEL_BUNDLE_CONTRACT_VERSION === "model-bundle.v1", "contract version should match v1");
    assert(
        MODEL_BUNDLE_REGISTRY_SCHEMA_VERSION === "model-bundle-registry.v1",
        "registry schema version should match v1"
    );

    for (const status of ["contract-only", "planned", "experimental", "configured", "disabled", "deprecated"]) {
        assertIncludes(MODEL_BUNDLE_STATUSES, status, "model bundle statuses");
        assert(isKnownModelBundleStatus(status), `status should be known: ${status}`);
    }

    assert(isSelectableModelBundleStatus("contract-only"), "contract-only should be selectable");
    assert(isSelectableModelBundleStatus("configured"), "configured should be selectable");
    assert(!isSelectableModelBundleStatus("disabled"), "disabled should not be selectable");

    for (const kind of ["gguf-text", "gguf-mmproj", "hf-multimodal", "server-managed", "native-vision"]) {
        assertIncludes(MODEL_BUNDLE_ARTIFACT_LAYOUT_KINDS, kind, "artifact layout kinds");
        assert(isKnownModelBundleArtifactLayoutKind(kind), `artifact layout kind should be known: ${kind}`);
    }

    assert(isKnownModelBundleRequirementSupportLevel("supported"), "supported should be known requirement level");
    ok("constants and known-value helpers passed");
}

async function testValidDefinitions() {
    const bundle = assertModelBundleDefinition(createValidModelBundle());
    assert(bundle.bundleId === "mistral-text-local", "valid bundle should preserve bundleId");
    assert(bundle.artifactLayout.modelPath.includes("mistral"), "artifact modelPath metadata should be preserved");

    for (const kind of MODEL_BUNDLE_ARTIFACT_LAYOUT_KINDS) {
        const result = validateModelBundleDefinition(createBundleForLayout(kind));
        assert(result.ok, `valid ${kind} layout should pass: ${JSON.stringify(result.errors)}`);
    }

    const normalized = normalizeModelBundleDefinition(createValidModelBundle({
        bundleId: "  trimmed-bundle  ",
        capabilities: [" text.generate "],
        backendKind: " nativeWorkerBackend ",
        defaultHardwareProfileId: " laptopFallback "
    }));
    assert(normalized.bundleId === "trimmed-bundle", "bundleId should trim");
    assert(normalized.capabilities[0] === "text.generate", "capability should trim");
    assert(normalized.backendKind === "nativeWorkerBackend", "backendKind should trim");
    assert(normalized.defaultHardwareProfileId === "laptopFallback", "profile id should trim");
    ok("valid definition and normalization checks passed");
}

async function testInvalidDefinitions() {
    assertErrorCode(
        validateModelBundleDefinition(createValidModelBundle({ bundleId: "" })),
        "missing_model_bundle_id",
        "missing bundleId"
    );
    assertErrorCode(
        validateModelBundleDefinition(createValidModelBundle({ status: "ready" })),
        "unknown_model_bundle_status",
        "unknown status"
    );
    assertErrorCode(
        validateModelBundleDefinition(createValidModelBundle({ capabilities: ["text.unknown"] })),
        "unknown_model_bundle_capability",
        "unknown capability"
    );
    assertErrorCode(
        validateModelBundleDefinition(createValidModelBundle({ capabilities: ["text.generate", "text.generate"] })),
        "duplicate_model_bundle_string_array_entry",
        "duplicate capabilities"
    );
    assertErrorCode(
        validateModelBundleDefinition(createValidModelBundle({ unexpected: true })),
        "unknown_model_bundle_field",
        "unknown top-level field"
    );
    assertErrorCode(
        validateModelBundleDefinition(createValidModelBundle({ artifactLayout: {} })),
        "missing_model_bundle_artifact_layout_kind",
        "missing artifact layout kind"
    );
    assertErrorCode(
        validateModelBundleDefinition(createValidModelBundle({ artifactLayout: { kind: "mystery" } })),
        "unknown_model_bundle_artifact_layout_kind",
        "unknown artifact layout kind"
    );
    assertErrorCode(
        validateModelBundleDefinition(createValidModelBundle({
            artifactLayout: {
                kind: "gguf-text",
                modelPath: "../../../models/model.gguf",
                mmprojPath: "../../../models/mmproj.gguf"
            }
        })),
        "unknown_model_bundle_artifact_layout_field",
        "forbidden field for gguf-text"
    );
    assertErrorCode(
        validateModelBundleDefinition(createValidModelBundle({
            artifactLayout: {
                kind: "gguf-mmproj",
                modelPath: "../../../models/model.gguf"
            }
        })),
        "missing_model_bundle_artifact_layout_field",
        "missing layout field"
    );
    assertErrorCode(
        validateModelBundleDefinition(createValidModelBundle({
            requirements: {
                streaming: "maybe"
            }
        })),
        "unknown_model_bundle_requirement_support_level",
        "unknown requirement support level"
    );
    assertErrorCode(
        validateModelBundleDefinition(createValidModelBundle({
            metadata: {
                docsPath: "../secret"
            }
        })),
        "forbidden_model_bundle_path_like_value",
        "path-like metadata value"
    );
    assertErrorCode(
        validateModelBundleDefinition(createValidModelBundle({
            metadata: {
                backendOptions: {
                    raw: true
                }
            }
        })),
        "forbidden_model_bundle_key",
        "forbidden executable key"
    );
    assertErrorCode(
        validateModelBundleDefinition(createValidModelBundle({
            metadata: {
                modelPath: "../../../models/model.gguf"
            }
        })),
        "forbidden_model_bundle_request_path_key",
        "artifact path key outside artifactLayout"
    );
    assertThrowsValidation(
        "invalid model bundle assert",
        () => assertModelBundleDefinition(createValidModelBundle({ capabilities: ["text.unknown"] })),
        "unknown_model_bundle_capability"
    );
    ok("invalid definition checks passed");
}

async function testRegistries() {
    const textBundle = createValidModelBundle({
        bundleId: "mistral-text-local"
    });
    const visionBundle = createBundleForLayout("native-vision");
    const registry = createModelBundleRegistry([textBundle, visionBundle]);

    assert(registry.schemaVersion === MODEL_BUNDLE_REGISTRY_SCHEMA_VERSION, "registry schema should be set");
    assert(registry.bundles.length === 2, "registry should carry two bundles");

    const normalized = normalizeModelBundleRegistry({
        bundles: [textBundle]
    });
    assert(
        normalized.schemaVersion === MODEL_BUNDLE_REGISTRY_SCHEMA_VERSION,
        "registry normalization should default schemaVersion"
    );

    const validated = validateModelBundleRegistry({ bundles: [textBundle] });
    assert(validated.ok, `schemaVersion should default during validation: ${JSON.stringify(validated.errors)}`);

    assertErrorCode(
        validateModelBundleRegistry({ schemaVersion: "future", bundles: [textBundle] }),
        "unsupported_model_bundle_registry_schema_version",
        "unsupported schema version"
    );
    assertErrorCode(
        validateModelBundleRegistry({ bundles: textBundle }),
        "invalid_model_bundle_registry_bundles",
        "bundles not array"
    );
    assertErrorCode(
        validateModelBundleRegistry({ bundles: [textBundle, textBundle] }),
        "duplicate_model_bundle_id",
        "duplicate bundleId"
    );
    assertErrorCodeIncludes(
        validateModelBundleRegistry({ bundles: [createValidModelBundle({ capabilities: ["text.unknown"] })] }),
        "unknown_model_bundle_capability",
        "nested bundle errors should be prefixed"
    );

    assert(hasModelBundle(registry, "mistral-text-local"), "hasModelBundle should find bundle");
    assert(getModelBundle(registry, " mistral-text-local ").bundleId === "mistral-text-local", "getModelBundle should trim id");
    assert(getModelBundle(registry, "missing") === null, "getModelBundle should return null for missing");
    assert(listModelBundles(registry).length === 2, "listModelBundles should list entries");
    assert(
        listModelBundlesForCapability(registry, "vision.chat").length === 1,
        "capability lookup should find vision bundle"
    );
    assert(
        listModelBundlesForBackendKind(registry, "nativeWorkerBackend").length === 2,
        "backend kind lookup should find matching bundles"
    );

    const listed = listModelBundles(registry);
    listed[0].artifactLayout.modelPath = "mutated";
    assert(
        getModelBundle(registry, "mistral-text-local").artifactLayout.modelPath !== "mutated",
        "list/get helpers should return copies"
    );
    ok("registry helper checks passed");
}

async function testSourceShape() {
    const runtimeSource = await readSource("runtime.mjs");
    const namedBlockExports = [...runtimeSource.matchAll(/export\s+\{([\s\S]*?)\};/g)]
        .flatMap((match) => match[1].split(",").map((entry) => entry.trim()).filter(Boolean));
    const functionExports = [...runtimeSource.matchAll(/export\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)/g)]
        .map((match) => match[1]);
    const runtimeExports = [...namedBlockExports, ...functionExports].sort();
    assert(
        JSON.stringify(runtimeExports) === JSON.stringify([
            "cancelPrompt",
            "executeAction",
            "initModel",
            "prompt",
            "resetModel",
            "resetSession",
            "shutdownRuntime"
        ].sort()),
        `runtime.mjs exports changed unexpectedly: ${JSON.stringify(runtimeExports)}`
    );

    const barrelSource = await readSource("runtime/models/modelBundleContract.mjs");
    const barrelWithoutReExports = barrelSource
        .replace(/export\s+\{[\s\S]*?\}\s+from\s+"\.\/[^\n]+";\s*/g, "")
        .trim();
    assert(barrelWithoutReExports.length === 0, "modelBundleContract.mjs should remain a thin re-export barrel");

    const forbiddenImportPatterns = [
        /from\s+["'][^"']*runtime\.mjs["']/,
        /from\s+["'][^"']*workerBridge[^"']*["']/,
        /from\s+["'][^"']*llama_worker[^"']*["']/,
        /from\s+["']node-llama-cpp["']/,
        /from\s+["']worker_threads["']/,
        /from\s+["']child_process["']/,
        /from\s+["'][^"']*runtime\/request[^"']*["']/,
        /from\s+["'][^"']*runtime\/lifecycle[^"']*["']/,
        /from\s+["'][^"']*runtime\/stream[^"']*["']/
    ];

    for (const file of [
        "runtime/models/modelBundleCommon.mjs",
        "runtime/models/modelBundleDefinition.mjs",
        "runtime/models/modelBundleRegistry.mjs",
        "runtime/models/modelBundleContract.mjs"
    ]) {
        const source = await readSource(file);
        for (const pattern of forbiddenImportPatterns) {
            assert(!pattern.test(source), `${file} should not include forbidden runtime/worker/native import: ${pattern}`);
        }
    }
    ok("source-shape guard checks passed");
}

async function main() {
    console.log("[SMOKE] model bundle registry contract");
    await testConstants();
    await testValidDefinitions();
    await testInvalidDefinitions();
    await testRegistries();
    await testSourceShape();
    console.log("All model bundle registry contract smoke tests finished.");
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
