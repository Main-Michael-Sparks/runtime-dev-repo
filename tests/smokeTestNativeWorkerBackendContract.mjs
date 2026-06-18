// smokeTestNativeWorkerBackendContract.mjs
//
// Purpose:
// - Contract smoke for the nativeWorkerBackend descriptor boundary.
// - Validates the canonical native-worker.default adapter descriptor and its
//   compatibility with the existing backend adapter contract chain.
// - This test validates architecture; it does not define runtime behavior.
//
// Run:
//   node ./tests/smokeTestNativeWorkerBackendContract.mjs

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

import {
    assertCapabilityBusAction
} from "../runtime/bus/capabilityBusContract.mjs";
import {
    CAPABILITY_REGISTRY_SCHEMA_VERSION
} from "../runtime/bus/capabilityRegistryContract.mjs";
import {
    CAPABILITY_ROUTER_CONTRACT_VERSION,
    assertCapabilityRoutePlan
} from "../runtime/router/capabilityRouterContract.mjs";
import {
    CAPABILITY_SERVICE_CONTRACT_VERSION,
    CAPABILITY_SERVICE_REGISTRY_SCHEMA_VERSION,
    assertCapabilityServicePlan
} from "../runtime/bus/capabilityServiceContract.mjs";
import {
    BACKEND_ADAPTER_REGISTRY_SCHEMA_VERSION,
    NATIVE_WORKER_BACKEND_ADAPTER_CONTRACT_VERSION,
    NATIVE_WORKER_BACKEND_ADAPTER_ID,
    NATIVE_WORKER_BACKEND_ADAPTER_STATUS,
    NATIVE_WORKER_BACKEND_ADAPTER_VERSION,
    NATIVE_WORKER_BACKEND_CAPABILITIES,
    NATIVE_WORKER_BACKEND_KIND,
    NATIVE_WORKER_BACKEND_RESULT_OUTPUT_FIELDS,
    NATIVE_WORKER_BACKEND_RESULT_SCHEMA,
    NATIVE_WORKER_BACKEND_SERVICES,
    assertBackendAdapterPlan,
    assertNativeWorkerBackendAdapterDefinition,
    createBackendAdapterRegistry,
    createNativeWorkerBackendAdapterDefinition,
    getBackendAdapter,
    validateNativeWorkerBackendAdapterDefinition
} from "../runtime/backends/backendAdapterContract.mjs";

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

async function readSource(relativePath) {
    return fs.readFile(path.join(repoRoot, relativePath), "utf8");
}

function createValidActionEnvelope(overrides = {}) {
    return {
        actionId: "act_native_worker_backend_1",
        runId: "run_native_worker_backend_1",
        source: {
            kind: "direct-api"
        },
        capability: "text.generate",
        intent: "execute_cognitive_node",
        input: {
            prompt: "Say hello briefly.",
            contextRefs: ["ctx_1"]
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
            operator: "native-worker-backend-contract-smoke"
        },
        ...overrides
    };
}

function createCapabilityDefinition(overrides = {}) {
    return {
        capability: "text.generate",
        version: "v1",
        status: "contract-only",
        summary: "Generate text through an approved text capability service.",
        contracts: {
            action: "actionEnvelope.v1",
            result: "resultEnvelope.v1",
            event: "actionEvent.v1"
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
            backendKinds: [NATIVE_WORKER_BACKEND_KIND],
            modelBundleRequired: true,
            contextRefs: true
        },
        ...overrides
    };
}

function createBusAction(actionOverrides = {}) {
    return assertCapabilityBusAction(
        createValidActionEnvelope(actionOverrides),
        {
            schemaVersion: CAPABILITY_REGISTRY_SCHEMA_VERSION,
            capabilities: [createCapabilityDefinition()]
        }
    );
}

