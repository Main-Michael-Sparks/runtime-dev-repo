// smokeTestActionEnvelopeContract.mjs
//
// Purpose:
// - Contract smoke for the Runtime Dev action-envelope branch.
// - Validates bus contract helpers without wiring runtime.mjs, workerBridge, or
//   llama_worker modules.
//
// Run:
//   node ./tests/smokeTestActionEnvelopeContract.mjs

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

import {
    ACTION_EVENT_TYPES,
    ACTION_SOURCE_KINDS,
    ACTION_STATUSES,
    CAPABILITIES,
    isKnownActionEventType,
    isKnownActionSourceKind,
    isKnownActionStatus,
    isKnownCapability
} from "../runtime/bus/capabilityTaxonomy.mjs";
import {
    assertValidation,
    createValidationError,
    createValidationResult,
    hasForbiddenPathLikeValue
} from "../runtime/bus/contractValidation.mjs";
import {
    assertContextRefs,
    normalizeContextRefs,
    validateContextRefs
} from "../runtime/bus/contextRefs.mjs";
import {
    assertActionEnvelope,
    normalizeActionEnvelope,
    validateActionEnvelope
} from "../runtime/bus/actionEnvelope.mjs";
import {
    RESULT_ERROR_KINDS,
    assertResultEnvelope,
    assertResultError,
    createResultEnvelope,
    createResultError,
    normalizeResultEnvelope,
    validateResultEnvelope,
    validateResultError
} from "../runtime/bus/resultEnvelope.mjs";
import {
    assertActionEvent,
    createActionEvent,
    normalizeActionEvent,
    validateActionEvent
} from "../runtime/bus/actionEvent.mjs";

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
            contextRefs: [" ctx_1 ", "doc:runtime-blueprint"]
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

async function assertNoRuntimeWiringImports() {
    const sources = {
        "runtime/bus/contractValidation.mjs": await readSource("runtime/bus/contractValidation.mjs"),
        "runtime/bus/capabilityTaxonomy.mjs": await readSource("runtime/bus/capabilityTaxonomy.mjs"),
        "runtime/bus/contextRefs.mjs": await readSource("runtime/bus/contextRefs.mjs"),
        "runtime/bus/actionEnvelope.mjs": await readSource("runtime/bus/actionEnvelope.mjs"),
        "runtime/bus/resultEnvelope.mjs": await readSource("runtime/bus/resultEnvelope.mjs"),
        "runtime/bus/actionEvent.mjs": await readSource("runtime/bus/actionEvent.mjs")
    };

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

    for (const [relativePath, source] of Object.entries(sources)) {
        for (const marker of forbiddenMarkers) {
            if (source.includes(marker)) {
                fail(`${relativePath} includes forbidden runtime wiring marker: ${marker}`);
            }
        }
    }

    ok("bus contract modules avoid runtime/worker execution imports");
}

function testTaxonomy() {
    assertIncludes(CAPABILITIES, "text.generate", "capabilities");
    assertIncludes(CAPABILITIES, "memory.search", "capabilities");
    assertIncludes(ACTION_STATUSES, "policy_denied", "action statuses");
    assertIncludes(ACTION_EVENT_TYPES, "action.policyDenied", "action event types");
    assertIncludes(ACTION_SOURCE_KINDS, "graph-node", "action source kinds");

    assert(isKnownCapability("tool.call"), "tool.call should be a known capability");
    assert(!isKnownCapability("knowledge.search"), "knowledge.search should not be in v1 taxonomy");
    assert(isKnownActionStatus("completed"), "completed should be a known action status");
    assert(!isKnownActionStatus("done"), "done should not be a known action status");
    assert(isKnownActionEventType("action.failed"), "action.failed should be a known event type");
    assert(isKnownActionSourceKind("integration"), "integration should be a known source kind");

    ok("capability taxonomy contract passed");
}

