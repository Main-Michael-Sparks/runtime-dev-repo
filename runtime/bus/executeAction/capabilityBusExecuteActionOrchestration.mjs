import {
    assertValidation,
    createValidationError,
    createValidationResult,
    isPlainObject
} from "../contractValidation.mjs";
import {
    validateCapabilityExecutionPlan
} from "../../execution/capabilityExecutionPlan.mjs";
import {
    validateCapabilityExecutorSkeletonPlan
} from "../../execution/capabilityExecutorSkeletonPlan.mjs";
import {
    validateBackendAdapterInvocationDescriptor
} from "../../backends/backendAdapterInvocationDescriptor.mjs";
import {
    CAPABILITY_BUS_EXECUTE_ACTION_CONTRACT_VERSION,
    copyCapabilityBusExecuteActionPlan
} from "./capabilityBusExecuteActionCommon.mjs";
import {
    CAPABILITY_BUS_EXECUTE_ACTION_ORCHESTRATION_ADAPTER_INVOCATION,
    CAPABILITY_BUS_EXECUTE_ACTION_ORCHESTRATION_BOUNDARY,
    CAPABILITY_BUS_EXECUTE_ACTION_ORCHESTRATION_CHAIN,
    CAPABILITY_BUS_EXECUTE_ACTION_ORCHESTRATION_CONTRACT_VERSION,
    CAPABILITY_BUS_EXECUTE_ACTION_ORCHESTRATION_EXECUTABLE,
    CAPABILITY_BUS_EXECUTE_ACTION_ORCHESTRATION_NATIVE_EXECUTION,
    CAPABILITY_BUS_EXECUTE_ACTION_ORCHESTRATION_RUNTIME_WIRING,
    CAPABILITY_BUS_EXECUTE_ACTION_ORCHESTRATION_STATUS,
    addCapabilityBusExecuteActionOrchestrationMetadataStringValidation,
    addForbiddenCapabilityBusExecuteActionOrchestrationKeyErrors,
    addOptionalCapabilityBusExecuteActionOrchestrationStringError,
    addRequiredCapabilityBusExecuteActionOrchestrationStringError,
    addUnknownCapabilityBusExecuteActionOrchestrationFieldErrors,
    copyCapabilityBusExecuteActionOrchestrationDescriptor,
    copyCapabilityBusExecuteActionOrchestrationValue,
    prefixCapabilityBusExecuteActionOrchestrationValidationErrors
} from "./capabilityBusExecuteActionOrchestrationCommon.mjs";

const EXECUTE_ACTION_PLAN_FIELDS = new Set([
    "contractVersion",
    "status",
    "action",
    "busAction",
    "routePlan",
    "servicePlan",
    "backendPlan",
    "executionPlan"
]);

const EXECUTE_ACTION_PLAN_ACTION_FIELDS = new Set([
    "actionId",
    "runId",
    "capability"
]);

const ORCHESTRATION_DESCRIPTOR_FIELDS = new Set([
    "contractVersion",
    "status",
    "action",
    "orchestration",
    "executeActionPlan",
    "executorSkeletonPlan",
    "backendAdapterInvocationDescriptor",
    "boundary"
]);

const ORCHESTRATION_ACTION_FIELDS = new Set([
    "actionId",
    "runId",
    "capability"
]);

const ORCHESTRATION_METADATA_FIELDS = new Set([
    "chain",
    "composition",
    "execution"
]);

const ORCHESTRATION_BOUNDARY_FIELDS = new Set([
    "orchestration",
    "executable",
    "adapterInvocation",
    "runtimeWiring",
    "nativeExecution"
]);

function createBoundary() {
    return {
        orchestration: CAPABILITY_BUS_EXECUTE_ACTION_ORCHESTRATION_BOUNDARY,
        executable: CAPABILITY_BUS_EXECUTE_ACTION_ORCHESTRATION_EXECUTABLE,
        adapterInvocation: CAPABILITY_BUS_EXECUTE_ACTION_ORCHESTRATION_ADAPTER_INVOCATION,
        runtimeWiring: CAPABILITY_BUS_EXECUTE_ACTION_ORCHESTRATION_RUNTIME_WIRING,
        nativeExecution: CAPABILITY_BUS_EXECUTE_ACTION_ORCHESTRATION_NATIVE_EXECUTION
    };
}

