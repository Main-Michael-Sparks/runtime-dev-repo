// smokeTestCapabilityBusExecuteActionContract.mjs
//
// Purpose:
// - Contract smoke for the Runtime Dev Capability Bus execute-action contract seam.
// - Validates that an action envelope can be composed through the existing
//   bus/router/service/backend/execution descriptor chain without real execution.
//
// Run:
//   node ./tests/smokeTestCapabilityBusExecuteActionContract.mjs

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
    CAPABILITY_EXECUTOR_CONTRACT_VERSION
} from "../runtime/execution/capabilityExecutorContract.mjs";
import {
    CAPABILITY_BUS_EXECUTE_ACTION_CONTRACT_VERSION,
    assertCapabilityBusExecuteActionPlan,
    createCapabilityBusExecuteActionAcceptedEvent,
    createCapabilityBusExecuteActionAcceptedResult,
    createCapabilityBusExecuteActionValidationFailedResult,
    normalizeCapabilityBusExecuteActionPlan,
    validateCapabilityBusExecuteActionPlan
} from "../runtime/bus/executeAction/capabilityBusExecuteActionContract.mjs";
import {
    validateActionEvent
} from "../runtime/bus/actionEvent.mjs";
import {
    validateResultEnvelope
} from "../runtime/bus/resultEnvelope.mjs";

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
        actionId: "act_execute_action_1",
        runId: "run_execute_action_1",
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
            operator: "capability-bus-execute-action-contract-smoke"
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

function createValidRegistries(overrides = {}) {
    return {
        capabilityRegistry: createValidCapabilityRegistry(),
        routerRegistry: createValidRouterRegistry(),
        serviceRegistry: createValidServiceRegistry(),
        backendAdapterRegistry: createValidBackendAdapterRegistry(),
        ...overrides
    };
}

async function assertExecuteActionModuleBoundaries() {
    const executeActionFiles = [
        "runtime/bus/executeAction/capabilityBusExecuteActionCommon.mjs",
        "runtime/bus/executeAction/capabilityBusExecuteActionPlan.mjs",
        "runtime/bus/executeAction/capabilityBusExecuteActionResult.mjs",
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
        "ReadableStream",
        "scheduler"
    ];

    for (const relativePath of executeActionFiles) {
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
    }

    const barrel = await readSource("runtime/bus/executeAction/capabilityBusExecuteActionContract.mjs");
    assert(!barrel.includes("function "), "execute-action public barrel must stay thin");
    assert(!barrel.includes("const "), "execute-action public barrel must not hold implementation constants");

    const runtimeSource = await readSource("runtime.mjs");
    assert(!runtimeSource.includes("executeAction"), "runtime.mjs public API must not expose executeAction in this branch");

    const executionBarrel = await readSource("runtime/execution/capabilityExecutorContract.mjs");
    assert(!executionBarrel.includes("function "), "runtime/execution barrel must remain thin");
}

function testValidExecuteActionPlan() {
    const action = createValidActionEnvelope();
    const registries = createValidRegistries();
    const result = validateCapabilityBusExecuteActionPlan(action, registries);

    assert(result.ok, `valid execute-action plan should pass: ${JSON.stringify(result.errors)}`);
    assert(result.value.contractVersion === CAPABILITY_BUS_EXECUTE_ACTION_CONTRACT_VERSION, "execute-action contract version mismatch");
    assert(result.value.status === "accepted", "execute-action plan status should be accepted");
    assert(result.value.busAction.contractVersion === "capability-bus.v1", "bus action should be carried forward");
    assert(result.value.routePlan.contractVersion === CAPABILITY_ROUTER_CONTRACT_VERSION, "route plan should be carried forward");
    assert(result.value.servicePlan.contractVersion === CAPABILITY_SERVICE_CONTRACT_VERSION, "service plan should be carried forward");
    assert(result.value.backendPlan.contractVersion === "backend-adapter.v1", "backend plan should be carried forward");
    assert(result.value.executionPlan.contractVersion === CAPABILITY_EXECUTOR_CONTRACT_VERSION, "execution plan should be carried forward");
    assert(result.value.executionPlan.invocation.backendKind === "nativeWorkerBackend", "execution invocation should carry backendKind");

    action.input.prompt = "mutated prompt";
    registries.routerRegistry.routes[0].routeId = "mutated-route";
    assert(result.value.busAction.action.input.prompt === "Say hello briefly.", "execute-action plan should copy source action values");
    assert(result.value.routePlan.route.routeId === "text-generate-default", "execute-action plan should copy source route values");

    const normalized = normalizeCapabilityBusExecuteActionPlan(createValidActionEnvelope(), createValidRegistries());
    assert(normalized.status === "accepted", "normalize execute-action plan should return accepted descriptor");
    ok("valid execute-action contract chain produced accepted descriptor");
}