function testValidationHelpers() {
    const validError = createValidationError(
        "capability",
        "unknown_capability",
        "Unknown capability"
    );
    const failed = createValidationResult([validError]);

    assert(!failed.ok, "failed validation result should not be ok");
    assert(failed.value === null, "failed validation result should have null value");

    const passed = createValidationResult([], { ok: true });
    assert(passed.ok, "empty validation errors should pass");
    assert(assertValidation(passed).ok === true, "assertValidation should return successful value");

    try {
        assertValidation(failed, "Expected failure");
        fail("assertValidation should throw for failed result");
    } catch (err) {
        if (String(err.message).startsWith("[FAIL]")) throw err;
        assert(Array.isArray(err.validationErrors), "assertValidation error should carry validationErrors");
    }

    assert(hasForbiddenPathLikeValue("../secret.txt"), "path traversal should be forbidden");
    assert(hasForbiddenPathLikeValue("C:\\models\\model.gguf"), "Windows path should be forbidden");
    assert(!hasForbiddenPathLikeValue("doc:runtime-blueprint"), "safe reference should not be forbidden");

    ok("validation helper contract passed");
}

function testContextRefs() {
    const result = validateContextRefs([
        " ctx_1 ",
        "mem_project_runtime_001",
        "doc:runtime-blueprint",
        "checkpoint:last-safe",
        "trace:run_123",
        "artifact:report_1"
    ]);

    assert(result.ok, `valid context refs should pass: ${JSON.stringify(result.errors)}`);
    assert(result.value[0] === "ctx_1", "context refs should be normalized by validation");
    assert(normalizeContextRefs([" a ", "b "]).join(",") === "a,b", "normalizeContextRefs trims refs");
    assert(assertContextRefs(["ctx_1"])[0] === "ctx_1", "assertContextRefs returns normalized refs");

    const rejected = validateContextRefs([
        "../secret.txt",
        "C:\\models\\model.gguf",
        "/home/user/model.gguf",
        "modelPath:../../../base/model.gguf"
    ]);

    assert(!rejected.ok, "path-like context refs should reject");
    assertErrorCode(rejected, "forbidden_context_ref_value", "path-like context refs");

    ok("context reference contract passed");
}

function testActionEnvelopeValidCase() {
    const envelope = createValidActionEnvelope();
    const result = validateActionEnvelope(envelope);

    assert(result.ok, `valid action envelope should pass: ${JSON.stringify(result.errors)}`);
    assert(result.value !== envelope, "normalized action envelope should be a copy");
    assert(result.value.actionId === "act_123", "actionId should be trimmed");
    assert(result.value.runId === "run_456", "runId should be trimmed");
    assert(result.value.intent === "direct_prompt", "intent should be trimmed");
    assert(result.value.input.contextRefs[0] === "ctx_1", "context refs should be trimmed");

    const normalized = normalizeActionEnvelope(envelope);
    assert(normalized.actionId === "act_123", "normalizeActionEnvelope should trim actionId");
    assert(normalized.input.contextRefs[0] === "ctx_1", "normalizeActionEnvelope should trim refs");
    assert(envelope.actionId === " act_123 ", "normalizeActionEnvelope should not mutate caller input");

    const asserted = assertActionEnvelope(envelope);
    assert(asserted.capability === "text.generate", "assertActionEnvelope should return normalized envelope");

    ok("valid action envelope contract passed");
}

function testActionEnvelopeRequiredFields() {
    const invalidRoot = validateActionEnvelope(null);
    assert(!invalidRoot.ok, "null action envelope should reject");
    assertErrorCode(invalidRoot, "invalid_action_envelope", "null action envelope");

    const missing = validateActionEnvelope({});
    assert(!missing.ok, "missing required fields should reject");
    assertErrorCode(missing, "missing_action_id", "missing actionId");
    assertErrorCode(missing, "invalid_source", "missing source");
    assertErrorCode(missing, "missing_capability", "missing capability");
    assertErrorCode(missing, "missing_intent", "missing intent");
    assertErrorCode(missing, "invalid_input", "missing input");

    ok("action envelope required-field rejection passed");
}

