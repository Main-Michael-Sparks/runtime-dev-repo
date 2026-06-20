// smokeTestHardwareProfileRegistryContract.mjs
//
// Purpose:
// - Contract smoke for Runtime Dev hardware profile registry v1.
// - Validates metadata-only hardware profile definitions and registries without
//   wiring runtime.mjs, workerBridge, executable backends, runtime config init
//   retry/probe modules, or llama_worker modules.
//
// Run:
//   node ./tests/smokeTestHardwareProfileRegistryContract.mjs

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

import {
    HARDWARE_PROFILE_CLASSES,
    HARDWARE_PROFILE_CONTRACT_VERSION,
    HARDWARE_PROFILE_PROCESS_MODES,
    HARDWARE_PROFILE_REGISTRY_SCHEMA_VERSION,
    HARDWARE_PROFILE_STATUSES,
    assertHardwareProfileDefinition,
    assertHardwareProfileRegistry,
    createHardwareProfileRegistry,
    getHardwareProfile,
    hasHardwareProfile,
    isKnownHardwareProfileClass,
    isKnownHardwareProfileProcessMode,
    isKnownHardwareProfileStatus,
    isSelectableHardwareProfileStatus,
    listHardwareProfiles,
    listHardwareProfilesForBackendKind,
    listHardwareProfilesForCapability,
    listHardwareProfilesForHardwareClass,
    listSelectableHardwareProfiles,
    normalizeHardwareProfileDefinition,
    normalizeHardwareProfileRegistry,
    validateHardwareProfileDefinition,
    validateHardwareProfileRegistry
} from "../runtime/profiles/hardwareProfileContract.mjs";

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

function createValidHardwareProfile(overrides = {}) {
    return {
        profileId: "laptopFallback",
        status: "configured",
        label: "Laptop fallback",
        hardwareClass: "cpu-laptop",
        capabilities: ["text.generate", "vision.chat"],
        backendKinds: ["nativeWorkerBackend", "llamaMtmdCliBackend"],
        processModes: ["in-process-worker", "oneshot-cli"],
        limits: {
            maxConcurrentText: 2,
            maxConcurrentVision: 1,
            maxConcurrentEmbedding: 1,
            maxQueueSizeText: 50,
            maxQueueSizeVision: 5,
            maxImageBytes: 4000000,
            maxImagePixels: 1500000,
            timeoutMs: 180000
        },
        tuning: {
            gpuLayers: 0,
            threads: {
                ideal: 2,
                min: 1
            },
            batchSize: 256,
            contextSize: "auto"
        },
        media: {
            imageResize: {
                enabled: true,
                maxWidth: 1024,
                maxHeight: 1024
            }
        },
        metadata: {
            notes: "static metadata only"
        },
        ...overrides
    };
}

function createProfileWithId(profileId, overrides = {}) {
    return createValidHardwareProfile({
        profileId,
        label: profileId,
        ...overrides
    });
}

async function testConstants() {
    assert(HARDWARE_PROFILE_CONTRACT_VERSION === "hardware-profile.v1", "contract version should match v1");
    assert(
        HARDWARE_PROFILE_REGISTRY_SCHEMA_VERSION === "hardware-profile-registry.v1",
        "registry schema version should match v1"
    );

    for (const status of ["contract-only", "planned", "experimental", "configured", "disabled", "deprecated"]) {
        assertIncludes(HARDWARE_PROFILE_STATUSES, status, "hardware profile statuses");
        assert(isKnownHardwareProfileStatus(status), `status should be known: ${status}`);
    }

    assert(isSelectableHardwareProfileStatus("contract-only"), "contract-only should be selectable");
    assert(isSelectableHardwareProfileStatus("configured"), "configured should be selectable");
    assert(!isSelectableHardwareProfileStatus("disabled"), "disabled should not be selectable");

    for (const hardwareClass of [
        "cpu-laptop",
        "cpu-desktop",
        "gpu-consumer",
        "gpu-workstation",
        "server-managed",
        "external-service",
        "unknown"
    ]) {
        assertIncludes(HARDWARE_PROFILE_CLASSES, hardwareClass, "hardware profile classes");
        assert(isKnownHardwareProfileClass(hardwareClass), `hardware class should be known: ${hardwareClass}`);
    }

    for (const processMode of [
        "in-process-worker",
        "managed-worker",
        "oneshot-cli",
        "service",
        "external-service",
        "metadata-only"
    ]) {
        assertIncludes(HARDWARE_PROFILE_PROCESS_MODES, processMode, "hardware profile process modes");
        assert(isKnownHardwareProfileProcessMode(processMode), `process mode should be known: ${processMode}`);
    }

    ok("constants and known-value helpers passed");
}

