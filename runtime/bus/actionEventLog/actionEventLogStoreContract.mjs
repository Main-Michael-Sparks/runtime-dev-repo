import {
    assertActionEventLogAppendEntry,
    copyActionEventLogEntry,
    normalizeActionEventLogAppendEntry,
    normalizeActionEventLogReadFilter,
    normalizeActionEventLogReadOptions,
    validateActionEventLogAppendEntry,
    validateActionEventLogReadFilter,
    validateActionEventLogReadOptions
} from "./actionEventLogEntry.mjs";
import {
    ACTION_EVENT_LOG_DEFAULT_DURABLE_EVENT_TYPES,
    ACTION_EVENT_LOG_HIGH_VOLUME_EVENT_TYPES,
    ACTION_EVENT_LOG_STORE_CONTRACT_VERSION,
    isDefaultDurableActionEventLogType,
    isHighVolumeActionEventLogType
} from "./actionEventLogCommon.mjs";
import {
    assertActionEvent
} from "../actionEvent.mjs";
import {
    assertValidation,
    createValidationError,
    createValidationResult,
    isFiniteNonNegativeNumber,
    isNonEmptyString,
    isPlainObject
} from "../contractValidation.mjs";

const ADAPTER_KEYS = new Set([
    "contractVersion",
    "adapterId",
    "capabilities",
    "appendEvent",
    "readEvents"
]);

const ADAPTER_CAPABILITY_KEYS = new Set([
    "append",
    "read",
    "cursorRead",
    "highVolumeEvents"
]);

const APPEND_RESULT_KEYS = new Set([
    "accepted",
    "eventId",
    "sequence",
    "logOffset",
    "storedAt"
]);

const READ_RESULT_KEYS = new Set([
    "events",
    "cursor",
    "truncated"
]);

const READ_CURSOR_KEYS = new Set([
    "lastSequence",
    "lastLogOffset"
]);

function cloneValue(value) {
    if (Array.isArray(value)) {
        return value.map((entry) => cloneValue(entry));
    }

    if (isPlainObject(value)) {
        return Object.fromEntries(
            Object.entries(value).map(([key, entry]) => [key, cloneValue(entry)])
        );
    }

    return value;
}

function freezeValue(value) {
    if (Array.isArray(value)) {
        for (const entry of value) {
            freezeValue(entry);
        }

        return Object.freeze(value);
    }

    if (isPlainObject(value)) {
        for (const entry of Object.values(value)) {
            freezeValue(entry);
        }

        return Object.freeze(value);
    }

    return value;
}

function copyAndFreeze(value) {
    return freezeValue(cloneValue(value));
}

function addError(errors, path, code, message, details = null) {
    errors.push(createValidationError(path, code, message, details));
}

function addUnknownKeyErrors(errors, value, allowedKeys, label) {
    for (const key of Object.keys(value)) {
        if (allowedKeys.has(key)) continue;

        addError(
            errors,
            key,
            "invalid_action_event_log_store",
            `Unknown action event log ${label} field: ${key}`,
            { field: key }
        );
    }
}

function normalizeCapabilities(errors, capabilities) {
    if (!isPlainObject(capabilities)) {
        addError(
            errors,
            "capabilities",
            "invalid_action_event_log_store",
            "Action event log store capabilities must be a plain object"
        );
        return null;
    }

    addUnknownKeyErrors(errors, capabilities, ADAPTER_CAPABILITY_KEYS, "capability");

    for (const key of ["append", "read"]) {
        if (capabilities[key] !== true) {
            addError(
                errors,
                `capabilities.${key}`,
                "invalid_action_event_log_store",
                `Action event log store capability ${key} must be true`
            );
        }
    }

    for (const key of ["cursorRead", "highVolumeEvents"]) {
        if (capabilities[key] !== undefined && typeof capabilities[key] !== "boolean") {
            addError(
                errors,
                `capabilities.${key}`,
                "invalid_action_event_log_store",
                `Action event log store capability ${key} must be boolean when provided`
            );
        }
    }

    return copyAndFreeze({
        append: capabilities.append === true,
        read: capabilities.read === true,
        cursorRead: capabilities.cursorRead === true,
        highVolumeEvents: capabilities.highVolumeEvents === true
    });
}

function normalizeNullableSequence(errors, value, path) {
    if (value === null) return null;

    if (!isFiniteNonNegativeNumber(value)) {
        addError(
            errors,
            path,
            "invalid_action_event_log_store",
            `Action event log ${path} must be null or a finite non-negative number`
        );
        return null;
    }

    return value;
}

