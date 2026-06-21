import {
    assertActionEvent
} from "./actionEvent.mjs";
import {
    isKnownActionEventType,
    isKnownCapability
} from "./capabilityTaxonomy.mjs";
import {
    isNonEmptyString,
    isPlainObject
} from "./contractValidation.mjs";

const STREAM_DELTA_EVENT_TYPE = "action.stream.delta";
const SUBSCRIPTION_FILTER_KEYS = new Set([
    "actionId",
    "runId",
    "type",
    "capability"
]);
const SUBSCRIPTION_OPTION_KEYS = new Set([
    "includeStreamDeltas"
]);

function createSubscriptionInputError(message, details = {}) {
    const err = new Error(message);
    err.code = "invalid_action_event_subscription";
    err.details = { ...details };
    return err;
}

function normalizeStringField(value, field) {
    if (value === undefined) return undefined;

    if (!isNonEmptyString(value)) {
        throw createSubscriptionInputError(
            `Action event subscription ${field} must be a non-empty string when provided`,
            { field }
        );
    }

    return value.trim();
}

function normalizeBooleanField(value, field) {
    if (value === undefined) return false;

    if (typeof value !== "boolean") {
        throw createSubscriptionInputError(
            `Action event subscription ${field} must be a boolean when provided`,
            { field }
        );
    }

    return value;
}

function assertKnownFilterKeys(filter) {
    for (const key of Object.keys(filter)) {
        if (SUBSCRIPTION_FILTER_KEYS.has(key)) continue;

        throw createSubscriptionInputError(
            `Unknown action event subscription filter field: ${key}`,
            { field: key }
        );
    }
}

function assertKnownOptionKeys(options) {
    for (const key of Object.keys(options)) {
        if (SUBSCRIPTION_OPTION_KEYS.has(key)) continue;

        throw createSubscriptionInputError(
            `Unknown action event subscription option field: ${key}`,
            { field: key }
        );
    }
}

function normalizeFilter(filter) {
    if (filter === undefined || filter === null) return {};

    if (!isPlainObject(filter)) {
        throw createSubscriptionInputError(
            "Action event subscription filter must be a plain object when provided"
        );
    }

    assertKnownFilterKeys(filter);

    const normalized = {
        actionId: normalizeStringField(filter.actionId, "actionId"),
        runId: normalizeStringField(filter.runId, "runId"),
        type: normalizeStringField(filter.type, "type"),
        capability: normalizeStringField(filter.capability, "capability")
    };

    if (normalized.type !== undefined && !isKnownActionEventType(normalized.type)) {
        throw createSubscriptionInputError(
            `Unknown action event subscription type: ${normalized.type}`,
            { type: normalized.type }
        );
    }

    if (normalized.capability !== undefined && !isKnownCapability(normalized.capability)) {
        throw createSubscriptionInputError(
            `Unknown action event subscription capability: ${normalized.capability}`,
            { capability: normalized.capability }
        );
    }

    return Object.fromEntries(
        Object.entries(normalized).filter(([, value]) => value !== undefined)
    );
}

function normalizeSubscriptionOptions(options = {}) {
    if (options === undefined || options === null) return {
        includeStreamDeltas: false
    };

    if (!isPlainObject(options)) {
        throw createSubscriptionInputError(
            "Action event subscription options must be a plain object when provided"
        );
    }

    assertKnownOptionKeys(options);

    return {
        includeStreamDeltas: normalizeBooleanField(
            options.includeStreamDeltas,
            "options.includeStreamDeltas"
        )
    };
}

export function normalizeActionEventSubscribeArgs(filterOrListener, listener) {
    if (typeof filterOrListener === "function" && listener === undefined) {
        return {
            filter: {},
            listener: filterOrListener
        };
    }

    if (typeof listener !== "function") {
        throw createSubscriptionInputError(
            "Action event subscription listener must be a function"
        );
    }

    return {
        filter: normalizeFilter(filterOrListener),
        listener
    };
}

function isStreamDeltaEvent(event) {
    return event.type === STREAM_DELTA_EVENT_TYPE;
}

function eventMatchesFilter(event, filter, options) {
    if (isStreamDeltaEvent(event) && options.includeStreamDeltas !== true) return false;
    if (filter.actionId !== undefined && event.actionId !== filter.actionId) return false;
    if (filter.runId !== undefined && event.runId !== filter.runId) return false;
    if (filter.type !== undefined && event.type !== filter.type) return false;
    if (filter.capability !== undefined && event.capability !== filter.capability) return false;

    return true;
}

function assertSubscriptionRegistry(registry) {
    if (!isPlainObject(registry) || !(registry.subscriptions instanceof Map)) {
        throw createSubscriptionInputError(
            "Action event subscription registry is invalid"
        );
    }
}

export function createActionEventSubscriptionRegistry() {
    return {
        nextSubscriptionId: 1,
        subscriptions: new Map()
    };
}

export function subscribeActionEvents(registry, filterOrListener, listener, options = {}) {
    assertSubscriptionRegistry(registry);

    const normalized = normalizeActionEventSubscribeArgs(filterOrListener, listener);
    const normalizedOptions = normalizeSubscriptionOptions(options);
    const subscriptionId = registry.nextSubscriptionId++;
    let active = true;

    registry.subscriptions.set(subscriptionId, {
        id: subscriptionId,
        filter: normalized.filter,
        options: normalizedOptions,
        listener: normalized.listener
    });

    return function unsubscribeActionEvents() {
        if (!active) return false;

        active = false;
        return registry.subscriptions.delete(subscriptionId);
    };
}

export function publishActionEvent(registry, event, options = {}) {
    assertSubscriptionRegistry(registry);

    const normalizedEvent = assertActionEvent(event);
    const subscribers = [...registry.subscriptions.values()];

    for (const subscriber of subscribers) {
        if (!registry.subscriptions.has(subscriber.id)) continue;
        if (!eventMatchesFilter(normalizedEvent, subscriber.filter, subscriber.options)) continue;

        try {
            subscriber.listener(normalizedEvent);
        } catch (err) {
            if (typeof options.onListenerError === "function") {
                try {
                    options.onListenerError(err, {
                        event: normalizedEvent,
                        subscriptionId: subscriber.id
                    });
                } catch {
                    // Listener error observers must not affect publication.
                }
            }
        }
    }

    return normalizedEvent;
}

export function getActionEventSubscriberCount(registry) {
    assertSubscriptionRegistry(registry);
    return registry.subscriptions.size;
}
