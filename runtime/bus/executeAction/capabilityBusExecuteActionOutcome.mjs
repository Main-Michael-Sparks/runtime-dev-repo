import {
    assertValidation,
    createValidationError,
    createValidationResult,
    isPlainObject
} from "../contractValidation.mjs";
import {
    createActionEvent,
    validateActionEvent
} from "../actionEvent.mjs";
import {
    createResultEnvelope,
    createResultError,
    validateResultEnvelope
} from "../resultEnvelope.mjs";
import {
    validateBackendAdapterInvocationDescriptor
} from "../../backends/backendAdapterInvocationDescriptor.mjs";
import {
    validateCapabilityExecutionPlan
} from "../../execution/capabilityExecutionPlan.mjs";
import {
    validateCapabilityExecutorSkeletonPlan
} from "../../execution/capabilityExecutorSkeletonPlan.mjs";
import {
    CAPABILITY_BUS_EXECUTE_ACTION_ORCHESTRATION_CONTRACT_VERSION,
    copyCapabilityBusExecuteActionOrchestrationDescriptor
} from "./capabilityBusExecuteActionOrchestrationCommon.mjs";
import {
    validateCapabilityBusExecuteActionOrchestrationDescriptor
} from "./capabilityBusExecuteActionOrchestration.mjs";
import {
    CAPABILITY_BUS_EXECUTE_ACTION_OUTCOME_BOUNDARY,
    CAPABILITY_BUS_EXECUTE_ACTION_OUTCOME_CONTRACT_VERSION,
    CAPABILITY_BUS_EXECUTE_ACTION_OUTCOME_EXECUTABLE,
    CAPABILITY_BUS_EXECUTE_ACTION_OUTCOME_NATIVE_EXECUTION,
    CAPABILITY_BUS_EXECUTE_ACTION_OUTCOME_RUNTIME_SETTLEMENT,
    CAPABILITY_BUS_EXECUTE_ACTION_OUTCOME_RUNTIME_WIRING,
    CAPABILITY_BUS_EXECUTE_ACTION_OUTCOME_STATUS,
    addCapabilityBusExecuteActionOutcomeMetadataStringValidation,
    addForbiddenCapabilityBusExecuteActionOutcomeKeyErrors,
    addOptionalCapabilityBusExecuteActionOutcomeStringError,
    addRequiredCapabilityBusExecuteActionOutcomeStringError,
    addUnknownCapabilityBusExecuteActionOutcomeFieldErrors,
    copyCapabilityBusExecuteActionOutcomeDescriptor,
    copyCapabilityBusExecuteActionOutcomeValue,
    prefixCapabilityBusExecuteActionOutcomeValidationErrors
} from "./capabilityBusExecuteActionOutcomeCommon.mjs";

const OUTCOME_DESCRIPTOR_FIELDS = new Set([
    "contractVersion",
    "status",
    "action",
    "boundary",
    "orchestrationDescriptor",
    "resultEnvelope",
    "actionEvent",
    "metadata"
]);

const OUTCOME_ACTION_FIELDS = new Set([
    "actionId",
    "runId",
    "capability"
]);

const OUTCOME_BOUNDARY_FIELDS = new Set([
    "outcome",
    "executable",
    "runtimeSettlement",
    "runtimeWiring",
    "nativeExecution"
]);

const OUTCOME_METADATA_FIELDS = new Set([
    "actionId",
    "runId",
    "capability",
    "routeId",
    "serviceId",
    "adapterId",
    "backendKind",
    "modelBundleId",
    "hardwareProfileId",
    "resultContract",
    "eventContract",
    "resultStatus",
    "eventType"
]);

const EVENT_TYPE_BY_RESULT_STATUS = Object.freeze({
    accepted: "action.accepted",
    running: "action.started",
    completed: "action.completed",
    failed: "action.failed",
    cancelled: "action.cancelled",
    timeout: "action.timeout",
    policy_denied: "action.policyDenied"
});

function createBoundary() {
    return {
        outcome: CAPABILITY_BUS_EXECUTE_ACTION_OUTCOME_BOUNDARY,
        executable: CAPABILITY_BUS_EXECUTE_ACTION_OUTCOME_EXECUTABLE,
        runtimeSettlement: CAPABILITY_BUS_EXECUTE_ACTION_OUTCOME_RUNTIME_SETTLEMENT,
        runtimeWiring: CAPABILITY_BUS_EXECUTE_ACTION_OUTCOME_RUNTIME_WIRING,
        nativeExecution: CAPABILITY_BUS_EXECUTE_ACTION_OUTCOME_NATIVE_EXECUTION
    };
}

