import {
    assertActionEventLogAppendEntry,
    assertActionEventLogAppendResult,
    assertActionEventLogStoreAdapter,
    isDefaultDurableActionEventLogType,
    isHighVolumeActionEventLogType
} from "./actionEventLogStoreContract.mjs";
import {
    isPlainObject
} from "../contractValidation.mjs";

const INTEGRATION_OPTION_KEYS = new Set([
    "adapter",
    "enabled",
    "includeHighVolumeEvents",
    "source",
    "durability",
    "onAppendError"
]);

const APPEND_OPTION_KEYS = new Set([
    "includeHighVolumeEvents",
    "source",
    "durability"
]);

const DURABILITY_VALUES = new Set([
    "default",
    "audit",
    "ephemeral"
]);

function createIntegrationInputError(message, details = {}) {
    const err = new Error(message);
    err.code = "invalid_action_event_log_integration";
    err.details = { ...details };
    return err;
}

function assertKnownKeys(value, allowedKeys, label) {
    for (const key of Object.keys(value)) {
        if (allowedKeys.has(key)) continue;

        throw createIntegrationInputError(
            `Unknown action event log integration ${label} field: ${key}`,
            { field: key }
        );
    }
}

function normalizeBooleanOption(value, field, defaultValue = false) {
    if (value === undefined) return defaultValue;

    if (typeof value !== "boolean") {
        throw createIntegrationInputError(
            `Action event log integration ${field} must be boolean when provided`,
            { field }
        );
    }

    return value;
}

function normalizeDurability(value, field = "durability") {
    if (value === undefined) return "default";

    if (typeof value !== "string" || value.trim() === "") {
        throw createIntegrationInputError(
            `Action event log integration ${field} must be a non-empty string when provided`,
            { field }
        );
    }

    const normalized = value.trim();

    if (!DURABILITY_VALUES.has(normalized)) {
        throw createIntegrationInputError(
            `Unsupported action event log integration ${field}: ${normalized}`,
            { field, durability: normalized }
        );
    }

    return normalized;
}

function normalizeOptionalSource(value, field = "source") {
    if (value === undefined) return undefined;

    if (!isPlainObject(value)) {
        throw createIntegrationInputError(
            `Action event log integration ${field} must be a plain object when provided`,
            { field }
        );
    }

    return value;
}

function normalizeAppendOptions(options = {}) {
    if (options === undefined || options === null) return {};

    if (!isPlainObject(options)) {
        throw createIntegrationInputError(
            "Action event log integration append options must be a plain object when provided"
        );
    }

    assertKnownKeys(options, APPEND_OPTION_KEYS, "append option");

    return {
        includeHighVolumeEvents: options.includeHighVolumeEvents === undefined
            ? undefined
            : normalizeBooleanOption(options.includeHighVolumeEvents, "options.includeHighVolumeEvents"),
        source: normalizeOptionalSource(options.source, "options.source"),
        durability: options.durability === undefined
            ? undefined
            : normalizeDurability(options.durability, "options.durability")
    };
}

function normalizeAdapter(adapter) {
    if (adapter === undefined || adapter === null) return null;
    return assertActionEventLogStoreAdapter(adapter);
}

function validateHighVolumeAdapterSupport(adapter, includeHighVolumeEvents) {
    if (includeHighVolumeEvents !== true || adapter === null) return;

    if (adapter.capabilities.highVolumeEvents !== true) {
        throw createIntegrationInputError(
            "Action event log integration cannot enable high-volume events for an adapter that does not advertise highVolumeEvents capability",
            { adapterId: adapter.adapterId }
        );
    }
}

function createAppendObservation(fields) {
    return Object.freeze({
        attempted: fields.attempted === true,
        accepted: fields.accepted === true,
        pending: fields.pending === true,
        skipped: fields.skipped === true,
        reason: fields.reason ?? null,
        eventId: fields.eventId ?? null,
        adapterId: fields.adapterId ?? null,
        result: fields.result ?? null,
        promise: fields.promise ?? null
    });
}

function observeAppendError(integration, err, context) {
    if (typeof integration.onAppendError !== "function") return;

    try {
        integration.onAppendError(err, Object.freeze({ ...context }));
    } catch {
        // Event-log failure observers must not affect runtime event publication.
    }
}

function isPromiseLike(value) {
    return value && typeof value.then === "function";
}

function createAppendEntry(integration, event, options) {
    const includeHighVolumeEvents = options.includeHighVolumeEvents === undefined
        ? integration.includeHighVolumeEvents
        : options.includeHighVolumeEvents;

    return assertActionEventLogAppendEntry({
        event,
        receivedAt: Date.now(),
        source: options.source ?? integration.source,
        durability: options.durability ?? integration.durability
    }, {
        includeHighVolumeEvents
    });
}

