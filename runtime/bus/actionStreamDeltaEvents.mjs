import {
    createActionEvent
} from "./actionEvent.mjs";
import {
    getActionRequestByRequestId
} from "./executeAction/actionRequestRegistry.mjs";
import {
    isPlainObject
} from "./contractValidation.mjs";

function createStreamDeltaInputError(message, details = {}) {
    const err = new Error(message);
    err.code = "invalid_action_stream_delta_events";
    err.details = { ...details };
    return err;
}

function assertStreamDeltaDeps(deps) {
    if (!isPlainObject(deps)) {
        throw createStreamDeltaInputError(
            "Action stream delta dependencies must be a plain object"
        );
    }

    if (typeof deps.publishActionEvent !== "function") {
        throw createStreamDeltaInputError(
            "Action stream delta dependency publishActionEvent must be a function"
        );
    }
}

function createStreamDeltaState() {
    return {
        indexByActionId: new Map()
    };
}

function normalizeDelta(delta) {
    if (typeof delta === "string") return delta;
    return String(delta);
}

function nextStreamDeltaIndex(state, actionId) {
    const index = state.indexByActionId.get(actionId) ?? 0;
    state.indexByActionId.set(actionId, index + 1);
    return index;
}

function createStreamDeltaEvent(record, requestId, delta, index, emittedAt) {
    return createActionEvent({
        eventId: `evt_${record.actionId}_stream_delta_${index}`,
        actionId: record.actionId,
        ...(record.runId === undefined ? {} : { runId: record.runId }),
        capability: record.capability,
        type: "action.stream.delta",
        timestamp: emittedAt,
        data: {
            delta,
            index,
            requestId,
            chunkKind: "text",
            emittedAt,
            ...(record.backend === undefined ? {} : { backend: record.backend })
        }
    });
}

export function createActionStreamDeltaObserver(deps) {
    assertStreamDeltaDeps(deps);

    const state = createStreamDeltaState();

    return function observeActionStreamDelta(requestId, delta) {
        try {
            const record = getActionRequestByRequestId(deps.actionRequests, requestId);
            if (!record || record.state !== "bound") return null;
            if (!record.capability) return null;

            const normalizedDelta = normalizeDelta(delta);
            const index = nextStreamDeltaIndex(state, record.actionId);
            const emittedAt = Date.now();
            const event = createStreamDeltaEvent(
                record,
                requestId,
                normalizedDelta,
                index,
                emittedAt
            );

            deps.publishActionEvent(event, {
                liveOnly: true
            });
            return event;
        } catch {
            // Stream-delta observation must never change prompt or stream behavior.
            return null;
        }
    };
}