function createActionIdentity(orchestrationDescriptor) {
    return copyCapabilityBusExecuteActionOutcomeValue({
        actionId: orchestrationDescriptor.action.actionId,
        ...(orchestrationDescriptor.action.runId === undefined ? {} : { runId: orchestrationDescriptor.action.runId }),
        capability: orchestrationDescriptor.action.capability
    });
}

function getInvocation(orchestrationDescriptor) {
    return orchestrationDescriptor.backendAdapterInvocationDescriptor?.invocation ?? {};
}

function createMetadata(orchestrationDescriptor, resultEnvelope, actionEvent) {
    const invocation = getInvocation(orchestrationDescriptor);

    return copyCapabilityBusExecuteActionOutcomeValue({
        actionId: orchestrationDescriptor.action.actionId,
        ...(orchestrationDescriptor.action.runId === undefined ? {} : { runId: orchestrationDescriptor.action.runId }),
        capability: orchestrationDescriptor.action.capability,
        routeId: invocation.routeId,
        serviceId: invocation.serviceId,
        adapterId: invocation.adapterId,
        backendKind: invocation.backendKind,
        modelBundleId: invocation.modelBundleId,
        hardwareProfileId: invocation.hardwareProfileId,
        resultContract: invocation.resultContract,
        eventContract: invocation.eventContract,
        ...(resultEnvelope?.status === undefined ? {} : { resultStatus: resultEnvelope.status }),
        ...(actionEvent?.type === undefined ? {} : { eventType: actionEvent.type })
    });
}

function normalizeFieldsData(fields) {
    return isPlainObject(fields?.data)
        ? copyCapabilityBusExecuteActionOutcomeValue(fields.data)
        : {};
}

function createEventId(actionId, suffix, fields) {
    if (fields?.eventId !== undefined) return fields.eventId;
    return `evt_${actionId}_${suffix}`;
}

function createOutcomeEvent(orchestrationDescriptor, eventType, suffix, fields = {}, data = {}) {
    const action = createActionIdentity(orchestrationDescriptor);
    const eventData = {
        ...normalizeFieldsData(fields),
        ...copyCapabilityBusExecuteActionOutcomeValue(data),
        contractVersion: orchestrationDescriptor.contractVersion,
        orchestrationContractVersion: orchestrationDescriptor.contractVersion,
        ...createMetadata(orchestrationDescriptor, null, { type: eventType })
    };

    return createActionEvent({
        ...action,
        eventId: createEventId(action.actionId, suffix, fields),
        type: eventType,
        timestamp: fields.timestamp ?? 0,
        ...(fields.sequence === undefined ? {} : { sequence: fields.sequence }),
        data: eventData
    });
}

function createOutcomeResult(orchestrationDescriptor, status, fields = {}) {
    const invocation = getInvocation(orchestrationDescriptor);
    const action = createActionIdentity(orchestrationDescriptor);

    return createResultEnvelope({
        ...action,
        status,
        ...(fields.result === undefined ? {} : { result: copyCapabilityBusExecuteActionOutcomeValue(fields.result) }),
        ...(fields.error === undefined ? {} : { error: fields.error }),
        usage: {
            backend: invocation.backendKind,
            modelBundle: invocation.modelBundleId,
            profile: invocation.hardwareProfileId
        },
        warnings: Array.isArray(fields.warnings) ? [...fields.warnings] : [],
        trace: isPlainObject(fields.trace) ? { ...fields.trace } : {},
        ...(fields.outputRefs === undefined ? {} : { outputRefs: copyCapabilityBusExecuteActionOutcomeValue(fields.outputRefs) }),
        ...(fields.artifactRefs === undefined ? {} : { artifactRefs: copyCapabilityBusExecuteActionOutcomeValue(fields.artifactRefs) }),
        ...(fields.partial === undefined ? {} : { partial: fields.partial }),
        ...(fields.retryable === undefined ? {} : { retryable: fields.retryable }),
        ...(fields.cancellationReason === undefined ? {} : { cancellationReason: fields.cancellationReason }),
        ...(fields.policyReason === undefined ? {} : { policyReason: fields.policyReason })
    });
}

function createError(error, defaults) {
    if (isPlainObject(error)) {
        return createResultError({
            ...defaults,
            ...error,
            details: isPlainObject(error.details) ? { ...error.details } : defaults.details
        });
    }

    return createResultError({
        ...defaults,
        message: typeof error === "string" ? error : defaults.message
    });
}