function testActionEnvelopeKnownTaxonomy() {
    const unknownCapability = validateActionEnvelope(createValidActionEnvelope({
        capability: "text.foo"
    }));
    assert(!unknownCapability.ok, "unknown capability should reject");
    assertErrorCode(unknownCapability, "unknown_capability", "unknown capability");

    const unknownSource = validateActionEnvelope(createValidActionEnvelope({
        source: {
            kind: "external-raw"
        }
    }));
    assert(!unknownSource.ok, "unknown source kind should reject");
    assertErrorCode(unknownSource, "unknown_source_kind", "unknown source kind");

    ok("action envelope taxonomy rejection passed");
}

function testActionEnvelopeContextRefs() {
    const invalidContext = validateActionEnvelope(createValidActionEnvelope({
        input: {
            prompt: "Say hello.",
            contextRefs: ["../secret.txt"]
        }
    }));

    assert(!invalidContext.ok, "invalid input.contextRefs should reject");
    assertErrorCode(invalidContext, "forbidden_context_ref_value", "input.contextRefs");

    ok("action envelope context-ref validation passed");
}

function testActionEnvelopeForbiddenKeys() {
    const withModelPath = validateActionEnvelope(createValidActionEnvelope({
        input: {
            prompt: "Say hello.",
            modelPath: "../../../base/model.gguf"
        }
    }));
    assert(!withModelPath.ok, "modelPath key should reject");
    assertErrorCode(withModelPath, "forbidden_action_envelope_key", "modelPath key");

    const withBackend = validateActionEnvelope(createValidActionEnvelope({
        requirements: {
            backend: "nativeWorkerBackend"
        }
    }));
    assert(!withBackend.ok, "backend key should reject");
    assertErrorCode(withBackend, "forbidden_action_envelope_key", "backend key");

    const withCommand = validateActionEnvelope(createValidActionEnvelope({
        input: {
            prompt: "Say hello.",
            toolProcess: {
                command: "node"
            }
        }
    }));
    assert(!withCommand.ok, "tool process command keys should reject");
    assertErrorCode(withCommand, "forbidden_action_envelope_key", "tool process command key");

    ok("action envelope forbidden-key guard passed");
}

function testActionEnvelopeOptionalSections() {
    const invalidRequirements = validateActionEnvelope(createValidActionEnvelope({
        requirements: {
            timeoutMs: -1,
            stream: "yes",
            unexpected: true
        }
    }));
    assert(!invalidRequirements.ok, "invalid requirements should reject");
    assertErrorCode(invalidRequirements, "invalid_timeout_ms", "negative timeout");
    assertErrorCode(invalidRequirements, "invalid_stream_requirement", "non-boolean stream");
    assertErrorCode(invalidRequirements, "unknown_requirement_field", "unknown requirement field");

    const invalidPolicy = validateActionEnvelope(createValidActionEnvelope({
        policy: {
            maxTokens: Number.NaN,
            approvalRequired: "false",
            allowTools: 1,
            budget: "cheap",
            backendOptions: {}
        }
    }));
    assert(!invalidPolicy.ok, "invalid policy should reject");
    assertErrorCode(invalidPolicy, "invalid_max_tokens", "invalid maxTokens");
    assertErrorCode(invalidPolicy, "invalid_approval_required", "invalid approvalRequired");
    assertErrorCode(invalidPolicy, "invalid_allow_tools", "invalid allowTools");
    assertErrorCode(invalidPolicy, "invalid_budget", "invalid budget");
    assertErrorCode(invalidPolicy, "forbidden_action_envelope_key", "forbidden backendOptions");

    const invalidTrace = validateActionEnvelope(createValidActionEnvelope({
        trace: {
            parentActionId: 123,
            parentNodeId: "node_1",
            operator: "direct",
            unexpected: true
        }
    }));
    assert(!invalidTrace.ok, "invalid trace should reject");
    assertErrorCode(invalidTrace, "invalid_string_field", "invalid parentActionId");
    assertErrorCode(invalidTrace, "unknown_trace_field", "unknown trace field");

    ok("action envelope optional-section validation passed");
}


