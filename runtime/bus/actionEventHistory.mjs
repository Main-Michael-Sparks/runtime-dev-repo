import {
    assertActionEvent
} from "./actionEvent.mjs";
import {
    isKnownActionEventType,
    isKnownCapability
} from "./capabilityTaxonomy.mjs";
import {
    isFiniteNonNegativeNumber,
    isNonEmptyString,
    isPlainObject
} from "./contractValidation.mjs";

const DEFAULT_MAX_EVENTS = 1000;
const HISTORY_FILTER_KEYS = new Set([
    "actionId",
    "runId",
    "type",
    "capability",
    "sinceTimestamp",
    "untilTimestamp",
    "afterSequence"
]);
const HISTORY_CREATE_OPTION_KEYS = new Set([
    "maxEvents"
]);
const HISTORY_READ_OPTION_KEYS = new Set([
    "limit"
]);

function createHistoryInputError(message, details = {}) {
    const err = new Error(message);
    err.code = "invalid_action_event_history";
    err.details = { ...details };
    return err;
}

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

function cloneAndFreeze(value) {
    return freezeValue(cloneValue(value));
}

function assertKnownKeys(value, allowedKeys, label) {
    for (const key of Object.keys(value)) {
        if (allowedKeys.has(key)) continue;

        throw createHistoryInputError(
            `Unknown action event history ${label} field: ${key}`,
            { field: key }
        );
    }
}

function normalizeStringField(value, field) {
    if (value === undefined) return undefined;

    if (!isNonEmptyString(value)) {
        throw createHistoryInputError(
            `Action event history ${field} must be a non-empty string when provided`,
            { field }
        );
    }

    return value.trim();
}

function normalizeNumberField(value, field) {
    if (value === undefined) return undefined;

    if (!isFiniteNonNegativeNumber(value)) {
        throw createHistoryInputError(
            `Action event history ${field} must be a finite non-negative number when provided`,
            { field }
        );
    }

    return value;
}

function normalizePositiveInteger(value, field) {
    if (!Number.isInteger(value) || value < 1) {
        throw createHistoryInputError(
            `Action event history ${field} must be a positive integer`,
            { field }
        );
    }

    return value;
}

function normalizeFilter(filter = {}) {
    if (filter === undefined || filter === null) return {};

    if (!isPlainObject(filter)) {
        throw createHistoryInputError(
            "Action event history filter must be a plain object when provided"
        );
    }

    assertKnownKeys(filter, HISTORY_FILTER_KEYS, "filter");

    const normalized = {
        actionId: normalizeStringField(filter.actionId, "filter.actionId"),
        runId: normalizeStringField(filter.runId, "filter.runId"),
        type: normalizeStringField(filter.type, "filter.type"),
        capability: normalizeStringField(filter.capability, "filter.capability"),
        sinceTimestamp: normalizeNumberField(filter.sinceTimestamp, "filter.sinceTimestamp"),
        untilTimestamp: normalizeNumberField(filter.untilTimestamp, "filter.untilTimestamp"),
        afterSequence: normalizeNumberField(filter.afterSequence, "filter.afterSequence")
    };

    if (normalized.type !== undefined && !isKnownActionEventType(normalized.type)) {
        throw createHistoryInputError(
            `Unknown action event history type: ${normalized.type}`,
            { type: normalized.type }
        );
    }

    if (normalized.capability !== undefined && !isKnownCapability(normalized.capability)) {
        throw createHistoryInputError(
            `Unknown action event history capability: ${normalized.capability}`,
            { capability: normalized.capability }
        );
    }

    if (
        normalized.sinceTimestamp !== undefined &&
        normalized.untilTimestamp !== undefined &&
        normalized.sinceTimestamp > normalized.untilTimestamp
    ) {
        throw createHistoryInputError(
            "Action event history sinceTimestamp must be less than or equal to untilTimestamp",
            {
                sinceTimestamp: normalized.sinceTimestamp,
                untilTimestamp: normalized.untilTimestamp
            }
        );
    }

    return Object.fromEntries(
        Object.entries(normalized).filter(([, value]) => value !== undefined)
    );
}