function createDescriptorFromParts(orchestrationDescriptor, resultEnvelope, actionEvent) {
    return assertCapabilityBusExecuteActionOutcomeDescriptor({
        contractVersion: CAPABILITY_BUS_EXECUTE_ACTION_OUTCOME_CONTRACT_VERSION,
        status: CAPABILITY_BUS_EXECUTE_ACTION_OUTCOME_STATUS,
        action: createActionIdentity(orchestrationDescriptor),
        boundary: createBoundary(),
        orchestrationDescriptor,
        ...(resultEnvelope === null || resultEnvelope === undefined ? {} : { resultEnvelope }),
        ...(actionEvent === null || actionEvent === undefined ? {} : { actionEvent }),
        metadata: createMetadata(orchestrationDescriptor, resultEnvelope, actionEvent)
    });
}

function normalizeOrchestrationDescriptor(source) {
    return assertValidation(
        validateCapabilityBusExecuteActionOrchestrationDescriptor(source),
        "Capability Bus execute-action outcome source orchestration validation failed"
    );
}

function appendPrefixedErrors(errors, result, prefix, codePrefix) {
    if (result.ok) return;

    errors.push(...prefixCapabilityBusExecuteActionOutcomeValidationErrors(
        result.errors,
        prefix,
        codePrefix
    ));
}

function addOutcomeOwnedForbiddenKeyErrors(errors, descriptor) {
    if (!isPlainObject(descriptor)) return;

    const outcomeOwned = {
        contractVersion: descriptor.contractVersion,
        status: descriptor.status,
        action: descriptor.action,
        boundary: descriptor.boundary,
        resultEnvelope: descriptor.resultEnvelope,
        actionEvent: descriptor.actionEvent,
        metadata: descriptor.metadata
    };

    for (const key of Object.keys(descriptor)) {
        if (OUTCOME_DESCRIPTOR_FIELDS.has(key)) continue;
        outcomeOwned[key] = descriptor[key];
    }

    addForbiddenCapabilityBusExecuteActionOutcomeKeyErrors(
        errors,
        outcomeOwned,
        "forbidden_capability_bus_execute_action_outcome_descriptor_key",
        "Capability Bus execute-action outcome descriptor"
    );
}

function validateOutcomeAction(action, orchestrationDescriptor, resultEnvelope, actionEvent) {
    const errors = [];

    if (!isPlainObject(action)) {
        return createValidationResult([
            createValidationError(
                "action",
                "invalid_capability_bus_execute_action_outcome_action",
                "Capability Bus execute-action outcome action must be a plain object"
            )
        ]);
    }

    addForbiddenCapabilityBusExecuteActionOutcomeKeyErrors(
        errors,
        action,
        "forbidden_capability_bus_execute_action_outcome_action_key",
        "Capability Bus execute-action outcome action"
    );

    addUnknownCapabilityBusExecuteActionOutcomeFieldErrors(
        errors,
        action,
        OUTCOME_ACTION_FIELDS,
        "action",
        "unknown_capability_bus_execute_action_outcome_action_field",
        "capability bus execute-action outcome action"
    );

    addRequiredCapabilityBusExecuteActionOutcomeStringError(
        errors,
        action.actionId,
        "action.actionId",
        "invalid_capability_bus_execute_action_outcome_action_id",
        "Capability Bus execute-action outcome actionId"
    );
    addOptionalCapabilityBusExecuteActionOutcomeStringError(
        errors,
        action.runId,
        "action.runId",
        "invalid_capability_bus_execute_action_outcome_run_id",
        "Capability Bus execute-action outcome runId"
    );
    addRequiredCapabilityBusExecuteActionOutcomeStringError(
        errors,
        action.capability,
        "action.capability",
        "invalid_capability_bus_execute_action_outcome_capability",
        "Capability Bus execute-action outcome capability"
    );

    addCapabilityBusExecuteActionOutcomeMetadataStringValidation(errors, action.actionId, "action.actionId");
    addCapabilityBusExecuteActionOutcomeMetadataStringValidation(errors, action.runId, "action.runId");
    addCapabilityBusExecuteActionOutcomeMetadataStringValidation(errors, action.capability, "action.capability");

    const sources = [
        ["orchestration", orchestrationDescriptor?.action],
        ["resultEnvelope", resultEnvelope],
        ["actionEvent", actionEvent]
    ];

    for (const [label, source] of sources) {
        if (!isPlainObject(source)) continue;

        if (source.actionId !== undefined && action.actionId !== source.actionId) {
            errors.push(createValidationError(
                "action.actionId",
                `capability_bus_execute_action_outcome_${label}_action_id_mismatch`,
                `Capability Bus execute-action outcome actionId must match ${label} actionId`
            ));
        }

        if (source.runId !== undefined && action.runId !== source.runId) {
            errors.push(createValidationError(
                "action.runId",
                `capability_bus_execute_action_outcome_${label}_run_id_mismatch`,
                `Capability Bus execute-action outcome runId must match ${label} runId`
            ));
        }

        if (source.capability !== undefined && action.capability !== source.capability) {
            errors.push(createValidationError(
                "action.capability",
                `capability_bus_execute_action_outcome_${label}_capability_mismatch`,
                `Capability Bus execute-action outcome capability must match ${label} capability`
            ));
        }
    }

    return createValidationResult(
        errors,
        errors.length === 0 ? copyCapabilityBusExecuteActionOutcomeValue(action) : null
    );
}

