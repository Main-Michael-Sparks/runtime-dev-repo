import {
    assertActionEvent
} from "../actionEvent.mjs";
import {
    isKnownActionEventType,
    isKnownCapability
} from "../capabilityTaxonomy.mjs";
import {
    assertValidation,
    collectForbiddenKeys,
    createValidationError,
    createValidationResult,
    isFiniteNonNegativeNumber,
    isNonEmptyString,
    isPlainObject
} from "../contractValidation.mjs";
import {
    isDefaultDurableActionEventLogType,
    isHighVolumeActionEventLogType
} from "./actionEventLogCommon.mjs";

const APPEND_ENTRY_KEYS = new Set([
    "event",
    "receivedAt",
    "source",
    "durability"
]);

const APPEND_OPTION_KEYS = new Set([
    "includeHighVolumeEvents"
]);

const READ_FILTER_KEYS = new Set([
    "actionId",
    "runId",
    "type",
    "capability",
    "sinceTimestamp",
    "untilTimestamp",
    "afterSequence",
    "afterLogOffset"
]);

const READ_OPTION_KEYS = new Set([
    "limit",
    "includeHighVolumeEvents"
]);

const DURABILITY_VALUES = new Set([
    "default",
    "audit",
    "ephemeral"
]);

const FORBIDDEN_EVENT_LOG_METADATA_KEYS = new Set([
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
            `invalid_action_event_log_${label}`,
            `Unknown action event log ${label} field: ${key}`,
            { field: key }
        );
    }
}

function addForbiddenMetadataKeyErrors(errors, value, path) {
    const found = collectForbiddenKeys(value, FORBIDDEN_EVENT_LOG_METADATA_KEYS, path);

    for (const entry of found) {
        addError(
            errors,
            entry.path,
            "invalid_action_event_log_metadata",
            `Action event log metadata must not include forbidden key: ${entry.key}`,
            { key: entry.key }
        );
    }
}

function addStringFieldErrors(errors, value, path) {
    if (value === undefined) return;

    if (!isNonEmptyString(value)) {
        addError(
            errors,
            path,
            "invalid_action_event_log_filter",
            `Action event log ${path} must be a non-empty string when provided`
        );
    }
}

function addNumberFieldErrors(errors, value, path) {
    if (value === undefined) return;

    if (!isFiniteNonNegativeNumber(value)) {
        addError(
            errors,
            path,
            "invalid_action_event_log_filter",
            `Action event log ${path} must be a finite non-negative number when provided`
        );
    }
}

function addHighVolumePolicyErrors(errors, event, includeHighVolumeEvents) {
    if (isHighVolumeActionEventLogType(event.type)) {
        if (includeHighVolumeEvents === true) return;

        addError(
            errors,
            "event.type",
            "invalid_action_event_log_entry",
            `Action event log entries exclude high-volume event type by default: ${event.type}`,
            { type: event.type }
        );
        return;
    }

    if (!isDefaultDurableActionEventLogType(event.type)) {
        addError(
            errors,
            "event.type",
            "invalid_action_event_log_entry",
            `Action event log entry type is not durable-log eligible in v1: ${event.type}`,
            { type: event.type }
        );
    }
}

function normalizeOptionsObject(options, allowedKeys, label, errors) {
    if (options === undefined || options === null) return {};

    if (!isPlainObject(options)) {
        addError(
            errors,
            "",
            `invalid_action_event_log_${label}`,
            `Action event log ${label} must be a plain object when provided`
        );
        return {};
    }

    addUnknownKeyErrors(errors, options, allowedKeys, label);
    return options;
}

function normalizeBooleanOption(errors, options, key, label) {
    if (options[key] === undefined) return false;

    if (typeof options[key] !== "boolean") {
        addError(
            errors,
            key,
            `invalid_action_event_log_${label}`,
            `Action event log ${label}.${key} must be boolean when provided`
        );
        return false;
    }

    return options[key];
}