function createOrchestrationMetadata() {
    return {
        chain: [...CAPABILITY_BUS_EXECUTE_ACTION_ORCHESTRATION_CHAIN],
        composition: "descriptor-chain",
        execution: "not-started"
    };
}

function createActionIdentityFromExecuteActionPlan(executeActionPlan) {
    return copyCapabilityBusExecuteActionOrchestrationValue({
        actionId: executeActionPlan.action.actionId,
        ...(executeActionPlan.action.runId === undefined ? {} : { runId: executeActionPlan.action.runId }),
        capability: executeActionPlan.action.capability
    });
}

function createDescriptorFromExecuteActionPlan(executeActionPlan) {
    const executorSkeletonResult = validateCapabilityExecutorSkeletonPlan(executeActionPlan.executionPlan);

    if (!executorSkeletonResult.ok) {
        return createValidationResult(prefixCapabilityBusExecuteActionOrchestrationValidationErrors(
            executorSkeletonResult.errors,
            "source.executionPlan",
            "capability_bus_execute_action_orchestration_source_skeleton"
        ));
    }

    const backendInvocationResult = validateBackendAdapterInvocationDescriptor(executorSkeletonResult.value);

    if (!backendInvocationResult.ok) {
        return createValidationResult(prefixCapabilityBusExecuteActionOrchestrationValidationErrors(
            backendInvocationResult.errors,
            "source.executorSkeletonPlan",
            "capability_bus_execute_action_orchestration_source_backend_invocation"
        ));
    }

    return validateNormalizedCapabilityBusExecuteActionOrchestrationDescriptor({
        contractVersion: CAPABILITY_BUS_EXECUTE_ACTION_ORCHESTRATION_CONTRACT_VERSION,
        status: CAPABILITY_BUS_EXECUTE_ACTION_ORCHESTRATION_STATUS,
        action: createActionIdentityFromExecuteActionPlan(executeActionPlan),
        orchestration: createOrchestrationMetadata(),
        executeActionPlan,
        executorSkeletonPlan: executorSkeletonResult.value,
        backendAdapterInvocationDescriptor: backendInvocationResult.value,
        boundary: createBoundary()
    });
}

function comparableJson(value) {
    return JSON.stringify(value);
}

function appendPrefixedErrors(errors, result, prefix, codePrefix) {
    if (result.ok) return;

    errors.push(...prefixCapabilityBusExecuteActionOrchestrationValidationErrors(
        result.errors,
        prefix,
        codePrefix
    ));
}

function addOrchestrationOwnedForbiddenKeyErrors(errors, descriptor) {
    if (!isPlainObject(descriptor)) return;

    const orchestrationOwned = {
        contractVersion: descriptor.contractVersion,
        status: descriptor.status,
        action: descriptor.action,
        orchestration: descriptor.orchestration,
        boundary: descriptor.boundary
    };

    for (const key of Object.keys(descriptor)) {
        if (ORCHESTRATION_DESCRIPTOR_FIELDS.has(key)) continue;
        orchestrationOwned[key] = descriptor[key];
    }

    addForbiddenCapabilityBusExecuteActionOrchestrationKeyErrors(
        errors,
        orchestrationOwned,
        "forbidden_capability_bus_execute_action_orchestration_descriptor_key",
        "Capability Bus execute-action orchestration descriptor"
    );
}