function validateOutcomeBoundary(boundary) {
    const errors = [];

    if (!isPlainObject(boundary)) {
        return createValidationResult([
            createValidationError(
                "boundary",
                "invalid_capability_bus_execute_action_outcome_boundary",
                "Capability Bus execute-action outcome boundary must be a plain object"
            )
        ]);
    }

    addForbiddenCapabilityBusExecuteActionOutcomeKeyErrors(
        errors,
        boundary,
        "forbidden_capability_bus_execute_action_outcome_boundary_key",
        "Capability Bus execute-action outcome boundary"
    );

    addUnknownCapabilityBusExecuteActionOutcomeFieldErrors(
        errors,
        boundary,
        OUTCOME_BOUNDARY_FIELDS,
        "boundary",
        "unknown_capability_bus_execute_action_outcome_boundary_field",
        "capability bus execute-action outcome boundary"
    );

    if (boundary.outcome !== CAPABILITY_BUS_EXECUTE_ACTION_OUTCOME_BOUNDARY) {
        errors.push(createValidationError(
            "boundary.outcome",
            "invalid_capability_bus_execute_action_outcome_boundary_outcome",
            `Capability Bus execute-action outcome boundary.outcome must be ${CAPABILITY_BUS_EXECUTE_ACTION_OUTCOME_BOUNDARY}`,
            {
                expected: CAPABILITY_BUS_EXECUTE_ACTION_OUTCOME_BOUNDARY
            }
        ));
    }

    if (boundary.executable !== CAPABILITY_BUS_EXECUTE_ACTION_OUTCOME_EXECUTABLE) {
        errors.push(createValidationError(
            "boundary.executable",
            "invalid_capability_bus_execute_action_outcome_boundary_executable",
            "Capability Bus execute-action outcome boundary.executable must be false"
        ));
    }

    if (boundary.runtimeSettlement !== CAPABILITY_BUS_EXECUTE_ACTION_OUTCOME_RUNTIME_SETTLEMENT) {
        errors.push(createValidationError(
            "boundary.runtimeSettlement",
            "invalid_capability_bus_execute_action_outcome_boundary_runtime_settlement",
            `Capability Bus execute-action outcome boundary.runtimeSettlement must be ${CAPABILITY_BUS_EXECUTE_ACTION_OUTCOME_RUNTIME_SETTLEMENT}`,
            {
                expected: CAPABILITY_BUS_EXECUTE_ACTION_OUTCOME_RUNTIME_SETTLEMENT
            }
        ));
    }

    if (boundary.runtimeWiring !== CAPABILITY_BUS_EXECUTE_ACTION_OUTCOME_RUNTIME_WIRING) {
        errors.push(createValidationError(
            "boundary.runtimeWiring",
            "invalid_capability_bus_execute_action_outcome_boundary_runtime_wiring",
            `Capability Bus execute-action outcome boundary.runtimeWiring must be ${CAPABILITY_BUS_EXECUTE_ACTION_OUTCOME_RUNTIME_WIRING}`,
            {
                expected: CAPABILITY_BUS_EXECUTE_ACTION_OUTCOME_RUNTIME_WIRING
            }
        ));
    }

    if (boundary.nativeExecution !== CAPABILITY_BUS_EXECUTE_ACTION_OUTCOME_NATIVE_EXECUTION) {
        errors.push(createValidationError(
            "boundary.nativeExecution",
            "invalid_capability_bus_execute_action_outcome_boundary_native_execution",
            `Capability Bus execute-action outcome boundary.nativeExecution must be ${CAPABILITY_BUS_EXECUTE_ACTION_OUTCOME_NATIVE_EXECUTION}`,
            {
                expected: CAPABILITY_BUS_EXECUTE_ACTION_OUTCOME_NATIVE_EXECUTION
            }
        ));
    }

    return createValidationResult(
        errors,
        errors.length === 0 ? copyCapabilityBusExecuteActionOutcomeValue(boundary) : null
    );
}