function createValidResultError(overrides = {}) {
    return {
        message: " Backend execution failed ",
        code: "backend_error",
        kind: "backend",
        retryable: false,
        details: {
            phase: "prompt"
        },
        ...overrides
    };
}

function createValidResultEnvelope(overrides = {}) {
    return {
        actionId: " act_123 ",
        runId: " run_456 ",
        capability: "text.generate",
        status: "completed",
        result: {
            text: "Hello."
        },
        usage: {
            backend: "nativeWorkerBackend",
            modelBundle: "mistral-text-local",
            profile: "laptopFallback"
        },
        warnings: [],
        trace: {
            startedAt: 1780000000000,
            finishedAt: 1780000022500,
            durationMs: 22500
        },
        outputRefs: [" output:txt_1 "],
        artifactRefs: [" artifact:report_1 "],
        partial: false,
        retryable: false,
        ...overrides
    };
}

function testResultErrors() {
    assertIncludes(RESULT_ERROR_KINDS, "validation", "result error kinds");
    assertIncludes(RESULT_ERROR_KINDS, "policy", "result error kinds");
    assertIncludes(RESULT_ERROR_KINDS, "runtime", "result error kinds");
    assertIncludes(RESULT_ERROR_KINDS, "backend", "result error kinds");
    assertIncludes(RESULT_ERROR_KINDS, "timeout", "result error kinds");
    assertIncludes(RESULT_ERROR_KINDS, "cancellation", "result error kinds");
    assertIncludes(RESULT_ERROR_KINDS, "unknown", "result error kinds");

    const validKinds = [
        "validation",
        "policy",
        "runtime",
        "backend",
        "timeout",
        "cancellation",
        "unknown"
    ];

    for (const kind of validKinds) {
        const result = validateResultError(createValidResultError({
            code: `${kind}_error`,
            kind,
            causeCode: `${kind}_cause`
        }));
        assert(result.ok, `${kind} result error should pass: ${JSON.stringify(result.errors)}`);
        assert(result.value.kind === kind, `${kind} result error should normalize kind`);
    }

    const normalized = createResultError(createValidResultError());
    assert(normalized.message === "Backend execution failed", "createResultError should trim message");
    assert(normalized.retryable === false, "createResultError should preserve retryable false");
    assert(assertResultError(createValidResultError()).code === "backend_error", "assertResultError should return normalized error");

    const missingMessage = validateResultError(createValidResultError({
        message: ""
    }));
    assert(!missingMessage.ok, "missing result error message should reject");
    assertErrorCode(missingMessage, "missing_error_message", "missing result error message");

    const invalidCode = validateResultError(createValidResultError({
        code: "Backend Error"
    }));
    assert(!invalidCode.ok, "invalid result error code should reject");
    assertErrorCode(invalidCode, "invalid_error_code", "invalid result error code");

    const invalidKind = validateResultError(createValidResultError({
        kind: "network"
    }));
    assert(!invalidKind.ok, "unknown result error kind should reject");
    assertErrorCode(invalidKind, "unknown_error_kind", "unknown result error kind");

    const invalidDetails = validateResultError(createValidResultError({
        details: "details"
    }));
    assert(!invalidDetails.ok, "invalid result error details should reject");
    assertErrorCode(invalidDetails, "invalid_error_details", "invalid result error details");

    ok("result error contract passed");
}

function testResultEnvelopeValidCase() {
    const envelope = createValidResultEnvelope();
    const result = validateResultEnvelope(envelope);

    assert(result.ok, `valid result envelope should pass: ${JSON.stringify(result.errors)}`);
    assert(result.value !== envelope, "normalized result envelope should be a copy");
    assert(result.value.actionId === "act_123", "result actionId should be trimmed");
    assert(result.value.runId === "run_456", "result runId should be trimmed");
    assert(result.value.outputRefs[0] === "output:txt_1", "outputRefs should be trimmed");
    assert(result.value.artifactRefs[0] === "artifact:report_1", "artifactRefs should be trimmed");

    const normalized = normalizeResultEnvelope(envelope);
    assert(normalized.actionId === "act_123", "normalizeResultEnvelope should trim actionId");
    assert(envelope.actionId === " act_123 ", "normalizeResultEnvelope should not mutate caller input");

    const asserted = assertResultEnvelope(envelope);
    assert(asserted.status === "completed", "assertResultEnvelope should return normalized envelope");

    const created = createResultEnvelope(envelope);
    assert(created.capability === "text.generate", "createResultEnvelope should return normalized envelope");

    ok("valid result envelope contract passed");
}