function testAcceptedResultAndEvent() {
    const plan = assertCapabilityBusExecuteActionPlan(createValidActionEnvelope(), createValidRegistries());
    const acceptedResult = createCapabilityBusExecuteActionAcceptedResult(plan);
    const acceptedEvent = createCapabilityBusExecuteActionAcceptedEvent(plan, {
        eventId: "evt_execute_action_accepted_1",
        timestamp: 123
    });

    const resultValidation = validateResultEnvelope(acceptedResult);
    const eventValidation = validateActionEvent(acceptedEvent);

    assert(resultValidation.ok, `accepted result should validate: ${JSON.stringify(resultValidation.errors)}`);
    assert(eventValidation.ok, `accepted event should validate: ${JSON.stringify(eventValidation.errors)}`);
    assert(acceptedResult.status === "accepted", "accepted result should not claim execution started or completed");
    assert(acceptedResult.result.executionPlan.contractVersion === CAPABILITY_EXECUTOR_CONTRACT_VERSION, "accepted result should carry execution descriptor");
    assert(acceptedResult.usage.backend === "nativeWorkerBackend", "accepted result should carry backend usage metadata");
    assert(acceptedEvent.type === "action.accepted", "accepted event should be action.accepted only");
    assert(acceptedEvent.data.backendKind === "nativeWorkerBackend", "accepted event should carry backend metadata");
    ok("accepted result and event metadata validated");
}

function testValidationFailures() {
    const invalidAction = validateCapabilityBusExecuteActionPlan(
        createValidActionEnvelope({ backendOptions: { raw: true } }),
        createValidRegistries()
    );
    assert(!invalidAction.ok, "forbidden action payload should fail");
    assertErrorCodeIncludes(invalidAction, "forbidden_action_envelope_key", "forbidden action payload");

    const missingCapability = validateCapabilityBusExecuteActionPlan(
        createValidActionEnvelope(),
        createValidRegistries({ capabilityRegistry: createValidCapabilityRegistry([]) })
    );
    assert(!missingCapability.ok, "missing capability should fail");
    assertErrorCodeIncludes(missingCapability, "capability_bus_missing_definition", "missing capability");

    const missingRoute = validateCapabilityBusExecuteActionPlan(
        createValidActionEnvelope(),
        createValidRegistries({ routerRegistry: createValidRouterRegistry([]) })
    );
    assert(!missingRoute.ok, "missing route should fail");
    assertErrorCodeIncludes(missingRoute, "route_missing_for_capability", "missing route");

    const missingService = validateCapabilityBusExecuteActionPlan(
        createValidActionEnvelope(),
        createValidRegistries({ serviceRegistry: createValidServiceRegistry([]) })
    );
    assert(!missingService.ok, "missing service should fail");
    assertErrorCodeIncludes(missingService, "service_missing_for_route", "missing service");

    const missingAdapter = validateCapabilityBusExecuteActionPlan(
        createValidActionEnvelope(),
        createValidRegistries({ backendAdapterRegistry: createValidBackendAdapterRegistry([]) })
    );
    assert(!missingAdapter.ok, "missing adapter should fail");
    assertErrorCodeIncludes(missingAdapter, "backend_adapter_missing_for_route", "missing adapter");

    const forbiddenRoutePayload = validateCapabilityBusExecuteActionPlan(
        createValidActionEnvelope(),
        createValidRegistries({
            routerRegistry: createValidRouterRegistry([
                createValidRoute({ command: "node unsafe.js" })
            ])
        })
    );
    assert(!forbiddenRoutePayload.ok, "forbidden route payload should fail");
    assertErrorCodeIncludes(forbiddenRoutePayload, "forbidden", "forbidden route payload");

    assertThrowsValidation(
        "assert execute-action missing adapter",
        () => assertCapabilityBusExecuteActionPlan(
            createValidActionEnvelope(),
            createValidRegistries({ backendAdapterRegistry: createValidBackendAdapterRegistry([]) })
        ),
        "backend_adapter_missing_for_route"
    );

    ok("execute-action validation failures remained contract-only and prefixed");
}

function testValidationFailedResult() {
    const validationResult = validateCapabilityBusExecuteActionPlan(
        createValidActionEnvelope(),
        createValidRegistries({ routerRegistry: createValidRouterRegistry([]) })
    );
    const failedResult = createCapabilityBusExecuteActionValidationFailedResult(
        createValidActionEnvelope(),
        validationResult,
        {
            stage: "route"
        }
    );
    const resultValidation = validateResultEnvelope(failedResult);

    assert(resultValidation.ok, `validation failed result should validate: ${JSON.stringify(resultValidation.errors)}`);
    assert(failedResult.status === "failed", "validation failed result should be failed");
    assert(failedResult.error.kind === "validation", "validation failed result should carry validation error kind");
    assert(failedResult.error.details.stage === "route", "validation failed result should preserve details");

    const noIdentityResult = createCapabilityBusExecuteActionValidationFailedResult(
        { capability: "text.generate" },
        validationResult
    );
    assert(noIdentityResult.ok === false, "invalid action identity should not force a result envelope");
    ok("validation-failed result helper preserves action-identity guard");
}

async function main() {
    console.log("[SMOKE] Capability Bus execute-action contract");
    testValidExecuteActionPlan();
    testAcceptedResultAndEvent();
    testValidationFailures();
    testValidationFailedResult();
    await assertExecuteActionModuleBoundaries();
    ok("execute-action module boundaries remained contract-only");
    console.log("All Capability Bus execute-action contract smoke tests finished.");
}

await main();