function normalizeNullableLogOffset(errors, value, path) {
    if (value === null) return null;

    if (!isNonEmptyString(value)) {
        addError(
            errors,
            path,
            "invalid_action_event_log_store",
            `Action event log ${path} must be null or a non-empty string`
        );
        return null;
    }

    return value.trim();
}

function normalizeOptionalSequence(errors, value, path) {
    if (value === undefined) return undefined;

    if (!isFiniteNonNegativeNumber(value)) {
        addError(
            errors,
            path,
            "invalid_action_event_log_store",
            `Action event log ${path} must be a finite non-negative number when provided`
        );
        return undefined;
    }

    return value;
}

function normalizeOptionalLogOffset(errors, value, path) {
    if (value === undefined) return undefined;

    if (!isNonEmptyString(value)) {
        addError(
            errors,
            path,
            "invalid_action_event_log_store",
            `Action event log ${path} must be a non-empty string when provided`
        );
        return undefined;
    }

    return value.trim();
}

export {
    ACTION_EVENT_LOG_DEFAULT_DURABLE_EVENT_TYPES,
    ACTION_EVENT_LOG_HIGH_VOLUME_EVENT_TYPES,
    ACTION_EVENT_LOG_STORE_CONTRACT_VERSION,
    assertActionEventLogAppendEntry,
    copyActionEventLogEntry,
    isDefaultDurableActionEventLogType,
    isHighVolumeActionEventLogType,
    normalizeActionEventLogAppendEntry,
    normalizeActionEventLogReadFilter,
    normalizeActionEventLogReadOptions,
    validateActionEventLogAppendEntry,
    validateActionEventLogReadFilter,
    validateActionEventLogReadOptions
};

export function validateActionEventLogStoreAdapter(adapter) {
    const errors = [];

    if (!isPlainObject(adapter)) {
        addError(
            errors,
            "",
            "invalid_action_event_log_store",
            "Action event log store adapter must be a plain object"
        );
        return createValidationResult(errors);
    }

    addUnknownKeyErrors(errors, adapter, ADAPTER_KEYS, "adapter");

    if (adapter.contractVersion !== ACTION_EVENT_LOG_STORE_CONTRACT_VERSION) {
        addError(
            errors,
            "contractVersion",
            "invalid_action_event_log_store",
            `Action event log store contractVersion must be ${ACTION_EVENT_LOG_STORE_CONTRACT_VERSION}`,
            { contractVersion: adapter.contractVersion }
        );
    }

    if (!isNonEmptyString(adapter.adapterId)) {
        addError(
            errors,
            "adapterId",
            "invalid_action_event_log_store",
            "Action event log store adapterId must be a non-empty string"
        );
    }

    const capabilities = normalizeCapabilities(errors, adapter.capabilities);

    if (typeof adapter.appendEvent !== "function") {
        addError(
            errors,
            "appendEvent",
            "invalid_action_event_log_store",
            "Action event log store adapter must expose appendEvent(entry)"
        );
    }

    if (typeof adapter.readEvents !== "function") {
        addError(
            errors,
            "readEvents",
            "invalid_action_event_log_store",
            "Action event log store adapter must expose readEvents(filter, options)"
        );
    }

    return createValidationResult(
        errors,
        errors.length === 0
            ? Object.freeze({
                  contractVersion: adapter.contractVersion,
                  adapterId: adapter.adapterId.trim(),
                  capabilities,
                  appendEvent: adapter.appendEvent,
                  readEvents: adapter.readEvents
              })
            : null
    );
}

export function assertActionEventLogStoreAdapter(adapter) {
    return assertValidation(
        validateActionEventLogStoreAdapter(adapter),
        "Action event log store adapter validation failed"
    );
}