function shouldSkipEventType(integration, event) {
    if (event?.type === undefined) return null;

    if (isHighVolumeActionEventLogType(event.type) && integration.includeHighVolumeEvents !== true) {
        return "high_volume_event_type_excluded";
    }

    if (
        !isHighVolumeActionEventLogType(event.type) &&
        !isDefaultDurableActionEventLogType(event.type)
    ) {
        return "non_durable_event_type";
    }

    return null;
}

function settleAppendResult(integration, result, context) {
    try {
        const normalizedResult = assertActionEventLogAppendResult(result);

        return createAppendObservation({
            attempted: true,
            accepted: true,
            pending: false,
            eventId: context.eventId,
            adapterId: context.adapterId,
            result: normalizedResult
        });
    } catch (err) {
        observeAppendError(integration, err, context);

        return createAppendObservation({
            attempted: true,
            accepted: false,
            pending: false,
            eventId: context.eventId,
            adapterId: context.adapterId,
            reason: "append_result_validation_failed"
        });
    }
}

function settleAppendFailure(integration, err, context) {
    observeAppendError(integration, err, context);

    return createAppendObservation({
        attempted: true,
        accepted: false,
        pending: false,
        eventId: context.eventId,
        adapterId: context.adapterId,
        reason: "append_failed"
    });
}

export function createActionEventLogIntegration(options = {}) {
    if (options === undefined || options === null) {
        options = {};
    }

    if (!isPlainObject(options)) {
        throw createIntegrationInputError(
            "Action event log integration options must be a plain object when provided"
        );
    }

    assertKnownKeys(options, INTEGRATION_OPTION_KEYS, "option");

    const adapter = normalizeAdapter(options.adapter);
    const includeHighVolumeEvents = normalizeBooleanOption(
        options.includeHighVolumeEvents,
        "includeHighVolumeEvents",
        false
    );

    validateHighVolumeAdapterSupport(adapter, includeHighVolumeEvents);

    if (options.onAppendError !== undefined && typeof options.onAppendError !== "function") {
        throw createIntegrationInputError(
            "Action event log integration onAppendError must be a function when provided"
        );
    }

    return Object.freeze({
        adapter,
        enabled: normalizeBooleanOption(options.enabled, "enabled", true),
        includeHighVolumeEvents,
        source: normalizeOptionalSource(options.source) ?? Object.freeze({ kind: "runtime-action-event" }),
        durability: normalizeDurability(options.durability),
        onAppendError: options.onAppendError
    });
}

export function appendRuntimeActionEventLog(integration, event, options = {}) {
    if (!isPlainObject(integration)) {
        throw createIntegrationInputError("Action event log integration is invalid");
    }

    if (integration.enabled !== true) {
        return createAppendObservation({
            skipped: true,
            reason: "disabled",
            eventId: event?.eventId ?? null,
            adapterId: integration.adapter?.adapterId ?? null
        });
    }

    if (!integration.adapter) {
        return createAppendObservation({
            skipped: true,
            reason: "no_adapter",
            eventId: event?.eventId ?? null
        });
    }

    const normalizedOptions = normalizeAppendOptions(options);
    const skipReason = shouldSkipEventType({
        ...integration,
        includeHighVolumeEvents: normalizedOptions.includeHighVolumeEvents === undefined
            ? integration.includeHighVolumeEvents
            : normalizedOptions.includeHighVolumeEvents
    }, event);

    if (skipReason) {
        return createAppendObservation({
            skipped: true,
            reason: skipReason,
            eventId: event?.eventId ?? null,
            adapterId: integration.adapter.adapterId
        });
    }

    let entry;
    const context = {
        eventId: event?.eventId ?? null,
        adapterId: integration.adapter.adapterId
    };

    try {
        entry = createAppendEntry(integration, event, normalizedOptions);
        context.entry = entry;
    } catch (err) {
        observeAppendError(integration, err, context);

        return createAppendObservation({
            attempted: false,
            accepted: false,
            pending: false,
            eventId: context.eventId,
            adapterId: context.adapterId,
            reason: "append_entry_validation_failed"
        });
    }

    try {
        const result = integration.adapter.appendEvent(entry);

        if (isPromiseLike(result)) {
            const promise = Promise.resolve(result)
                .then((resolvedResult) => settleAppendResult(integration, resolvedResult, context))
                .catch((err) => settleAppendFailure(integration, err, context));

            return createAppendObservation({
                attempted: true,
                accepted: false,
                pending: true,
                eventId: context.eventId,
                adapterId: context.adapterId,
                promise
            });
        }

        return settleAppendResult(integration, result, context);
    } catch (err) {
        return settleAppendFailure(integration, err, context);
    }
}
