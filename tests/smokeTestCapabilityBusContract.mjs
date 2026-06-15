// smokeTestCapabilityBusContract.mjs
//
// Purpose:
// - Contract smoke for the Runtime Dev Capability Bus skeleton branch.
// - Validates bus-local intake/result/event helpers without wiring runtime.mjs,
//   workerBridge, scheduler, backend adapters, or llama_worker modules.
//
// Run:
//   node ./tests/smokeTestCapabilityBusContract.mjs

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

import {
    CAPABILITY_BUS_CONTRACT_VERSION,
    assertCapabilityBusAction,
    normalizeCapabilityBusAction,
    validateCapabilityBusAction
} from "../runtime/bus/capabilityBusContract.mjs";
import {
    createCapabilityNotImplementedResult,
    createCapabilityPolicyDeniedResult,
    createCapabilityUnsupportedResult,
    createCapabilityValidationFailedResult
} from "../runtime/bus/capabilityBusResult.mjs";
import {
    createCapabilityBusAcceptedEvent,
    createCapabilityBusNotImplementedEvent,
    createCapabilityBusPolicyDeniedEvent,
    createCapabilityBusRejectedEvent
} from "../runtime/bus/capabilityBusEvents.mjs";
import {
    CAPABILITY_REGISTRY_SCHEMA_VERSION
} from "../runtime/bus/capabilityRegistryContract.mjs";
import {
    assertActionEvent
} from "../runtime/bus/actionEvent.mjs";
import {
    assertResultEnvelope,
    createResultError
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

function createValidActionEnvelope(overrides = {}) {
    return {
        actionId: " act_123 ",
        runId: " run_456 ",
        source: {
            kind: "direct-api"
        },
        capability: "text.generate",
        intent: " direct_prompt ",
        input: {
            prompt: "Say hello briefly.",
            contextRefs: [" ctx_1 "]
        },
        requirements: {
            modelClass: "reasoning-7b",
            contextNeed: "medium",
            stream: false,
            timeoutMs: 60000
        },
        policy: {
            maxTokens: 800,
            approvalRequired: false,
            allowTools: false,
            budget: {
                tokenBudget: 1000
            }
        },
        trace: {
            parentActionId: null,
            operator: "direct",
            correlationId: "corr_1"
        },
        ...overrides
    };
}

function createValidCapabilityDefinition(overrides = {}) {
    return {
        capability: "text.generate",
        version: " v1 ",
        status: "contract-only",
        summary: " Generate text through an approved text capability service. ",
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
            backendKinds: [" nativeWorkerBackend "],
            modelBundleRequired: true,
            contextRefs: true
        },
        ...overrides
    };
}

function createValidRegistry(overrides = {}) {
    return {
        schemaVersion: CAPABILITY_REGISTRY_SCHEMA_VERSION,
        capabilities: [createValidCapabilityDefinition()],
        ...overrides
    };
}

async function assertNoRuntimeWiringImports() {
    const sources = {
        "runtime/bus/capabilityBusContract.mjs": await readSource("runtime/bus/capabilityBusContract.mjs"),
        "runtime/bus/capabilityBusResult.mjs": await readSource("runtime/bus/capabilityBusResult.mjs"),
        "runtime/bus/capabilityBusEvents.mjs": await readSource("runtime/bus/capabilityBusEvents.mjs")
    };

    const forbiddenMarkers = [
        "runtime.mjs",
        "workerBridge",
        "llama_worker",
        "node-llama-cpp",
        "../lifecycle/",
        "../request/",
        "../stream/",
        "../observability/",
        "worker_threads",
        "child_process",
        "spawn(",
        "exec(",
        "executeAction",
        "prompt(",
        "sendToWorker",
        "new Worker",
        "ReadableStream",
        "setTimeout",
        "Date.now"
    ];

    for (const [relativePath, source] of Object.entries(sources)) {
        for (const marker of forbiddenMarkers) {
            if (source.includes(marker)) {
                fail(`${relativePath} includes forbidden runtime wiring marker: ${marker}`);
            }
        }
    }

    const runtimeSource = await readSource("runtime.mjs");
    assert(
        !runtimeSource.includes("runtime/bus/capabilityBus"),
        "runtime.mjs should not import Capability Bus skeleton modules in this branch"
    );

    ok("capability bus skeleton modules avoid runtime/worker execution wiring");
}