function validateExecuteActionPlanAction(action, executionInvocation) {
    const errors = [];

    if (!isPlainObject(action)) {
        return createValidationResult([
            createValidationError(
                "action",
                "invalid_capability_bus_execute_action_orchestration_execute_action_identity",
                "Capability Bus execute-action orchestration source action identity must be a plain object"
            )
        ]);
    }

    addForbiddenCapabilityBusExecuteActionOrchestrationKeyErrors(
        errors,
        action,
        "forbidden_capability_bus_execute_action_orchestration_execute_action_identity_key",
        "Capability Bus execute-action source action identity"
    );

    addUnknownCapabilityBusExecuteActionOrchestrationFieldErrors(
        errors,
        action,
        EXECUTE_ACTION_PLAN_ACTION_FIELDS,
        "action",
        "unknown_capability_bus_execute_action_orchestration_execute_action_identity_field",
        "capability bus execute-action source action identity"
    );

    addRequiredCapabilityBusExecuteActionOrchestrationStringError(
        errors,
        action.actionId,
        "action.actionId",
        "invalid_capability_bus_execute_action_orchestration_action_id",
        "Capability Bus execute-action source actionId"
    );
    addOptionalCapabilityBusExecuteActionOrchestrationStringError(
        errors,
        action.runId,
        "action.runId",
        "invalid_capability_bus_execute_action_orchestration_run_id",
        "Capability Bus execute-action source runId"
    );
    addRequiredCapabilityBusExecuteActionOrchestrationStringError(
        errors,
        action.capability,
        "action.capability",
        "invalid_capability_bus_execute_action_orchestration_capability",
        "Capability Bus execute-action source capability"
    );

    addCapabilityBusExecuteActionOrchestrationMetadataStringValidation(errors, action.actionId, "action.actionId");
    addCapabilityBusExecuteActionOrchestrationMetadataStringValidation(errors, action.runId, "action.runId");
    addCapabilityBusExecuteActionOrchestrationMetadataStringValidation(errors, action.capability, "action.capability");

    if (isPlainObject(executionInvocation)) {
        if (action.actionId !== executionInvocation.actionId) {
            errors.push(createValidationError(
                "action.actionId",
                "capability_bus_execute_action_orchestration_action_id_mismatch",
                "Capability Bus execute-action source actionId must match executionPlan invocation actionId"
            ));
        }

        if (action.runId !== executionInvocation.runId) {
            errors.push(createValidationError(
                "action.runId",
                "capability_bus_execute_action_orchestration_run_id_mismatch",
                "Capability Bus execute-action source runId must match executionPlan invocation runId"
            ));
        }

        if (action.capability !== executionInvocation.capability) {
            errors.push(createValidationError(
                "action.capability",
                "capability_bus_execute_action_orchestration_capability_mismatch",
                "Capability Bus execute-action source capability must match executionPlan invocation capability"
            ));
        }
    }

    return createValidationResult(
        errors,
        errors.length === 0 ? copyCapabilityBusExecuteActionOrchestrationValue(action) : null
    );
}