async function testValidDefinitions() {
    const profile = assertHardwareProfileDefinition(createValidHardwareProfile());
    assert(profile.profileId === "laptopFallback", "valid profile should preserve profileId");
    assert(profile.tuning.contextSize === "auto", "valid profile should preserve contextSize auto metadata");

    const autoGpuProfile = validateHardwareProfileDefinition(createValidHardwareProfile({
        profileId: "gpuAuto",
        tuning: {
            gpuLayers: "auto",
            threads: {
                ideal: 0,
                min: 1
            },
            batchSize: 512,
            contextSize: {
                min: 2048,
                max: 4096
            }
        }
    }));
    assert(autoGpuProfile.ok, `valid auto/bounded tuning profile should pass: ${JSON.stringify(autoGpuProfile.errors)}`);

    const normalized = normalizeHardwareProfileDefinition(createValidHardwareProfile({
        profileId: "  trimmed-profile  ",
        status: " configured ",
        hardwareClass: " cpu-laptop ",
        capabilities: [" text.generate "],
        backendKinds: [" nativeWorkerBackend "],
        processModes: [" in-process-worker "],
        tuning: {
            contextSize: " auto "
        }
    }));
    assert(normalized.profileId === "trimmed-profile", "profileId should trim");
    assert(normalized.status === "configured", "status should trim");
    assert(normalized.hardwareClass === "cpu-laptop", "hardwareClass should trim");
    assert(normalized.capabilities[0] === "text.generate", "capability should trim");
    assert(normalized.backendKinds[0] === "nativeWorkerBackend", "backendKind should trim");
    assert(normalized.processModes[0] === "in-process-worker", "processMode should trim");
    assert(normalized.tuning.contextSize === "auto", "contextSize string should trim");
    ok("valid definition and normalization checks passed");
}

