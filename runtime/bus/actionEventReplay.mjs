import {
    normalizeActionEventSubscribeArgs
} from "./actionEventSubscriptionRegistry.mjs";
import {
    isFiniteNonNegativeNumber,
    isPlainObject
} from "./contractValidation.mjs";

const REPLAY_OPTION_KEYS = new Set([
    "replay",
    "afterSequence",
    "limit",
    "includeStreamDeltas"
]);

function createReplayInputError(message, details = {}) {
    const err = new Error(message);
    err.code = "invalid_action_event_replay";
    err.details = { ...details };
    return err;
}

function assertKnownReplayOptionKeys(options) {
    for (const key of Object.keys(options)) {
        if (REPLAY_OPTION_KEYS.has(key)) continue;

        throw createReplayInputError(
            `Unknown action event replay option field: ${key}`,
            { field: key }
        );
    }
}

function normalizeReplayBoolean(value, field) {
    if (value === undefined) return false;

    if (typeof value !== "boolean") {
        throw createReplayInputError(
            `Action event replay ${field} must be a boolean when provided`,
            { field }
        );
    }

    return value;
}

function normalizeNonNegativeNumber(value, field) {
    if (value === undefined) return undefined;

    if (!isFiniteNonNegativeNumber(value)) {
        throw createReplayInputError(
            `Action event replay ${field} must be a finite non-negative number when provided`,
            { field }
        );
    }

    return value;
}

function normalizePositiveInteger(value, field) {
    if (value === undefined) return undefined;

    if (!Number.isInteger(value) || value < 1) {
        throw createReplayInputError(
            `Action event replay ${field} must be a positive integer when provided`,
            { field }
        );
    }

    return value;
}

function normalizeReplayOptions(options = {}) {
    if (options === undefined || options === null) return {
        replay: false
    };

    if (!isPlainObject(options)) {
        throw createReplayInputError(
            "Action event replay options must be a plain object when provided"
        );
    }

    assertKnownReplayOptionKeys(options);

    return {
        replay: normalizeReplayBoolean(options.replay, "options.replay"),
        afterSequence: normalizeNonNegativeNumber(options.afterSequence, "options.afterSequence"),
        limit: normalizePositiveInteger(options.limit, "options.limit"),
        includeStreamDeltas: normalizeReplayBoolean(
            options.includeStreamDeltas,
            "options.includeStreamDeltas"
        )
    };
}

function normalizeReplaySubscribeArgs(filterOrListener, listenerOrOptions, maybeOptions) {
    if (typeof filterOrListener === "function" && listenerOrOptions !== undefined) {
        if (!isPlainObject(listenerOrOptions)) {
            throw createReplayInputError(
                "Action event replay options must be a plain object when using listener-first replay shorthand"
            );
        }

        return {
            filter: {},
            listener: filterOrListener,
            options: normalizeReplayOptions(listenerOrOptions)
        };
    }

    return {
        ...normalizeActionEventSubscribeArgs(filterOrListener, listenerOrOptions),
        options: normalizeReplayOptions(maybeOptions)
    };
}

function assertReplayDeps(deps) {
    if (!isPlainObject(deps)) {
        throw createReplayInputError(
            "Action event replay dependencies must be a plain object"
        );
    }

    if (typeof deps.subscribe !== "function") {
        throw createReplayInputError(
            "Action event replay dependency subscribe must be a function"
        );
    }

    if (typeof deps.readEvents !== "function") {
        throw createReplayInputError(
            "Action event replay dependency readEvents must be a function"
        );
    }
}

function deliverActionEvent(listener, event) {
    try {
        listener(event);
    } catch {
        // Listener errors must not abort replay or the live subscription surface.
    }
}

function createReadFilter(filter, options) {
    return Object.fromEntries(
        Object.entries({
            ...filter,
            afterSequence: options.afterSequence
        }).filter(([, value]) => value !== undefined)
    );
}

function createReadOptions(options) {
    return options.limit === undefined
        ? {}
        : { limit: options.limit };
}

function resolveReplayBoundary(replayResult, options) {
    const cursorSequence = replayResult?.cursor?.lastSequence;
    const optionSequence = options.afterSequence;

    return Math.max(
        typeof cursorSequence === "number" ? cursorSequence : 0,
        typeof optionSequence === "number" ? optionSequence : 0
    );
}

function shouldDeliverBufferedEvent(event, replayBoundary) {
    if (typeof event?.sequence !== "number") return true;
    return event.sequence > replayBoundary;
}

export function subscribeActionEventReplay(deps, filterOrListener, listenerOrOptions, maybeOptions) {
    assertReplayDeps(deps);

    const normalized = normalizeReplaySubscribeArgs(
        filterOrListener,
        listenerOrOptions,
        maybeOptions
    );

    if (normalized.options.replay !== true) {
        return deps.subscribe(normalized.filter, normalized.listener, {
            includeStreamDeltas: normalized.options.includeStreamDeltas
        });
    }

    const liveBuffer = [];
    let replayComplete = false;
    let active = true;

    const unsubscribeLive = deps.subscribe(normalized.filter, (event) => {
        if (!active) return;

        if (!replayComplete) {
            liveBuffer.push(event);
            return;
        }

        deliverActionEvent(normalized.listener, event);
    }, {
        includeStreamDeltas: normalized.options.includeStreamDeltas
    });

    function unsubscribeActionEventReplay() {
        if (!active) return false;

        active = false;
        liveBuffer.length = 0;
        return unsubscribeLive();
    }

    try {
        const replayResult = deps.readEvents(
            createReadFilter(normalized.filter, normalized.options),
            createReadOptions(normalized.options)
        );
        const replayBoundary = resolveReplayBoundary(replayResult, normalized.options);

        for (const event of replayResult.events) {
            if (!active) break;
            deliverActionEvent(normalized.listener, event);
        }

        replayComplete = true;

        for (const event of liveBuffer) {
            if (!active) break;
            if (!shouldDeliverBufferedEvent(event, replayBoundary)) continue;
            deliverActionEvent(normalized.listener, event);
        }

        liveBuffer.length = 0;
        return unsubscribeActionEventReplay;
    } catch (err) {
        unsubscribeActionEventReplay();
        throw err;
    }
}
