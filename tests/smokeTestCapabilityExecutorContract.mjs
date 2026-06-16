// smokeTestCapabilityExecutorContract.mjs
//
// Purpose:
// - Contract smoke for the Runtime Dev capability executor contract branch.
// - Validates descriptor-only execution plans without wiring runtime.mjs,
//   workerBridge, executable backends, or llama_worker modules.
//
// Run:
//   node ./tests/smokeTestCapabilityExecutorContract.mjs

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
    BACKEND_ADAPTER_CONTRACT_VERSION,
    BACKEND_ADAPTER_REGISTRY_SCHEMA_VERSION,
    assertBackendAdapterPlan
} from "../runtime/backends/backendAdapterContract.mjs";
import {
    CAPABILITY_EXECUTOR_CONTRACT_VERSION,
    assertCapabilityExecutionPlan,
    copyCapabilityExecutionPlan,
    normalizeCapabilityExecutionPlan,
    validateCapabilityExecutionPlan
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

function assertErrorCode(result, code, label) {
    const found = result.errors.some((error) => error.code === code);
    assert(found, `${label} missing error code ${code}: ${JSON.stringify(result.errors)}`);
}

function assertNestedErrorCode(result, code, label) {
    const found = result.errors.some((error) => error.code.includes(code));
    assert(found, `${label} missing nested error code ${code}: ${JSON.stringify(result.errors)}`);
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
        actionId: "act_execution_1",
        runId: "run_execution_1",
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
            operator: "capability-executor-contract-smoke"
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

function createValidBusAction({ actionOverrides = {}, definitionOverrides = {} } = {}) {
    return assertCapabilityBusAction(
        createValidActionEnvelope(actionOverrides),
        createValidCapabilityRegistry([
            createValidCapabilityDefinition(definitionOverrides)
        ])
    );
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

function createValidRoutePlan({ busAction = createValidBusAction(), routerRegistry = createValidRouterRegistry() } = {}) {
    return assertCapabilityRoutePlan(busAction, routerRegistry);
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

function createValidServicePlan({ routePlan = createValidRoutePlan(), serviceRegistry = createValidServiceRegistry() } = {}) {
    return assertCapabilityServicePlan(routePlan, serviceRegistry);
}

function createValidAdapter(overrides = {}) {
    return {
        adapterId: " native-worker.default ",
        backendKind: " nativeWorkerBackend ",
        version: " v1 ",
        status: "contract-only",
        summary: " Native worker backend adapter descriptor. ",
        capabilities: [" text.generate "],
        services: [" text.generate.default "],
        contracts: {
            servicePlan: CAPABILITY_SERVICE_CONTRACT_VERSION,
            result: "resultEnvelope.v1",
            event: "actionEvent.v1"
        },
        result: {
            schema: " text.generate.result.v1 ",
            outputFields: [" text "],
            streamingDeltas: "supported",
            errorNormalization: "supported"
        },
        requirements: {
            streaming: "supported",
            cancellation: "supported",
            timeout: "supported"
        },
        compatibility: {
            backendKind: " nativeWorkerBackend ",
            modelBundleRequired: true,
            hardwareProfileRequired: true
        },
        ...overrides
    };
}

function createValidAdapterRegistry(adapters = [createValidAdapter()]) {
    return {
        schemaVersion: BACKEND_ADAPTER_REGISTRY_SCHEMA_VERSION,
        adapters
    };
}

function createValidBackendAdapterPlan({ servicePlan = createValidServicePlan(), adapterRegistry = createValidAdapterRegistry() } = {}) {
    return assertBackendAdapterPlan(servicePlan, adapterRegistry);
}

async function assertExecutionModuleBoundaries() {
    const executionFiles = [
        "runtime/execution/capabilityExecutionCommon.mjs",
        "runtime/execution/capabilityExecutionPlan.mjs",
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

    const contractSource = await readSource("runtime/execution/capabilityExecutorContract.mjs");
    const contractNonEmptyLines = contractSource
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);

    assert(contractNonEmptyLines.length <= 18, "capabilityExecutorContract.mjs should remain a thin public barrel");
    assert(!/\bfunction\b/.test(contractSource), "capabilityExecutorContract.mjs should not define functions");
    assert(!/\bconst\b|\blet\b|=>/.test(contractSource), "capabilityExecutorContract.mjs should not contain hidden implementation logic");

    const commonSource = await readSource("runtime/execution/capabilityExecutionCommon.mjs");
    assert(
        !commonSource.includes("capabilityExecutionPlan.mjs") &&
        !commonSource.includes("capabilityExecutorContract.mjs"),
        "capabilityExecutionCommon.mjs must not import plan/contract modules"
    );

    ok("execution module source guards passed");
}

function assertValidExecutionPlan() {
    const backendPlan = createValidBackendAdapterPlan();
    const executionPlan = normalizeCapabilityExecutionPlan(backendPlan);

    assert(executionPlan.contractVersion === CAPABILITY_EXECUTOR_CONTRACT_VERSION, "execution plan version mismatch");
    assert(executionPlan.backendPlan.contractVersion === BACKEND_ADAPTER_CONTRACT_VERSION, "backend plan version mismatch");
    assert(executionPlan.invocation.actionId === "act_execution_1", "invocation actionId mismatch");
    assert(executionPlan.invocation.runId === "run_execution_1", "invocation runId mismatch");
    assert(executionPlan.invocation.capability === "text.generate", "invocation capability mismatch");
    assert(executionPlan.invocation.serviceId === "text.generate.default", "invocation serviceId mismatch");
    assert(executionPlan.invocation.adapterId === "native-worker.default", "invocation adapterId mismatch");
    assert(executionPlan.invocation.backendKind === "nativeWorkerBackend", "invocation backendKind mismatch");
    assert(executionPlan.invocation.routeId === "text-generate-default", "invocation routeId mismatch");
    assert(executionPlan.invocation.modelBundleId === "mistral-text-local", "invocation modelBundleId mismatch");
    assert(executionPlan.invocation.hardwareProfileId === "laptopFallback", "invocation hardwareProfileId mismatch");
    assert(executionPlan.invocation.stream === true, "invocation stream mismatch");
    assert(executionPlan.invocation.timeoutMs === 60000, "invocation timeoutMs mismatch");
    assert(executionPlan.invocation.resultContract === "resultEnvelope.v1", "invocation resultContract mismatch");
    assert(executionPlan.invocation.eventContract === "actionEvent.v1", "invocation eventContract mismatch");

    ok("valid upstream chain produced execution descriptor");
}

function assertExecutionPlanValidation() {
    const backendPlan = createValidBackendAdapterPlan();
    const executionPlan = assertCapabilityExecutionPlan(backendPlan);
    const validatedExecutionPlan = validateCapabilityExecutionPlan(executionPlan);

    assert(validatedExecutionPlan.ok, `normalized execution plan should validate: ${JSON.stringify(validatedExecutionPlan.errors)}`);


    const unsupportedExecutionVersion = validateCapabilityExecutionPlan({
        ...executionPlan,
        contractVersion: "capability-executor.v999"
    });
    assertErrorCode(
        unsupportedExecutionVersion,
        "unsupported_capability_execution_contract_version",
        "unsupported execution plan version"
    );

    const unknownExecutionField = validateCapabilityExecutionPlan({
        ...executionPlan,
        executorRuntime: "not-v1"
    });
    assertErrorCode(
        unknownExecutionField,
        "unknown_capability_execution_plan_field",
        "unknown execution plan field"
    );

    const mismatchedInvocation = validateCapabilityExecutionPlan({
        ...executionPlan,
        invocation: {
            ...executionPlan.invocation,
            adapterId: "wrong-adapter"
        }
    });
    assertNestedErrorCode(
        mismatchedInvocation,
        "capability_execution_adapter_id_mismatch",
        "mismatched invocation adapterId"
    );

    const unsupportedBackendVersion = validateCapabilityExecutionPlan({
        ...backendPlan,
        contractVersion: "backend-adapter.v999"
    });
    assertErrorCode(
        unsupportedBackendVersion,
        "unsupported_capability_execution_backend_plan_contract_version",
        "unsupported backend adapter plan version"
    );

    const invalidBackendPlan = validateCapabilityExecutionPlan({
        contractVersion: BACKEND_ADAPTER_CONTRACT_VERSION,
        servicePlan: {},
        adapter: {}
    });
    assert(!invalidBackendPlan.ok, "invalid backend plan should reject");

    assertThrowsValidation(
        "assert invalid backend plan",
        () => assertCapabilityExecutionPlan({
            contractVersion: BACKEND_ADAPTER_CONTRACT_VERSION,
            servicePlan: {},
            adapter: {}
        }),
        "capability_execution_backend_plan"
    );

    ok("execution plan validation rejection paths passed");
}

function assertCompatibilityStillFlowsThroughBackendContract() {
    const servicePlan = createValidServicePlan();
    const incompatibleAdapter = createValidAdapter({
        capabilities: ["text.embed"]
    });
    const incompatibleBackendPlan = {
        contractVersion: BACKEND_ADAPTER_CONTRACT_VERSION,
        servicePlan,
        adapter: incompatibleAdapter
    };
    const result = validateCapabilityExecutionPlan(incompatibleBackendPlan);

    assertNestedErrorCode(
        result,
        "backend_adapter_capability_incompatible",
        "incompatible adapter capability"
    );

    ok("backend compatibility validation flowed through upstream contract");
}

function assertForbiddenKeysReject() {
    const backendPlan = createValidBackendAdapterPlan();
    const forbiddenTopLevel = validateCapabilityExecutionPlan({
        ...backendPlan,
        rawBackendPayload: {
            command: "run-this"
        }
    });
    assertErrorCode(
        forbiddenTopLevel,
        "forbidden_capability_execution_backend_plan_key",
        "forbidden backend payload key"
    );

    const forbiddenNested = validateCapabilityExecutionPlan({
        ...backendPlan,
        adapter: {
            ...backendPlan.adapter,
            handler: "run"
        }
    });
    assertErrorCode(
        forbiddenNested,
        "forbidden_capability_execution_backend_plan_key",
        "forbidden executable handler key"
    );

    const forbiddenExecutionPlan = validateCapabilityExecutionPlan({
        contractVersion: CAPABILITY_EXECUTOR_CONTRACT_VERSION,
        backendPlan,
        invocation: {
            actionId: "act_execution_1",
            runId: "run_execution_1",
            capability: "text.generate",
            serviceId: "text.generate.default",
            adapterId: "native-worker.default",
            backendKind: "nativeWorkerBackend",
            routeId: "text-generate-default",
            modelBundleId: "mistral-text-local",
            hardwareProfileId: "laptopFallback",
            stream: true,
            timeoutMs: 60000,
            resultContract: "resultEnvelope.v1",
            eventContract: "actionEvent.v1",
            modelPath: "../../../base/model.gguf"
        }
    });
    assertNestedErrorCode(
        forbiddenExecutionPlan,
        "forbidden_capability_execution_plan_key",
        "forbidden invocation model path key"
    );

    ok("forbidden execution/backend payload keys rejected");
}

function assertCopyIsolation() {
    const backendPlan = createValidBackendAdapterPlan();
    const executionPlan = normalizeCapabilityExecutionPlan(backendPlan);

    backendPlan.adapter.capabilities.push("text.embed");
    backendPlan.servicePlan.service.result.outputFields.push("extra");

    assert(
        !executionPlan.backendPlan.adapter.capabilities.includes("text.embed"),
        "execution plan adapter capabilities should not alias source backendPlan"
    );
    assert(
        !executionPlan.backendPlan.servicePlan.service.result.outputFields.includes("extra"),
        "execution plan service result fields should not alias source backendPlan"
    );

    const copied = copyCapabilityExecutionPlan(executionPlan);
    copied.backendPlan.adapter.capabilities.push("text.rerank");
    copied.invocation.serviceId = "mutated";

    assert(
        !executionPlan.backendPlan.adapter.capabilities.includes("text.rerank"),
        "copyCapabilityExecutionPlan should copy nested arrays"
    );
    assert(
        executionPlan.invocation.serviceId === "text.generate.default",
        "copyCapabilityExecutionPlan should copy invocation metadata"
    );

    ok("execution plan copy isolation passed");
}

async function main() {
    console.log("[SMOKE] capability executor contract");

    assert(CAPABILITY_EXECUTOR_CONTRACT_VERSION === "capability-executor.v1", "contract version export mismatch");
    ok("contract version export passed");

    assertValidExecutionPlan();
    assertExecutionPlanValidation();
    assertCompatibilityStillFlowsThroughBackendContract();
    assertForbiddenKeysReject();
    assertCopyIsolation();
    await assertExecutionModuleBoundaries();

    console.log("All capability executor contract smoke tests finished.");
}

main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
});
