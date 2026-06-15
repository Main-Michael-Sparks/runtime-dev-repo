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
    isKnownActionStatus,
    isKnownCapability
} from "./capabilityTaxonomy.mjs";
import {
    normalizeContextRefs,
    validateContextRefs
} from "./contextRefs.mjs";

export const RESULT_ERROR_KINDS = Object.freeze([
    "validation",
    "policy",
    "runtime",
    "backend",
    "timeout",
    "cancellation",
    "unknown"
]);

const RESULT_ERROR_KIND_SET = new Set(RESULT_ERROR_KINDS);

const FORBIDDEN_RESULT_ENVELOPE_KEYS = new Set([
    "modelPath",
    "baseModel",
    "mmprojPath",
    "projectorPath",
    "backendAdapter",
    "backendOptions",
    "adapterArgs",
    "rawBackendPayload",
    "toolProcess",
    "command",
    "shell",
    "exec"
]);

function isSnakeCaseString(value) {
    return typeof value === "string" && /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/.test(value.trim());
}

function hasValidResultErrorKind(value) {
    return RESULT_ERROR_KIND_SET.has(value);
}

function addForbiddenKeyErrors(errors, envelope) {
    const found = collectForbiddenKeys(envelope, FORBIDDEN_RESULT_ENVELOPE_KEYS);

    for (const entry of found) {
        errors.push(createValidationError(
            entry.path,
            "forbidden_result_envelope_key",
            `Result envelope must not include forbidden key: ${entry.key}`,
            {
                key: entry.key
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

function addOptionalBooleanError(errors, value, path) {
    if (value === undefined) return;

    if (typeof value !== "boolean") {
        errors.push(createValidationError(
            path,
            "invalid_boolean_field",
            `${path} must be a boolean when provided`
        ));
    }
}

function addOptionalNumberError(errors, value, path) {
    if (value === undefined) return;

    if (!isFiniteNonNegativeNumber(value)) {
        errors.push(createValidationError(
            path,
            "invalid_number_field",
            `${path} must be a finite non-negative number when provided`
        ));
    }
}

function addReferenceListErrors(errors, value, path) {
    if (value === undefined) return;

    const result = validateContextRefs(value, path);
    errors.push(...result.errors);
}

function normalizeOptionalRefs(value) {
    if (!Array.isArray(value)) return value;
    return normalizeContextRefs(value);
}

function validateUsage(usage, errors) {
    if (usage === undefined) return;

    if (!isPlainObject(usage)) {
        errors.push(createValidationError(
            "usage",
            "invalid_usage",
            "Result envelope usage must be a plain object when provided"
        ));
        return;
    }

    addOptionalStringError(errors, usage.backend, "usage.backend");
    addOptionalStringError(errors, usage.modelBundle, "usage.modelBundle");
    addOptionalStringError(errors, usage.profile, "usage.profile");
}

function validateWarnings(warnings, errors) {
    if (warnings === undefined) return;

    if (!Array.isArray(warnings)) {
        errors.push(createValidationError(
            "warnings",
            "invalid_warnings",
            "Result envelope warnings must be an array when provided"
        ));
    }
}

function validateTrace(trace, errors) {
    if (trace === undefined) return;

    if (!isPlainObject(trace)) {
        errors.push(createValidationError(
            "trace",
            "invalid_trace",
            "Result envelope trace must be a plain object when provided"
        ));
        return;
    }

    addOptionalNumberError(errors, trace.startedAt, "trace.startedAt");
    addOptionalNumberError(errors, trace.finishedAt, "trace.finishedAt");
    addOptionalNumberError(errors, trace.durationMs, "trace.durationMs");
}

function validateStatusSemantics(envelope, errors) {
    if (envelope.status === "completed") {
        if (envelope.result === undefined && envelope.partial !== true) {
            errors.push(createValidationError(
                "result",
                "missing_completed_result",
                "Completed result envelopes must include result unless partial is true"
            ));
        }
        return;
    }

    if (envelope.status === "failed" && envelope.error === undefined) {
        errors.push(createValidationError(
            "error",
            "missing_failed_error",
            "Failed result envelopes must include error"
        ));
        return;
    }

    if (
        envelope.status === "timeout" &&
        envelope.error === undefined &&
        envelope.cancellationReason === undefined
    ) {
        errors.push(createValidationError(
            "error",
            "missing_timeout_error",
            "Timeout result envelopes must include error or cancellationReason"
        ));
        return;
    }

    if (
        envelope.status === "cancelled" &&
        envelope.error === undefined &&
        envelope.cancellationReason === undefined
    ) {
        errors.push(createValidationError(
            "cancellationReason",
            "missing_cancellation_reason",
            "Cancelled result envelopes must include cancellationReason or error"
        ));
        return;
    }

    if (
        envelope.status === "policy_denied" &&
        envelope.error === undefined &&
        envelope.policyReason === undefined
    ) {
        errors.push(createValidationError(
            "error",
            "missing_policy_denied_error",
            "Policy-denied result envelopes must include error or policyReason"
        ));
    }
}

export function createResultError(fields = {}) {
    return {
        message: typeof fields.message === "string" ? fields.message.trim() : fields.message,
        code: typeof fields.code === "string" ? fields.code.trim() : fields.code,
        kind: typeof fields.kind === "string" ? fields.kind.trim() : fields.kind,
        retryable: fields.retryable === undefined ? false : fields.retryable,
        details: isPlainObject(fields.details) ? { ...fields.details } : fields.details,
        ...(fields.causeCode === undefined
            ? {}
            : {
                  causeCode: typeof fields.causeCode === "string"
                      ? fields.causeCode.trim()
                      : fields.causeCode
              })
    };
}

export function validateResultError(error) {
    const errors = [];

    if (!isPlainObject(error)) {
        return createValidationResult([
            createValidationError(
                "",
                "invalid_result_error",
                "Result error must be a plain object"
            )
        ]);
    }

    if (!isNonEmptyString(error.message)) {
        errors.push(createValidationError(
            "message",
            "missing_error_message",
            "Result error message must be a non-empty string"
        ));
    }

    if (!isSnakeCaseString(error.code)) {
        errors.push(createValidationError(
            "code",
            "invalid_error_code",
            "Result error code must be a non-empty snake_case string"
        ));
    }

    if (!isNonEmptyString(error.kind)) {
        errors.push(createValidationError(
            "kind",
            "missing_error_kind",
            "Result error kind must be a non-empty string"
        ));
    } else if (!hasValidResultErrorKind(error.kind)) {
        errors.push(createValidationError(
            "kind",
            "unknown_error_kind",
            `Unknown result error kind: ${error.kind}`,
            {
                kind: error.kind
            }
        ));
    }

    if (error.retryable !== undefined && typeof error.retryable !== "boolean") {
        errors.push(createValidationError(
            "retryable",
            "invalid_error_retryable",
            "Result error retryable must be a boolean when provided"
        ));
    }

    if (error.details !== undefined && !isPlainObject(error.details)) {
        errors.push(createValidationError(
            "details",
            "invalid_error_details",
            "Result error details must be a plain object when provided"
        ));
    }

    if (error.causeCode !== undefined && !isNonEmptyString(error.causeCode)) {
        errors.push(createValidationError(
            "causeCode",
            "invalid_error_cause_code",
            "Result error causeCode must be a non-empty string when provided"
        ));
    }

    return createValidationResult(
        errors,
        errors.length === 0 ? createResultError(error) : null
    );
}

export function assertResultError(error) {
    return assertValidation(
        validateResultError(error),
        "Result error validation failed"
    );
}

export function normalizeResultEnvelope(envelope) {
    return {
        ...envelope,
        actionId: typeof envelope?.actionId === "string" ? envelope.actionId.trim() : envelope?.actionId,
        runId: typeof envelope?.runId === "string" ? envelope.runId.trim() : envelope?.runId,
        capability: typeof envelope?.capability === "string"
            ? envelope.capability.trim()
            : envelope?.capability,
        status: typeof envelope?.status === "string" ? envelope.status.trim() : envelope?.status,
        result: isPlainObject(envelope?.result) ? { ...envelope.result } : envelope?.result,
        error: isPlainObject(envelope?.error) ? createResultError(envelope.error) : envelope?.error,
        usage: isPlainObject(envelope?.usage) ? { ...envelope.usage } : envelope?.usage,
        warnings: Array.isArray(envelope?.warnings) ? [...envelope.warnings] : envelope?.warnings,
        trace: isPlainObject(envelope?.trace) ? { ...envelope.trace } : envelope?.trace,
        outputRefs: normalizeOptionalRefs(envelope?.outputRefs),
        artifactRefs: normalizeOptionalRefs(envelope?.artifactRefs),
        cancellationReason: typeof envelope?.cancellationReason === "string"
            ? envelope.cancellationReason.trim()
            : envelope?.cancellationReason,
        policyReason: typeof envelope?.policyReason === "string"
            ? envelope.policyReason.trim()
            : envelope?.policyReason
    };
}

export function validateResultEnvelope(envelope) {
    const errors = [];

    if (!isPlainObject(envelope)) {
        return createValidationResult([
            createValidationError(
                "",
                "invalid_result_envelope",
                "Result envelope must be a plain object"
            )
        ]);
    }

    addForbiddenKeyErrors(errors, envelope);

    if (!isNonEmptyString(envelope.actionId)) {
        errors.push(createValidationError(
            "actionId",
            "missing_action_id",
            "Result envelope actionId must be a non-empty string"
        ));
    }

    if (envelope.runId !== undefined && !isNonEmptyString(envelope.runId)) {
        errors.push(createValidationError(
            "runId",
            "invalid_run_id",
            "Result envelope runId must be a non-empty string when provided"
        ));
    }

    if (!isNonEmptyString(envelope.capability)) {
        errors.push(createValidationError(
            "capability",
            "missing_capability",
            "Result envelope capability must be a non-empty string"
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

    if (!isNonEmptyString(envelope.status)) {
        errors.push(createValidationError(
            "status",
            "missing_status",
            "Result envelope status must be a non-empty string"
        ));
    } else if (!isKnownActionStatus(envelope.status)) {
        errors.push(createValidationError(
            "status",
            "unknown_status",
            `Unknown result envelope status: ${envelope.status}`,
            {
                status: envelope.status
            }
        ));
    }

    if (envelope.result !== undefined && !isPlainObject(envelope.result)) {
        errors.push(createValidationError(
            "result",
            "invalid_result",
            "Result envelope result must be a plain object when provided"
        ));
    }

    if (envelope.error !== undefined) {
        const errorResult = validateResultError(envelope.error);
        errors.push(...errorResult.errors.map((error) => ({
            ...error,
            path: error.path ? `error.${error.path}` : "error"
        })));
    }

    validateUsage(envelope.usage, errors);
    validateWarnings(envelope.warnings, errors);
    validateTrace(envelope.trace, errors);
    addReferenceListErrors(errors, envelope.outputRefs, "outputRefs");
    addReferenceListErrors(errors, envelope.artifactRefs, "artifactRefs");
    addOptionalBooleanError(errors, envelope.partial, "partial");
    addOptionalBooleanError(errors, envelope.retryable, "retryable");
    addOptionalStringError(errors, envelope.cancellationReason, "cancellationReason");
    addOptionalStringError(errors, envelope.policyReason, "policyReason");
    validateStatusSemantics(envelope, errors);

    return createValidationResult(
        errors,
        errors.length === 0 ? normalizeResultEnvelope(envelope) : null
    );
}

export function assertResultEnvelope(envelope) {
    return assertValidation(
        validateResultEnvelope(envelope),
        "Result envelope validation failed"
    );
}

export function createResultEnvelope(fields = {}) {
    return assertResultEnvelope(fields);
}
