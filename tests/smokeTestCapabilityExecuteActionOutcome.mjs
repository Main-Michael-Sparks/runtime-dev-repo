// smokeTestCapabilityExecuteActionOutcome.mjs
//
// Purpose:
// - Contract smoke for the Runtime Dev Capability Bus execute-action result/event outcome seam.
// - Validates that an accepted execute-action orchestration descriptor can be paired with
//   normalized result envelopes and action events without wiring runtime.mjs,
//   workerBridge, backend execution, scheduler/request/stream, or llama_worker.
//
// Run:
//   node ./tests/smokeTestCapabilityExecuteActionOutcome.mjs

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

import {
    validateActionEvent
} from "../runtime/bus/actionEvent.mjs";
import {
    validateResultEnvelope
} from "../runtime/bus/resultEnvelope.mjs";
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
    BACKEND_ADAPTER_REGISTRY_SCHEMA_VERSION,
    assertBackendAdapterPlan
} from "../runtime/backends/backendAdapterContract.mjs";
import {
    CAPABILITY_BUS_EXECUTE_ACTION_OUTCOME_BOUNDARY,
    CAPABILITY_BUS_EXECUTE_ACTION_OUTCOME_CONTRACT_VERSION,
    CAPABILITY_BUS_EXECUTE_ACTION_OUTCOME_EXECUTABLE,
    CAPABILITY_BUS_EXECUTE_ACTION_OUTCOME_NATIVE_EXECUTION,
    CAPABILITY_BUS_EXECUTE_ACTION_OUTCOME_RUNTIME_SETTLEMENT,
    CAPABILITY_BUS_EXECUTE_ACTION_OUTCOME_RUNTIME_WIRING,
    CAPABILITY_BUS_EXECUTE_ACTION_OUTCOME_STATUS,
    assertCapabilityBusExecuteActionOrchestrationDescriptor,
    assertCapabilityBusExecuteActionOutcomeDescriptor,
    assertCapabilityBusExecuteActionPlan,
    copyCapabilityBusExecuteActionOutcomeDescriptor,
    createCapabilityBusExecuteActionAcceptedOutcome,
    createCapabilityBusExecuteActionCancelledOutcome,
    createCapabilityBusExecuteActionCompletedOutcome,
    createCapabilityBusExecuteActionFailedOutcome,
    createCapabilityBusExecuteActionPolicyDeniedOutcome,
    createCapabilityBusExecuteActionStartedOutcome,
    createCapabilityBusExecuteActionStreamDeltaEvent,
    createCapabilityBusExecuteActionStreamDeltaOutcome,
    createCapabilityBusExecuteActionTimeoutOutcome,
    normalizeCapabilityBusExecuteActionOutcomeDescriptor,
    validateCapabilityBusExecuteActionOutcomeDescriptor
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

function assertValidationOk(result, label) {
    assert(result.ok, `${label} should validate: ${JSON.stringify(result.errors)}`);
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
        actionId: "act_execute_action_outcome_1",
        runId: "run_execute_action_outcome_1",
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
            operator: "capability-execute-action-outcome-smoke"
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

function createValidOrchestrationDescriptor() {
    return assertCapabilityBusExecuteActionOrchestrationDescriptor(createValidExecuteActionPlan());
}

function assertOutcomeShape(outcome, resultStatus, eventType) {
    assert(outcome.contractVersion === CAPABILITY_BUS_EXECUTE_ACTION_OUTCOME_CONTRACT_VERSION, "outcome contract version mismatch");
    assert(outcome.status === CAPABILITY_BUS_EXECUTE_ACTION_OUTCOME_STATUS, "outcome status mismatch");
    assert(outcome.action.actionId === "act_execute_action_outcome_1", "outcome actionId mismatch");
    assert(outcome.action.runId === "run_execute_action_outcome_1", "outcome runId mismatch");
    assert(outcome.action.capability === "text.generate", "outcome capability mismatch");
    assert(outcome.boundary.outcome === CAPABILITY_BUS_EXECUTE_ACTION_OUTCOME_BOUNDARY, "outcome boundary label mismatch");
    assert(outcome.boundary.executable === CAPABILITY_BUS_EXECUTE_ACTION_OUTCOME_EXECUTABLE, "outcome executable mismatch");
    assert(outcome.boundary.runtimeSettlement === CAPABILITY_BUS_EXECUTE_ACTION_OUTCOME_RUNTIME_SETTLEMENT, "outcome runtime settlement mismatch");
    assert(outcome.boundary.runtimeWiring === CAPABILITY_BUS_EXECUTE_ACTION_OUTCOME_RUNTIME_WIRING, "outcome runtime wiring mismatch");
    assert(outcome.boundary.nativeExecution === CAPABILITY_BUS_EXECUTE_ACTION_OUTCOME_NATIVE_EXECUTION, "outcome native execution mismatch");
    assert(outcome.orchestrationDescriptor.contractVersion.includes("orchestration"), "outcome should embed orchestration descriptor");
    assert(outcome.metadata.actionId === outcome.action.actionId, "outcome metadata actionId mismatch");
    assert(outcome.metadata.serviceId === "text.generate.default", "outcome metadata serviceId mismatch");
    assert(outcome.metadata.adapterId === "native-worker.default", "outcome metadata adapterId mismatch");
    assert(outcome.metadata.backendKind === "nativeWorkerBackend", "outcome metadata backendKind mismatch");
    assert(outcome.metadata.modelBundleId === "mistral-text-local", "outcome metadata modelBundleId mismatch");
    assert(outcome.metadata.hardwareProfileId === "laptopFallback", "outcome metadata hardwareProfileId mismatch");
    assert(outcome.metadata.resultContract === "resultEnvelope.v1", "outcome metadata resultContract mismatch");
    assert(outcome.metadata.eventContract === "actionEvent.v1", "outcome metadata eventContract mismatch");

    if (resultStatus !== null) {
        assert(outcome.resultEnvelope.status === resultStatus, `outcome result status should be ${resultStatus}`);
        assert(outcome.metadata.resultStatus === resultStatus, "outcome metadata result status mismatch");
        assertValidationOk(validateResultEnvelope(outcome.resultEnvelope), `${resultStatus} result envelope`);
    } else {
        assert(outcome.resultEnvelope === undefined, "event-only outcome should not include resultEnvelope");
    }

    assert(outcome.actionEvent.type === eventType, `outcome event type should be ${eventType}`);
    assert(outcome.metadata.eventType === eventType, "outcome metadata event type mismatch");
    assertValidationOk(validateActionEvent(outcome.actionEvent), `${eventType} action event`);
    assertValidationOk(validateCapabilityBusExecuteActionOutcomeDescriptor(outcome), `${eventType} outcome descriptor`);
}

function assertOutcomeHappyPaths() {
    const orchestration = createValidOrchestrationDescriptor();

    assertOutcomeShape(createCapabilityBusExecuteActionAcceptedOutcome(orchestration), "accepted", "action.accepted");
    assertOutcomeShape(createCapabilityBusExecuteActionStartedOutcome(orchestration), "running", "action.started");
    assertOutcomeShape(
        createCapabilityBusExecuteActionCompletedOutcome(orchestration, {
            result: {
                text: "hello"
            },
            trace: {
                startedAt: 1,
                finishedAt: 2,
                durationMs: 1
            }
        }),
        "completed",
        "action.completed"
    );
    assertOutcomeShape(
        createCapabilityBusExecuteActionFailedOutcome(orchestration, {
            message: "backend failed",
            code: "backend_failed",
            kind: "backend",
            retryable: false,
            details: {
                phase: "contract-smoke"
            }
        }),
        "failed",
        "action.failed"
    );
    assertOutcomeShape(createCapabilityBusExecuteActionCancelledOutcome(orchestration, "user cancelled"), "cancelled", "action.cancelled");
    assertOutcomeShape(createCapabilityBusExecuteActionTimeoutOutcome(orchestration, "timed out"), "timeout", "action.timeout");
    assertOutcomeShape(createCapabilityBusExecuteActionPolicyDeniedOutcome(orchestration, "approval required"), "policy_denied", "action.policyDenied");

    const streamDeltaEvent = createCapabilityBusExecuteActionStreamDeltaEvent(orchestration, {
        delta: "hel",
        index: 0
    });
    assert(streamDeltaEvent.type === "action.stream.delta", "stream delta event type mismatch");
    assertValidationOk(validateActionEvent(streamDeltaEvent), "stream delta event");

    const streamDeltaOutcome = createCapabilityBusExecuteActionStreamDeltaOutcome(orchestration, {
        delta: "hel",
        index: 0
    });
    assertOutcomeShape(streamDeltaOutcome, null, "action.stream.delta");

    const normalized = normalizeCapabilityBusExecuteActionOutcomeDescriptor(streamDeltaOutcome);
    assert(normalized.actionEvent.data.delta === "hel", "normalized stream delta should preserve delta payload");

    ok("execute-action outcome happy paths passed");
}

function assertOutcomeValidationRejections() {
    const orchestration = createValidOrchestrationDescriptor();
    const outcome = createCapabilityBusExecuteActionCompletedOutcome(orchestration, {
        result: {
            text: "hello"
        }
    });

    assertThrowsValidation(
        "assert invalid outcome version",
        () => assertCapabilityBusExecuteActionOutcomeDescriptor({
            ...outcome,
            contractVersion: "capability-bus-execute-action-outcome.v999"
        }),
        "unsupported_capability_bus_execute_action_outcome_contract_version"
    );

    const missingPair = validateCapabilityBusExecuteActionOutcomeDescriptor({
        ...outcome,
        resultEnvelope: undefined,
        actionEvent: undefined,
        metadata: {
            ...outcome.metadata,
            resultStatus: undefined,
            eventType: undefined
        }
    });
    assertErrorCodeIncludes(
        missingPair,
        "missing_capability_bus_execute_action_outcome_result_or_event",
        "missing outcome result/event pair"
    );

    const mismatchedEvent = validateCapabilityBusExecuteActionOutcomeDescriptor({
        ...outcome,
        actionEvent: {
            ...outcome.actionEvent,
            type: "action.started"
        },
        metadata: {
            ...outcome.metadata,
            eventType: "action.started"
        }
    });
    assertErrorCodeIncludes(
        mismatchedEvent,
        "capability_bus_execute_action_outcome_result_event_type_mismatch",
        "mismatched result/event pair"
    );

    const rawQueued = validateCapabilityBusExecuteActionOutcomeDescriptor({
        ...outcome,
        resultEnvelope: {
            ...outcome.resultEnvelope,
            status: "queued"
        },
        actionEvent: undefined,
        metadata: {
            ...outcome.metadata,
            resultStatus: "queued",
            eventType: undefined
        }
    });
    assertErrorCodeIncludes(
        rawQueued,
        "unsupported_capability_bus_execute_action_outcome_queued_status",
        "queued status outcome rejection"
    );

    ok("execute-action outcome validation rejection paths passed");
}

function assertForbiddenKeysReject() {
    const orchestration = createValidOrchestrationDescriptor();
    const outcome = createCapabilityBusExecuteActionAcceptedOutcome(orchestration);

    const forbiddenTopLevel = validateCapabilityBusExecuteActionOutcomeDescriptor({
        ...outcome,
        rawBackend: {
            command: "run-this"
        }
    });
    assertErrorCodeIncludes(
        forbiddenTopLevel,
        "forbidden_capability_bus_execute_action_outcome_descriptor_key",
        "forbidden raw backend payload"
    );

    const forbiddenMetadata = validateCapabilityBusExecuteActionOutcomeDescriptor({
        ...outcome,
        metadata: {
            ...outcome.metadata,
            workerBridge: "sendToWorker"
        }
    });
    assertErrorCodeIncludes(
        forbiddenMetadata,
        "forbidden_capability_bus_execute_action_outcome_descriptor_key",
        "forbidden metadata workerBridge"
    );

    const forbiddenBoundary = validateCapabilityBusExecuteActionOutcomeDescriptor({
        ...outcome,
        boundary: {
            ...outcome.boundary,
            scheduler: "not-allowed"
        }
    });
    assertErrorCodeIncludes(
        forbiddenBoundary,
        "forbidden_capability_bus_execute_action_outcome_descriptor_key",
        "forbidden boundary scheduler"
    );

    ok("forbidden outcome execution/runtime keys rejected");
}

function assertRawLowerLevelInputsRejected() {
    const executeActionPlan = createValidExecuteActionPlan();
    const orchestration = createValidOrchestrationDescriptor();

    const rawBackendPlan = validateCapabilityBusExecuteActionOutcomeDescriptor(createValidBackendAdapterPlan());
    assertErrorCodeIncludes(
        rawBackendPlan,
        "unsupported_capability_bus_execute_action_outcome_lower_level_source",
        "raw backend adapter plan direct input"
    );

    const rawExecutionPlan = validateCapabilityBusExecuteActionOutcomeDescriptor(executeActionPlan.executionPlan);
    assertErrorCodeIncludes(
        rawExecutionPlan,
        "unsupported_capability_bus_execute_action_outcome_lower_level_source",
        "raw capability execution plan direct input"
    );

    const rawExecutorSkeleton = validateCapabilityBusExecuteActionOutcomeDescriptor(orchestration.executorSkeletonPlan);
    assertErrorCodeIncludes(
        rawExecutorSkeleton,
        "unsupported_capability_bus_execute_action_outcome_lower_level_source",
        "raw executor skeleton direct input"
    );

    const rawBackendInvocation = validateCapabilityBusExecuteActionOutcomeDescriptor(orchestration.backendAdapterInvocationDescriptor);
    assertErrorCodeIncludes(
        rawBackendInvocation,
        "unsupported_capability_bus_execute_action_outcome_lower_level_source",
        "raw backend invocation direct input"
    );

    ok("raw lower-level direct outcome inputs rejected");
}

function assertCopyIsolation() {
    const outcome = createCapabilityBusExecuteActionCompletedOutcome(createValidOrchestrationDescriptor(), {
        result: {
            text: "hello"
        }
    });
    const copied = copyCapabilityBusExecuteActionOutcomeDescriptor(outcome);

    copied.action.capability = "mutated";
    copied.orchestrationDescriptor.action.capability = "mutated";
    copied.resultEnvelope.result.text = "mutated";
    copied.actionEvent.data.backendKind = "mutated";
    copied.metadata.backendKind = "mutated";
    copied.boundary.nativeExecution = "mutated";

    assert(outcome.action.capability === "text.generate", "copy should isolate outcome action metadata");
    assert(outcome.orchestrationDescriptor.action.capability === "text.generate", "copy should isolate orchestration descriptor");
    assert(outcome.resultEnvelope.result.text === "hello", "copy should isolate result envelope");
    assert(outcome.actionEvent.data.backendKind === "nativeWorkerBackend", "copy should isolate action event data");
    assert(outcome.metadata.backendKind === "nativeWorkerBackend", "copy should isolate outcome metadata");
    assert(outcome.boundary.nativeExecution === CAPABILITY_BUS_EXECUTE_ACTION_OUTCOME_NATIVE_EXECUTION, "copy should isolate outcome boundary");

    ok("execute-action outcome copy isolation passed");
}

async function assertOutcomeModuleBoundaries() {
    const outcomeFiles = [
        "runtime/bus/executeAction/capabilityBusExecuteActionOutcomeCommon.mjs",
        "runtime/bus/executeAction/capabilityBusExecuteActionOutcome.mjs",
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

    for (const relativePath of outcomeFiles) {
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

    ok("execute-action outcome module source guards passed");
}

async function main() {
    console.log("[SMOKE] capability execute-action outcome");

    assert(
        CAPABILITY_BUS_EXECUTE_ACTION_OUTCOME_CONTRACT_VERSION === "capability-bus-execute-action-outcome.v1",
        "execute-action outcome contract version export mismatch"
    );
    ok("execute-action outcome contract version export passed");

    assertOutcomeHappyPaths();
    assertOutcomeValidationRejections();
    assertForbiddenKeysReject();
    assertRawLowerLevelInputsRejected();
    assertCopyIsolation();
    await assertOutcomeModuleBoundaries();

    console.log("All capability execute-action outcome smoke tests finished.");
}

main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
});
