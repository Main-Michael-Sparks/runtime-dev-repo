import {
    createResultEnvelope,
    createResultError
} from "./resultEnvelope.mjs";
import { normalizeActionEnvelope } from "./actionEnvelope.mjs";

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

function normalizeDetails(details) {
    return details && typeof details === "object" && !Array.isArray(details)
        ? { ...details }
        : {};
}

function createBusResultError({ message, code, kind, details, retryable = false, causeCode }) {
    return createResultError({
        message,
        code,
        kind,
        retryable,
        details: normalizeDetails(details),
        ...(causeCode === undefined ? {} : { causeCode })
    });
}

function createFailedBusResult(actionEnvelope, error) {
    return createResultEnvelope({
        ...copyActionIdentity(actionEnvelope),
        status: "failed",
        error,
        retryable: error.retryable
    });
}

export function createCapabilityNotImplementedResult(actionEnvelope, details = {}) {
    const error = createBusResultError({
        message: "Capability is not implemented by the Capability Bus skeleton",
        code: "capability_not_implemented",
        kind: "runtime",
        details
    });

    return createFailedBusResult(actionEnvelope, error);
}

export function createCapabilityUnsupportedResult(actionEnvelope, details = {}) {
    const error = createBusResultError({
        message: "Capability is not supported by the Capability Bus skeleton",
        code: "capability_unsupported",
        kind: "validation",
        details
    });

    return createFailedBusResult(actionEnvelope, error);
}

export function createCapabilityPolicyDeniedResult(actionEnvelope, policyReason, details = {}) {
    const normalizedPolicyReason = typeof policyReason === "string"
        ? policyReason.trim()
        : policyReason;
    const error = createBusResultError({
        message: normalizedPolicyReason || "Capability request denied by policy",
        code: "capability_policy_denied",
        kind: "policy",
        details: {
            ...normalizeDetails(details),
            policyReason: normalizedPolicyReason
        }
    });

    return createResultEnvelope({
        ...copyActionIdentity(actionEnvelope),
        status: "policy_denied",
        error,
        policyReason: normalizedPolicyReason,
        retryable: false
    });
}

export function createCapabilityValidationFailedResult(actionEnvelope, validationResult, details = {}) {
    const errors = Array.isArray(validationResult?.errors)
        ? validationResult.errors.map((error) => ({ ...error }))
        : [];
    const causeCode = errors.length > 0 ? errors[0].code : undefined;
    const error = createBusResultError({
        message: "Capability Bus contract validation failed",
        code: "capability_bus_validation_failed",
        kind: "validation",
        details: {
            ...normalizeDetails(details),
            errors
        },
        causeCode
    });

    return createFailedBusResult(actionEnvelope, error);
}
