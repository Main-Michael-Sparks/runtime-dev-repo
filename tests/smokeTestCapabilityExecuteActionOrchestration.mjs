// smokeTestCapabilityExecuteActionOrchestration.mjs
//
// Purpose:
// - Contract smoke for the Runtime Dev Capability Bus execute-action orchestration seam.
// - Validates that an accepted execute-action plan can be composed into a
//   descriptor-only orchestration handoff without wiring runtime.mjs,
//   workerBridge, backend execution, scheduler/request/stream, or llama_worker.
//
// Run:
//   node ./tests/smokeTestCapabilityExecuteActionOrchestration.mjs

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
    BACKEND_ADAPTER_REGISTRY_SCHEMA_VERSION,
    assertBackendAdapterPlan
} from "../runtime/backends/backendAdapterContract.mjs";
import {
    CAPABILITY_EXECUTOR_SKELETON_CONTRACT_VERSION,
    validateCapabilityExecutorSkeletonPlan
} from "../runtime/execution/capabilityExecutorContract.mjs";
import {
    CAPABILITY_BUS_EXECUTE_ACTION_CONTRACT_VERSION,
    CAPABILITY_BUS_EXECUTE_ACTION_ORCHESTRATION_ADAPTER_INVOCATION,
    CAPABILITY_BUS_EXECUTE_ACTION_ORCHESTRATION_BOUNDARY,
    CAPABILITY_BUS_EXECUTE_ACTION_ORCHESTRATION_CHAIN,
    CAPABILITY_BUS_EXECUTE_ACTION_ORCHESTRATION_CONTRACT_VERSION,
    CAPABILITY_BUS_EXECUTE_ACTION_ORCHESTRATION_EXECUTABLE,
    CAPABILITY_BUS_EXECUTE_ACTION_ORCHESTRATION_NATIVE_EXECUTION,
    CAPABILITY_BUS_EXECUTE_ACTION_ORCHESTRATION_RUNTIME_WIRING,
    CAPABILITY_BUS_EXECUTE_ACTION_ORCHESTRATION_STATUS,
    assertCapabilityBusExecuteActionPlan,
    assertCapabilityBusExecuteActionOrchestrationDescriptor,
    copyCapabilityBusExecuteActionOrchestrationDescriptor,
    normalizeCapabilityBusExecuteActionOrchestrationDescriptor,
    validateCapabilityBusExecuteActionOrchestrationDescriptor
} from "../runtime/bus/executeAction/capabilityBusExecuteActionContract.mjs";

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
        actionId: "act_execute_action_orchestration_1",
        runId: "run_execute_action_orchestration_1",
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
            operator: "capability-execute-action-orchestration-smoke"
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

function assertOrchestrationDescriptorShape(descriptor) {
    assert(descriptor.contractVersion === CAPABILITY_BUS_EXECUTE_ACTION_ORCHESTRATION_CONTRACT_VERSION, "orchestration contract version mismatch");
    assert(descriptor.status === CAPABILITY_BUS_EXECUTE_ACTION_ORCHESTRATION_STATUS, "orchestration status mismatch");
    assert(descriptor.action.actionId === "act_execute_action_orchestration_1", "orchestration actionId mismatch");
    assert(descriptor.action.runId === "run_execute_action_orchestration_1", "orchestration runId mismatch");
    assert(descriptor.action.capability === "text.generate", "orchestration capability mismatch");
    assert(JSON.stringify(descriptor.orchestration.chain) === JSON.stringify(CAPABILITY_BUS_EXECUTE_ACTION_ORCHESTRATION_CHAIN), "orchestration chain mismatch");
    assert(descriptor.orchestration.composition === "descriptor-chain", "orchestration composition mismatch");
    assert(descriptor.orchestration.execution === "not-started", "orchestration execution mismatch");
    assert(descriptor.executeActionPlan.contractVersion === CAPABILITY_BUS_EXECUTE_ACTION_CONTRACT_VERSION, "embedded execute-action plan contract mismatch");
    assert(descriptor.executorSkeletonPlan.contractVersion === CAPABILITY_EXECUTOR_SKELETON_CONTRACT_VERSION, "embedded executor skeleton contract mismatch");
    assert(descriptor.backendAdapterInvocationDescriptor.contractVersion === BACKEND_ADAPTER_INVOCATION_CONTRACT_VERSION, "embedded backend invocation contract mismatch");
    assert(descriptor.backendAdapterInvocationDescriptor.boundary.adapterInvocation === BACKEND_ADAPTER_INVOCATION_BOUNDARY, "embedded backend invocation boundary mismatch");
    assert(descriptor.boundary.orchestration === CAPABILITY_BUS_EXECUTE_ACTION_ORCHESTRATION_BOUNDARY, "boundary orchestration mismatch");
    assert(descriptor.boundary.executable === CAPABILITY_BUS_EXECUTE_ACTION_ORCHESTRATION_EXECUTABLE, "boundary executable mismatch");
    assert(descriptor.boundary.adapterInvocation === CAPABILITY_BUS_EXECUTE_ACTION_ORCHESTRATION_ADAPTER_INVOCATION, "boundary adapterInvocation mismatch");
    assert(descriptor.boundary.runtimeWiring === CAPABILITY_BUS_EXECUTE_ACTION_ORCHESTRATION_RUNTIME_WIRING, "boundary runtimeWiring mismatch");
    assert(descriptor.boundary.nativeExecution === CAPABILITY_BUS_EXECUTE_ACTION_ORCHESTRATION_NATIVE_EXECUTION, "boundary nativeExecution mismatch");
}