function normalizeDurability(errors, durability) {
    if (durability === undefined) return "default";

    if (!isNonEmptyString(durability)) {
        addError(
            errors,
            "durability",
            "invalid_action_event_log_entry",
            "Action event log durability must be a non-empty string when provided"
        );
        return null;
    }

    const normalized = durability.trim();
    if (!DURABILITY_VALUES.has(normalized)) {
        addError(
            errors,
            "durability",
            "invalid_action_event_log_entry",
            `Unsupported action event log durability: ${normalized}`,
            { durability: normalized }
        );
        return null;
    }

    return normalized;
}

function normalizeSource(errors, source) {
    if (source === undefined) return undefined;

    if (!isPlainObject(source)) {
        addError(
            errors,
            "source",
            "invalid_action_event_log_entry",
            "Action event log source must be a plain object when provided"
        );
        return undefined;
    }

    addForbiddenMetadataKeyErrors(errors, source, "source");
    return copyAndFreeze(source);
}

function normalizeReceivedAt(errors, receivedAt) {
    if (receivedAt === undefined) return undefined;

    if (!isFiniteNonNegativeNumber(receivedAt)) {
        addError(
            errors,
            "receivedAt",
            "invalid_action_event_log_entry",
            "Action event log receivedAt must be a finite non-negative number when provided"
        );
        return undefined;
    }

    return receivedAt;
}

function normalizeEvent(errors, value, includeHighVolumeEvents) {
    if (value === undefined) {
        addError(
            errors,
            "event",
            "invalid_action_event_log_entry",
            "Action event log entry must include event"
        );
        return null;
    }

    try {
        const event = assertActionEvent(value);
        addHighVolumePolicyErrors(errors, event, includeHighVolumeEvents);
        return copyAndFreeze(event);
    } catch (err) {
        const validationErrors = Array.isArray(err.validationErrors)
            ? err.validationErrors
            : [
                  createValidationError(
                      "event",
                      "invalid_action_event_log_entry",
                      err?.message || "Action event log event validation failed"
                  )
              ];

        for (const error of validationErrors) {
            addError(
                errors,
                error.path ? `event.${error.path}` : "event",
                "invalid_action_event_log_entry",
                error.message,
                {
                    originalCode: error.code
                }
            );
        }

        return null;
    }
}

function normalizeStringField(value) {
    return value === undefined ? undefined : value.trim();
}

function normalizeNumberField(value) {
    return value === undefined ? undefined : value;
}

function normalizePositiveInteger(errors, value, path) {
    if (value === undefined) return undefined;

    if (!Number.isInteger(value) || value < 1) {
        addError(
            errors,
            path,
            "invalid_action_event_log_options",
            `Action event log ${path} must be a positive integer`
        );
        return undefined;
    }

    return value;
}

function compactObject(value) {
    return Object.fromEntries(
        Object.entries(value).filter(([, entry]) => entry !== undefined)
    );
}

export function copyActionEventLogEntry(entry) {
    return copyAndFreeze(entry);
}

export function validateActionEventLogAppendEntry(entry, options = {}) {
    const errors = [];
    const normalizedOptions = normalizeOptionsObject(
        options,
        APPEND_OPTION_KEYS,
        "options",
        errors
    );
    const includeHighVolumeEvents = normalizeBooleanOption(
        errors,
        normalizedOptions,
        "includeHighVolumeEvents",
        "options"
    );

    if (!isPlainObject(entry)) {
        addError(
            errors,
            "",
            "invalid_action_event_log_entry",
            "Action event log entry must be a plain object"
        );
        return createValidationResult(errors);
    }

    addUnknownKeyErrors(errors, entry, APPEND_ENTRY_KEYS, "entry");

    const normalized = compactObject({
        event: normalizeEvent(errors, entry.event, includeHighVolumeEvents),
        receivedAt: normalizeReceivedAt(errors, entry.receivedAt),
        source: normalizeSource(errors, entry.source),
        durability: normalizeDurability(errors, entry.durability)
    });

    return createValidationResult(
        errors,
        errors.length === 0 ? copyAndFreeze(normalized) : null
    );
}

export function normalizeActionEventLogAppendEntry(entry, options = {}) {
    return assertActionEventLogAppendEntry(entry, options);
}

