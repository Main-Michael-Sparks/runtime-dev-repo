import {
    assertValidation,
    collectForbiddenKeys,
    createValidationError,
    createValidationResult,
    isFiniteNonNegativeNumber,
    isNonEmptyString,
    isPlainObject
} from "./contractValidation.mjs";
import {
    isKnownActionSourceKind,
    isKnownCapability
} from "./capabilityTaxonomy.mjs";
import {
    normalizeContextRefs,
    validateContextRefs
} from "./contextRefs.mjs";

const FORBIDDEN_ACTION_ENVELOPE_KEYS = new Set([
    "modelPath",
    "baseModel",
    "mmprojPath",
    "projectorPath",
    "backend",
    "backendAdapter",
    "backendOptions",
    "adapterArgs",
    "rawBackendPayload",
    "toolProcess",
    "command",
    "shell",
    "exec"
]);

const REQUIREMENT_FIELDS = new Set([
    "modelClass",
    "contextNeed",
    "stream",
    "timeoutMs"
]);

const POLICY_FIELDS = new Set([
    "maxTokens",
    "approvalRequired",
    "allowTools",
    "budget"
]);

const TRACE_FIELDS = new Set([
    "parentActionId",
    "parentNodeId",
    "operator",
    "correlationId"
]);

function addForbiddenKeyErrors(errors, envelope) {
    const found = collectForbiddenKeys(envelope, FORBIDDEN_ACTION_ENVELOPE_KEYS);

    for (const entry of found) {
        errors.push(createValidationError(
            entry.path,
            "forbidden_action_envelope_key",
            `Action envelope must not include forbidden key: ${entry.key}`,
            {
                key: entry.key
            }
        ));
    }
}

function addUnknownFieldErrors(errors, objectValue, allowedFields, path, code) {
    if (!isPlainObject(objectValue)) return;

    for (const key of Object.keys(objectValue)) {
        if (allowedFields.has(key)) continue;

        errors.push(createValidationError(
            path ? `${path}.${key}` : key,
            code,
            `Unsupported field for ${path || "object"}: ${key}`,
            {
                key
            }
        ));
    }
}

function addOptionalStringError(errors, value, path) {
    if (value === undefined) return;

    if (!isNonEmptyString(value)) {
        errors.push(createValidationError(
            path,
            "invalid_string_field",
            `${path} must be a non-empty string when provided`
        ));
    }
}

function validateSource(source, errors) {
    if (!isPlainObject(source)) {
        errors.push(createValidationError(
            "source",
            "invalid_source",
            "Action envelope source must be a plain object"
        ));
        return;
    }

    if (!isNonEmptyString(source.kind)) {
        errors.push(createValidationError(
            "source.kind",
            "missing_source_kind",
            "Action envelope source.kind must be a non-empty string"
        ));
        return;
    }

    if (!isKnownActionSourceKind(source.kind)) {
        errors.push(createValidationError(
            "source.kind",
            "unknown_source_kind",
            `Unknown action source kind: ${source.kind}`,
            {
                sourceKind: source.kind
            }
        ));
    }
}

function validateInput(input, errors) {
    if (!isPlainObject(input)) {
        errors.push(createValidationError(
            "input",
            "invalid_input",
            "Action envelope input must be a plain object"
        ));
        return;
    }

    if (input.contextRefs !== undefined) {
        const contextResult = validateContextRefs(input.contextRefs, "input.contextRefs");
        errors.push(...contextResult.errors);
    }
}

function validateRequirements(requirements, errors) {
    if (requirements === undefined) return;

    if (!isPlainObject(requirements)) {
        errors.push(createValidationError(
            "requirements",
            "invalid_requirements",
            "Action envelope requirements must be a plain object when provided"
        ));
        return;
    }

    addUnknownFieldErrors(
        errors,
        requirements,
        REQUIREMENT_FIELDS,
        "requirements",
        "unknown_requirement_field"
    );

    addOptionalStringError(errors, requirements.modelClass, "requirements.modelClass");
    addOptionalStringError(errors, requirements.contextNeed, "requirements.contextNeed");

    if (requirements.stream !== undefined && typeof requirements.stream !== "boolean") {
        errors.push(createValidationError(
            "requirements.stream",
            "invalid_stream_requirement",
            "requirements.stream must be a boolean when provided"
        ));
    }

    if (
        requirements.timeoutMs !== undefined &&
        !isFiniteNonNegativeNumber(requirements.timeoutMs)
    ) {
        errors.push(createValidationError(
            "requirements.timeoutMs",
            "invalid_timeout_ms",
            "requirements.timeoutMs must be a finite non-negative number when provided"
        ));
    }
}