async function testInvalidDefinitions() {
    assertErrorCode(
        validateHardwareProfileDefinition(createValidHardwareProfile({ profileId: "" })),
        "missing_hardware_profile_id",
        "missing profileId"
    );
    assertErrorCode(
        validateHardwareProfileDefinition(createValidHardwareProfile({ status: "ready" })),
        "unknown_hardware_profile_status",
        "unknown status"
    );
    assertErrorCode(
        validateHardwareProfileDefinition(createValidHardwareProfile({ hardwareClass: "gpu-cloud" })),
        "unknown_hardware_profile_class",
        "unknown hardware class"
    );
    assertErrorCode(
        validateHardwareProfileDefinition(createValidHardwareProfile({ capabilities: ["text.unknown"] })),
        "unknown_hardware_profile_capability",
        "unknown capability"
    );
    assertErrorCode(
        validateHardwareProfileDefinition(createValidHardwareProfile({ capabilities: ["text.generate", "text.generate"] })),
        "duplicate_hardware_profile_string_array_entry",
        "duplicate capabilities"
    );
    assertErrorCode(
        validateHardwareProfileDefinition(createValidHardwareProfile({ backendKinds: ["nativeWorkerBackend", "nativeWorkerBackend"] })),
        "duplicate_hardware_profile_string_array_entry",
        "duplicate backendKinds"
    );
    assertErrorCode(
        validateHardwareProfileDefinition(createValidHardwareProfile({ processModes: ["daemon"] })),
        "unknown_hardware_profile_process_mode",
        "unknown process mode"
    );
    assertErrorCode(
        validateHardwareProfileDefinition(createValidHardwareProfile({ unexpected: true })),
        "unknown_hardware_profile_field",
        "unknown top-level field"
    );
    assertErrorCode(
        validateHardwareProfileDefinition(createValidHardwareProfile({ limits: { timeoutMs: 0 } })),
        "invalid_hardware_profile_limit_value",
        "invalid timeout limit"
    );
    assertErrorCode(
        validateHardwareProfileDefinition(createValidHardwareProfile({ limits: { mysteryLimit: 1 } })),
        "unknown_hardware_profile_limit_field",
        "unknown limit field"
    );
    assertErrorCode(
        validateHardwareProfileDefinition(createValidHardwareProfile({ tuning: { gpuLayers: -1 } })),
        "invalid_hardware_profile_gpu_layers",
        "invalid gpuLayers"
    );
    assertErrorCode(
        validateHardwareProfileDefinition(createValidHardwareProfile({ tuning: { threads: { ideal: -1 } } })),
        "invalid_hardware_profile_threads_value",
        "invalid threads"
    );
    assertErrorCode(
        validateHardwareProfileDefinition(createValidHardwareProfile({ tuning: { batchSize: 0 } })),
        "invalid_hardware_profile_batch_size",
        "invalid batchSize"
    );
    assertErrorCode(
        validateHardwareProfileDefinition(createValidHardwareProfile({ tuning: { contextSize: "large" } })),
        "invalid_hardware_profile_context_size_value",
        "invalid contextSize"
    );
    assertErrorCode(
        validateHardwareProfileDefinition(createValidHardwareProfile({ tuning: { contextSize: { min: 4096, max: 2048 } } })),
        "invalid_hardware_profile_context_size_range",
        "invalid contextSize range"
    );
    assertErrorCode(
        validateHardwareProfileDefinition(createValidHardwareProfile({ media: { imageResize: { enabled: "yes" } } })),
        "invalid_hardware_profile_image_resize_enabled",
        "invalid imageResize enabled"
    );
    assertErrorCode(
        validateHardwareProfileDefinition(createValidHardwareProfile({ media: { imageResize: { maxWidth: 0 } } })),
        "invalid_hardware_profile_image_resize_dimension",
        "invalid imageResize dimension"
    );
    assertErrorCode(
        validateHardwareProfileDefinition(createValidHardwareProfile({ media: { imageResize: { mode: "crop" } } })),
        "unknown_hardware_profile_image_resize_field",
        "unknown imageResize field"
    );
    assertErrorCode(
        validateHardwareProfileDefinition(createValidHardwareProfile({
            metadata: {
                docsPath: "../secret"
            }
        })),
        "forbidden_hardware_profile_path_like_value",
        "path-like metadata value"
    );
    assertErrorCode(
        validateHardwareProfileDefinition(createValidHardwareProfile({
            metadata: {
                backendOptions: {
                    raw: true
                }
            }
        })),
        "forbidden_hardware_profile_key",
        "forbidden executable key"
    );
    assertErrorCode(
        validateHardwareProfileDefinition(createValidHardwareProfile({
            metadata: {
                modelPath: "../../../models/model.gguf"
            }
        })),
        "forbidden_hardware_profile_key",
        "forbidden model path key"
    );
    assertThrowsValidation(
        "invalid hardware profile assert",
        () => assertHardwareProfileDefinition(createValidHardwareProfile({ capabilities: ["text.unknown"] })),
        "unknown_hardware_profile_capability"
    );
    ok("invalid definition checks passed");
}