export function assertActionEventLogAppendEntry(entry, options = {}) {
    return assertValidation(
        validateActionEventLogAppendEntry(entry, options),
        "Action event log entry validation failed"
    );
}

export function validateActionEventLogReadFilter(filter = {}) {
    const errors = [];

    if (filter === undefined || filter === null) {
        return createValidationResult(errors, Object.freeze({}));
    }

    if (!isPlainObject(filter)) {
        addError(
            errors,
            "",
            "invalid_action_event_log_filter",
            "Action event log read filter must be a plain object when provided"
        );
        return createValidationResult(errors);
    }

    addUnknownKeyErrors(errors, filter, READ_FILTER_KEYS, "filter");
    addStringFieldErrors(errors, filter.actionId, "actionId");
    addStringFieldErrors(errors, filter.runId, "runId");
    addStringFieldErrors(errors, filter.type, "type");
    addStringFieldErrors(errors, filter.capability, "capability");
    addNumberFieldErrors(errors, filter.sinceTimestamp, "sinceTimestamp");
    addNumberFieldErrors(errors, filter.untilTimestamp, "untilTimestamp");
    addNumberFieldErrors(errors, filter.afterSequence, "afterSequence");
    addStringFieldErrors(errors, filter.afterLogOffset, "afterLogOffset");

    const type = normalizeStringField(filter.type);
    if (type !== undefined && isNonEmptyString(type) && !isKnownActionEventType(type)) {
        addError(
            errors,
            "type",
            "invalid_action_event_log_filter",
            `Unknown action event log type: ${type}`,
            { type }
        );
    }

    const capability = normalizeStringField(filter.capability);
    if (
        capability !== undefined &&
        isNonEmptyString(capability) &&
        !isKnownCapability(capability)
    ) {
        addError(
            errors,
            "capability",
            "invalid_action_event_log_filter",
            `Unknown action event log capability: ${capability}`,
            { capability }
        );
    }

    if (
        isFiniteNonNegativeNumber(filter.sinceTimestamp) &&
        isFiniteNonNegativeNumber(filter.untilTimestamp) &&
        filter.sinceTimestamp > filter.untilTimestamp
    ) {
        addError(
            errors,
            "sinceTimestamp",
            "invalid_action_event_log_filter",
            "Action event log sinceTimestamp must be less than or equal to untilTimestamp",
            {
                sinceTimestamp: filter.sinceTimestamp,
                untilTimestamp: filter.untilTimestamp
            }
        );
    }

    const normalized = compactObject({
        actionId: normalizeStringField(filter.actionId),
        runId: normalizeStringField(filter.runId),
        type,
        capability,
        sinceTimestamp: normalizeNumberField(filter.sinceTimestamp),
        untilTimestamp: normalizeNumberField(filter.untilTimestamp),
        afterSequence: normalizeNumberField(filter.afterSequence),
        afterLogOffset: normalizeStringField(filter.afterLogOffset)
    });

    return createValidationResult(
        errors,
        errors.length === 0 ? copyAndFreeze(normalized) : null
    );
}

export function normalizeActionEventLogReadFilter(filter = {}) {
    return assertValidation(
        validateActionEventLogReadFilter(filter),
        "Action event log filter validation failed"
    );
}

export function validateActionEventLogReadOptions(options = {}) {
    const errors = [];
    const normalizedOptions = normalizeOptionsObject(
        options,
        READ_OPTION_KEYS,
        "options",
        errors
    );

    const normalized = compactObject({
        limit: normalizePositiveInteger(errors, normalizedOptions.limit, "limit"),
        includeHighVolumeEvents: normalizeBooleanOption(
            errors,
            normalizedOptions,
            "includeHighVolumeEvents",
            "options"
        )
    });

    return createValidationResult(
        errors,
        errors.length === 0 ? copyAndFreeze(normalized) : null
    );
}

export function normalizeActionEventLogReadOptions(options = {}) {
    return assertValidation(
        validateActionEventLogReadOptions(options),
        "Action event log read options validation failed"
    );
}