function assertValidOrchestrationDescriptor() {
    const executeActionPlan = createValidExecuteActionPlan();
    const descriptor = normalizeCapabilityBusExecuteActionOrchestrationDescriptor(executeActionPlan);

    assertOrchestrationDescriptorShape(descriptor);

    const skeletonResult = validateCapabilityExecutorSkeletonPlan(descriptor.executorSkeletonPlan);
    assert(skeletonResult.ok, `embedded executor skeleton should validate: ${JSON.stringify(skeletonResult.errors)}`);

    const validated = validateCapabilityBusExecuteActionOrchestrationDescriptor(descriptor);
    assert(validated.ok, `normalized orchestration descriptor should validate: ${JSON.stringify(validated.errors)}`);

    const asserted = assertCapabilityBusExecuteActionOrchestrationDescriptor(descriptor);
    assertOrchestrationDescriptorShape(asserted);

    ok("accepted execute-action plan produced orchestration descriptor");
    return descriptor;
}

function assertOrchestrationValidationRejections() {
    const descriptor = assertValidOrchestrationDescriptor();

    const unsupportedVersion = validateCapabilityBusExecuteActionOrchestrationDescriptor({
        ...descriptor,
        contractVersion: "capability-bus-execute-action-orchestration.v999"
    });
    assertErrorCodeIncludes(
        unsupportedVersion,
        "unsupported_capability_bus_execute_action_orchestration_contract_version",
        "unsupported orchestration descriptor version"
    );

    const unknownField = validateCapabilityBusExecuteActionOrchestrationDescriptor({
        ...descriptor,
        adapterRuntime: "not-v1"
    });
    assertErrorCodeIncludes(
        unknownField,
        "unknown_capability_bus_execute_action_orchestration_descriptor_field",
        "unknown orchestration descriptor field"
    );

    const executableBoundary = validateCapabilityBusExecuteActionOrchestrationDescriptor({
        ...descriptor,
        boundary: {
            ...descriptor.boundary,
            executable: true
        }
    });
    assertErrorCodeIncludes(
        executableBoundary,
        "invalid_capability_bus_execute_action_orchestration_boundary_executable",
        "executable orchestration boundary"
    );

    const startedExecution = validateCapabilityBusExecuteActionOrchestrationDescriptor({
        ...descriptor,
        orchestration: {
            ...descriptor.orchestration,
            execution: "started"
        }
    });
    assertErrorCodeIncludes(
        startedExecution,
        "invalid_capability_bus_execute_action_orchestration_execution",
        "started orchestration execution"
    );

    assertThrowsValidation(
        "assert invalid orchestration version",
        () => assertCapabilityBusExecuteActionOrchestrationDescriptor({
            ...descriptor,
            contractVersion: "capability-bus-execute-action-orchestration.v999"
        }),
        "unsupported_capability_bus_execute_action_orchestration_contract_version"
    );

    ok("execute-action orchestration validation rejection paths passed");
}