function validatePolicy(policy, errors) {
    if (policy === undefined) return;

    if (!isPlainObject(policy)) {
        errors.push(createValidationError(
            "policy",
            "invalid_policy",
            "Action envelope policy must be a plain object when provided"
        ));
        return;
    }

    addUnknownFieldErrors(
        errors,
        policy,
        POLICY_FIELDS,
        "policy",
        "unknown_policy_field"
    );

    if (policy.maxTokens !== undefined && !isFiniteNonNegativeNumber(policy.maxTokens)) {
        errors.push(createValidationError(
            "policy.maxTokens",
            "invalid_max_tokens",
            "policy.maxTokens must be a finite non-negative number when provided"
        ));
    }

    if (
        policy.approvalRequired !== undefined &&
        typeof policy.approvalRequired !== "boolean"
    ) {
        errors.push(createValidationError(
            "policy.approvalRequired",
            "invalid_approval_required",
            "policy.approvalRequired must be a boolean when provided"
        ));
    }

    if (policy.allowTools !== undefined && typeof policy.allowTools !== "boolean") {
        errors.push(createValidationError(
            "policy.allowTools",
            "invalid_allow_tools",
            "policy.allowTools must be a boolean when provided"
        ));
    }

    if (policy.budget !== undefined && !isPlainObject(policy.budget)) {
        errors.push(createValidationError(
            "policy.budget",
            "invalid_budget",
            "policy.budget must be a plain object when provided"
        ));
    }
}

function validateTrace(trace, errors) {
    if (trace === undefined) return;

    if (!isPlainObject(trace)) {
        errors.push(createValidationError(
            "trace",
            "invalid_trace",
            "Action envelope trace must be a plain object when provided"
        ));
        return;
    }

    addUnknownFieldErrors(
        errors,
        trace,
        TRACE_FIELDS,
        "trace",
        "unknown_trace_field"
    );

    if (trace.parentActionId !== undefined && trace.parentActionId !== null) {
        addOptionalStringError(errors, trace.parentActionId, "trace.parentActionId");
    }

    addOptionalStringError(errors, trace.parentNodeId, "trace.parentNodeId");
    addOptionalStringError(errors, trace.operator, "trace.operator");
    addOptionalStringError(errors, trace.correlationId, "trace.correlationId");
}

export function normalizeActionEnvelope(envelope) {
    const input = isPlainObject(envelope?.input) ? { ...envelope.input } : envelope?.input;

    if (isPlainObject(input) && input.contextRefs !== undefined && Array.isArray(input.contextRefs)) {
        input.contextRefs = normalizeContextRefs(input.contextRefs);
    }

    return {
        ...envelope,
        actionId: typeof envelope?.actionId === "string" ? envelope.actionId.trim() : envelope?.actionId,
        runId: typeof envelope?.runId === "string" ? envelope.runId.trim() : envelope?.runId,
        source: isPlainObject(envelope?.source)
            ? {
                  ...envelope.source,
                  kind: typeof envelope.source.kind === "string"
                      ? envelope.source.kind.trim()
                      : envelope.source.kind
              }
            : envelope?.source,
        capability: typeof envelope?.capability === "string"
            ? envelope.capability.trim()
            : envelope?.capability,
        intent: typeof envelope?.intent === "string" ? envelope.intent.trim() : envelope?.intent,
        input,
        requirements: isPlainObject(envelope?.requirements)
            ? { ...envelope.requirements }
            : envelope?.requirements,
        policy: isPlainObject(envelope?.policy) ? { ...envelope.policy } : envelope?.policy,
        trace: isPlainObject(envelope?.trace) ? { ...envelope.trace } : envelope?.trace
    };
}

export function validateActionEnvelope(envelope) {
    const errors = [];

    if (!isPlainObject(envelope)) {
        return createValidationResult([
            createValidationError(
                "",
                "invalid_action_envelope",
                "Action envelope must be a plain object"
            )
        ]);
    }

    addForbiddenKeyErrors(errors, envelope);

    if (!isNonEmptyString(envelope.actionId)) {
        errors.push(createValidationError(
            "actionId",
            "missing_action_id",
            "Action envelope actionId must be a non-empty string"
        ));
    }

    if (envelope.runId !== undefined && !isNonEmptyString(envelope.runId)) {
        errors.push(createValidationError(
            "runId",
            "invalid_run_id",
            "Action envelope runId must be a non-empty string when provided"
        ));
    }

    validateSource(envelope.source, errors);

    if (!isNonEmptyString(envelope.capability)) {
        errors.push(createValidationError(
            "capability",
            "missing_capability",
            "Action envelope capability must be a non-empty string"
        ));
    } else if (!isKnownCapability(envelope.capability)) {
        errors.push(createValidationError(
            "capability",
            "unknown_capability",
            `Unknown capability: ${envelope.capability}`,
            {
                capability: envelope.capability
            }
        ));
    }

    if (!isNonEmptyString(envelope.intent)) {
        errors.push(createValidationError(
            "intent",
            "missing_intent",
            "Action envelope intent must be a non-empty string"
        ));
    }

    validateInput(envelope.input, errors);
    validateRequirements(envelope.requirements, errors);
    validatePolicy(envelope.policy, errors);
    validateTrace(envelope.trace, errors);

    return createValidationResult(
        errors,
        errors.length === 0 ? normalizeActionEnvelope(envelope) : null
    );
}

export function assertActionEnvelope(envelope) {
    return assertValidation(
        validateActionEnvelope(envelope),
        "Action envelope validation failed"
    );
}
