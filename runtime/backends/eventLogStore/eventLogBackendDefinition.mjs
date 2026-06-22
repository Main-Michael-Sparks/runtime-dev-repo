import {
    assertValidation,
    createValidationError,
    createValidationResult,
    isPlainObject
} from "../../bus/contractValidation.mjs";
import {
    ACTION_EVENT_LOG_STORE_CONTRACT_VERSION
} from "../../bus/actionEventLog/actionEventLogCommon.mjs";
import {
    EVENT_LOG_BACKEND_CONTRACT_VERSION,
    EVENT_LOG_BACKEND_KIND,
    EVENT_LOG_BACKEND_STATUSES,
    addEventLogBackendBooleanValidation,
    addEventLogBackendMetadataStringValidation,
    addForbiddenEventLogBackendKeyErrors,
    addRequiredEventLogBackendStringError,
    addUnknownEventLogBackendFieldErrors,
    copyAndFreezeEventLogBackendValue,
    normalizeOptionalEventLogBackendString
} from "./eventLogBackendCommon.mjs";
import {
    DEFAULT_EVENT_LOG_BACKEND_POLICY,
    assertEventLogBackendPolicy,
    validateEventLogBackendPolicy
} from "./eventLogBackendPolicy.mjs";

const EVENT_LOG_BACKEND_STATUS_SET = new Set(EVENT_LOG_BACKEND_STATUSES);

const EVENT_LOG_BACKEND_DEFINITION_FIELDS = new Set([
    "contractVersion",
    "backendKind",
    "backendId",
    "status",
    "storeContractVersion",
    "summary",
    "capabilities",
    "defaultPolicy"
]);

const EVENT_LOG_BACKEND_CAPABILITY_FIELDS = new Set([
    "append",
    "read",
    "cursorRead",
    "highVolumeEvents",
    "durable"
]);

export const CONTRACT_ONLY_EVENT_LOG_BACKEND_DEFINITION = copyAndFreezeEventLogBackendValue({
    contractVersion: EVENT_LOG_BACKEND_CONTRACT_VERSION,
    backendKind: EVENT_LOG_BACKEND_KIND,
    backendId: "event-log.contract-only",
    status: "contract-only",
    storeContractVersion: ACTION_EVENT_LOG_STORE_CONTRACT_VERSION,
    summary: "Contract-only event-log store backend placeholder.",
    capabilities: {
        append: true,
        read: true,
        cursorRead: true,
        highVolumeEvents: false,
        durable: true
    },
    defaultPolicy: DEFAULT_EVENT_LOG_BACKEND_POLICY
});

export function isKnownEventLogBackendStatus(value) {
    return EVENT_LOG_BACKEND_STATUS_SET.has(value);
}

function normalizeCapabilities(capabilities) {
    if (!isPlainObject(capabilities)) return capabilities;

    return {
        ...capabilities
    };
}

export function copyEventLogBackendDefinition(definition) {
    return copyAndFreezeEventLogBackendValue(definition);
}

export function normalizeEventLogBackendDefinition(definition = CONTRACT_ONLY_EVENT_LOG_BACKEND_DEFINITION) {
    return {
        ...definition,
        contractVersion: normalizeOptionalEventLogBackendString(definition?.contractVersion),
        backendKind: normalizeOptionalEventLogBackendString(definition?.backendKind),
        backendId: normalizeOptionalEventLogBackendString(definition?.backendId),
        status: normalizeOptionalEventLogBackendString(definition?.status),
        storeContractVersion: normalizeOptionalEventLogBackendString(definition?.storeContractVersion),
        summary: normalizeOptionalEventLogBackendString(definition?.summary),
        capabilities: normalizeCapabilities(definition?.capabilities),
        defaultPolicy: definition?.defaultPolicy
    };
}

function validateCapabilities(capabilities, errors) {
    if (!isPlainObject(capabilities)) {
        errors.push(createValidationError(
            "capabilities",
            "invalid_event_log_backend_capabilities",
            "Event-log backend capabilities must be a plain object"
        ));
        return;
    }

    addUnknownEventLogBackendFieldErrors(
        errors,
        capabilities,
        EVENT_LOG_BACKEND_CAPABILITY_FIELDS,
        "capabilities",
        "unknown_event_log_backend_capability_field",
        "event-log backend capabilities"
    );

    for (const key of EVENT_LOG_BACKEND_CAPABILITY_FIELDS) {
        addEventLogBackendBooleanValidation(
            errors,
            capabilities[key],
            `capabilities.${key}`,
            "invalid_event_log_backend_capability_boolean",
            `Event-log backend capabilities.${key}`
        );
    }
}