function createRoute(overrides = {}) {
    return {
        routeId: "text-generate-default",
        capability: "text.generate",
        status: "contract-only",
        serviceId: "text.generate.default",
        backendKind: NATIVE_WORKER_BACKEND_KIND,
        backendId: NATIVE_WORKER_BACKEND_ADAPTER_ID,
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

function createRoutePlan(routeOverrides = {}) {
    return assertCapabilityRoutePlan(
        createBusAction(),
        {
            schemaVersion: CAPABILITY_ROUTER_CONTRACT_VERSION,
            routes: [createRoute(routeOverrides)]
        }
    );
}

function createService(overrides = {}) {
    return {
        serviceId: "text.generate.default",
        capability: "text.generate",
        version: "v1",
        status: "contract-only",
        summary: "Validate text generation inputs and normalize text generation results.",
        contracts: {
            action: "actionEnvelope.v1",
            result: "resultEnvelope.v1",
            event: "actionEvent.v1"
        },
        input: {
            schema: "text.generate.input.v1",
            requiredFields: ["prompt"],
            optionalFields: ["contextRefs"],
            contextRefs: "supported"
        },
        result: {
            schema: NATIVE_WORKER_BACKEND_RESULT_SCHEMA,
            outputFields: [...NATIVE_WORKER_BACKEND_RESULT_OUTPUT_FIELDS],
            streamingDeltas: "supported"
        },
        requirements: {
            streaming: "supported",
            cancellation: "supported",
            timeout: "supported",
            approval: "conditional"
        },
        compatibility: {
            backendKinds: [NATIVE_WORKER_BACKEND_KIND],
            modelBundleRequired: true,
            hardwareProfileRequired: true
        },
        ...overrides
    };
}

function createServicePlan(routeOverrides = {}) {
    return assertCapabilityServicePlan(
        createRoutePlan(routeOverrides),
        {
            schemaVersion: CAPABILITY_SERVICE_REGISTRY_SCHEMA_VERSION,
            services: [createService()]
        }
    );
}

async function assertNoNativeWorkerRuntimeWiring() {
    const backendFiles = [
        "runtime/backends/backendAdapterContract.mjs",
        "runtime/backends/nativeWorker/nativeWorkerBackendAdapterDefinition.mjs",
        "runtime/backends/nativeWorker/nativeWorkerBackendContract.mjs"
    ];

    const forbiddenMarkers = [
        "runtime.mjs",
        "workerBridge",
        "llama_worker",
        "node-llama-cpp",
        "worker_threads",
        "child_process",
        "new Worker",
        "sendToWorker",
        "ReadableStream",
        "setTimeout",
        "Date.now"
    ];

    for (const relativePath of backendFiles) {
        const source = await readSource(relativePath);

        for (const marker of forbiddenMarkers) {
            if (source.includes(marker)) {
                fail(`${relativePath} includes forbidden runtime/native wiring marker: ${marker}`);
            }
        }
    }

    const runtimeSource = await readSource("runtime.mjs");
    assert(
        !runtimeSource.includes("runtime/backends") && !runtimeSource.includes("./runtime/backends"),
        "runtime.mjs should not import backend adapter contract modules in this branch"
    );

    ok("native worker backend contract avoids runtime/native wiring imports");
}

function testNativeWorkerConstants() {
    assert(
        NATIVE_WORKER_BACKEND_ADAPTER_CONTRACT_VERSION === "native-worker-backend-adapter.v1",
        "native worker backend adapter contract version should match"
    );
    assert(NATIVE_WORKER_BACKEND_KIND === "nativeWorkerBackend", "native worker backendKind should match");
    assert(NATIVE_WORKER_BACKEND_ADAPTER_ID === "native-worker.default", "native worker adapterId should match");
    assert(NATIVE_WORKER_BACKEND_ADAPTER_VERSION === "v1", "native worker adapter version should match");
    assert(NATIVE_WORKER_BACKEND_ADAPTER_STATUS === "contract-only", "native worker adapter status should match");
    assert(NATIVE_WORKER_BACKEND_CAPABILITIES.length === 1, "native worker capabilities should be narrow");
    assert(NATIVE_WORKER_BACKEND_CAPABILITIES[0] === "text.generate", "native worker capability should be text.generate");
    assert(NATIVE_WORKER_BACKEND_SERVICES[0] === "text.generate.default", "native worker service should be text.generate.default");
    assert(NATIVE_WORKER_BACKEND_RESULT_SCHEMA === "text.generate.result.v1", "native worker result schema should match");
    assert(NATIVE_WORKER_BACKEND_RESULT_OUTPUT_FIELDS[0] === "text", "native worker output field should be text");

    ok("native worker backend constants passed");
}

function testNativeWorkerCanonicalDescriptor() {
    const adapter = createNativeWorkerBackendAdapterDefinition();
    const result = validateNativeWorkerBackendAdapterDefinition(adapter);

    assert(result.ok, `canonical native worker adapter should pass: ${JSON.stringify(result.errors)}`);
    assert(result.value.adapterId === NATIVE_WORKER_BACKEND_ADAPTER_ID, "canonical adapterId should survive validation");
    assert(result.value.backendKind === NATIVE_WORKER_BACKEND_KIND, "canonical backendKind should survive validation");
    assert(result.value.status === "contract-only", "native worker backend remains contract-only");
    assert(result.value.capabilities.length === 1, "native worker backend should define one v1 capability");
    assert(result.value.services.length === 1, "native worker backend should define one v1 service");
    assert(result.value.compatibility.modelBundleRequired === true, "native worker backend should require model bundles");
    assert(result.value.compatibility.hardwareProfileRequired === true, "native worker backend should require hardware profiles");

    const asserted = assertNativeWorkerBackendAdapterDefinition(adapter);
    assert(asserted.adapterId === NATIVE_WORKER_BACKEND_ADAPTER_ID, "assertion should return normalized canonical adapter");

    ok("native worker canonical descriptor contract passed");
}

function testNativeWorkerRejectsNonCanonicalIdentity() {
    const wrongId = validateNativeWorkerBackendAdapterDefinition({
        ...createNativeWorkerBackendAdapterDefinition(),
        adapterId: "default"
    });
    assert(!wrongId.ok, "plain default should not be accepted as the canonical native worker adapterId");
    assertErrorCode(wrongId, "invalid_native_worker_backend_adapter_id", "plain default adapterId");

    const wrongKind = validateNativeWorkerBackendAdapterDefinition({
        ...createNativeWorkerBackendAdapterDefinition(),
        backendKind: "llamaServerBackend",
        compatibility: {
            ...createNativeWorkerBackendAdapterDefinition().compatibility,
            backendKind: "llamaServerBackend"
        }
    });
    assert(!wrongKind.ok, "wrong backendKind should reject");
    assertErrorCode(wrongKind, "invalid_native_worker_backend_kind", "wrong backendKind");

    ok("native worker canonical identity rejection passed");
}

function testNativeWorkerRejectsShapeDrift() {
    const extraCapability = validateNativeWorkerBackendAdapterDefinition({
        ...createNativeWorkerBackendAdapterDefinition(),
        capabilities: ["text.generate", "text.embed"]
    });
    assert(!extraCapability.ok, "extra capability should reject in v1 native worker contract");
    assertErrorCode(extraCapability, "invalid_native_worker_backend_capabilities", "extra capability");

    const missingModelBundle = validateNativeWorkerBackendAdapterDefinition({
        ...createNativeWorkerBackendAdapterDefinition(),
        compatibility: {
            ...createNativeWorkerBackendAdapterDefinition().compatibility,
            modelBundleRequired: false
        }
    });
    assert(!missingModelBundle.ok, "modelBundleRequired false should reject");
    assertErrorCode(missingModelBundle, "invalid_native_worker_backend_model_bundle_requirement", "model bundle requirement");

    const weakerCancellation = validateNativeWorkerBackendAdapterDefinition({
        ...createNativeWorkerBackendAdapterDefinition(),
        requirements: {
            ...createNativeWorkerBackendAdapterDefinition().requirements,
            cancellation: "unsupported"
        }
    });
    assert(!weakerCancellation.ok, "unsupported cancellation should reject for native worker v1");
    assertErrorCode(weakerCancellation, "invalid_native_worker_backend_cancellation_requirement", "cancellation support");

    ok("native worker shape-drift rejection passed");
}

function testNativeWorkerWorksWithBackendRegistryAndPlan() {
    const adapter = createNativeWorkerBackendAdapterDefinition();
    const registry = createBackendAdapterRegistry([adapter]);
    const listedAdapter = getBackendAdapter(registry, NATIVE_WORKER_BACKEND_ADAPTER_ID);

    assert(listedAdapter?.adapterId === NATIVE_WORKER_BACKEND_ADAPTER_ID, "registry should resolve canonical native worker adapter ID");

    const plan = assertBackendAdapterPlan(createServicePlan(), {
        schemaVersion: BACKEND_ADAPTER_REGISTRY_SCHEMA_VERSION,
        adapters: [adapter]
    });

    assert(plan.adapter.adapterId === NATIVE_WORKER_BACKEND_ADAPTER_ID, "backend adapter plan should select canonical native worker adapter");
    assert(plan.adapter.backendKind === NATIVE_WORKER_BACKEND_KIND, "backend adapter plan should preserve native worker backendKind");
    assert(typeof plan.adapter.execute === "undefined", "native worker descriptor plan must not include execute hook");
    assert(typeof plan.adapter.modelPath === "undefined", "native worker descriptor plan must not expose model paths");
    assert(plan.servicePlan.contractVersion === CAPABILITY_SERVICE_CONTRACT_VERSION, "service plan should remain metadata-only");

    ok("native worker backend registry and plan compatibility passed");
}

await assertNoNativeWorkerRuntimeWiring();
testNativeWorkerConstants();
testNativeWorkerCanonicalDescriptor();
testNativeWorkerRejectsNonCanonicalIdentity();
testNativeWorkerRejectsShapeDrift();
testNativeWorkerWorksWithBackendRegistryAndPlan();

console.log("All native worker backend contract smoke tests finished.");
