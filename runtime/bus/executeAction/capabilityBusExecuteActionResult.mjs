import {
    createValidationResult,
    isNonEmptyString,
    isPlainObject
} from "../contractValidation.mjs";
import {
    createCapabilityBusAcceptedEvent
} from "../capabilityBusEvents.mjs";
import {
    createResultEnvelope,
    createResultError
} from "../resultEnvelope.mjs";
import {
    copyCapabilityBusExecuteActionPlan,
    copyCapabilityBusExecuteActionValue
} from "./capabilityBusExecuteActionCommon.mjs";

function normalizeDetails(details) {
    return isPlainObject(details) ? { ...details } : {};
}

function getPlanAction(plan) {
    return plan?.busAction?.action ?? plan?.action ?? {};
}

function getPlanInvocation(plan) {
    return plan?.executionPlan?.invocation ?? {};
}

function createActionIdentityFromPlan(plan) {
    const action = getPlanAction(plan);
    const identity = {
        actionId: action.actionId,
        capability: action.capability
    };

    if (action.runId !== undefined) {
        identity.runId = action.runId;
    }

    return identity;
}

function createActionIdentityFromEnvelope(actionEnvelope) {
    if (!isPlainObject(actionEnvelope)) return null;
    if (!isNonEmptyString(actionEnvelope.actionId)) return null;
    if (!isNonEmptyString(actionEnvelope.capability)) return null;

    const identity = {
        actionId: actionEnvelope.actionId.trim(),
        capability: actionEnvelope.capability.trim()
    };

    if (actionEnvelope.runId !== undefined) {
        if (!isNonEmptyString(actionEnvelope.runId)) return null;
        identity.runId = actionEnvelope.runId.trim();
    }

    return identity;
}

function createValidationErrorDetails(validationResult, details) {
    const errors = Array.isArray(validationResult?.errors)
        ? validationResult.errors.map((error) => ({ ...error }))
        : [];

    return {
        ...normalizeDetails(details),
        errors
    };
}

export function createCapabilityBusExecuteActionAcceptedResult(plan, details = {}) {
    const invocation = getPlanInvocation(plan);

    return createResultEnvelope({
        ...createActionIdentityFromPlan(plan),
        status: "accepted",
        result: {
            executionPlan: copyCapabilityBusExecuteActionPlan(plan.executionPlan)
        },
        usage: {
            backend: invocation.backendKind,
            modelBundle: invocation.modelBundleId,
            profile: invocation.hardwareProfileId
        },
        warnings: Array.isArray(details.warnings) ? [...details.warnings] : [],
        trace: isPlainObject(details.trace) ? { ...details.trace } : {}
    });
}

export function createCapabilityBusExecuteActionAcceptedEvent(plan, fields = {}) {
    const action = getPlanAction(plan);
    const invocation = getPlanInvocation(plan);
    const data = {
        ...(isPlainObject(fields.data) ? copyCapabilityBusExecuteActionValue(fields.data) : {}),
        contractVersion: plan.contractVersion,
        executionContractVersion: plan.executionPlan?.contractVersion,
        routeId: invocation.routeId,
        serviceId: invocation.serviceId,
        adapterId: invocation.adapterId,
        backendKind: invocation.backendKind,
        modelBundleId: invocation.modelBundleId,
        hardwareProfileId: invocation.hardwareProfileId,
        resultContract: invocation.resultContract,
        eventContract: invocation.eventContract
    };

    return createCapabilityBusAcceptedEvent(action, {
        eventId: fields.eventId ?? `evt_${action.actionId}_accepted`,
        timestamp: fields.timestamp ?? 0,
        ...(fields.sequence === undefined ? {} : { sequence: fields.sequence }),
        data
    });
}

export function createCapabilityBusExecuteActionValidationFailedResult(
    actionEnvelope,
    validationResult,
    details = {}
) {
    const identity = createActionIdentityFromEnvelope(actionEnvelope);

    if (!identity) {
        return createValidationResult(
            Array.isArray(validationResult?.errors) ? validationResult.errors : []
        );
    }

    const errors = Array.isArray(validationResult?.errors) ? validationResult.errors : [];
    const error = createResultError({
        message: "Capability Bus execute-action contract validation failed",
        code: "capability_bus_execute_action_validation_failed",
        kind: "validation",
        retryable: false,
        details: createValidationErrorDetails(validationResult, details),
        ...(errors.length > 0 ? { causeCode: errors[0].code } : {})
    });

    return createResultEnvelope({
        ...identity,
        status: "failed",
        error,
        retryable: false
    });
}