function testResultEnvelopeStatusSemantics() {
    const failed = validateResultEnvelope(createValidResultEnvelope({
        status: "failed",
        result: undefined,
        error: createValidResultError({
            kind: "runtime",
            code: "runtime_error"
        })
    }));
    assert(failed.ok, `failed result envelope with error should pass: ${JSON.stringify(failed.errors)}`);

    const timeout = validateResultEnvelope(createValidResultEnvelope({
        status: "timeout",
        result: undefined,
        error: createValidResultError({
            kind: "timeout",
            code: "timeout_error"
        })
    }));
    assert(timeout.ok, `timeout result envelope with error should pass: ${JSON.stringify(timeout.errors)}`);

    const cancelled = validateResultEnvelope(createValidResultEnvelope({
        status: "cancelled",
        result: undefined,
        cancellationReason: " Prompt canceled "
    }));
    assert(cancelled.ok, `cancelled result envelope with reason should pass: ${JSON.stringify(cancelled.errors)}`);
    assert(cancelled.value.cancellationReason === "Prompt canceled", "cancellationReason should be trimmed");

    const policyDenied = validateResultEnvelope(createValidResultEnvelope({
        status: "policy_denied",
        result: undefined,
        error: createValidResultError({
            kind: "policy",
            code: "policy_denied"
        })
    }));
    assert(policyDenied.ok, `policy-denied result envelope with error should pass: ${JSON.stringify(policyDenied.errors)}`);

    const partialCompleted = validateResultEnvelope(createValidResultEnvelope({
        result: undefined,
        partial: true
    }));
    assert(partialCompleted.ok, `partial completed result without result should pass: ${JSON.stringify(partialCompleted.errors)}`);

    ok("result envelope status semantics passed");
}

function testResultEnvelopeRejects() {
    const missing = validateResultEnvelope({});
    assert(!missing.ok, "missing result envelope fields should reject");
    assertErrorCode(missing, "missing_action_id", "missing result actionId");
    assertErrorCode(missing, "missing_capability", "missing result capability");
    assertErrorCode(missing, "missing_status", "missing result status");

    const unknownCapability = validateResultEnvelope(createValidResultEnvelope({
        capability: "text.foo"
    }));
    assert(!unknownCapability.ok, "unknown result capability should reject");
    assertErrorCode(unknownCapability, "unknown_capability", "unknown result capability");

    const unknownStatus = validateResultEnvelope(createValidResultEnvelope({
        status: "done"
    }));
    assert(!unknownStatus.ok, "unknown result status should reject");
    assertErrorCode(unknownStatus, "unknown_status", "unknown result status");

    const failedWithoutError = validateResultEnvelope(createValidResultEnvelope({
        status: "failed",
        result: undefined
    }));
    assert(!failedWithoutError.ok, "failed without error should reject");
    assertErrorCode(failedWithoutError, "missing_failed_error", "failed without error");

    const timeoutWithoutError = validateResultEnvelope(createValidResultEnvelope({
        status: "timeout",
        result: undefined
    }));
    assert(!timeoutWithoutError.ok, "timeout without error or cancellationReason should reject");
    assertErrorCode(timeoutWithoutError, "missing_timeout_error", "timeout without error");

    const cancelledWithoutReason = validateResultEnvelope(createValidResultEnvelope({
        status: "cancelled",
        result: undefined
    }));
    assert(!cancelledWithoutReason.ok, "cancelled without reason or error should reject");
    assertErrorCode(cancelledWithoutReason, "missing_cancellation_reason", "cancelled without reason");

    const policyDeniedWithoutError = validateResultEnvelope(createValidResultEnvelope({
        status: "policy_denied",
        result: undefined
    }));
    assert(!policyDeniedWithoutError.ok, "policy_denied without error or policyReason should reject");
    assertErrorCode(policyDeniedWithoutError, "missing_policy_denied_error", "policy_denied without error");

    const invalidCompletedResult = validateResultEnvelope(createValidResultEnvelope({
        result: "hello"
    }));
    assert(!invalidCompletedResult.ok, "completed with invalid result object should reject");
    assertErrorCode(invalidCompletedResult, "invalid_result", "invalid result object");

    const invalidError = validateResultEnvelope(createValidResultEnvelope({
        status: "failed",
        result: undefined,
        error: {
            message: "failed",
            code: "bad code",
            kind: "runtime"
        }
    }));
    assert(!invalidError.ok, "invalid nested result error should reject");
    assertErrorCode(invalidError, "invalid_error_code", "invalid nested result error");

    const invalidOutputRefs = validateResultEnvelope(createValidResultEnvelope({
        outputRefs: ["../secret.txt"]
    }));
    assert(!invalidOutputRefs.ok, "invalid outputRefs should reject");
    assertErrorCode(invalidOutputRefs, "forbidden_context_ref_value", "invalid outputRefs");

    const invalidArtifactRefs = validateResultEnvelope(createValidResultEnvelope({
        artifactRefs: ["C:\\models\\model.gguf"]
    }));
    assert(!invalidArtifactRefs.ok, "invalid artifactRefs should reject");
    assertErrorCode(invalidArtifactRefs, "forbidden_context_ref_value", "invalid artifactRefs");

    const invalidWarnings = validateResultEnvelope(createValidResultEnvelope({
        warnings: "none"
    }));
    assert(!invalidWarnings.ok, "warnings not array should reject");
    assertErrorCode(invalidWarnings, "invalid_warnings", "invalid warnings");

    ok("result envelope rejection contract passed");
}

