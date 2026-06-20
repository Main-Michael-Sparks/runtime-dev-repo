// smokeTestBackendAdapterExecutionInterface.mjs
//
// Purpose:
// - Contract smoke for the Runtime Dev backend adapter execution interface seam.
// - Validates that accepted capability execution / executor skeleton descriptors
//   can derive a minimal backend adapter invocation descriptor without wiring
//   runtime.mjs, workerBridge, backend execution, scheduler/request/stream, or llama_worker.
//
// Run:
//   node ./tests/smokeTestBackendAdapterExecutionInterface.mjs

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

import {
    CAPABILITY_REGISTRY_SCHEMA_VERSION
} from "../runtime/bus/capabilityRegistryContract.mjs";
import {
    CAPABILITY_ROUTER_CONTRACT_VERSION
} from "../runtime/router/capabilityRouterContract.mjs";
import {
    CAPABILITY_SERVICE_CONTRACT_VERSION,
    CAPABILITY_SERVICE_REGISTRY_SCHEMA_VERSION
} from "../runtime/bus/capabilityServiceContract.mjs";
import {
    BACKEND_ADAPTER_INVOCATION_BOUNDARY,
    BACKEND_ADAPTER_INVOCATION_CONTRACT_VERSION,
    BACKEND_ADAPTER_INVOCATION_EXECUTABLE,
    BACKEND_ADAPTER_INVOCATION_NATIVE_EXECUTION,
    BACKEND_ADAPTER_INVOCATION_RUNTIME_WIRING,
    BACKEND_ADAPTER_INVOCATION_STATUS,
    BACKEND_ADAPTER_REGISTRY_SCHEMA_VERSION,
    assertBackendAdapterPlan,
    assertBackendAdapterInvocationDescriptor,
    copyBackendAdapterInvocationDescriptor,
    normalizeBackendAdapterInvocationDescriptor,
    validateBackendAdapterInvocationDescriptor
} from "../runtime/backends/backendAdapterContract.mjs";
import {
    CAPABILITY_BUS_EXECUTE_ACTION_CONTRACT_VERSION,
    assertCapabilityBusExecuteActionPlan
} from "../runtime/bus/executeAction/capabilityBusExecuteActionContract.mjs";
import {
    CAPABILITY_EXECUTOR_CONTRACT_VERSION,
    CAPABILITY_EXECUTOR_SKELETON_CONTRACT_VERSION,
    normalizeCapabilityExecutorSkeletonPlan
} from "../runtime/execution/capabilityExecutorContract.mjs";

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

function assertErrorCodeIncludes(result, code, label) {
    const found = result.errors.some((error) => error.code.includes(code));
    assert(found, `${label} missing error code fragment ${code}: ${JSON.stringify(result.errors)}`);
}

function assertThrowsValidation(label, fn, code) {
    try {
        fn();
        fail(`${label} should throw`);
    } catch (err) {
        if (String(err.message).startsWith("[FAIL]")) throw err;
        assert(Array.isArray(err.validationErrors), `${label} should carry validationErrors`);
        assert(
            err.validationErrors.some((error) => error.code.includes(code)),
            `${label} missing validation error code ${code}: ${JSON.stringify(err.validationErrors)}`
        );
    }
}

async function readSource(relativePath) {
    return fs.readFile(path.join(repoRoot, relativePath), "utf8");
}

function createValidActionEnvelope(overrides = {}) {
    return {
        actionId: "act_backend_adapter_invocation_1",
        runId: "run_backend_adapter_invocation_1",
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
            operator: "backend-adapter-execution-interface-smoke"
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
            backendKinds: ["nativeWorkerBackend"],
            modelBundleRequired: true,
            contextRefs: true
        },
        ...overrides
    };
}

function createValidCapabilityRegistry(definitions = [createValidCapabilityDefinition()]) {
    return {
        schemaVersion: CAPABILITY_REGISTRY_SCHEMA_VERSION,
        capabilities: definitions
    };
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
        schemaVersion: CAPABILITY_ROUTER_CONTRACT_VERSION,
        routes
    };
}

function createValidService(overrides = {}) {
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
            schema: "text.generate.result.v1",
            outputFields: ["text"],
            streamingDeltas: "supported"
        },
        requirements: {
            streaming: "supported",
            cancellation: "supported",
            timeout: "supported",
            approval: "conditional"
        },
        compatibility: {
            backendKinds: ["nativeWorkerBackend"],
            modelBundleRequired: true,
            hardwareProfileRequired: true
        },
        ...overrides
    };
}

function createValidServiceRegistry(services = [createValidService()]) {
    return {
        schemaVersion: CAPABILITY_SERVICE_REGISTRY_SCHEMA_VERSION,
        services
    };
}