async function testRegistries() {
    const laptopProfile = createProfileWithId("laptopFallback");
    const gpuProfile = createProfileWithId("rtx3060_12gb", {
        hardwareClass: "gpu-consumer",
        backendKinds: ["llamaServerBackend"],
        processModes: ["service"],
        status: "experimental"
    });
    const disabledProfile = createProfileWithId("disabledLab", {
        status: "disabled",
        hardwareClass: "unknown"
    });
    const registry = createHardwareProfileRegistry([laptopProfile, gpuProfile, disabledProfile]);

    assert(registry.schemaVersion === HARDWARE_PROFILE_REGISTRY_SCHEMA_VERSION, "registry schema should be set");
    assert(registry.profiles.length === 3, "registry should carry three profiles");

    const normalized = normalizeHardwareProfileRegistry({
        profiles: [laptopProfile]
    });
    assert(
        normalized.schemaVersion === HARDWARE_PROFILE_REGISTRY_SCHEMA_VERSION,
        "registry normalization should default schemaVersion"
    );

    const validated = validateHardwareProfileRegistry({ profiles: [laptopProfile] });
    assert(validated.ok, `schemaVersion should default during validation: ${JSON.stringify(validated.errors)}`);

    assertErrorCode(
        validateHardwareProfileRegistry({ schemaVersion: "future", profiles: [laptopProfile] }),
        "unsupported_hardware_profile_registry_schema_version",
        "unsupported schema version"
    );
    assertErrorCode(
        validateHardwareProfileRegistry({ profiles: laptopProfile }),
        "invalid_hardware_profile_registry_profiles",
        "profiles not array"
    );
    assertErrorCode(
        validateHardwareProfileRegistry({ profiles: [laptopProfile, laptopProfile] }),
        "duplicate_hardware_profile_id",
        "duplicate profileId"
    );
    assertErrorCodeIncludes(
        validateHardwareProfileRegistry({ profiles: [createValidHardwareProfile({ capabilities: ["text.unknown"] })] }),
        "unknown_hardware_profile_capability",
        "nested profile errors should be prefixed"
    );

    assert(hasHardwareProfile(registry, "laptopFallback"), "hasHardwareProfile should find profile");
    assert(getHardwareProfile(registry, " laptopFallback ").profileId === "laptopFallback", "getHardwareProfile should trim id");
    assert(getHardwareProfile(registry, "missing") === null, "getHardwareProfile should return null for missing");
    assert(listHardwareProfiles(registry).length === 3, "listHardwareProfiles should list entries");
    assert(
        listHardwareProfilesForCapability(registry, "vision.chat").length === 3,
        "capability lookup should find vision profiles"
    );
    assert(
        listHardwareProfilesForBackendKind(registry, "llamaServerBackend").length === 1,
        "backend kind lookup should find matching profiles"
    );
    assert(
        listHardwareProfilesForHardwareClass(registry, "gpu-consumer").length === 1,
        "hardware class lookup should find matching profiles"
    );
    assert(
        listSelectableHardwareProfiles(registry).length === 2,
        "selectable lookup should exclude disabled profiles"
    );

    const listed = listHardwareProfiles(registry);
    listed[0].tuning.batchSize = 999;
    assert(
        getHardwareProfile(registry, "laptopFallback").tuning.batchSize !== 999,
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
            "cancelAction",
            "cancelPrompt",
            "executeAction",
            "initModel",
            "prompt",
            "readActionEvents",
            "resetModel",
            "resetSession",
            "shutdownRuntime",
            "subscribeActionEvents"
        ].sort()),
        `runtime.mjs exports changed unexpectedly: ${JSON.stringify(runtimeExports)}`
    );

    const barrelSource = await readSource("runtime/profiles/hardwareProfileContract.mjs");
    const barrelWithoutReExports = barrelSource
        .replace(/export\s+\{[\s\S]*?\}\s+from\s+"\.\/[^\n]+";\s*/g, "")
        .trim();
    assert(barrelWithoutReExports.length === 0, "hardwareProfileContract.mjs should remain a thin re-export barrel");

    const forbiddenImportPatterns = [
        /from\s+["'][^"']*runtime\.mjs["']/,
        /from\s+["'][^"']*workerBridge[^"']*["']/,
        /from\s+["'][^"']*llama_worker[^"']*["']/,
        /from\s+["']node-llama-cpp["']/,
        /from\s+["']worker_threads["']/,
        /from\s+["']child_process["']/,
        /from\s+["'][^"']*runtime\/config[^"']*["']/,
        /from\s+["'][^"']*runtime\/request[^"']*["']/,
        /from\s+["'][^"']*runtime\/lifecycle[^"']*["']/,
        /from\s+["'][^"']*runtime\/stream[^"']*["']/,
        /from\s+["'][^"']*runtime\/router[^"']*["']/,
        /from\s+["'][^"']*runtime\/backends[^"']*["']/,
        /from\s+["'][^"']*runtime\/execution[^"']*["']/
    ];

    for (const file of [
        "runtime/profiles/hardwareProfileCommon.mjs",
        "runtime/profiles/hardwareProfileDefinition.mjs",
        "runtime/profiles/hardwareProfileRegistry.mjs",
        "runtime/profiles/hardwareProfileContract.mjs"
    ]) {
        const source = await readSource(file);
        for (const pattern of forbiddenImportPatterns) {
            assert(!pattern.test(source), `${file} should not include forbidden runtime/worker/native import: ${pattern}`);
        }
    }
    ok("source-shape guard checks passed");
}

async function main() {
    console.log("[SMOKE] hardware profile registry contract");
    await testConstants();
    await testValidDefinitions();
    await testInvalidDefinitions();
    await testRegistries();
    await testSourceShape();
    console.log("All hardware profile registry contract smoke tests finished.");
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
