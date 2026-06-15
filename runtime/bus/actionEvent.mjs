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
    isKnownActionEventType,
    isKnownCapability
} from "./capabilityTaxonomy.mjs";
import {
    createResultError,
    validateResultError
} from "./resultEnvelope.mjs";

const FORBIDDEN_ACTION_EVENT_KEYS = new Set([
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

function addForbiddenKeyErrors(errors, event) {
    const found = collectForbiddenKeys(event, FORBIDDEN_ACTION_EVENT_KEYS);

    for (const entry of found) {
        errors.push(createValidationError(
            entry.path,
            "forbidden_action_event_key",
            `Action event must not include forbidden key: ${entry.key}`,
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

function addNestedResultErrorErrors(errors, errorValue) {
    if (errorValue === undefined) return;

    const result = validateResultError(errorValue);

    for (const error of result.errors) {
        errors.push({
            ...error,
            path: error.path ? `data.error.${error.path}` : "data.error"
        });
    }
}

function hasEventErrorData(data) {
    return data?.error !== undefined;
}

function hasCancellationReasonData(data) {
    return isNonEmptyString(data?.cancellationReason);
}

function hasPolicyReasonData(data) {
    return isNonEmptyString(data?.policyReason);
}

function validateEventDataFields(event, data, errors) {
    if (data === undefined) return;

    if (!isPlainObject(data)) {
        errors.push(createValidationError(
            "data",
            "invalid_event_data",
            "Action event data must be a plain object when provided"
        ));
        return;
    }

    addNestedResultErrorErrors(errors, data.error);
    addOptionalStringError(errors, data.cancellationReason, "data.cancellationReason");
    addOptionalStringError(errors, data.policyReason, "data.policyReason");

    if (event.type === "action.failed" && !hasEventErrorData(data)) {
        errors.push(createValidationError(
            "data.error",
            "missing_failed_event_error",
            "action.failed events must include data.error"
        ));
        return;
    }

    if (
        event.type === "action.timeout" &&
        !hasEventErrorData(data) &&
        !hasCancellationReasonData(data)
    ) {
        errors.push(createValidationError(
            "data.error",
            "missing_timeout_event_error",
            "action.timeout events must include data.error or data.cancellationReason"
        ));
        return;
    }

    if (
        event.type === "action.cancelled" &&
        !hasEventErrorData(data) &&
        !hasCancellationReasonData(data)
    ) {
        errors.push(createValidationError(
            "data.cancellationReason",
            "missing_cancelled_event_reason",
            "action.cancelled events must include data.cancellationReason or data.error"
        ));
        return;
    }

    if (
        event.type === "action.policyDenied" &&
        !hasEventErrorData(data) &&
        !hasPolicyReasonData(data)
    ) {
        errors.push(createValidationError(
            "data.error",
            "missing_policy_denied_event_reason",
            "action.policyDenied events must include data.error or data.policyReason"
        ));
    }
}

function validateStatusSpecificData(event, errors) {
    const data = event.data;

    if (
        event.type === "action.failed" ||
        event.type === "action.timeout" ||
        event.type === "action.cancelled" ||
        event.type === "action.policyDenied"
    ) {
        if (!isPlainObject(data)) {
            errors.push(createValidationError(
                "data",
                "missing_event_error_data",
                `${event.type} events must include data with error reporting fields`
            ));
            return;
        }
    }

    validateEventDataFields(event, data, errors);
}

export function normalizeActionEvent(event) {
    const normalizedData = isPlainObject(event?.data)
        ? {
              ...event.data,
              error: isPlainObject(event.data.error)
                  ? createResultError(event.data.error)
                  : event.data.error,
              cancellationReason: typeof event.data.cancellationReason === "string"
                  ? event.data.cancellationReason.trim()
                  : event.data.cancellationReason,
              policyReason: typeof event.data.policyReason === "string"
                  ? event.data.policyReason.trim()
                  : event.data.policyReason
          }
        : event?.data;

    return {
        ...event,
        eventId: typeof event?.eventId === "string" ? event.eventId.trim() : event?.eventId,
        actionId: typeof event?.actionId === "string" ? event.actionId.trim() : event?.actionId,
        runId: typeof event?.runId === "string" ? event.runId.trim() : event?.runId,
        type: typeof event?.type === "string" ? event.type.trim() : event?.type,
        capability: typeof event?.capability === "string"
            ? event.capability.trim()
            : event?.capability,
        data: normalizedData
    };
}

export function validateActionEvent(event) {
    const errors = [];

    if (!isPlainObject(event)) {
        return createValidationResult([
            createValidationError(
                "",
                "invalid_action_event",
                "Action event must be a plain object"
            )
        ]);
    }

    addForbiddenKeyErrors(errors, event);

    if (!isNonEmptyString(event.eventId)) {
        errors.push(createValidationError(
            "eventId",
            "missing_event_id",
            "Action event eventId must be a non-empty string"
        ));
    }

    if (!isNonEmptyString(event.actionId)) {
        errors.push(createValidationError(
            "actionId",
            "missing_action_id",
            "Action event actionId must be a non-empty string"
        ));
    }

    if (event.runId !== undefined && !isNonEmptyString(event.runId)) {
        errors.push(createValidationError(
            "runId",
            "invalid_run_id",
            "Action event runId must be a non-empty string when provided"
        ));
    }

    if (!isNonEmptyString(event.type)) {
        errors.push(createValidationError(
            "type",
            "missing_event_type",
            "Action event type must be a non-empty string"
        ));
    } else if (!isKnownActionEventType(event.type)) {
        errors.push(createValidationError(
            "type",
            "unknown_event_type",
            `Unknown action event type: ${event.type}`,
            {
                eventType: event.type
            }
        ));
    }

    if (event.capability !== undefined) {
        if (!isNonEmptyString(event.capability)) {
            errors.push(createValidationError(
                "capability",
                "invalid_capability",
                "Action event capability must be a non-empty string when provided"
            ));
        } else if (!isKnownCapability(event.capability)) {
            errors.push(createValidationError(
                "capability",
                "unknown_capability",
                `Unknown capability: ${event.capability}`,
                {
                    capability: event.capability
                }
            ));
        }
    }

    if (!isFiniteNonNegativeNumber(event.timestamp)) {
        errors.push(createValidationError(
            "timestamp",
            "invalid_timestamp",
            "Action event timestamp must be a finite non-negative number"
        ));
    }

    addOptionalNumberError(errors, event.sequence, "sequence");
    validateStatusSpecificData(event, errors);

    return createValidationResult(
        errors,
        errors.length === 0 ? normalizeActionEvent(event) : null
    );
}

export function assertActionEvent(event) {
    return assertValidation(
        validateActionEvent(event),
        "Action event validation failed"
    );
}

export function createActionEvent(fields = {}) {
    return assertActionEvent(fields);
}