function testValidBusAction() {
    const action = createValidActionEnvelope();
    const registry = createValidRegistry();
    const result = validateCapabilityBusAction(action, registry);

    assert(result.ok, `valid bus action should pass: ${JSON.stringify(result.errors)}`);
    assert(result.value.contractVersion === CAPABILITY_BUS_CONTRACT_VERSION, "bus contract version should match");
    assert(result.value.action.actionId === "act_123", "bus action should contain normalized action identity");
    assert(result.value.action.input.contextRefs[0] === "ctx_1", "bus action should normalize context refs");
    assert(result.value.capabilityDefinition.capability === "text.generate", "bus action should include registry definition");
    assert(result.value.capabilityDefinition.version === "v1", "definition version should be normalized");
    assert(result.value !== action, "bus action should be a new wrapper object");

    const normalized = normalizeCapabilityBusAction(action, registry);
    assert(normalized.action.actionId === "act_123", "normalizeCapabilityBusAction should return normalized wrapper");

    const asserted = assertCapabilityBusAction(action, registry);
    assert(asserted.capabilityDefinition.summary.startsWith("Generate text"), "assertCapabilityBusAction returns definition");

    ok("valid Capability Bus action intake contract passed");
}

function testActionAndRegistryValidationPrefixes() {
    const invalidAction = validateCapabilityBusAction(
        createValidActionEnvelope({
            input: {
                prompt: "Say hello.",
                backendOptions: {
                    secret: true
                }
            }
        }),
        createValidRegistry()
    );

    assert(!invalidAction.ok, "invalid action should reject through bus validation");
    assertErrorCode(
        invalidAction,
        "bus_action_forbidden_action_envelope_key",
        "invalid action bus validation"
    );
    assert(
        invalidAction.errors.some((error) => error.path === "action.input.backendOptions"),
        "action validation errors should be action-prefixed"
    );

    const invalidRegistry = validateCapabilityBusAction(
        createValidActionEnvelope(),
        {
            schemaVersion: CAPABILITY_REGISTRY_SCHEMA_VERSION,
            capabilities: "not-array"
        }
    );

    assert(!invalidRegistry.ok, "invalid registry should reject through bus validation");
    assertErrorCode(
        invalidRegistry,
        "bus_registry_invalid_capabilities",
        "invalid registry bus validation"
    );
    assert(
        invalidRegistry.errors.some((error) => error.path === "registry.capabilities"),
        "registry validation errors should be registry-prefixed"
    );

    ok("bus action/registry validation prefixing passed");
}

function testMissingAndDeprecatedCapabilities() {
    const missing = validateCapabilityBusAction(
        createValidActionEnvelope({ capability: "vision.chat" }),
        createValidRegistry()
    );

    assert(!missing.ok, "missing capability definition should reject");
    assertErrorCode(missing, "capability_bus_missing_definition", "missing capability definition");

    const deprecated = validateCapabilityBusAction(
        createValidActionEnvelope(),
        createValidRegistry({
            capabilities: [createValidCapabilityDefinition({ status: "deprecated" })]
        })
    );

    assert(!deprecated.ok, "deprecated capability definition should reject at bus intake");
    assertErrorCode(deprecated, "capability_bus_deprecated_definition", "deprecated capability definition");

    assertThrowsValidation(
        "assertCapabilityBusAction missing definition",
        () => assertCapabilityBusAction(createValidActionEnvelope({ capability: "vision.chat" }), createValidRegistry()),
        "capability_bus_missing_definition"
    );

    ok("missing/deprecated capability intake rejection passed");
}