function validateAcceptedExecuteActionPlan(plan) {
    const errors = [];

    if (!isPlainObject(plan)) {
        return createValidationResult([
            createValidationError(
                "source",
                "invalid_capability_bus_execute_action_orchestration_source",
                "Capability Bus execute-action orchestration source must be an accepted execute-action plan"
            )
        ]);
    }

    addForbiddenCapabilityBusExecuteActionOrchestrationKeyErrors(
        errors,
        {
            contractVersion: plan.contractVersion,
            status: plan.status,
            action: plan.action,
            ...Object.fromEntries(Object.entries(plan).filter(([key]) => !EXECUTE_ACTION_PLAN_FIELDS.has(key)))
        },
        "forbidden_capability_bus_execute_action_orchestration_source_key",
        "Capability Bus execute-action orchestration source"
    );

    addUnknownCapabilityBusExecuteActionOrchestrationFieldErrors(
        errors,
        plan,
        EXECUTE_ACTION_PLAN_FIELDS,
        "source",
        "unknown_capability_bus_execute_action_orchestration_source_field",
        "capability bus execute-action orchestration source"
    );

    if (plan.contractVersion !== CAPABILITY_BUS_EXECUTE_ACTION_CONTRACT_VERSION) {
        errors.push(createValidationError(
            "source.contractVersion",
            "unsupported_capability_bus_execute_action_orchestration_source_contract_version",
            `Capability Bus execute-action orchestration source contractVersion must be ${CAPABILITY_BUS_EXECUTE_ACTION_CONTRACT_VERSION}`,
            {
                expected: CAPABILITY_BUS_EXECUTE_ACTION_CONTRACT_VERSION
            }
        ));
    }

    if (plan.status !== "accepted") {
        errors.push(createValidationError(
            "source.status",
            "invalid_capability_bus_execute_action_orchestration_source_status",
            "Capability Bus execute-action orchestration source status must be accepted"
        ));
    }

    const executionPlanResult = validateCapabilityExecutionPlan(plan.executionPlan);
    appendPrefixedErrors(
        errors,
        executionPlanResult,
        "source.executionPlan",
        "capability_bus_execute_action_orchestration_source_execution"
    );

    const executionPlan = executionPlanResult.value;
    const actionResult = validateExecuteActionPlanAction(plan.action, executionPlan?.invocation);
    appendPrefixedErrors(
        errors,
        actionResult,
        "source",
        "capability_bus_execute_action_orchestration_source"
    );

    if (executionPlanResult.ok && isPlainObject(plan.backendPlan)) {
        if (comparableJson(plan.backendPlan) !== comparableJson(executionPlan.backendPlan)) {
            errors.push(createValidationError(
                "source.backendPlan",
                "capability_bus_execute_action_orchestration_backend_plan_mismatch",
                "Capability Bus execute-action source backendPlan must match executionPlan backendPlan"
            ));
        }
    }

    if (executionPlanResult.ok && isPlainObject(plan.servicePlan)) {
        if (comparableJson(plan.servicePlan) !== comparableJson(executionPlan.backendPlan.servicePlan)) {
            errors.push(createValidationError(
                "source.servicePlan",
                "capability_bus_execute_action_orchestration_service_plan_mismatch",
                "Capability Bus execute-action source servicePlan must match executionPlan backendPlan servicePlan"
            ));
        }
    }

    if (executionPlanResult.ok && isPlainObject(plan.routePlan)) {
        if (comparableJson(plan.routePlan) !== comparableJson(executionPlan.backendPlan.servicePlan.routePlan)) {
            errors.push(createValidationError(
                "source.routePlan",
                "capability_bus_execute_action_orchestration_route_plan_mismatch",
                "Capability Bus execute-action source routePlan must match executionPlan routePlan"
            ));
        }
    }

    if (executionPlanResult.ok && isPlainObject(plan.busAction)) {
        if (comparableJson(plan.busAction) !== comparableJson(executionPlan.backendPlan.servicePlan.routePlan.busAction)) {
            errors.push(createValidationError(
                "source.busAction",
                "capability_bus_execute_action_orchestration_bus_action_mismatch",
                "Capability Bus execute-action source busAction must match executionPlan busAction"
            ));
        }
    }

    return createValidationResult(
        errors,
        errors.length === 0
            ? copyCapabilityBusExecuteActionPlan({
                  contractVersion: CAPABILITY_BUS_EXECUTE_ACTION_CONTRACT_VERSION,
                  status: "accepted",
                  action: actionResult.value,
                  busAction: executionPlan.backendPlan.servicePlan.routePlan.busAction,
                  routePlan: executionPlan.backendPlan.servicePlan.routePlan,
                  servicePlan: executionPlan.backendPlan.servicePlan,
                  backendPlan: executionPlan.backendPlan,
                  executionPlan
              })
            : null
    );
}

