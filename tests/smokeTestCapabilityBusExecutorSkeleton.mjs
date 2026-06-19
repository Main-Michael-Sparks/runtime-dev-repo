// smokeTestCapabilityBusExecutorSkeleton.mjs
//
// Purpose:
// - Contract smoke for the Runtime Dev capability bus executor skeleton seam.
// - Validates that an accepted execute-action plan can produce a metadata-only
//   executor skeleton handoff descriptor without wiring runtime.mjs,
//   workerBridge, backend execution, scheduler/request/stream, or llama_worker.
//
// Run:
//   node ./tests/smokeTestCapabilityBusExecutorSkeleton.mjs

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
    BACKEND_ADAPTER_REGISTRY_SCHEMA_VERSION
} from "../runtime/backends/backendAdapterContract.mjs";
import {
    CAPABILITY_BUS_EXECUTE_ACTION_CONTRACT_VERSION,
    assertCapabilityBusExecuteActionPlan
} from "../runtime/bus/executeAction/capabilityBusExecuteActionContract.mjs";
import {
    CAPABILITY_EXECUTOR_CONTRACT_VERSION,
    CAPABILITY_EXECUTOR_SKELETON_ADAPTER_INVOCATION,
    CAPABILITY_EXECUTOR_SKELETON_CONTRACT_VERSION,
    CAPABILITY_EXECUTOR_SKELETON_EXECUTABLE,
    CAPABILITY_EXECUTOR_SKELETON_EXECUTOR_BOUNDARY,
    CAPABILITY_EXECUTOR_SKELETON_RUNTIME_WIRING,
    CAPABILITY_EXECUTOR_SKELETON_STATUS,
    assertCapabilityExecutorSkeletonPlan,
    copyCapabilityExecutorSkeletonPlan,
    normalizeCapabilityExecutorSkeletonPlan,
    validateCapabilityExecutorSkeletonPlan
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
        actionId: "act_executor_skeleton_1",
        runId: "run_executor_skeleton_1",
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
            operator: "capability-bus-executor-skeleton-smoke"
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

function assertValidExecutorSkeletonPlan() {
    const executeActionPlan = createValidExecuteActionPlan();
    const skeletonPlan = normalizeCapabilityExecutorSkeletonPlan(executeActionPlan.executionPlan);

    assert(executeActionPlan.contractVersion === CAPABILITY_BUS_EXECUTE_ACTION_CONTRACT_VERSION, "execute-action plan version mismatch");
    assert(executeActionPlan.status === "accepted", "execute-action status mismatch");
    assert(executeActionPlan.executionPlan.contractVersion === CAPABILITY_EXECUTOR_CONTRACT_VERSION, "execution plan version mismatch");
    assert(skeletonPlan.contractVersion === CAPABILITY_EXECUTOR_SKELETON_CONTRACT_VERSION, "skeleton contract version mismatch");
    assert(skeletonPlan.status === CAPABILITY_EXECUTOR_SKELETON_STATUS, "skeleton status mismatch");
    assert(skeletonPlan.executionPlan.contractVersion === CAPABILITY_EXECUTOR_CONTRACT_VERSION, "embedded execution plan version mismatch");
    assert(skeletonPlan.invocation.actionId === "act_executor_skeleton_1", "skeleton actionId mismatch");
    assert(skeletonPlan.invocation.runId === "run_executor_skeleton_1", "skeleton runId mismatch");
    assert(skeletonPlan.invocation.capability === "text.generate", "skeleton capability mismatch");
    assert(skeletonPlan.invocation.serviceId === "text.generate.default", "skeleton serviceId mismatch");
    assert(skeletonPlan.invocation.adapterId === "native-worker.default", "skeleton adapterId mismatch");
    assert(skeletonPlan.invocation.backendKind === "nativeWorkerBackend", "skeleton backendKind mismatch");
    assert(skeletonPlan.invocation.routeId === "text-generate-default", "skeleton routeId mismatch");
    assert(skeletonPlan.invocation.modelBundleId === "mistral-text-local", "skeleton modelBundleId mismatch");
    assert(skeletonPlan.invocation.hardwareProfileId === "laptopFallback", "skeleton hardwareProfileId mismatch");
    assert(skeletonPlan.invocation.stream === true, "skeleton stream mismatch");
    assert(skeletonPlan.invocation.timeoutMs === 60000, "skeleton timeoutMs mismatch");
    assert(skeletonPlan.invocation.resultContract === "resultEnvelope.v1", "skeleton resultContract mismatch");
    assert(skeletonPlan.invocation.eventContract === "actionEvent.v1", "skeleton eventContract mismatch");
    assert(skeletonPlan.boundary.executor === CAPABILITY_EXECUTOR_SKELETON_EXECUTOR_BOUNDARY, "skeleton boundary executor mismatch");
    assert(skeletonPlan.boundary.executable === CAPABILITY_EXECUTOR_SKELETON_EXECUTABLE, "skeleton boundary executable mismatch");
    assert(skeletonPlan.boundary.adapterInvocation === CAPABILITY_EXECUTOR_SKELETON_ADAPTER_INVOCATION, "skeleton boundary adapterInvocation mismatch");
    assert(skeletonPlan.boundary.runtimeWiring === CAPABILITY_EXECUTOR_SKELETON_RUNTIME_WIRING, "skeleton boundary runtimeWiring mismatch");

    const validated = validateCapabilityExecutorSkeletonPlan(skeletonPlan);
    assert(validated.ok, `normalized skeleton plan should validate: ${JSON.stringify(validated.errors)}`);

    ok("valid execute-action chain produced executor skeleton descriptor");
    return skeletonPlan;
}

function assertExecutorSkeletonValidation() {
    const skeletonPlan = assertValidExecutorSkeletonPlan();

    const unsupportedVersion = validateCapabilityExecutorSkeletonPlan({
        ...skeletonPlan,
        contractVersion: "capability-executor-skeleton.v999"
    });
    assertErrorCodeIncludes(
        unsupportedVersion,
        "unsupported_capability_executor_skeleton_contract_version",
        "unsupported skeleton version"
    );

    const unknownField = validateCapabilityExecutorSkeletonPlan({
        ...skeletonPlan,
        executorRuntime: "not-v1"
    });
    assertErrorCodeIncludes(
        unknownField,
        "unknown_capability_executor_skeleton_plan_field",
        "unknown skeleton field"
    );

    const mismatchedInvocation = validateCapabilityExecutorSkeletonPlan({
        ...skeletonPlan,
        invocation: {
            ...skeletonPlan.invocation,
            adapterId: "wrong-adapter"
        }
    });
    assertErrorCodeIncludes(
        mismatchedInvocation,
        "capability_executor_skeleton_adapterId_mismatch",
        "mismatched skeleton adapterId"
    );

    const executableBoundary = validateCapabilityExecutorSkeletonPlan({
        ...skeletonPlan,
        boundary: {
            ...skeletonPlan.boundary,
            executable: true
        }
    });
    assertErrorCodeIncludes(
        executableBoundary,
        "invalid_capability_executor_skeleton_boundary_executable",
        "executable skeleton boundary"
    );

    const implementedBoundary = validateCapabilityExecutorSkeletonPlan({
        ...skeletonPlan,
        boundary: {
            ...skeletonPlan.boundary,
            adapterInvocation: "implemented"
        }
    });
    assertErrorCodeIncludes(
        implementedBoundary,
        "invalid_capability_executor_skeleton_boundary_adapter_invocation",
        "implemented adapter invocation boundary"
    );

    assertThrowsValidation(
        "assert invalid skeleton version",
        () => assertCapabilityExecutorSkeletonPlan({
            ...skeletonPlan,
            contractVersion: "capability-executor-skeleton.v999"
        }),
        "unsupported_capability_executor_skeleton_contract_version"
    );

    ok("executor skeleton validation rejection paths passed");
}

function assertForbiddenKeysReject() {
    const skeletonPlan = assertValidExecutorSkeletonPlan();

    const forbiddenTopLevel = validateCapabilityExecutorSkeletonPlan({
        ...skeletonPlan,
        rawBackendPayload: {
            command: "run-this"
        }
    });
    assertErrorCodeIncludes(
        forbiddenTopLevel,
        "forbidden_capability_executor_skeleton_plan_key",
        "forbidden raw backend payload"
    );

    const forbiddenInvocation = validateCapabilityExecutorSkeletonPlan({
        ...skeletonPlan,
        invocation: {
            ...skeletonPlan.invocation,
            modelPath: "../../../base/model.gguf"
        }
    });
    assertErrorCodeIncludes(
        forbiddenInvocation,
        "forbidden_capability_executor_skeleton_plan_key",
        "forbidden invocation modelPath"
    );

    const forbiddenNestedExecutionPlan = validateCapabilityExecutorSkeletonPlan({
        ...skeletonPlan,
        executionPlan: {
            ...skeletonPlan.executionPlan,
            backendPlan: {
                ...skeletonPlan.executionPlan.backendPlan,
                adapter: {
                    ...skeletonPlan.executionPlan.backendPlan.adapter,
                    workerBridge: "sendToWorker"
                }
            }
        }
    });
    assertErrorCodeIncludes(
        forbiddenNestedExecutionPlan,
        "forbidden_capability_executor_skeleton_plan_key",
        "forbidden nested workerBridge"
    );

    ok("forbidden skeleton execution/backend payload keys rejected");
}

function assertCopyIsolation() {
    const skeletonPlan = assertValidExecutorSkeletonPlan();
    const copied = copyCapabilityExecutorSkeletonPlan(skeletonPlan);

    copied.executionPlan.backendPlan.adapter.capabilities.push("text.embed");
    copied.invocation.serviceId = "mutated";
    copied.boundary.runtimeWiring = "mutated";

    assert(
        !skeletonPlan.executionPlan.backendPlan.adapter.capabilities.includes("text.embed"),
        "copyCapabilityExecutorSkeletonPlan should copy nested execution plan arrays"
    );
    assert(
        skeletonPlan.invocation.serviceId === "text.generate.default",
        "copyCapabilityExecutorSkeletonPlan should copy invocation metadata"
    );
    assert(
        skeletonPlan.boundary.runtimeWiring === CAPABILITY_EXECUTOR_SKELETON_RUNTIME_WIRING,
        "copyCapabilityExecutorSkeletonPlan should copy boundary metadata"
    );

    ok("executor skeleton copy isolation passed");
}

async function assertExecutorSkeletonModuleBoundaries() {
    const executionFiles = [
        "runtime/execution/capabilityExecutorSkeletonCommon.mjs",
        "runtime/execution/capabilityExecutorSkeletonPlan.mjs",
        "runtime/execution/capabilityExecutorContract.mjs"
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

    for (const relativePath of executionFiles) {
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
            !/function\s+executeAction\b/.test(source),
            `${relativePath} must not define executeAction()`
        );
        assert(
            !/\bpostMessage\s*\(/.test(source),
            `${relativePath} must not post worker/runtime messages`
        );
    }

    const runtimeSource = await readSource("runtime.mjs");
    assert(runtimeSource.includes("export async function executeAction"), "runtime.mjs must expose narrow executeAction seam");
    assert(runtimeSource.includes("runExecuteAction(orchestrationDescriptor"), "runtime.mjs executeAction must call runExecuteAction seam");
    assert(!runtimeSource.includes("executeActionEnvelope"), "runtime.mjs must not expose raw action-envelope execution in this branch");

    const contractSource = await readSource("runtime/execution/capabilityExecutorContract.mjs");
    const contractNonEmptyLines = contractSource
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);

    assert(contractNonEmptyLines.length <= 48, "capabilityExecutorContract.mjs should remain a thin public barrel");
    assert(!/\bfunction\b/.test(contractSource), "capabilityExecutorContract.mjs should not define functions");
    assert(!/\bconst\b|\blet\b|=>/.test(contractSource), "capabilityExecutorContract.mjs should not contain hidden implementation logic");

    ok("executor skeleton module source guards passed");
}

async function main() {
    console.log("[SMOKE] capability bus executor skeleton");

    assert(
        CAPABILITY_EXECUTOR_SKELETON_CONTRACT_VERSION === "capability-executor-skeleton.v1",
        "skeleton contract version export mismatch"
    );
    ok("skeleton contract version export passed");

    assertExecutorSkeletonValidation();
    assertForbiddenKeysReject();
    assertCopyIsolation();
    await assertExecutorSkeletonModuleBoundaries();

    console.log("All capability bus executor skeleton smoke tests finished.");
}

main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
});