function validateOutcomeMetadata(metadata, orchestrationDescriptor, resultEnvelope, actionEvent) {
    const errors = [];

    if (!isPlainObject(metadata)) {
        return createValidationResult([
            createValidationError(
                "metadata",
                "invalid_capability_bus_execute_action_outcome_metadata",
                "Capability Bus execute-action outcome metadata must be a plain object"
            )
        ]);
    }

    addForbiddenCapabilityBusExecuteActionOutcomeKeyErrors(
        errors,
        metadata,
        "forbidden_capability_bus_execute_action_outcome_metadata_key",
        "Capability Bus execute-action outcome metadata"
    );

    addUnknownCapabilityBusExecuteActionOutcomeFieldErrors(
        errors,
        metadata,
        OUTCOME_METADATA_FIELDS,
        "metadata",
        "unknown_capability_bus_execute_action_outcome_metadata_field",
        "capability bus execute-action outcome metadata"
    );

    const expected = createMetadata(orchestrationDescriptor, resultEnvelope, actionEvent);

    for (const field of OUTCOME_METADATA_FIELDS) {
        if (expected[field] === undefined) continue;

        addRequiredCapabilityBusExecuteActionOutcomeStringError(
            errors,
            metadata[field],
            `metadata.${field}`,
            `invalid_capability_bus_execute_action_outcome_metadata_${field}`,
            `Capability Bus execute-action outcome metadata ${field}`
        );
        addCapabilityBusExecuteActionOutcomeMetadataStringValidation(errors, metadata[field], `metadata.${field}`);

        if (metadata[field] !== expected[field]) {
            errors.push(createValidationError(
                `metadata.${field}`,
                `capability_bus_execute_action_outcome_metadata_${field}_mismatch`,
                `Capability Bus execute-action outcome metadata ${field} must match the normalized result/event source`,
                {
                    expected: expected[field]
                }
            ));
        }
    }

    for (const field of OUTCOME_METADATA_FIELDS) {
        if (expected[field] !== undefined) continue;
        if (metadata[field] === undefined) continue;

        addOptionalCapabilityBusExecuteActionOutcomeStringError(
            errors,
            metadata[field],
            `metadata.${field}`,
            `invalid_capability_bus_execute_action_outcome_metadata_${field}`,
            `Capability Bus execute-action outcome metadata ${field}`
        );
        addCapabilityBusExecuteActionOutcomeMetadataStringValidation(errors, metadata[field], `metadata.${field}`);
    }

    return createValidationResult(
        errors,
        errors.length === 0 ? copyCapabilityBusExecuteActionOutcomeValue(metadata) : null
    );
}

function validateOutcomePair(resultEnvelope, actionEvent) {
    const errors = [];

    if (resultEnvelope === undefined && actionEvent === undefined) {
        errors.push(createValidationError(
            "resultEnvelope",
            "missing_capability_bus_execute_action_outcome_result_or_event",
            "Capability Bus execute-action outcome descriptor must include resultEnvelope, actionEvent, or both"
        ));
        return createValidationResult(errors);
    }

    if (resultEnvelope?.status === "queued") {
        errors.push(createValidationError(
            "resultEnvelope.status",
            "unsupported_capability_bus_execute_action_outcome_queued_status",
            "Capability Bus execute-action outcome does not model queued status in v1"
        ));
    }

    if (isPlainObject(resultEnvelope) && isPlainObject(actionEvent)) {
        const expectedEventType = EVENT_TYPE_BY_RESULT_STATUS[resultEnvelope.status];

        if (expectedEventType !== undefined && actionEvent.type !== expectedEventType) {
            errors.push(createValidationError(
                "actionEvent.type",
                "capability_bus_execute_action_outcome_result_event_type_mismatch",
                "Capability Bus execute-action outcome event type must match resultEnvelope status",
                {
                    expected: expectedEventType
                }
            ));
        }
    }

    return createValidationResult(errors, errors.length === 0 ? true : null);
}

