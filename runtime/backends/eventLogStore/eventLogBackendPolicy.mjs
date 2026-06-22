import {
    assertValidation,
    createValidationError,
    createValidationResult,
    isPlainObject
} from "../../bus/contractValidation.mjs";
import {
    EVENT_LOG_APPEND_ERROR_SURFACES,
    EVENT_LOG_APPEND_POLICIES,
    EVENT_LOG_RUNTIME_WAIT_MODES,
    addEventLogBackendBooleanValidation,
    addEventLogBackendMetadataStringValidation,
    addForbiddenEventLogBackendKeyErrors,
    addRequiredEventLogBackendStringError,
    addUnknownEventLogBackendFieldErrors,
    copyAndFreezeEventLogBackendValue,
    normalizeOptionalEventLogBackendString
} from "./eventLogBackendCommon.mjs";

const EVENT_LOG_APPEND_POLICY_SET = new Set(EVENT_LOG_APPEND_POLICIES);
const EVENT_LOG_RUNTIME_WAIT_MODE_SET = new Set(EVENT_LOG_RUNTIME_WAIT_MODES);
const EVENT_LOG_APPEND_ERROR_SURFACE_SET = new Set(EVENT_LOG_APPEND_ERROR_SURFACES);

const EVENT_LOG_BACKEND_POLICY_FIELDS = new Set([
    "policyId",
    "appendPolicy",
    "runtimeWaitMode",
    "appendErrorSurface",
    "includeHighVolumeEvents",
    "read"
]);

const EVENT_LOG_BACKEND_READ_POLICY_FIELDS = new Set([
    "durable",
    "cursor",
    "boundedHistoryFallback"
]);

export const DEFAULT_EVENT_LOG_BACKEND_POLICY = copyAndFreezeEventLogBackendValue({
    policyId: "event-log.best-effort.default",
    appendPolicy: "best-effort",
    runtimeWaitMode: "never",
    appendErrorSurface: "observe-only",
    includeHighVolumeEvents: false,
    read: {
        durable: true,
        cursor: true,
        boundedHistoryFallback: false
    }
});

export function isKnownEventLogAppendPolicy(value) {
    return EVENT_LOG_APPEND_POLICY_SET.has(value);
}

export function isKnownEventLogRuntimeWaitMode(value) {
    return EVENT_LOG_RUNTIME_WAIT_MODE_SET.has(value);
}

export function isKnownEventLogAppendErrorSurface(value) {
    return EVENT_LOG_APPEND_ERROR_SURFACE_SET.has(value);
}

function normalizeReadPolicy(read) {
    if (!isPlainObject(read)) return read;

    return {
        ...read
    };
}

export function copyEventLogBackendPolicy(policy) {
    return copyAndFreezeEventLogBackendValue(policy);
}

export function normalizeEventLogBackendPolicy(policy = DEFAULT_EVENT_LOG_BACKEND_POLICY) {
    return {
        ...policy,
        policyId: normalizeOptionalEventLogBackendString(policy?.policyId),
        appendPolicy: normalizeOptionalEventLogBackendString(policy?.appendPolicy),
        runtimeWaitMode: normalizeOptionalEventLogBackendString(policy?.runtimeWaitMode),
        appendErrorSurface: normalizeOptionalEventLogBackendString(policy?.appendErrorSurface),
        read: normalizeReadPolicy(policy?.read)
    };
}

function validateKnownString(errors, value, path, code, label, isKnown) {
    addRequiredEventLogBackendStringError(errors, value, path, `missing_${code}`, label);

    if (typeof value !== "string" || value.trim().length === 0) return;

    addEventLogBackendMetadataStringValidation(errors, value, path);

    if (!isKnown(value)) {
        errors.push(createValidationError(
            path,
            `unknown_${code}`,
            `Unknown ${label}: ${value}`,
            {
                value
            }
        ));
    }
}

function validateReadPolicy(read, errors) {
    if (!isPlainObject(read)) {
        errors.push(createValidationError(
            "read",
            "invalid_event_log_backend_read_policy",
            "Event-log backend read policy must be a plain object"
        ));
        return;
    }

    addUnknownEventLogBackendFieldErrors(
        errors,
        read,
        EVENT_LOG_BACKEND_READ_POLICY_FIELDS,
        "read",
        "unknown_event_log_backend_read_policy_field",
        "event-log backend read policy"
    );

    addEventLogBackendBooleanValidation(
        errors,
        read.durable,
        "read.durable",
        "invalid_event_log_backend_read_policy_boolean",
        "Event-log backend read.durable"
    );
    addEventLogBackendBooleanValidation(
        errors,
        read.cursor,
        "read.cursor",
        "invalid_event_log_backend_read_policy_boolean",
        "Event-log backend read.cursor"
    );
    addEventLogBackendBooleanValidation(
        errors,
        read.boundedHistoryFallback,
        "read.boundedHistoryFallback",
        "invalid_event_log_backend_read_policy_boolean",
        "Event-log backend read.boundedHistoryFallback"
    );
}

export function validateEventLogBackendPolicy(policy = DEFAULT_EVENT_LOG_BACKEND_POLICY) {
    const errors = [];

    if (!isPlainObject(policy)) {
        return createValidationResult([
            createValidationError(
                "",
                "invalid_event_log_backend_policy",
                "Event-log backend policy must be a plain object"
            )
        ]);
    }

    const normalizedPolicy = normalizeEventLogBackendPolicy(policy);

    addForbiddenEventLogBackendKeyErrors(
        errors,
        policy,
        "forbidden_event_log_backend_policy_key",
        "Event-log backend policy"
    );
    addUnknownEventLogBackendFieldErrors(
        errors,
        policy,
        EVENT_LOG_BACKEND_POLICY_FIELDS,
        "",
        "unknown_event_log_backend_policy_field",
        "event-log backend policy"
    );

    addRequiredEventLogBackendStringError(
        errors,
        normalizedPolicy.policyId,
        "policyId",
        "missing_event_log_backend_policy_id",
        "Event-log backend policyId"
    );
    addEventLogBackendMetadataStringValidation(errors, normalizedPolicy.policyId, "policyId");

    validateKnownString(
        errors,
        normalizedPolicy.appendPolicy,
        "appendPolicy",
        "event_log_backend_append_policy",
        "event-log backend append policy",
        isKnownEventLogAppendPolicy
    );
    validateKnownString(
        errors,
        normalizedPolicy.runtimeWaitMode,
        "runtimeWaitMode",
        "event_log_backend_runtime_wait_mode",
        "event-log backend runtime wait mode",
        isKnownEventLogRuntimeWaitMode
    );
    validateKnownString(
        errors,
        normalizedPolicy.appendErrorSurface,
        "appendErrorSurface",
        "event_log_backend_append_error_surface",
        "event-log backend append error surface",
        isKnownEventLogAppendErrorSurface
    );

    addEventLogBackendBooleanValidation(
        errors,
        normalizedPolicy.includeHighVolumeEvents,
        "includeHighVolumeEvents",
        "invalid_event_log_backend_high_volume_policy",
        "Event-log backend includeHighVolumeEvents"
    );
    validateReadPolicy(normalizedPolicy.read, errors);

    return createValidationResult(
        errors,
        errors.length === 0 ? copyEventLogBackendPolicy(normalizedPolicy) : null
    );
}

export function assertEventLogBackendPolicy(policy = DEFAULT_EVENT_LOG_BACKEND_POLICY) {
    return assertValidation(
        validateEventLogBackendPolicy(policy),
        "Event-log backend policy validation failed"
    );
}