function assertForbiddenKeysReject() {
    const descriptor = assertValidOrchestrationDescriptor();

    const forbiddenTopLevel = validateCapabilityBusExecuteActionOrchestrationDescriptor({
        ...descriptor,
        rawBackend: {
            command: "run-this"
        }
    });
    assertErrorCodeIncludes(
        forbiddenTopLevel,
        "forbidden_capability_bus_execute_action_orchestration_descriptor_key",
        "forbidden raw backend payload"
    );

    const forbiddenOrchestration = validateCapabilityBusExecuteActionOrchestrationDescriptor({
        ...descriptor,
        orchestration: {
            ...descriptor.orchestration,
            workerBridge: "sendToWorker"
        }
    });
    assertErrorCodeIncludes(
        forbiddenOrchestration,
        "forbidden_capability_bus_execute_action_orchestration_descriptor_key",
        "forbidden orchestration workerBridge"
    );

    const forbiddenBoundary = validateCapabilityBusExecuteActionOrchestrationDescriptor({
        ...descriptor,
        boundary: {
            ...descriptor.boundary,
            scheduler: "not-allowed"
        }
    });
    assertErrorCodeIncludes(
        forbiddenBoundary,
        "forbidden_capability_bus_execute_action_orchestration_descriptor_key",
        "forbidden boundary scheduler"
    );

    ok("forbidden orchestration execution/runtime keys rejected");
}

function assertRawLowerLevelInputsRejected() {
    const executeActionPlan = createValidExecuteActionPlan();

    const rawBackendPlan = validateCapabilityBusExecuteActionOrchestrationDescriptor(createValidBackendAdapterPlan());
    assertErrorCodeIncludes(
        rawBackendPlan,
        "unsupported_capability_bus_execute_action_orchestration_source",
        "raw backend adapter plan direct input"
    );

    const rawExecutionPlan = validateCapabilityBusExecuteActionOrchestrationDescriptor(executeActionPlan.executionPlan);
    assertErrorCodeIncludes(
        rawExecutionPlan,
        "unsupported_capability_bus_execute_action_orchestration_source",
        "raw capability execution plan direct input"
    );

    ok("raw lower-level direct orchestration inputs rejected");
}

function assertCopyIsolation() {
    const descriptor = assertValidOrchestrationDescriptor();
    const copied = copyCapabilityBusExecuteActionOrchestrationDescriptor(descriptor);

    copied.action.capability = "mutated";
    copied.executeActionPlan.action.capability = "mutated";
    copied.executorSkeletonPlan.invocation.serviceId = "mutated";
    copied.backendAdapterInvocationDescriptor.boundary.runtimeWiring = "mutated";
    copied.boundary.nativeExecution = "mutated";

    assert(descriptor.action.capability === "text.generate", "copy should isolate action metadata");
    assert(descriptor.executeActionPlan.action.capability === "text.generate", "copy should isolate executeActionPlan");
    assert(descriptor.executorSkeletonPlan.invocation.serviceId === "text.generate.default", "copy should isolate executor skeleton");
    assert(descriptor.backendAdapterInvocationDescriptor.boundary.runtimeWiring === "not-wired", "copy should isolate backend invocation descriptor");
    assert(descriptor.boundary.nativeExecution === CAPABILITY_BUS_EXECUTE_ACTION_ORCHESTRATION_NATIVE_EXECUTION, "copy should isolate orchestration boundary");

    ok("execute-action orchestration copy isolation passed");
}

async function assertOrchestrationModuleBoundaries() {
    const orchestrationFiles = [
        "runtime/bus/executeAction/capabilityBusExecuteActionOrchestrationCommon.mjs",
        "runtime/bus/executeAction/capabilityBusExecuteActionOrchestration.mjs",
        "runtime/bus/executeAction/capabilityBusExecuteActionContract.mjs"
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
        "runtime/request",
        "runtime/stream",
        "streamController",
        "ReadableStream"
    ];

    for (const relativePath of orchestrationFiles) {
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
    assert(!/executeAction/.test(runtimeSource), "runtime.mjs must not expose executeAction");

    ok("execute-action orchestration module source guards passed");
}

async function main() {
    console.log("[SMOKE] capability execute-action orchestration");

    assert(
        CAPABILITY_BUS_EXECUTE_ACTION_ORCHESTRATION_CONTRACT_VERSION === "capability-bus-execute-action-orchestration.v1",
        "execute-action orchestration contract version export mismatch"
    );
    ok("execute-action orchestration contract version export passed");

    assertValidOrchestrationDescriptor();
    assertOrchestrationValidationRejections();
    assertForbiddenKeysReject();
    assertRawLowerLevelInputsRejected();
    assertCopyIsolation();
    await assertOrchestrationModuleBoundaries();

    console.log("All capability execute-action orchestration smoke tests finished.");
}

main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
});
