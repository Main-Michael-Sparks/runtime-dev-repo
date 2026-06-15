import { createActionEvent } from "./actionEvent.mjs";
import { normalizeActionEnvelope } from "./actionEnvelope.mjs";
import { createResultError } from "./resultEnvelope.mjs";

function copyActionIdentity(actionEnvelope) {
    const normalizedAction = normalizeActionEnvelope(actionEnvelope);
    const identity = {
        actionId: normalizedAction.actionId,
        capability: normalizedAction.capability
    };

    if (normalizedAction.runId !== undefined) {
        identity.runId = normalizedAction.runId;
    }

    return identity;
}

function normalizeError(error, fallbackCode) {
    if (error && typeof error === "object" && !Array.isArray(error)) {
        return createResultError(error);
    }

    return createResultError({
        message: typeof error === "string" ? error : "Capability Bus event error",
        code: fallbackCode,
        kind: "runtime",
        retryable: false,
        details: {}
    });
}

function createBusEvent(actionEnvelope, type, fields = {}, data = undefined) {
    return createActionEvent({
        ...copyActionIdentity(actionEnvelope),
        eventId: fields.eventId,
        type,
        timestamp: fields.timestamp,
        ...(fields.sequence === undefined ? {} : { sequence: fields.sequence }),
        ...(data === undefined ? {} : { data })
    });
}

export function createCapabilityBusAcceptedEvent(actionEnvelope, fields = {}) {
    return createBusEvent(
        actionEnvelope,
        "action.accepted",
        fields,
        fields.data
    );
}

export function createCapabilityBusRejectedEvent(actionEnvelope, error, fields = {}) {
    const normalizedError = normalizeError(error, "capability_bus_rejected");

    return createBusEvent(
        actionEnvelope,
        "action.failed",
        fields,
        {
            ...(fields.data && typeof fields.data === "object" && !Array.isArray(fields.data)
                ? fields.data
                : {}),
            error: normalizedError
        }
    );
}

export function createCapabilityBusNotImplementedEvent(actionEnvelope, error, fields = {}) {
    const normalizedError = normalizeError(error, "capability_not_implemented");

    return createBusEvent(
        actionEnvelope,
        "action.failed",
        fields,
        {
            ...(fields.data && typeof fields.data === "object" && !Array.isArray(fields.data)
                ? fields.data
                : {}),
            error: normalizedError
        }
    );
}

export function createCapabilityBusPolicyDeniedEvent(actionEnvelope, error, fields = {}) {
    const normalizedError = normalizeError(error, "capability_policy_denied");
    const policyReason = typeof fields.policyReason === "string"
        ? fields.policyReason.trim()
        : fields.policyReason;

    return createBusEvent(
        actionEnvelope,
        "action.policyDenied",
        fields,
        {
            ...(fields.data && typeof fields.data === "object" && !Array.isArray(fields.data)
                ? fields.data
                : {}),
            error: normalizedError,
            ...(policyReason === undefined ? {} : { policyReason })
        }
    );
}