function createValidAdapter(overrides = {}) {
    return {
        adapterId: "native-worker.default",
        backendKind: "nativeWorkerBackend",
        version: "v1",
        status: "contract-only",
        summary: "Native worker backend adapter descriptor.",
        capabilities: ["text.generate"],
        services: ["text.generate.default"],
        contracts: {
            servicePlan: CAPABILITY_SERVICE_CONTRACT_VERSION,
            result: "resultEnvelope.v1",
            event: "actionEvent.v1"
        },
        result: {
            schema: "text.generate.result.v1",
            outputFields: ["text"],
            streamingDeltas: "supported",
            errorNormalization: "supported"
        },
        requirements: {
            streaming: "supported",
            cancellation: "supported",
            timeout: "supported"
        },
        compatibility: {
            backendKind: "nativeWorkerBackend",
            modelBundleRequired: true,
            hardwareProfileRequired: true
        },
        ...overrides
    };
}

function createValidBackendAdapterRegistry(adapters = [createValidAdapter()]) {
    return {
        schemaVersion: BACKEND_ADAPTER_REGISTRY_SCHEMA_VERSION,
        adapters
    };
}

function createValidExecuteActionPlan() {
    return assertCapabilityBusExecuteActionPlan(
        createValidActionEnvelope(),
        {
            capabilityRegistry: createValidCapabilityRegistry(),
            routerRegistry: createValidRouterRegistry(),
            serviceRegistry: createValidServiceRegistry(),
            backendAdapterRegistry: createValidBackendAdapterRegistry()
        }
    );
}

function createValidBackendAdapterPlan() {
    const executeActionPlan = createValidExecuteActionPlan();
    return assertBackendAdapterPlan(
        executeActionPlan.executionPlan.backendPlan.servicePlan,
        createValidBackendAdapterRegistry()
    );
}

function assertInvocationDescriptorShape(descriptor) {
    assert(descriptor.contractVersion === BACKEND_ADAPTER_INVOCATION_CONTRACT_VERSION, "descriptor contract version mismatch");
    assert(descriptor.status === BACKEND_ADAPTER_INVOCATION_STATUS, "descriptor status mismatch");
    assert(descriptor.executionPlan === undefined, "descriptor must not embed executionPlan");
    assert(descriptor.backendPlan === undefined, "descriptor must not embed backendPlan");
    assert(descriptor.invocation.actionId === "act_backend_adapter_invocation_1", "descriptor actionId mismatch");
    assert(descriptor.invocation.runId === "run_backend_adapter_invocation_1", "descriptor runId mismatch");
    assert(descriptor.invocation.capability === "text.generate", "descriptor capability mismatch");
    assert(descriptor.invocation.serviceId === "text.generate.default", "descriptor serviceId mismatch");
    assert(descriptor.invocation.adapterId === "native-worker.default", "descriptor adapterId mismatch");
    assert(descriptor.invocation.backendKind === "nativeWorkerBackend", "descriptor backendKind mismatch");
    assert(descriptor.invocation.routeId === "text-generate-default", "descriptor routeId mismatch");
    assert(descriptor.invocation.modelBundleId === "mistral-text-local", "descriptor modelBundleId mismatch");
    assert(descriptor.invocation.hardwareProfileId === "laptopFallback", "descriptor hardwareProfileId mismatch");
    assert(descriptor.invocation.stream === true, "descriptor stream mismatch");
    assert(descriptor.invocation.timeoutMs === 60000, "descriptor timeoutMs mismatch");
    assert(descriptor.invocation.resultContract === "resultEnvelope.v1", "descriptor resultContract mismatch");
    assert(descriptor.invocation.eventContract === "actionEvent.v1", "descriptor eventContract mismatch");
    assert(descriptor.boundary.adapterInvocation === BACKEND_ADAPTER_INVOCATION_BOUNDARY, "boundary adapterInvocation mismatch");
    assert(descriptor.boundary.executable === BACKEND_ADAPTER_INVOCATION_EXECUTABLE, "boundary executable mismatch");
    assert(descriptor.boundary.runtimeWiring === BACKEND_ADAPTER_INVOCATION_RUNTIME_WIRING, "boundary runtimeWiring mismatch");
    assert(descriptor.boundary.nativeExecution === BACKEND_ADAPTER_INVOCATION_NATIVE_EXECUTION, "boundary nativeExecution mismatch");
}