function validateOrchestrationAction(action, executeActionPlan, backendInvocationDescriptor) {
    const errors = [];

    if (!isPlainObject(action)) {
        return createValidationResult([
            createValidationError(
                "action",
                "invalid_capability_bus_execute_action_orchestration_action",
                "Capability Bus execute-action orchestration action must be a plain object"
            )
        ]);
    }

    addForbiddenCapabilityBusExecuteActionOrchestrationKeyErrors(
        errors,
        action,
        "forbidden_capability_bus_execute_action_orchestration_action_key",
        "Capability Bus execute-action orchestration action"
    );

    addUnknownCapabilityBusExecuteActionOrchestrationFieldErrors(
        errors,
        action,
        ORCHESTRATION_ACTION_FIELDS,
        "action",
        "unknown_capability_bus_execute_action_orchestration_action_field",
        "capability bus execute-action orchestration action"
    );

    addRequiredCapabilityBusExecuteActionOrchestrationStringError(
        errors,
        action.actionId,
        "action.actionId",
        "invalid_capability_bus_execute_action_orchestration_action_id",
        "Capability Bus execute-action orchestration actionId"
    );
    addOptionalCapabilityBusExecuteActionOrchestrationStringError(
        errors,
        action.runId,
        "action.runId",
        "invalid_capability_bus_execute_action_orchestration_run_id",
        "Capability Bus execute-action orchestration runId"
    );
    addRequiredCapabilityBusExecuteActionOrchestrationStringError(
        errors,
        action.capability,
        "action.capability",
        "invalid_capability_bus_execute_action_orchestration_capability",
        "Capability Bus execute-action orchestration capability"
    );

    addCapabilityBusExecuteActionOrchestrationMetadataStringValidation(errors, action.actionId, "action.actionId");
    addCapabilityBusExecuteActionOrchestrationMetadataStringValidation(errors, action.runId, "action.runId");
    addCapabilityBusExecuteActionOrchestrationMetadataStringValidation(errors, action.capability, "action.capability");

    if (isPlainObject(executeActionPlan?.action)) {
        if (action.actionId !== executeActionPlan.action.actionId) {
            errors.push(createValidationError(
                "action.actionId",
                "capability_bus_execute_action_orchestration_action_id_mismatch",
                "Capability Bus execute-action orchestration actionId must match executeActionPlan actionId"
            ));
        }

        if (action.runId !== executeActionPlan.action.runId) {
            errors.push(createValidationError(
                "action.runId",
                "capability_bus_execute_action_orchestration_run_id_mismatch",
                "Capability Bus execute-action orchestration runId must match executeActionPlan runId"
            ));
        }

        if (action.capability !== executeActionPlan.action.capability) {
            errors.push(createValidationError(
                "action.capability",
                "capability_bus_execute_action_orchestration_capability_mismatch",
                "Capability Bus execute-action orchestration capability must match executeActionPlan capability"
            ));
        }
    }

    if (isPlainObject(backendInvocationDescriptor?.invocation)) {
        if (action.actionId !== backendInvocationDescriptor.invocation.actionId) {
            errors.push(createValidationError(
                "action.actionId",
                "capability_bus_execute_action_orchestration_backend_invocation_action_id_mismatch",
                "Capability Bus execute-action orchestration actionId must match backend invocation actionId"
            ));
        }
    }

    return createValidationResult(
        errors,
        errors.length === 0 ? copyCapabilityBusExecuteActionOrchestrationValue(action) : null
    );
}

function validateOrchestrationMetadata(orchestration) {
    const errors = [];

    if (!isPlainObject(orchestration)) {
        return createValidationResult([
            createValidationError(
                "orchestration",
                "invalid_capability_bus_execute_action_orchestration_metadata",
                "Capability Bus execute-action orchestration metadata must be a plain object"
            )
        ]);
    }

    addForbiddenCapabilityBusExecuteActionOrchestrationKeyErrors(
        errors,
        orchestration,
        "forbidden_capability_bus_execute_action_orchestration_metadata_key",
        "Capability Bus execute-action orchestration metadata"
    );

    addUnknownCapabilityBusExecuteActionOrchestrationFieldErrors(
        errors,
        orchestration,
        ORCHESTRATION_METADATA_FIELDS,
        "orchestration",
        "unknown_capability_bus_execute_action_orchestration_metadata_field",
        "capability bus execute-action orchestration metadata"
    );

    if (!Array.isArray(orchestration.chain)) {
        errors.push(createValidationError(
            "orchestration.chain",
            "invalid_capability_bus_execute_action_orchestration_chain",
            "Capability Bus execute-action orchestration chain must be an array"
        ));
    } else if (comparableJson(orchestration.chain) !== comparableJson(CAPABILITY_BUS_EXECUTE_ACTION_ORCHESTRATION_CHAIN)) {
        errors.push(createValidationError(
            "orchestration.chain",
            "invalid_capability_bus_execute_action_orchestration_chain_order",
            "Capability Bus execute-action orchestration chain must match the expected descriptor chain"
        ));
    }

    if (orchestration.composition !== "descriptor-chain") {
        errors.push(createValidationError(
            "orchestration.composition",
            "invalid_capability_bus_execute_action_orchestration_composition",
            "Capability Bus execute-action orchestration composition must be descriptor-chain"
        ));
    }

    if (orchestration.execution !== "not-started") {
        errors.push(createValidationError(
            "orchestration.execution",
            "invalid_capability_bus_execute_action_orchestration_execution",
            "Capability Bus execute-action orchestration execution must be not-started"
        ));
    }

    return createValidationResult(
        errors,
        errors.length === 0 ? copyCapabilityBusExecuteActionOrchestrationValue(orchestration) : null
    );
}