function addExactStringValidation(errors, value, path, expected, code, label) {
    addRequiredEventLogBackendStringError(errors, value, path, `missing_${code}`, label);

    if (typeof value !== "string" || value.trim().length === 0) return;

    addEventLogBackendMetadataStringValidation(errors, value, path);

    if (value !== expected) {
        errors.push(createValidationError(
            path,
            `invalid_${code}`,
            `${label} must be ${expected}`,
            {
                expected,
                value
            }
        ));
    }
}

export function validateEventLogBackendDefinition(definition = CONTRACT_ONLY_EVENT_LOG_BACKEND_DEFINITION) {
    const errors = [];

    if (!isPlainObject(definition)) {
        return createValidationResult([
            createValidationError(
                "",
                "invalid_event_log_backend_definition",
                "Event-log backend definition must be a plain object"
            )
        ]);
    }

    const normalizedDefinition = normalizeEventLogBackendDefinition(definition);

    addForbiddenEventLogBackendKeyErrors(
        errors,
        definition,
        "forbidden_event_log_backend_definition_key",
        "Event-log backend definition"
    );
    addUnknownEventLogBackendFieldErrors(
        errors,
        definition,
        EVENT_LOG_BACKEND_DEFINITION_FIELDS,
        "",
        "unknown_event_log_backend_definition_field",
        "event-log backend definition"
    );

    addExactStringValidation(
        errors,
        normalizedDefinition.contractVersion,
        "contractVersion",
        EVENT_LOG_BACKEND_CONTRACT_VERSION,
        "event_log_backend_contract_version",
        "Event-log backend contractVersion"
    );
    addExactStringValidation(
        errors,
        normalizedDefinition.backendKind,
        "backendKind",
        EVENT_LOG_BACKEND_KIND,
        "event_log_backend_kind",
        "Event-log backend backendKind"
    );
    addExactStringValidation(
        errors,
        normalizedDefinition.storeContractVersion,
        "storeContractVersion",
        ACTION_EVENT_LOG_STORE_CONTRACT_VERSION,
        "event_log_backend_store_contract_version",
        "Event-log backend storeContractVersion"
    );

    addRequiredEventLogBackendStringError(
        errors,
        normalizedDefinition.backendId,
        "backendId",
        "missing_event_log_backend_id",
        "Event-log backend backendId"
    );
    addEventLogBackendMetadataStringValidation(errors, normalizedDefinition.backendId, "backendId");

    addRequiredEventLogBackendStringError(
        errors,
        normalizedDefinition.summary,
        "summary",
        "missing_event_log_backend_summary",
        "Event-log backend summary"
    );

    if (typeof normalizedDefinition.status !== "string" || normalizedDefinition.status.trim().length === 0) {
        errors.push(createValidationError(
            "status",
            "missing_event_log_backend_status",
            "Event-log backend status must be a non-empty string"
        ));
    } else if (!isKnownEventLogBackendStatus(normalizedDefinition.status)) {
        errors.push(createValidationError(
            "status",
            "unknown_event_log_backend_status",
            `Unknown event-log backend status: ${normalizedDefinition.status}`,
            {
                status: normalizedDefinition.status
            }
        ));
    }

    validateCapabilities(normalizedDefinition.capabilities, errors);

    const policyResult = validateEventLogBackendPolicy(normalizedDefinition.defaultPolicy);
    for (const error of policyResult.errors) {
        errors.push(createValidationError(
            error.path ? `defaultPolicy.${error.path}` : "defaultPolicy",
            error.code,
            error.message,
            error.details
        ));
    }

    return createValidationResult(
        errors,
        errors.length === 0
            ? copyEventLogBackendDefinition({
                  ...normalizedDefinition,
                  defaultPolicy: policyResult.value
              })
            : null
    );
}

export function assertEventLogBackendDefinition(definition = CONTRACT_ONLY_EVENT_LOG_BACKEND_DEFINITION) {
    return assertValidation(
        validateEventLogBackendDefinition(definition),
        "Event-log backend definition validation failed"
    );
}

export function createEventLogBackendDefinition(overrides = {}) {
    const definition = {
        ...CONTRACT_ONLY_EVENT_LOG_BACKEND_DEFINITION,
        ...overrides,
        capabilities: {
            ...CONTRACT_ONLY_EVENT_LOG_BACKEND_DEFINITION.capabilities,
            ...(isPlainObject(overrides.capabilities) ? overrides.capabilities : {})
        },
        defaultPolicy: overrides.defaultPolicy === undefined
            ? DEFAULT_EVENT_LOG_BACKEND_POLICY
            : assertEventLogBackendPolicy(overrides.defaultPolicy)
    };

    return assertEventLogBackendDefinition(definition);
}