function assertValidInvocationDescriptor() {
    const executeActionPlan = createValidExecuteActionPlan();
    const fromExecutionPlan = normalizeBackendAdapterInvocationDescriptor(executeActionPlan.executionPlan);

    assert(executeActionPlan.contractVersion === CAPABILITY_BUS_EXECUTE_ACTION_CONTRACT_VERSION, "execute-action contract version mismatch");
    assert(executeActionPlan.executionPlan.contractVersion === CAPABILITY_EXECUTOR_CONTRACT_VERSION, "execution plan version mismatch");
    assertInvocationDescriptorShape(fromExecutionPlan);

    const skeletonPlan = normalizeCapabilityExecutorSkeletonPlan(executeActionPlan.executionPlan);
    assert(skeletonPlan.contractVersion === CAPABILITY_EXECUTOR_SKELETON_CONTRACT_VERSION, "skeleton contract version mismatch");

    const fromSkeleton = normalizeBackendAdapterInvocationDescriptor(skeletonPlan);
    assertInvocationDescriptorShape(fromSkeleton);
    assert(
        JSON.stringify(fromSkeleton.invocation) === JSON.stringify(fromExecutionPlan.invocation),
        "skeleton and execution plan should derive the same backend adapter invocation metadata"
    );

    const validated = validateBackendAdapterInvocationDescriptor(fromSkeleton);
    assert(validated.ok, `normalized invocation descriptor should validate: ${JSON.stringify(validated.errors)}`);

    ok("valid execution/skeleton chain produced backend adapter invocation descriptor");
    return fromSkeleton;
}

function assertInvocationDescriptorValidation() {
    const descriptor = assertValidInvocationDescriptor();

    const unsupportedVersion = validateBackendAdapterInvocationDescriptor({
        ...descriptor,
        contractVersion: "backend-adapter-invocation.v999"
    });
    assertErrorCodeIncludes(
        unsupportedVersion,
        "unsupported_backend_adapter_invocation_contract_version",
        "unsupported invocation descriptor version"
    );

    const unknownField = validateBackendAdapterInvocationDescriptor({
        ...descriptor,
        adapterRuntime: "not-v1"
    });
    assertErrorCodeIncludes(
        unknownField,
        "unknown_backend_adapter_invocation_descriptor_field",
        "unknown invocation descriptor field"
    );

    const executableBoundary = validateBackendAdapterInvocationDescriptor({
        ...descriptor,
        boundary: {
            ...descriptor.boundary,
            executable: true
        }
    });
    assertErrorCodeIncludes(
        executableBoundary,
        "invalid_backend_adapter_invocation_boundary_executable",
        "executable invocation boundary"
    );

    const implementedBoundary = validateBackendAdapterInvocationDescriptor({
        ...descriptor,
        boundary: {
            ...descriptor.boundary,
            adapterInvocation: "implemented"
        }
    });
    assertErrorCodeIncludes(
        implementedBoundary,
        "invalid_backend_adapter_invocation_boundary_adapter_invocation",
        "implemented invocation boundary"
    );

    const wiredNativeExecution = validateBackendAdapterInvocationDescriptor({
        ...descriptor,
        boundary: {
            ...descriptor.boundary,
            nativeExecution: "wired"
        }
    });
    assertErrorCodeIncludes(
        wiredNativeExecution,
        "invalid_backend_adapter_invocation_boundary_native_execution",
        "wired native execution boundary"
    );

    const invalidStream = validateBackendAdapterInvocationDescriptor({
        ...descriptor,
        invocation: {
            ...descriptor.invocation,
            stream: "yes"
        }
    });
    assertErrorCodeIncludes(
        invalidStream,
        "invalid_backend_adapter_invocation_stream_flag",
        "invalid invocation stream"
    );

    const invalidTimeout = validateBackendAdapterInvocationDescriptor({
        ...descriptor,
        invocation: {
            ...descriptor.invocation,
            timeoutMs: -1
        }
    });
    assertErrorCodeIncludes(
        invalidTimeout,
        "invalid_backend_adapter_invocation_timeout_ms",
        "invalid invocation timeout"
    );

    assertThrowsValidation(
        "assert invalid invocation version",
        () => assertBackendAdapterInvocationDescriptor({
            ...descriptor,
            contractVersion: "backend-adapter-invocation.v999"
        }),
        "unsupported_backend_adapter_invocation_contract_version"
    );

    ok("backend adapter invocation validation rejection paths passed");
}