function normalizeCreateOptions(options = {}) {
    if (options === undefined || options === null) return {};

    if (!isPlainObject(options)) {
        throw createHistoryInputError(
            "Action event history options must be a plain object when provided"
        );
    }

    assertKnownKeys(options, HISTORY_CREATE_OPTION_KEYS, "option");

    return {
        maxEvents: options.maxEvents === undefined
            ? undefined
            : normalizePositiveInteger(options.maxEvents, "options.maxEvents")
    };
}

function normalizeReadOptions(options = {}) {
    if (options === undefined || options === null) return {};

    if (!isPlainObject(options)) {
        throw createHistoryInputError(
            "Action event history read options must be a plain object when provided"
        );
    }

    assertKnownKeys(options, HISTORY_READ_OPTION_KEYS, "option");

    return {
        limit: options.limit === undefined
            ? undefined
            : normalizePositiveInteger(options.limit, "options.limit")
    };
}

function assertHistory(history) {
    if (
        !isPlainObject(history) ||
        !Array.isArray(history.events) ||
        !(history.eventIds instanceof Set) ||
        !Number.isInteger(history.nextSequence) ||
        !Number.isInteger(history.maxEvents)
    ) {
        throw createHistoryInputError(
            "Action event history is invalid"
        );
    }
}

function matchesFilter(event, filter) {
    if (filter.actionId !== undefined && event.actionId !== filter.actionId) return false;
    if (filter.runId !== undefined && event.runId !== filter.runId) return false;
    if (filter.type !== undefined && event.type !== filter.type) return false;
    if (filter.capability !== undefined && event.capability !== filter.capability) return false;
    if (filter.sinceTimestamp !== undefined && event.timestamp < filter.sinceTimestamp) return false;
    if (filter.untilTimestamp !== undefined && event.timestamp > filter.untilTimestamp) return false;
    if (filter.afterSequence !== undefined && event.sequence <= filter.afterSequence) return false;

    return true;
}

function evictOverflow(history) {
    while (history.events.length > history.maxEvents) {
        const [evicted] = history.events.splice(0, 1);
        if (evicted?.eventId) {
            history.eventIds.delete(evicted.eventId);
        }
    }
}

export function createActionEventHistory(options = {}) {
    const normalizedOptions = normalizeCreateOptions(options);
    const maxEvents = normalizedOptions.maxEvents === undefined
        ? DEFAULT_MAX_EVENTS
        : normalizedOptions.maxEvents;

    return {
        maxEvents,
        nextSequence: 1,
        events: [],
        eventIds: new Set()
    };
}

export function recordActionEvent(history, event) {
    assertHistory(history);

    const normalizedEvent = assertActionEvent(event);

    if (history.eventIds.has(normalizedEvent.eventId)) {
        throw createHistoryInputError(
            `Duplicate retained action event id: ${normalizedEvent.eventId}`,
            { eventId: normalizedEvent.eventId }
        );
    }

    const recordedEvent = cloneAndFreeze({
        ...normalizedEvent,
        sequence: history.nextSequence++
    });

    history.events.push(recordedEvent);
    history.eventIds.add(recordedEvent.eventId);
    evictOverflow(history);

    return recordedEvent;
}

export function readActionEvents(history, filter = {}, options = {}) {
    assertHistory(history);

    const normalizedFilter = normalizeFilter(filter);
    const normalizedOptions = normalizeReadOptions(options);
    const matchingEvents = history.events.filter((event) => matchesFilter(event, normalizedFilter));
    const returnedEvents = normalizedOptions.limit === undefined
        ? matchingEvents
        : matchingEvents.slice(0, normalizedOptions.limit);
    const lastEvent = returnedEvents[returnedEvents.length - 1] ?? null;

    return {
        events: returnedEvents.map((event) => cloneAndFreeze(event)),
        cursor: {
            lastSequence: lastEvent?.sequence ?? null
        },
        truncated: returnedEvents.length < matchingEvents.length
    };
}

export function getActionEventHistorySize(history) {
    assertHistory(history);
    return history.events.length;
}