function testResultEnvelopeForbiddenKeys() {
    const withModelPath = validateResultEnvelope(createValidResultEnvelope({
        usage: {
            backend: "nativeWorkerBackend",
            modelPath: "../../../base/model.gguf"
        }
    }));
    assert(!withModelPath.ok, "modelPath key should reject in result envelope");
    assertErrorCode(withModelPath, "forbidden_result_envelope_key", "result modelPath key");

    const withBackendMetadata = validateResultEnvelope(createValidResultEnvelope({
        usage: {
            backend: "nativeWorkerBackend",
            modelBundle: "mistral-text-local",
            profile: "laptopFallback"
        }
    }));
    assert(withBackendMetadata.ok, `usage backend metadata should pass: ${JSON.stringify(withBackendMetadata.errors)}`);

    const withCommand = validateResultEnvelope(createValidResultEnvelope({
        result: {
            toolProcess: {
                command: "node"
            }
        }
    }));
    assert(!withCommand.ok, "tool process command keys should reject in result envelope");
    assertErrorCode(withCommand, "forbidden_result_envelope_key", "result command key");

    ok("result envelope forbidden-key guard passed");
}


function createValidActionEvent(overrides = {}) {
    return {
        eventId: " evt_123 ",
        actionId: " act_123 ",
        runId: " run_456 ",
        type: "action.started",
        capability: "text.generate",
        timestamp: 1780000000000,
        sequence: 1,
        data: {
            phase: "dispatch"
        },
        ...overrides
    };
}

function createValidEventForType(type) {
    if (type === "action.failed") {
        return createValidActionEvent({
            type,
            data: {
                error: createValidResultError({
                    kind: "runtime",
                    code: "runtime_error"
                })
            }
        });
    }

    if (type === "action.timeout") {
        return createValidActionEvent({
            type,
            data: {
                error: createValidResultError({
                    kind: "timeout",
                    code: "timeout_error"
                })
            }
        });
    }

    if (type === "action.cancelled") {
        return createValidActionEvent({
            type,
            data: {
                cancellationReason: " Prompt canceled "
            }
        });
    }

    if (type === "action.policyDenied") {
        return createValidActionEvent({
            type,
            data: {
                policyReason: " approval_required "
            }
        });
    }

    return createValidActionEvent({ type });
}