function validateOrchestrationBoundary(boundary) {
    const errors = [];

    if (!isPlainObject(boundary)) {
        return createValidationResult([
            createValidationError(
                "boundary",
                "invalid_capability_bus_execute_action_orchestration_boundary",
                "Capability Bus execute-action orchestration boundary must be a plain object"
            )
        ]);
    }

    addForbiddenCapabilityBusExecuteActionOrchestrationKeyErrors(
        errors,
        boundary,
        "forbidden_capability_bus_execute_action_orchestration_boundary_key",
        "Capability Bus execute-action orchestration boundary"
    );

    addUnknownCapabilityBusExecuteActionOrchestrationFieldErrors(
        errors,
        boundary,
        ORCHESTRATION_BOUNDARY_FIELDS,
        "boundary",
        "unknown_capability_bus_execute_action_orchestration_boundary_field",
        "capability bus execute-action orchestration boundary"
    );

    if (boundary.orchestration !== CAPABILITY_BUS_EXECUTE_ACTION_ORCHESTRATION_BOUNDARY) {
        errors.push(createValidationError(
            "boundary.orchestration",
            "invalid_capability_bus_execute_action_orchestration_boundary_orchestration",
            `Capability Bus execute-action orchestration boundary.orchestration must be ${CAPABILITY_BUS_EXECUTE_ACTION_ORCHESTRATION_BOUNDARY}`,
            {
                expected: CAPABILITY_BUS_EXECUTE_ACTION_ORCHESTRATION_BOUNDARY
            }
        ));
    }

    if (boundary.executable !== CAPABILITY_BUS_EXECUTE_ACTION_ORCHESTRATION_EXECUTABLE) {
        errors.push(createValidationError(
            "boundary.executable",
            "invalid_capability_bus_execute_action_orchestration_boundary_executable",
            "Capability Bus execute-action orchestration boundary.executable must be false"
        ));
    }

    if (boundary.adapterInvocation !== CAPABILITY_BUS_EXECUTE_ACTION_ORCHESTRATION_ADAPTER_INVOCATION) {
        errors.push(createValidationError(
            "boundary.adapterInvocation",
            "invalid_capability_bus_execute_action_orchestration_boundary_adapter_invocation",
            `Capability Bus execute-action orchestration boundary.adapterInvocation must be ${CAPABILITY_BUS_EXECUTE_ACTION_ORCHESTRATION_ADAPTER_INVOCATION}`,
            {
                expected: CAPABILITY_BUS_EXECUTE_ACTION_ORCHESTRATION_ADAPTER_INVOCATION
            }
        ));
    }

    if (boundary.runtimeWiring !== CAPABILITY_BUS_EXECUTE_ACTION_ORCHESTRATION_RUNTIME_WIRING) {
        errors.push(createValidationError(
            "boundary.runtimeWiring",
            "invalid_capability_bus_execute_action_orchestration_boundary_runtime_wiring",
            `Capability Bus execute-action orchestration boundary.runtimeWiring must be ${CAPABILITY_BUS_EXECUTE_ACTION_ORCHESTRATION_RUNTIME_WIRING}`,
            {
                expected: CAPABILITY_BUS_EXECUTE_ACTION_ORCHESTRATION_RUNTIME_WIRING
            }
        ));
    }

    if (boundary.nativeExecution !== CAPABILITY_BUS_EXECUTE_ACTION_ORCHESTRATION_NATIVE_EXECUTION) {
        errors.push(createValidationError(
            "boundary.nativeExecution",
            "invalid_capability_bus_execute_action_orchestration_boundary_native_execution",
            `Capability Bus execute-action orchestration boundary.nativeExecution must be ${CAPABILITY_BUS_EXECUTE_ACTION_ORCHESTRATION_NATIVE_EXECUTION}`,
            {
                expected: CAPABILITY_BUS_EXECUTE_ACTION_ORCHESTRATION_NATIVE_EXECUTION
            }
        ));
    }

    return createValidationResult(
        errors,
        errors.length === 0 ? copyCapabilityBusExecuteActionOrchestrationValue(boundary) : null
    );
}