function assertForbiddenKeysReject() {
    const descriptor = assertValidInvocationDescriptor();

    const forbiddenTopLevel = validateBackendAdapterInvocationDescriptor({
        ...descriptor,
        rawBackendPayload: {
            command: "run-this"
        }
    });
    assertErrorCodeIncludes(
        forbiddenTopLevel,
        "forbidden_backend_adapter_invocation_descriptor_key",
        "forbidden raw backend payload"
    );

    const forbiddenInvocation = validateBackendAdapterInvocationDescriptor({
        ...descriptor,
        invocation: {
            ...descriptor.invocation,
            modelPath: "../../../base/model.gguf"
        }
    });
    assertErrorCodeIncludes(
        forbiddenInvocation,
        "forbidden_backend_adapter_invocation_descriptor_key",
        "forbidden invocation modelPath"
    );

    const forbiddenBoundary = validateBackendAdapterInvocationDescriptor({
        ...descriptor,
        boundary: {
            ...descriptor.boundary,
            workerBridge: "sendToWorker"
        }
    });
    assertErrorCodeIncludes(
        forbiddenBoundary,
        "forbidden_backend_adapter_invocation_descriptor_key",
        "forbidden boundary workerBridge"
    );

    ok("forbidden invocation execution/backend payload keys rejected");
}

function assertRawBackendAdapterPlanRejected() {
    const backendPlan = createValidBackendAdapterPlan();
    const result = validateBackendAdapterInvocationDescriptor(backendPlan);

    assertErrorCodeIncludes(
        result,
        "unsupported_backend_adapter_invocation_source",
        "raw backend adapter plan direct input"
    );

    ok("raw backend adapter plan direct input rejected");
}

function assertCopyIsolation() {
    const descriptor = assertValidInvocationDescriptor();
    const copied = copyBackendAdapterInvocationDescriptor(descriptor);

    copied.invocation.serviceId = "mutated";
    copied.boundary.runtimeWiring = "mutated";

    assert(
        descriptor.invocation.serviceId === "text.generate.default",
        "copyBackendAdapterInvocationDescriptor should copy invocation metadata"
    );
    assert(
        descriptor.boundary.runtimeWiring === BACKEND_ADAPTER_INVOCATION_RUNTIME_WIRING,
        "copyBackendAdapterInvocationDescriptor should copy boundary metadata"
    );

    ok("backend adapter invocation copy isolation passed");
}

async function assertBackendAdapterInvocationModuleBoundaries() {
    const backendFiles = [
        "runtime/backends/backendAdapterInvocationCommon.mjs",
        "runtime/backends/backendAdapterInvocationDescriptor.mjs",
        "runtime/backends/backendAdapterContract.mjs"
    ];

    const forbiddenImportMarkers = [
        "runtime.mjs",
        "workerBridge",
        "llama_worker",
        "node-llama-cpp",
        "worker_threads",
        "child_process",
        "new Worker",
        "sendToWorker",
        "scheduler",
        "ReadableStream"
    ];

    for (const relativePath of backendFiles) {
        const source = await readSource(relativePath);
        const importLines = source
            .split("\n")
            .filter((line) => line.trim().startsWith("import"));

        for (const marker of forbiddenImportMarkers) {
            assert(
                !importLines.some((line) => line.includes(marker)),
                `${relativePath} imports forbidden runtime/worker marker: ${marker}`
            );
        }

        assert(
            !/export\s+(async\s+)?function\s+executeAction\b/.test(source),
            `${relativePath} must not export executeAction()`
        );
        assert(
            !/\bpostMessage\s*\(/.test(source),
            `${relativePath} must not post worker/runtime messages`
        );
    }

    const runtimeSource = await readSource("runtime.mjs");
    assert(runtimeSource.includes("export async function executeAction"), "runtime.mjs must expose narrow executeAction seam");
    assert(runtimeSource.includes("runExecuteActionDispatch(actionInput"), "runtime.mjs executeAction must call public dispatch seam");
    assert(!runtimeSource.includes("executeActionEnvelope"), "runtime.mjs must not expose raw action-envelope execution in this branch");

    const contractSource = await readSource("runtime/backends/backendAdapterContract.mjs");
    const contractNonEmptyLines = contractSource
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);

    assert(contractNonEmptyLines.length <= 80, "backendAdapterContract.mjs should remain a thin public barrel");
    assert(!/\bfunction\b/.test(contractSource), "backendAdapterContract.mjs should not define functions");
    assert(!/\bconst\b|\blet\b|=>/.test(contractSource), "backendAdapterContract.mjs should not contain hidden implementation logic");

    ok("backend adapter invocation module source guards passed");
}

async function main() {
    console.log("[SMOKE] backend adapter execution interface");

    assert(
        BACKEND_ADAPTER_INVOCATION_CONTRACT_VERSION === "backend-adapter-invocation.v1",
        "backend adapter invocation contract version export mismatch"
    );
    ok("backend adapter invocation contract version export passed");

    assertInvocationDescriptorValidation();
    assertForbiddenKeysReject();
    assertRawBackendAdapterPlanRejected();
    assertCopyIsolation();
    await assertBackendAdapterInvocationModuleBoundaries();

    console.log("All backend adapter execution interface smoke tests finished.");
}

main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
});