function testActionEventValidCases() {
    for (const eventType of ACTION_EVENT_TYPES) {
        const result = validateActionEvent(createValidEventForType(eventType));
        assert(result.ok, `${eventType} should pass: ${JSON.stringify(result.errors)}`);
        assert(result.value.type === eventType, `${eventType} should normalize type`);
    }

    const event = createValidActionEvent();
    const result = validateActionEvent(event);

    assert(result.ok, `valid action event should pass: ${JSON.stringify(result.errors)}`);
    assert(result.value !== event, "normalized action event should be a copy");
    assert(result.value.eventId === "evt_123", "action event eventId should be trimmed");
    assert(result.value.actionId === "act_123", "action event actionId should be trimmed");
    assert(result.value.runId === "run_456", "action event runId should be trimmed");

    const normalized = normalizeActionEvent(event);
    assert(normalized.eventId === "evt_123", "normalizeActionEvent should trim eventId");
    assert(event.eventId === " evt_123 ", "normalizeActionEvent should not mutate caller input");

    const asserted = assertActionEvent(event);
    assert(asserted.type === "action.started", "assertActionEvent should return normalized event");

    const created = createActionEvent(event);
    assert(created.capability === "text.generate", "createActionEvent should return normalized event");

    ok("valid action event contract passed");
}

function testActionEventErrorReporting() {
    const failed = validateActionEvent(createValidActionEvent({
        type: "action.failed",
        data: {
            error: createValidResultError({
                kind: "runtime",
                code: "runtime_error"
            })
        }
    }));
    assert(failed.ok, `failed action event with error should pass: ${JSON.stringify(failed.errors)}`);

    const timeoutWithReason = validateActionEvent(createValidActionEvent({
        type: "action.timeout",
        data: {
            cancellationReason: " Native operation timeout "
        }
    }));
    assert(timeoutWithReason.ok, `timeout event with cancellationReason should pass: ${JSON.stringify(timeoutWithReason.errors)}`);
    assert(timeoutWithReason.value.data.cancellationReason === "Native operation timeout", "event cancellationReason should be trimmed");

    const cancelledWithError = validateActionEvent(createValidActionEvent({
        type: "action.cancelled",
        data: {
            error: createValidResultError({
                kind: "cancellation",
                code: "prompt_cancelled"
            })
        }
    }));
    assert(cancelledWithError.ok, `cancelled event with error should pass: ${JSON.stringify(cancelledWithError.errors)}`);

    const policyDeniedWithError = validateActionEvent(createValidActionEvent({
        type: "action.policyDenied",
        data: {
            error: createValidResultError({
                kind: "policy",
                code: "policy_denied"
            })
        }
    }));
    assert(policyDeniedWithError.ok, `policy denied event with error should pass: ${JSON.stringify(policyDeniedWithError.errors)}`);

    const failedWithoutError = validateActionEvent(createValidActionEvent({
        type: "action.failed",
        data: {}
    }));
    assert(!failedWithoutError.ok, "failed event without error should reject");
    assertErrorCode(failedWithoutError, "missing_failed_event_error", "failed event without error");

    const timeoutWithoutError = validateActionEvent(createValidActionEvent({
        type: "action.timeout",
        data: {}
    }));
    assert(!timeoutWithoutError.ok, "timeout event without error or reason should reject");
    assertErrorCode(timeoutWithoutError, "missing_timeout_event_error", "timeout event without error");

    const cancelledWithoutReason = validateActionEvent(createValidActionEvent({
        type: "action.cancelled",
        data: {}
    }));
    assert(!cancelledWithoutReason.ok, "cancelled event without reason or error should reject");
    assertErrorCode(cancelledWithoutReason, "missing_cancelled_event_reason", "cancelled event without reason");

    const policyDeniedWithoutReason = validateActionEvent(createValidActionEvent({
        type: "action.policyDenied",
        data: {}
    }));
    assert(!policyDeniedWithoutReason.ok, "policy denied event without reason or error should reject");
    assertErrorCode(policyDeniedWithoutReason, "missing_policy_denied_event_reason", "policy denied event without reason");

    const invalidNestedError = validateActionEvent(createValidActionEvent({
        type: "action.failed",
        data: {
            error: {
                message: "failed",
                code: "bad code",
                kind: "runtime"
            }
        }
    }));
    assert(!invalidNestedError.ok, "invalid nested event error should reject");
    assertErrorCode(invalidNestedError, "invalid_error_code", "invalid nested event error");

    ok("action event error-reporting contract passed");
}