function validateNormalizedCapabilityBusExecuteActionOrchestrationDescriptor(descriptor) {
    const errors = [];

    if (!isPlainObject(descriptor)) {
        return createValidationResult([
            createValidationError(
                "descriptor",
                "invalid_capability_bus_execute_action_orchestration_descriptor",
                "Capability Bus execute-action orchestration descriptor must be a plain object"
            )
        ]);
    }

    addOrchestrationOwnedForbiddenKeyErrors(errors, descriptor);

    addUnknownCapabilityBusExecuteActionOrchestrationFieldErrors(
        errors,
        descriptor,
        ORCHESTRATION_DESCRIPTOR_FIELDS,
        "descriptor",
        "unknown_capability_bus_execute_action_orchestration_descriptor_field",
        "capability bus execute-action orchestration descriptor"
    );

    if (descriptor.contractVersion !== CAPABILITY_BUS_EXECUTE_ACTION_ORCHESTRATION_CONTRACT_VERSION) {
        errors.push(createValidationError(
            "descriptor.contractVersion",
            "unsupported_capability_bus_execute_action_orchestration_contract_version",
            `Capability Bus execute-action orchestration descriptor contractVersion must be ${CAPABILITY_BUS_EXECUTE_ACTION_ORCHESTRATION_CONTRACT_VERSION}`,
            {
                expected: CAPABILITY_BUS_EXECUTE_ACTION_ORCHESTRATION_CONTRACT_VERSION
            }
        ));
    }

    if (descriptor.status !== CAPABILITY_BUS_EXECUTE_ACTION_ORCHESTRATION_STATUS) {
        errors.push(createValidationError(
            "descriptor.status",
            "invalid_capability_bus_execute_action_orchestration_status",
            `Capability Bus execute-action orchestration descriptor status must be ${CAPABILITY_BUS_EXECUTE_ACTION_ORCHESTRATION_STATUS}`,
            {
                expected: CAPABILITY_BUS_EXECUTE_ACTION_ORCHESTRATION_STATUS
            }
        ));
    }

    const executeActionPlanResult = validateAcceptedExecuteActionPlan(descriptor.executeActionPlan);
    appendPrefixedErrors(
        errors,
        executeActionPlanResult,
        "descriptor.executeActionPlan",
        "capability_bus_execute_action_orchestration_execute_action_plan"
    );

    const executorSkeletonResult = validateCapabilityExecutorSkeletonPlan(descriptor.executorSkeletonPlan);
    appendPrefixedErrors(
        errors,
        executorSkeletonResult,
        "descriptor.executorSkeletonPlan",
        "capability_bus_execute_action_orchestration_executor_skeleton"
    );

    const backendInvocationResult = validateBackendAdapterInvocationDescriptor(descriptor.backendAdapterInvocationDescriptor);
    appendPrefixedErrors(
        errors,
        backendInvocationResult,
        "descriptor.backendAdapterInvocationDescriptor",
        "capability_bus_execute_action_orchestration_backend_invocation"
    );

    const actionResult = validateOrchestrationAction(
        descriptor.action,
        executeActionPlanResult.value,
        backendInvocationResult.value
    );
    appendPrefixedErrors(
        errors,
        actionResult,
        "descriptor",
        "capability_bus_execute_action_orchestration"
    );

    const orchestrationResult = validateOrchestrationMetadata(descriptor.orchestration);
    appendPrefixedErrors(
        errors,
        orchestrationResult,
        "descriptor",
        "capability_bus_execute_action_orchestration"
    );

    const boundaryResult = validateOrchestrationBoundary(descriptor.boundary);
    appendPrefixedErrors(
        errors,
        boundaryResult,
        "descriptor",
        "capability_bus_execute_action_orchestration"
    );

    if (executeActionPlanResult.ok && executorSkeletonResult.ok) {
        const expectedSkeletonResult = validateCapabilityExecutorSkeletonPlan(executeActionPlanResult.value.executionPlan);

        if (expectedSkeletonResult.ok && comparableJson(executorSkeletonResult.value) !== comparableJson(expectedSkeletonResult.value)) {
            errors.push(createValidationError(
                "descriptor.executorSkeletonPlan",
                "capability_bus_execute_action_orchestration_executor_skeleton_mismatch",
                "Capability Bus execute-action orchestration executorSkeletonPlan must be derived from executeActionPlan executionPlan"
            ));
        }
    }

    if (executorSkeletonResult.ok && backendInvocationResult.ok) {
        const expectedBackendInvocationResult = validateBackendAdapterInvocationDescriptor(executorSkeletonResult.value);

        if (expectedBackendInvocationResult.ok && comparableJson(backendInvocationResult.value) !== comparableJson(expectedBackendInvocationResult.value)) {
            errors.push(createValidationError(
                "descriptor.backendAdapterInvocationDescriptor",
                "capability_bus_execute_action_orchestration_backend_invocation_mismatch",
                "Capability Bus execute-action orchestration backendAdapterInvocationDescriptor must be derived from executorSkeletonPlan"
            ));
        }
    }

    return createValidationResult(
        errors,
        errors.length === 0
            ? copyCapabilityBusExecuteActionOrchestrationDescriptor({
                  contractVersion: CAPABILITY_BUS_EXECUTE_ACTION_ORCHESTRATION_CONTRACT_VERSION,
                  status: CAPABILITY_BUS_EXECUTE_ACTION_ORCHESTRATION_STATUS,
                  action: actionResult.value,
                  orchestration: orchestrationResult.value,
                  executeActionPlan: executeActionPlanResult.value,
                  executorSkeletonPlan: executorSkeletonResult.value,
                  backendAdapterInvocationDescriptor: backendInvocationResult.value,
                  boundary: boundaryResult.value
              })
            : null
    );
}

