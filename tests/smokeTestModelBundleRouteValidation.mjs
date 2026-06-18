// smokeTestModelBundleRouteValidation.mjs
//
// Purpose:
// - Contract smoke for Runtime Dev model-bundle route validation v1.
// - Validates route/model-bundle/hardware-profile metadata compatibility without
//   wiring public runtime APIs, workerBridge, executable backends, or worker modules.
//
// Run:
//   node ./tests/smokeTestModelBundleRouteValidation.mjs

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

import {
    CAPABILITY_BUS_CONTRACT_VERSION,
    assertCapabilityBusAction
} from "../runtime/bus/capabilityBusContract.mjs";
import {
    CAPABILITY_CONTRACT_REFS
} from "../runtime/bus/capabilityDefinition.mjs";
import {
    CAPABILITY_ROUTE_MODEL_BUNDLE_PLAN_CONTRACT_VERSION,
    assertCapabilityRouteModelBundlePlan,
    assertCapabilityRoutePlan,
    normalizeCapabilityRouteModelBundlePlan,
    validateCapabilityRouteModelBundlePlan
} from "../runtime/router/capabilityRouterContract.mjs";
import {
    createModelBundleRegistry
} from "../runtime/models/modelBundleContract.mjs";
import {
    createHardwareProfileRegistry
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

function assertErrorCode(result, code, label) {
    const found = result.errors.some((error) => error.code === code);
    assert(found, `${label} missing error code ${code}: ${JSON.stringify(result.errors)}`);
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

function createValidAction(overrides = {}) {
    return {
        actionId: "act_route_bundle_1",
        runId: "run_route_bundle_1",
        source: {
            kind: "direct-api"
        },
        capability: "text.generate",
        intent: "execute_cognitive_node",
        input: {
            prompt: "Say hello briefly."
        },
        requirements: {
            modelClass: "reasoning-7b",
            contextNeed: "medium",
            stream: true,
            timeoutMs: 60000
        },
        policy: {
            maxTokens: 128,
            approvalRequired: false,
            allowTools: false,
            budget: {
                tokens: 128
            }
        },
        trace: {
            operator: "route-model-bundle-smoke"
        },
        ...overrides
    };
}

function createValidCapabilityDefinition(overrides = {}) {
    return {
        capability: "text.generate",
        version: "v1",
        status: "contract-only",
        summary: "Generate text through an approved text capability service.",
        contracts: {
            action: CAPABILITY_CONTRACT_REFS.action,
            result: CAPABILITY_CONTRACT_REFS.result,
            event: CAPABILITY_CONTRACT_REFS.event
        },
        requirements: {
            streaming: "supported",
            cancellation: "supported",
            timeout: "supported",
            approval: "conditional"
        },
        policy: {
            maxTokens: true,
            approvalRequired: true,
            allowTools: false,
            budget: true
        },
        compatibility: {
            backendKinds: ["nativeWorkerBackend"],
            modelBundleRequired: true,
            contextRefs: true
        },
        ...overrides
    };
}

function createValidCapabilityRegistry(definition = createValidCapabilityDefinition()) {
    return {
        schemaVersion: "capability-registry.v1",
        capabilities: [definition]
    };
}

function createValidBusAction({ action = createValidAction(), definition = createValidCapabilityDefinition() } = {}) {
    return assertCapabilityBusAction(action, createValidCapabilityRegistry(definition));
}

function createValidRoute(overrides = {}) {
    return {
        routeId: "text-generate-default",
        capability: "text.generate",
        status: "contract-only",
        serviceId: "text.generate.default",
        backendKind: "nativeWorkerBackend",
        backendId: "native-worker.default",
        modelBundleId: "mistral-text-local",
        hardwareProfileId: "laptopFallback",
        requirements: {
            streaming: "supported",
            cancellation: "supported",
            timeout: "supported"
        },
        ...overrides
    };
}

function createValidRouterRegistry(routes = [createValidRoute()]) {
    return {
        schemaVersion: "capability-router.v1",
        routes
    };
}

function createValidRoutePlan({
    action = createValidAction(),
    definition = createValidCapabilityDefinition(),
    route = createValidRoute()
} = {}) {
    const busAction = createValidBusAction({ action, definition });
    return assertCapabilityRoutePlan(busAction, createValidRouterRegistry([route]));
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

function createVisionModelBundle(overrides = {}) {
    return createValidModelBundle({
        bundleId: "qwen-vl-local",
        capabilities: ["vision.chat"],
        backendKind: "llamaMtmdCliBackend",
        backendId: "llama-mtmd.default",
        defaultHardwareProfileId: "visionLaptop",
        artifactLayout: {
            kind: "gguf-mmproj",
            modelPath: "../../../models/qwen-vl/model.gguf",
            mmprojPath: "../../../models/qwen-vl/mmproj.gguf"
        },
        ...overrides
    });
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

function createRegistries({ bundles = [createValidModelBundle()], profiles = [createValidHardwareProfile()] } = {}) {
    return {
        modelBundleRegistry: createModelBundleRegistry(bundles),
        hardwareProfileRegistry: createHardwareProfileRegistry(profiles)
    };
}

const ROUTE_MODEL_BUNDLE_IMPLEMENTATION_FILES = [
    "runtime/router/capabilityRouteModelBundlePlan.mjs",
    "runtime/router/capabilityRouterContract.mjs",
    "runtime/router/capabilityRouterCommon.mjs"
];

async function assertNoRuntimeWiringImports() {
    const forbiddenMarkers = [
        "runtime.mjs",
        "workerBridge",
        "llama_worker",
        "node-llama-cpp",
        "../lifecycle/",
        "../request/",
        "../stream/",
        "executeAction",
        "prompt("
    ];

    for (const relativePath of ROUTE_MODEL_BUNDLE_IMPLEMENTATION_FILES) {
        const source = await readSource(relativePath);

        for (const marker of forbiddenMarkers) {
            if (source.includes(marker)) {
                fail(`${relativePath} includes forbidden runtime wiring marker: ${marker}`);
            }
        }
    }

    ok("route model-bundle validation modules avoid runtime/worker execution imports");
}

function testValidTextRouteBundleAndProfile() {
    const routePlan = createValidRoutePlan();
    const result = validateCapabilityRouteModelBundlePlan(routePlan, createRegistries());

    assert(result.ok, `valid route/model/profile should pass: ${JSON.stringify(result.errors)}`);
    assert(
        result.value.contractVersion === CAPABILITY_ROUTE_MODEL_BUNDLE_PLAN_CONTRACT_VERSION,
        "route model-bundle plan contract version should match"
    );
    assert(result.value.routePlan.contractVersion === "capability-router.v1", "route plan copy should keep router contract");
    assert(result.value.modelBundle.bundleId === "mistral-text-local", "selected model bundle should be returned");
    assert(result.value.hardwareProfile.profileId === "laptopFallback", "selected hardware profile should be returned");
    assert(result.value.effectiveHardwareProfileId === "laptopFallback", "effective profile should be route profile");
    assert(result.value.routePlan !== routePlan, "result should copy routePlan wrapper");
    assert(result.value.routePlan.route !== routePlan.route, "result should copy route object");

    const normalized = normalizeCapabilityRouteModelBundlePlan(routePlan, createRegistries());
    assert(normalized.modelBundle.backendKind === "nativeWorkerBackend", "normalize helper should return accepted plan");

    const asserted = assertCapabilityRouteModelBundlePlan(routePlan, createRegistries());
    assert(asserted.hardwareProfile.backendKinds.includes("nativeWorkerBackend"), "assert helper should return accepted plan");

    ok("valid text route/model/profile validation passed");
}

function testValidVisionMetadataRouteWithoutExecution() {
    const route = createValidRoute({
        routeId: "vision-chat-default",
        capability: "vision.chat",
        serviceId: "vision.chat.default",
        backendKind: "llamaMtmdCliBackend",
        backendId: "llama-mtmd.default",
        modelBundleId: "qwen-vl-local",
        hardwareProfileId: "visionLaptop"
    });
    const action = createValidAction({
        capability: "vision.chat",
        input: {
            imageRef: "image_1",
            prompt: "Describe this image."
        }
    });
    const definition = createValidCapabilityDefinition({
        capability: "vision.chat",
        compatibility: {
            backendKinds: ["llamaMtmdCliBackend"],
            modelBundleRequired: true,
            contextRefs: true
        }
    });
    const profile = createValidHardwareProfile({
        profileId: "visionLaptop",
        label: "Vision laptop fallback",
        capabilities: ["vision.chat"],
        backendKinds: ["llamaMtmdCliBackend"]
    });
    const routePlan = createValidRoutePlan({ action, definition, route });
    const result = validateCapabilityRouteModelBundlePlan(routePlan, createRegistries({
        bundles: [createVisionModelBundle()],
        profiles: [profile]
    }));

    assert(result.ok, `valid future vision metadata should pass: ${JSON.stringify(result.errors)}`);
    assert(result.value.modelBundle.artifactLayout.kind === "gguf-mmproj", "vision model bundle layout should remain metadata");
    assert(result.value.hardwareProfile.processModes.includes("oneshot-cli"), "vision profile process mode should remain metadata");

    ok("valid future vision metadata route passed without execution");
}

function testNoBundleOrProfileDoesNotRequireRegistries() {
    const routePlan = createValidRoutePlan({
        definition: createValidCapabilityDefinition({
            capability: "tool.call",
            compatibility: {
                backendKinds: ["toolBackend"],
                modelBundleRequired: false,
                contextRefs: true
            }
        }),
        route: createValidRoute({
            routeId: "tool-call-default",
            capability: "tool.call",
            serviceId: "tool.call.default",
            backendKind: "toolBackend",
            backendId: "tool.default",
            modelBundleId: undefined,
            hardwareProfileId: undefined
        }),
        action: createValidAction({
            capability: "tool.call",
            input: {
                toolName: "safe-tool"
            }
        })
    });
    const result = validateCapabilityRouteModelBundlePlan(routePlan);

    assert(result.ok, `route without model/profile should not require registries: ${JSON.stringify(result.errors)}`);
    assert(result.value.modelBundle === null, "route without modelBundleId should return null modelBundle");
    assert(result.value.hardwareProfile === null, "route without profile should return null hardwareProfile");
    assert(result.value.effectiveHardwareProfileId === null, "route without profile should return null effective profile");

    ok("route without bundle/profile does not require registries passed");
}

function testBundleRegistryRejections() {
    const routePlan = createValidRoutePlan();

    const missingRegistry = validateCapabilityRouteModelBundlePlan(routePlan, {
        hardwareProfileRegistry: createRegistries().hardwareProfileRegistry
    });
    assert(!missingRegistry.ok, "missing model bundle registry should reject");
    assertErrorCode(missingRegistry, "route_model_bundle_registry_missing", "missing model bundle registry");

    const missingBundle = validateCapabilityRouteModelBundlePlan(routePlan, createRegistries({
        bundles: [createValidModelBundle({ bundleId: "different-bundle" })]
    }));
    assert(!missingBundle.ok, "missing model bundle should reject");
    assertErrorCode(missingBundle, "route_model_bundle_missing", "missing model bundle");

    const disabledBundle = validateCapabilityRouteModelBundlePlan(routePlan, createRegistries({
        bundles: [createValidModelBundle({ status: "disabled" })]
    }));
    assert(!disabledBundle.ok, "disabled model bundle should reject");
    assertErrorCode(disabledBundle, "route_model_bundle_unselectable_status", "disabled model bundle");

    ok("model bundle registry/missing/status rejection passed");
}

function testBundleCompatibilityRejections() {
    const routePlan = createValidRoutePlan();

    const capabilityMismatch = validateCapabilityRouteModelBundlePlan(routePlan, createRegistries({
        bundles: [createValidModelBundle({ capabilities: ["text.embed"] })]
    }));
    assert(!capabilityMismatch.ok, "model bundle capability mismatch should reject");
    assertErrorCode(capabilityMismatch, "route_model_bundle_capability_incompatible", "bundle capability mismatch");

    const backendKindMismatch = validateCapabilityRouteModelBundlePlan(routePlan, createRegistries({
        bundles: [createValidModelBundle({ backendKind: "llamaServerBackend" })]
    }));
    assert(!backendKindMismatch.ok, "model bundle backendKind mismatch should reject");
    assertErrorCode(backendKindMismatch, "route_model_bundle_backend_kind_mismatch", "bundle backendKind mismatch");

    const backendIdMismatch = validateCapabilityRouteModelBundlePlan(routePlan, createRegistries({
        bundles: [createValidModelBundle({ backendId: "native-worker.other" })]
    }));
    assert(!backendIdMismatch.ok, "model bundle backendId mismatch should reject");
    assertErrorCode(backendIdMismatch, "route_model_bundle_backend_id_mismatch", "bundle backendId mismatch");

    ok("model bundle compatibility rejection passed");
}

function testHardwareProfileSelectionRules() {
    const defaultProfileRoutePlan = createValidRoutePlan({
        route: createValidRoute({ hardwareProfileId: undefined })
    });
    const defaultResult = validateCapabilityRouteModelBundlePlan(defaultProfileRoutePlan, createRegistries());
    assert(defaultResult.ok, `bundle default profile should validate: ${JSON.stringify(defaultResult.errors)}`);
    assert(defaultResult.value.effectiveHardwareProfileId === "laptopFallback", "bundle default profile should become effective profile");

    const routeOverridePlan = createValidRoutePlan({
        route: createValidRoute({ hardwareProfileId: "desktopFallback" })
    });
    const routeOverrideResult = validateCapabilityRouteModelBundlePlan(routeOverridePlan, createRegistries({
        profiles: [
            createValidHardwareProfile(),
            createValidHardwareProfile({ profileId: "desktopFallback", label: "Desktop fallback" })
        ]
    }));
    assert(routeOverrideResult.ok, `route profile override should validate: ${JSON.stringify(routeOverrideResult.errors)}`);
    assert(routeOverrideResult.value.effectiveHardwareProfileId === "desktopFallback", "route profile should override bundle default");
    assert(routeOverrideResult.value.hardwareProfile.profileId === "desktopFallback", "route override profile should be selected");

    ok("hardware profile selection rule passed");
}

function testHardwareProfileRejections() {
    const routePlan = createValidRoutePlan();

    const missingRegistry = validateCapabilityRouteModelBundlePlan(routePlan, {
        modelBundleRegistry: createRegistries().modelBundleRegistry
    });
    assert(!missingRegistry.ok, "missing hardware profile registry should reject");
    assertErrorCode(missingRegistry, "route_hardware_profile_registry_missing", "missing profile registry");

    const missingProfile = validateCapabilityRouteModelBundlePlan(routePlan, createRegistries({
        profiles: [createValidHardwareProfile({ profileId: "differentProfile", label: "Different profile" })]
    }));
    assert(!missingProfile.ok, "missing hardware profile should reject");
    assertErrorCode(missingProfile, "route_hardware_profile_missing", "missing profile");

    const disabledProfile = validateCapabilityRouteModelBundlePlan(routePlan, createRegistries({
        profiles: [createValidHardwareProfile({ status: "disabled" })]
    }));
    assert(!disabledProfile.ok, "disabled hardware profile should reject");
    assertErrorCode(disabledProfile, "route_hardware_profile_unselectable_status", "disabled profile");

    const capabilityMismatch = validateCapabilityRouteModelBundlePlan(routePlan, createRegistries({
        profiles: [createValidHardwareProfile({ capabilities: ["text.embed"] })]
    }));
    assert(!capabilityMismatch.ok, "hardware profile capability mismatch should reject");
    assertErrorCode(capabilityMismatch, "route_hardware_profile_capability_incompatible", "profile capability mismatch");

    const backendKindMismatch = validateCapabilityRouteModelBundlePlan(routePlan, createRegistries({
        profiles: [createValidHardwareProfile({ backendKinds: ["llamaServerBackend"] })]
    }));
    assert(!backendKindMismatch.ok, "hardware profile backendKind mismatch should reject");
    assertErrorCode(backendKindMismatch, "route_hardware_profile_backend_kind_incompatible", "profile backendKind mismatch");

    ok("hardware profile rejection passed");
}

function testRoutePlanShapeRejections() {
    const invalidRoot = validateCapabilityRouteModelBundlePlan(null, createRegistries());
    assert(!invalidRoot.ok, "null route plan should reject");
    assertErrorCode(invalidRoot, "route_model_bundle_route_plan_invalid", "null route plan");

    const badVersion = validateCapabilityRouteModelBundlePlan({
        ...createValidRoutePlan(),
        contractVersion: "capability-router.v0"
    }, createRegistries());
    assert(!badVersion.ok, "unsupported route plan contract should reject");
    assertErrorCode(badVersion, "route_model_bundle_route_contract_version_unsupported", "bad route plan contract");

    const unknownField = validateCapabilityRouteModelBundlePlan({
        ...createValidRoutePlan(),
        priority: 1
    }, createRegistries());
    assert(!unknownField.ok, "unknown route plan field should reject");
    assertErrorCode(unknownField, "route_model_bundle_route_plan_unknown_field", "unknown route plan field");

    const badActionCapability = validateCapabilityRouteModelBundlePlan({
        ...createValidRoutePlan(),
        busAction: {
            ...createValidRoutePlan().busAction,
            action: {
                ...createValidRoutePlan().busAction.action,
                capability: "text.embed"
            }
        }
    }, createRegistries());
    assert(!badActionCapability.ok, "route/action capability mismatch should reject");
    assertErrorCode(badActionCapability, "route_model_bundle_route_capability_mismatch", "route/action capability mismatch");

    assertThrowsValidation(
        "assert route model-bundle plan",
        () => assertCapabilityRouteModelBundlePlan(null, createRegistries()),
        "route_model_bundle_route_plan_invalid"
    );

    ok("route plan shape rejection passed");
}

function testCopyBehaviorPreventsMutationLeaks() {
    const routePlan = createValidRoutePlan();
    const registries = createRegistries();
    const accepted = assertCapabilityRouteModelBundlePlan(routePlan, registries);

    accepted.routePlan.route.routeId = "mutated-route";
    accepted.modelBundle.bundleId = "mutated-bundle";
    accepted.hardwareProfile.profileId = "mutated-profile";

    assert(routePlan.route.routeId === "text-generate-default", "mutating result route should not mutate source route plan");
    assert(registries.modelBundleRegistry.bundles[0].bundleId === "mistral-text-local", "mutating result bundle should not mutate registry");
    assert(registries.hardwareProfileRegistry.profiles[0].profileId === "laptopFallback", "mutating result profile should not mutate registry");

    ok("route model-bundle validation copy behavior passed");
}

async function assertSourcePropagation() {
    const commonSource = await readSource("runtime/router/capabilityRouterCommon.mjs");
    assert(
        commonSource.includes("CAPABILITY_ROUTE_MODEL_BUNDLE_PLAN_CONTRACT_VERSION"),
        "router common should export route model-bundle plan contract version"
    );

    const contractSource = await readSource("runtime/router/capabilityRouterContract.mjs");
    assert(
        contractSource.includes("validateCapabilityRouteModelBundlePlan"),
        "router contract should export route model-bundle validation helper"
    );

    const busContractSource = (await readSource("runtime/bus/capabilityRouterContract.mjs")).trim();
    assert(
        busContractSource === "export * from \"../router/capabilityRouterContract.mjs\";",
        "bus router contract compatibility barrel should remain re-export-only"
    );

    ok("source propagation checks passed");
}

async function main() {
    assert(CAPABILITY_BUS_CONTRACT_VERSION === "capability-bus.v1", "bus contract version should match fixture expectation");
    assert(
        CAPABILITY_ROUTE_MODEL_BUNDLE_PLAN_CONTRACT_VERSION === "capability-route-model-bundle-plan.v1",
        "route model-bundle plan contract version should match"
    );

    testValidTextRouteBundleAndProfile();
    testValidVisionMetadataRouteWithoutExecution();
    testNoBundleOrProfileDoesNotRequireRegistries();
    testBundleRegistryRejections();
    testBundleCompatibilityRejections();
    testHardwareProfileSelectionRules();
    testHardwareProfileRejections();
    testRoutePlanShapeRejections();
    testCopyBehaviorPreventsMutationLeaks();
    await assertSourcePropagation();
    await assertNoRuntimeWiringImports();

    console.log("All model-bundle route validation smoke checks finished.");
}

main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
});