function validateNormalizedCapabilityBusExecuteActionOutcomeDescriptor(descriptor) {
    const errors = [];

    if (!isPlainObject(descriptor)) {
        return createValidationResult([
            createValidationError(
                "descriptor",
                "invalid_capability_bus_execute_action_outcome_descriptor",
                "Capability Bus execute-action outcome descriptor must be a plain object"
            )
        ]);
    }

    addOutcomeOwnedForbiddenKeyErrors(errors, descriptor);

    addUnknownCapabilityBusExecuteActionOutcomeFieldErrors(
        errors,
        descriptor,
        OUTCOME_DESCRIPTOR_FIELDS,
        "descriptor",
        "unknown_capability_bus_execute_action_outcome_descriptor_field",
        "capability bus execute-action outcome descriptor"
    );

    if (descriptor.contractVersion !== CAPABILITY_BUS_EXECUTE_ACTION_OUTCOME_CONTRACT_VERSION) {
        errors.push(createValidationError(
            "descriptor.contractVersion",
            "unsupported_capability_bus_execute_action_outcome_contract_version",
            `Capability Bus execute-action outcome descriptor contractVersion must be ${CAPABILITY_BUS_EXECUTE_ACTION_OUTCOME_CONTRACT_VERSION}`,
            {
                expected: CAPABILITY_BUS_EXECUTE_ACTION_OUTCOME_CONTRACT_VERSION
            }
        ));
    }

    if (descriptor.status !== CAPABILITY_BUS_EXECUTE_ACTION_OUTCOME_STATUS) {
        errors.push(createValidationError(
            "descriptor.status",
            "invalid_capability_bus_execute_action_outcome_status",
            `Capability Bus execute-action outcome descriptor status must be ${CAPABILITY_BUS_EXECUTE_ACTION_OUTCOME_STATUS}`,
            {
                expected: CAPABILITY_BUS_EXECUTE_ACTION_OUTCOME_STATUS
            }
        ));
    }

    const orchestrationResult = validateCapabilityBusExecuteActionOrchestrationDescriptor(descriptor.orchestrationDescriptor);
    appendPrefixedErrors(
        errors,
        orchestrationResult,
        "descriptor.orchestrationDescriptor",
        "capability_bus_execute_action_outcome_orchestration"
    );

    const resultEnvelopeResult = descriptor.resultEnvelope === undefined
        ? { ok: true, value: undefined, errors: [] }
        : validateResultEnvelope(descriptor.resultEnvelope);
    appendPrefixedErrors(
        errors,
        resultEnvelopeResult,
        "descriptor.resultEnvelope",
        "capability_bus_execute_action_outcome_result_envelope"
    );

    const actionEventResult = descriptor.actionEvent === undefined
        ? { ok: true, value: undefined, errors: [] }
        : validateActionEvent(descriptor.actionEvent);
    appendPrefixedErrors(
        errors,
        actionEventResult,
        "descriptor.actionEvent",
        "capability_bus_execute_action_outcome_action_event"
    );

    const actionResult = validateOutcomeAction(
        descriptor.action,
        orchestrationResult.value,
        resultEnvelopeResult.value,
        actionEventResult.value
    );
    appendPrefixedErrors(
        errors,
        actionResult,
        "descriptor",
        "capability_bus_execute_action_outcome"
    );

    const boundaryResult = validateOutcomeBoundary(descriptor.boundary);
    appendPrefixedErrors(
        errors,
        boundaryResult,
        "descriptor",
        "capability_bus_execute_action_outcome"
    );

    const pairResult = validateOutcomePair(resultEnvelopeResult.value, actionEventResult.value);
    appendPrefixedErrors(
        errors,
        pairResult,
        "descriptor",
        "capability_bus_execute_action_outcome"
    );

    const metadataResult = validateOutcomeMetadata(
        descriptor.metadata,
        orchestrationResult.value,
        resultEnvelopeResult.value,
        actionEventResult.value
    );
    appendPrefixedErrors(
        errors,
        metadataResult,
        "descriptor",
        "capability_bus_execute_action_outcome"
    );

    return createValidationResult(
        errors,
        errors.length === 0
            ? copyCapabilityBusExecuteActionOutcomeDescriptor({
                  contractVersion: CAPABILITY_BUS_EXECUTE_ACTION_OUTCOME_CONTRACT_VERSION,
                  status: CAPABILITY_BUS_EXECUTE_ACTION_OUTCOME_STATUS,
                  action: actionResult.value,
                  boundary: boundaryResult.value,
                  orchestrationDescriptor: copyCapabilityBusExecuteActionOrchestrationDescriptor(orchestrationResult.value),
                  ...(resultEnvelopeResult.value === undefined ? {} : { resultEnvelope: resultEnvelopeResult.value }),
                  ...(actionEventResult.value === undefined ? {} : { actionEvent: actionEventResult.value }),
                  metadata: metadataResult.value
              })
            : null
    );
}