function testActionEventRejects() {
    const invalidRoot = validateActionEvent(null);
    assert(!invalidRoot.ok, "null action event should reject");
    assertErrorCode(invalidRoot, "invalid_action_event", "null action event");

    const missing = validateActionEvent({});
    assert(!missing.ok, "missing event required fields should reject");
    assertErrorCode(missing, "missing_event_id", "missing eventId");
    assertErrorCode(missing, "missing_action_id", "missing event actionId");
    assertErrorCode(missing, "missing_event_type", "missing event type");
    assertErrorCode(missing, "invalid_timestamp", "missing timestamp");

    const unknownType = validateActionEvent(createValidActionEvent({
        type: "action.unknown"
    }));
    assert(!unknownType.ok, "unknown event type should reject");
    assertErrorCode(unknownType, "unknown_event_type", "unknown event type");

    const invalidTimestamp = validateActionEvent(createValidActionEvent({
        timestamp: -1
    }));
    assert(!invalidTimestamp.ok, "negative timestamp should reject");
    assertErrorCode(invalidTimestamp, "invalid_timestamp", "negative timestamp");

    const invalidData = validateActionEvent(createValidActionEvent({
        data: []
    }));
    assert(!invalidData.ok, "array event data should reject");
    assertErrorCode(invalidData, "invalid_event_data", "array event data");

    const unknownCapability = validateActionEvent(createValidActionEvent({
        capability: "text.foo"
    }));
    assert(!unknownCapability.ok, "unknown event capability should reject");
    assertErrorCode(unknownCapability, "unknown_capability", "unknown event capability");

    const invalidSequence = validateActionEvent(createValidActionEvent({
        sequence: Number.NaN
    }));
    assert(!invalidSequence.ok, "invalid event sequence should reject");
    assertErrorCode(invalidSequence, "invalid_number_field", "invalid event sequence");

    ok("action event rejection contract passed");
}

function testActionEventForbiddenKeys() {
    const withModelPath = validateActionEvent(createValidActionEvent({
        data: {
            modelPath: "../../../base/model.gguf"
        }
    }));
    assert(!withModelPath.ok, "modelPath key should reject in action event");
    assertErrorCode(withModelPath, "forbidden_action_event_key", "action event modelPath key");

    const withCommand = validateActionEvent(createValidActionEvent({
        data: {
            toolProcess: {
                command: "node"
            }
        }
    }));
    assert(!withCommand.ok, "tool process command keys should reject in action event");
    assertErrorCode(withCommand, "forbidden_action_event_key", "action event command key");

    ok("action event forbidden-key guard passed");
}

async function main() {
    console.log("[SMOKE] action envelope contract");

    testTaxonomy();
    testValidationHelpers();
    testContextRefs();
    testActionEnvelopeValidCase();
    testActionEnvelopeRequiredFields();
    testActionEnvelopeKnownTaxonomy();
    testActionEnvelopeContextRefs();
    testActionEnvelopeForbiddenKeys();
    testActionEnvelopeOptionalSections();
    testResultErrors();
    testResultEnvelopeValidCase();
    testResultEnvelopeStatusSemantics();
    testResultEnvelopeRejects();
    testResultEnvelopeForbiddenKeys();
    testActionEventValidCases();
    testActionEventErrorReporting();
    testActionEventRejects();
    testActionEventForbiddenKeys();
    await assertNoRuntimeWiringImports();

    console.log("\nAll action envelope contract smoke checks finished.");
}

main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
});