export function validateActionEventLogAppendResult(result) {
    const errors = [];

    if (!isPlainObject(result)) {
        addError(
            errors,
            "",
            "invalid_action_event_log_store",
            "Action event log append result must be a plain object"
        );
        return createValidationResult(errors);
    }

    addUnknownKeyErrors(errors, result, APPEND_RESULT_KEYS, "append result");

    if (result.accepted !== true) {
        addError(
            errors,
            "accepted",
            "invalid_action_event_log_store",
            "Action event log append result accepted must be true"
        );
    }

    if (!isNonEmptyString(result.eventId)) {
        addError(
            errors,
            "eventId",
            "invalid_action_event_log_store",
            "Action event log append result eventId must be a non-empty string"
        );
    }

    const normalized = {
        accepted: result.accepted === true,
        eventId: isNonEmptyString(result.eventId) ? result.eventId.trim() : result.eventId,
        sequence: normalizeOptionalSequence(errors, result.sequence, "sequence"),
        logOffset: normalizeOptionalLogOffset(errors, result.logOffset, "logOffset"),
        storedAt: normalizeOptionalSequence(errors, result.storedAt, "storedAt")
    };

    return createValidationResult(
        errors,
        errors.length === 0
            ? copyAndFreeze(Object.fromEntries(
                  Object.entries(normalized).filter(([, value]) => value !== undefined)
              ))
            : null
    );
}

export function assertActionEventLogAppendResult(result) {
    return assertValidation(
        validateActionEventLogAppendResult(result),
        "Action event log append result validation failed"
    );
}

export function validateActionEventLogReadResult(result, options = {}) {
    const errors = [];
    const readOptionsResult = validateActionEventLogReadOptions(options);

    for (const error of readOptionsResult.errors) {
        addError(
            errors,
            error.path ? `options.${error.path}` : "options",
            "invalid_action_event_log_store",
            error.message,
            {
                originalCode: error.code
            }
        );
    }

    const normalizedOptions = readOptionsResult.ok
        ? readOptionsResult.value
        : Object.freeze({ includeHighVolumeEvents: false });

    if (!isPlainObject(result)) {
        addError(
            errors,
            "",
            "invalid_action_event_log_store",
            "Action event log read result must be a plain object"
        );
        return createValidationResult(errors);
    }

    addUnknownKeyErrors(errors, result, READ_RESULT_KEYS, "read result");

    if (!Array.isArray(result.events)) {
        addError(
            errors,
            "events",
            "invalid_action_event_log_store",
            "Action event log read result events must be an array"
        );
    }

    if (!isPlainObject(result.cursor)) {
        addError(
            errors,
            "cursor",
            "invalid_action_event_log_store",
            "Action event log read result cursor must be a plain object"
        );
    }

    if (typeof result.truncated !== "boolean") {
        addError(
            errors,
            "truncated",
            "invalid_action_event_log_store",
            "Action event log read result truncated must be boolean"
        );
    }

    const events = [];
    if (Array.isArray(result.events)) {
        for (let index = 0; index < result.events.length; index++) {
            try {
                const event = assertActionEvent(result.events[index]);
                if (
                    isHighVolumeActionEventLogType(event.type) &&
                    normalizedOptions.includeHighVolumeEvents !== true
                ) {
                    addError(
                        errors,
                        `events[${index}].type`,
                        "invalid_action_event_log_store",
                        `Action event log read result excludes high-volume event type by default: ${event.type}`,
                        { type: event.type }
                    );
                }
                events.push(copyAndFreeze(event));
            } catch (err) {
                const validationErrors = Array.isArray(err.validationErrors)
                    ? err.validationErrors
                    : [
                          createValidationError(
                              `events[${index}]`,
                              "invalid_action_event_log_store",
                              err?.message || "Action event log read result event validation failed"
                          )
                      ];

                for (const error of validationErrors) {
                    addError(
                        errors,
                        error.path
                            ? `events[${index}].${error.path}`
                            : `events[${index}]`,
                        "invalid_action_event_log_store",
                        error.message,
                        {
                            originalCode: error.code
                        }
                    );
                }
            }
        }
    }

    let cursor = null;
    if (isPlainObject(result.cursor)) {
        addUnknownKeyErrors(errors, result.cursor, READ_CURSOR_KEYS, "cursor");
        cursor = {
            lastSequence: normalizeNullableSequence(errors, result.cursor.lastSequence, "cursor.lastSequence"),
            lastLogOffset: normalizeNullableLogOffset(errors, result.cursor.lastLogOffset, "cursor.lastLogOffset")
        };
    }

    return createValidationResult(
        errors,
        errors.length === 0
            ? copyAndFreeze({
                  events,
                  cursor,
                  truncated: result.truncated
              })
            : null
    );
}

export function assertActionEventLogReadResult(result, options = {}) {
    return assertValidation(
        validateActionEventLogReadResult(result, options),
        "Action event log read result validation failed"
    );
}