function looksLikeCapabilityBusExecuteActionOutcomeDescriptor(value) {
    if (!isPlainObject(value)) return false;
    if (value.contractVersion === CAPABILITY_BUS_EXECUTE_ACTION_OUTCOME_CONTRACT_VERSION) return true;
    if (typeof value.contractVersion === "string" && value.contractVersion.startsWith("capability-bus-execute-action-outcome.")) return true;
    return isPlainObject(value.boundary) && value.boundary.outcome !== undefined;
}

function looksLikeRejectedLowerLevelSource(value) {
    if (!isPlainObject(value)) return false;
    if (value.contractVersion === CAPABILITY_BUS_EXECUTE_ACTION_ORCHESTRATION_CONTRACT_VERSION) return false;
    if (typeof value.contractVersion === "string" && value.contractVersion.startsWith("capability-bus-execute-action-orchestration.")) return false;

    return (
        validateCapabilityExecutionPlan(value).ok ||
        validateCapabilityExecutorSkeletonPlan(value).ok ||
        validateBackendAdapterInvocationDescriptor(value).ok
    );
}

export function validateCapabilityBusExecuteActionOutcomeDescriptor(value) {
    if (looksLikeCapabilityBusExecuteActionOutcomeDescriptor(value)) {
        return validateNormalizedCapabilityBusExecuteActionOutcomeDescriptor(value);
    }

    if (looksLikeRejectedLowerLevelSource(value)) {
        return createValidationResult([
            createValidationError(
                "source",
                "unsupported_capability_bus_execute_action_outcome_lower_level_source",
                "Capability Bus execute-action outcome descriptor must be derived from an execute-action orchestration descriptor, not a lower-level execution/backend descriptor"
            )
        ]);
    }

    return createValidationResult([
        createValidationError(
            "source",
            "unsupported_capability_bus_execute_action_outcome_source",
            "Capability Bus execute-action outcome descriptor must be a normalized outcome descriptor created from an execute-action orchestration descriptor"
        )
    ]);
}

export function normalizeCapabilityBusExecuteActionOutcomeDescriptor(value) {
    return assertCapabilityBusExecuteActionOutcomeDescriptor(value);
}

export function assertCapabilityBusExecuteActionOutcomeDescriptor(value) {
    return assertValidation(
        validateCapabilityBusExecuteActionOutcomeDescriptor(value),
        "Capability Bus execute-action outcome descriptor validation failed"
    );
}

export function createCapabilityBusExecuteActionAcceptedOutcome(orchestrationDescriptor, fields = {}) {
    const orchestration = normalizeOrchestrationDescriptor(orchestrationDescriptor);
    const resultEnvelope = createOutcomeResult(orchestration, "accepted", fields);
    const actionEvent = createOutcomeEvent(orchestration, "action.accepted", "accepted", fields);
    return createDescriptorFromParts(orchestration, resultEnvelope, actionEvent);
}

export function createCapabilityBusExecuteActionStartedOutcome(orchestrationDescriptor, fields = {}) {
    const orchestration = normalizeOrchestrationDescriptor(orchestrationDescriptor);
    const resultEnvelope = createOutcomeResult(orchestration, "running", fields);
    const actionEvent = createOutcomeEvent(orchestration, "action.started", "started", fields);
    return createDescriptorFromParts(orchestration, resultEnvelope, actionEvent);
}

export function createCapabilityBusExecuteActionStreamDeltaEvent(orchestrationDescriptor, fields = {}) {
    const orchestration = normalizeOrchestrationDescriptor(orchestrationDescriptor);
    const data = {
        ...(fields.delta === undefined ? {} : { delta: fields.delta }),
        ...(fields.index === undefined ? {} : { index: fields.index })
    };

    return createOutcomeEvent(orchestration, "action.stream.delta", "stream_delta", fields, data);
}

export function createCapabilityBusExecuteActionStreamDeltaOutcome(orchestrationDescriptor, fields = {}) {
    const orchestration = normalizeOrchestrationDescriptor(orchestrationDescriptor);
    const actionEvent = createCapabilityBusExecuteActionStreamDeltaEvent(orchestration, fields);
    return createDescriptorFromParts(orchestration, null, actionEvent);
}

export function createCapabilityBusExecuteActionCompletedOutcome(orchestrationDescriptor, fields = {}) {
    const orchestration = normalizeOrchestrationDescriptor(orchestrationDescriptor);
    const resultEnvelope = createOutcomeResult(orchestration, "completed", {
        ...fields,
        result: fields.result ?? {}
    });
    const actionEvent = createOutcomeEvent(orchestration, "action.completed", "completed", fields);
    return createDescriptorFromParts(orchestration, resultEnvelope, actionEvent);
}