function testBusResultHelpers() {
    const action = createValidActionEnvelope();
    const validationFailure = validateCapabilityBusAction(
        createValidActionEnvelope({ capability: "vision.chat" }),
        createValidRegistry()
    );

    const notImplemented = createCapabilityNotImplementedResult(action, { phase: "skeleton" });
    assertResultEnvelope(notImplemented);
    assert(notImplemented.status === "failed", "not-implemented result should fail");
    assert(notImplemented.error.kind === "runtime", "not-implemented result error should be runtime kind");
    assert(notImplemented.error.code === "capability_not_implemented", "not-implemented result code should match");
    assert(notImplemented.actionId === "act_123", "result helper should normalize actionId");

    const unsupported = createCapabilityUnsupportedResult(action, { phase: "intake" });
    assertResultEnvelope(unsupported);
    assert(unsupported.status === "failed", "unsupported result should fail");
    assert(unsupported.error.kind === "validation", "unsupported result should be validation kind");

    const denied = createCapabilityPolicyDeniedResult(action, " Approval required. ", { policy: "approval" });
    assertResultEnvelope(denied);
    assert(denied.status === "policy_denied", "policy denied result should use policy_denied status");
    assert(denied.policyReason === "Approval required.", "policy reason should be normalized");
    assert(denied.error.kind === "policy", "policy denied result should be policy kind");

    const validationResult = createCapabilityValidationFailedResult(action, validationFailure, { phase: "intake" });
    assertResultEnvelope(validationResult);
    assert(validationResult.status === "failed", "validation failure result should fail");
    assert(validationResult.error.kind === "validation", "validation failure result should be validation kind");
    assert(
        validationResult.error.details.errors.some((error) => error.code === "capability_bus_missing_definition"),
        "validation failure result should carry validation errors"
    );

    ok("Capability Bus result helper contract passed");
}

function testBusEventHelpers() {
    const action = createValidActionEnvelope();
    const notImplementedResult = createCapabilityNotImplementedResult(action, { phase: "skeleton" });
    const policyError = createResultError({
        message: "Approval required.",
        code: "capability_policy_denied",
        kind: "policy",
        retryable: false,
        details: {}
    });

    const accepted = createCapabilityBusAcceptedEvent(action, {
        eventId: " evt_accepted ",
        timestamp: 10,
        sequence: 1
    });
    assertActionEvent(accepted);
    assert(accepted.type === "action.accepted", "accepted event type should match");
    assert(accepted.eventId === "evt_accepted", "accepted event id should be normalized");

    const rejected = createCapabilityBusRejectedEvent(action, notImplementedResult.error, {
        eventId: "evt_rejected",
        timestamp: 11,
        sequence: 2
    });
    assertActionEvent(rejected);
    assert(rejected.type === "action.failed", "rejected event should be action.failed");
    assert(rejected.data.error.code === "capability_not_implemented", "rejected event should carry error");

    const notImplemented = createCapabilityBusNotImplementedEvent(action, notImplementedResult.error, {
        eventId: "evt_not_implemented",
        timestamp: 12,
        sequence: 3
    });
    assertActionEvent(notImplemented);
    assert(notImplemented.type === "action.failed", "not-implemented event should be action.failed");

    const denied = createCapabilityBusPolicyDeniedEvent(action, policyError, {
        eventId: "evt_denied",
        timestamp: 13,
        sequence: 4,
        policyReason: "Approval required."
    });
    assertActionEvent(denied);
    assert(denied.type === "action.policyDenied", "policy denied event should use action.policyDenied");
    assert(denied.data.policyReason === "Approval required.", "policy denied event should carry policy reason");

    assertThrowsValidation(
        "accepted event without timestamp",
        () => createCapabilityBusAcceptedEvent(action, { eventId: "evt_missing_timestamp" }),
        "invalid_timestamp"
    );

    ok("Capability Bus event helper contract passed");
}

await assertNoRuntimeWiringImports();
testValidBusAction();
testActionAndRegistryValidationPrefixes();
testMissingAndDeprecatedCapabilities();
testBusResultHelpers();
testBusEventHelpers();

console.log("All capability bus skeleton contract smoke checks finished.");