function looksLikeCapabilityBusExecuteActionOrchestrationDescriptor(value) {
    if (!isPlainObject(value)) return false;
    if (value.contractVersion === CAPABILITY_BUS_EXECUTE_ACTION_ORCHESTRATION_CONTRACT_VERSION) return true;
    if (typeof value.contractVersion === "string" && value.contractVersion.startsWith("capability-bus-execute-action-orchestration.")) return true;
    return isPlainObject(value.orchestration) && isPlainObject(value.boundary);
}

function looksLikeAcceptedExecuteActionPlan(value) {
    if (!isPlainObject(value)) return false;
    if (value.contractVersion === CAPABILITY_BUS_EXECUTE_ACTION_CONTRACT_VERSION) return true;
    if (typeof value.contractVersion === "string" && value.contractVersion.startsWith("capability-bus-execute-action.")) return true;
    return value.busAction !== undefined || value.routePlan !== undefined || value.executionPlan !== undefined;
}

export function validateCapabilityBusExecuteActionOrchestrationDescriptor(value) {
    if (looksLikeCapabilityBusExecuteActionOrchestrationDescriptor(value)) {
        return validateNormalizedCapabilityBusExecuteActionOrchestrationDescriptor(value);
    }

    if (looksLikeAcceptedExecuteActionPlan(value)) {
        const executeActionPlanResult = validateAcceptedExecuteActionPlan(value);

        if (!executeActionPlanResult.ok) {
            return createValidationResult(prefixCapabilityBusExecuteActionOrchestrationValidationErrors(
                executeActionPlanResult.errors,
                "source",
                "capability_bus_execute_action_orchestration_source"
            ));
        }

        return createDescriptorFromExecuteActionPlan(executeActionPlanResult.value);
    }

    return createValidationResult([
        createValidationError(
            "source",
            "unsupported_capability_bus_execute_action_orchestration_source",
            "Capability Bus execute-action orchestration descriptor must be derived from an accepted execute-action plan"
        )
    ]);
}

export function normalizeCapabilityBusExecuteActionOrchestrationDescriptor(value) {
    return assertCapabilityBusExecuteActionOrchestrationDescriptor(value);
}

export function assertCapabilityBusExecuteActionOrchestrationDescriptor(value) {
    return assertValidation(
        validateCapabilityBusExecuteActionOrchestrationDescriptor(value),
        "Capability Bus execute-action orchestration descriptor validation failed"
    );
}