export function createCapabilityBusExecuteActionFailedOutcome(orchestrationDescriptor, error, fields = {}) {
    const orchestration = normalizeOrchestrationDescriptor(orchestrationDescriptor);
    const normalizedError = createError(error, {
        message: "Capability Bus execute-action failed",
        code: "capability_bus_execute_action_failed",
        kind: "runtime",
        retryable: false,
        details: {}
    });
    const resultEnvelope = createOutcomeResult(orchestration, "failed", {
        ...fields,
        error: normalizedError,
        retryable: normalizedError.retryable
    });
    const actionEvent = createOutcomeEvent(orchestration, "action.failed", "failed", fields, {
        error: normalizedError
    });
    return createDescriptorFromParts(orchestration, resultEnvelope, actionEvent);
}

export function createCapabilityBusExecuteActionCancelledOutcome(orchestrationDescriptor, reasonOrError, fields = {}) {
    const orchestration = normalizeOrchestrationDescriptor(orchestrationDescriptor);
    const normalizedReason = typeof reasonOrError === "string" ? reasonOrError.trim() : fields.cancellationReason;
    const normalizedError = isPlainObject(reasonOrError)
        ? createError(reasonOrError, {
              message: "Capability Bus execute-action cancelled",
              code: "capability_bus_execute_action_cancelled",
              kind: "cancellation",
              retryable: false,
              details: {}
          })
        : fields.error;
    const cancellationReason = normalizedReason || normalizedError?.message || "Capability Bus execute-action cancelled";
    const resultEnvelope = createOutcomeResult(orchestration, "cancelled", {
        ...fields,
        ...(normalizedError === undefined ? {} : { error: normalizedError }),
        cancellationReason,
        retryable: false
    });
    const actionEvent = createOutcomeEvent(orchestration, "action.cancelled", "cancelled", fields, {
        ...(normalizedError === undefined ? {} : { error: normalizedError }),
        cancellationReason
    });
    return createDescriptorFromParts(orchestration, resultEnvelope, actionEvent);
}

export function createCapabilityBusExecuteActionTimeoutOutcome(orchestrationDescriptor, reasonOrError, fields = {}) {
    const orchestration = normalizeOrchestrationDescriptor(orchestrationDescriptor);
    const normalizedReason = typeof reasonOrError === "string" ? reasonOrError.trim() : fields.cancellationReason;
    const normalizedError = isPlainObject(reasonOrError)
        ? createError(reasonOrError, {
              message: "Capability Bus execute-action timed out",
              code: "capability_bus_execute_action_timeout",
              kind: "timeout",
              retryable: false,
              details: {}
          })
        : fields.error;
    const cancellationReason = normalizedReason || normalizedError?.message || "Capability Bus execute-action timed out";
    const resultEnvelope = createOutcomeResult(orchestration, "timeout", {
        ...fields,
        ...(normalizedError === undefined ? {} : { error: normalizedError }),
        cancellationReason,
        retryable: false
    });
    const actionEvent = createOutcomeEvent(orchestration, "action.timeout", "timeout", fields, {
        ...(normalizedError === undefined ? {} : { error: normalizedError }),
        cancellationReason
    });
    return createDescriptorFromParts(orchestration, resultEnvelope, actionEvent);
}

export function createCapabilityBusExecuteActionPolicyDeniedOutcome(orchestrationDescriptor, reasonOrError, fields = {}) {
    const orchestration = normalizeOrchestrationDescriptor(orchestrationDescriptor);
    const normalizedReason = typeof reasonOrError === "string" ? reasonOrError.trim() : fields.policyReason;
    const normalizedError = isPlainObject(reasonOrError)
        ? createError(reasonOrError, {
              message: "Capability Bus execute-action denied by policy",
              code: "capability_bus_execute_action_policy_denied",
              kind: "policy",
              retryable: false,
              details: {}
          })
        : fields.error;
    const policyReason = normalizedReason || normalizedError?.message || "Capability Bus execute-action denied by policy";
    const resultEnvelope = createOutcomeResult(orchestration, "policy_denied", {
        ...fields,
        ...(normalizedError === undefined ? {} : { error: normalizedError }),
        policyReason,
        retryable: false
    });
    const actionEvent = createOutcomeEvent(orchestration, "action.policyDenied", "policy_denied", fields, {
        ...(normalizedError === undefined ? {} : { error: normalizedError }),
        policyReason
    });
    return createDescriptorFromParts(orchestration, resultEnvelope, actionEvent);
}
