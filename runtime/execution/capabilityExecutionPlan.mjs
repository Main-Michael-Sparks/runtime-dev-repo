import {
    assertValidation,
    createValidationError,
    createValidationResult,
    isPlainObject
} from "../bus/contractValidation.mjs";
import {
    BACKEND_ADAPTER_CONTRACT_VERSION,
    BACKEND_ADAPTER_REGISTRY_SCHEMA_VERSION,
    normalizeBackendAdapterPlan,
    validateBackendAdapterDefinition
} from "../backends/backendAdapterContract.mjs";
import {
    CAPABILITY_EXECUTOR_CONTRACT_VERSION,
    addCapabilityExecutionMetadataStringValidation,
    addForbiddenCapabilityExecutionKeyErrors,
    addOptionalCapabilityExecutionStringError,
    addRequiredCapabilityExecutionStringError,
    addUnknownCapabilityExecutionFieldErrors,
    copyCapabilityExecutionBackendPlan,
    copyCapabilityExecutionInvocation,
    copyCapabilityExecutionPlan,
    prefixCapabilityExecutionValidationErrors
} from "./capabilityExecutionCommon.mjs";

const BACKEND_ADAPTER_PLAN_FIELDS = new Set([
    "contractVersion",
    "servicePlan",
    "adapter"
]);

const CAPABILITY_EXECUTION_PLAN_FIELDS = new Set([
    "contractVersion",
    "backendPlan",
    "invocation"
]);

const CAPABILITY_EXECUTION_INVOCATION_FIELDS = new Set([
    "actionId",
    "runId",
    "capability",
    "serviceId",
    "adapterId",
    "backendKind",
    "routeId",
    "modelBundleId",
    "hardwareProfileId",
    "stream",
    "timeoutMs",
    "resultContract",
    "eventContract"
]);

function validateBackendAdapterPlanDescriptor(backendPlan) {
    const errors = [];

    if (!isPlainObject(backendPlan)) {
        return createValidationResult([
            createValidationError(
                "backendPlan",
                "invalid_backend_adapter_plan_descriptor",
                "Capability execution backend adapter plan must be a plain object"
            )
        ]);
    }

    addForbiddenCapabilityExecutionKeyErrors(
        errors,
        backendPlan,
        "forbidden_capability_execution_backend_plan_key",
        "Capability execution backend adapter plan"
    );

    addUnknownCapabilityExecutionFieldErrors(
        errors,
        backendPlan,
        BACKEND_ADAPTER_PLAN_FIELDS,
        "backendPlan",
        "unknown_capability_execution_backend_plan_field",
        "capability execution backend adapter plan"
    );

    if (backendPlan.contractVersion !== BACKEND_ADAPTER_CONTRACT_VERSION) {
        errors.push(createValidationError(
            "backendPlan.contractVersion",
            "unsupported_capability_execution_backend_plan_contract_version",
            `Capability execution backendPlan.contractVersion must be ${BACKEND_ADAPTER_CONTRACT_VERSION}`,
            {
                expected: BACKEND_ADAPTER_CONTRACT_VERSION
            }
        ));
    }

    const adapterResult = validateBackendAdapterDefinition(backendPlan.adapter);

    if (!adapterResult.ok) {
        errors.push(...prefixCapabilityExecutionValidationErrors(
            adapterResult.errors,
            "backendPlan.adapter",
            "capability_execution_backend_plan_adapter"
        ));
    }

    if (errors.length > 0 || !adapterResult.ok) {
        return createValidationResult(errors);
    }

    const backendAdapterRegistry = {
        schemaVersion: BACKEND_ADAPTER_REGISTRY_SCHEMA_VERSION,
        adapters: [adapterResult.value]
    };

    try {
        const normalizedBackendPlan = normalizeBackendAdapterPlan(
            backendPlan.servicePlan,
            backendAdapterRegistry
        );

        return createValidationResult([], normalizedBackendPlan);
    } catch (err) {
        const validationErrors = Array.isArray(err.validationErrors)
            ? err.validationErrors
            : [
                  createValidationError(
                      "backendPlan",
                      "invalid_capability_execution_backend_plan",
                      err?.message || "Capability execution backend adapter plan validation failed"
                  )
              ];

        return createValidationResult(prefixCapabilityExecutionValidationErrors(
            validationErrors,
            "backendPlan",
            "capability_execution_backend_plan"
        ));
    }
}

function createCapabilityExecutionInvocation(backendPlan) {
    const action = backendPlan.servicePlan.routePlan.busAction.action;
    const route = backendPlan.servicePlan.routePlan.route;
    const service = backendPlan.servicePlan.service;
    const adapter = backendPlan.adapter;
    const invocation = {
        actionId: action.actionId,
        capability: action.capability,
        serviceId: service.serviceId,
        adapterId: adapter.adapterId,
        backendKind: adapter.backendKind,
        routeId: route.routeId,
        stream: action.requirements?.stream === true,
        resultContract: adapter.contracts.result,
        eventContract: adapter.contracts.event
    };

    if (action.runId !== undefined) {
        invocation.runId = action.runId;
    }

    if (route.modelBundleId !== undefined) {
        invocation.modelBundleId = route.modelBundleId;
    }

    if (route.hardwareProfileId !== undefined) {
        invocation.hardwareProfileId = route.hardwareProfileId;
    }

    if (action.requirements?.timeoutMs !== undefined) {
        invocation.timeoutMs = action.requirements.timeoutMs;
    }

    return invocation;
}

function createCapabilityExecutionPlan(backendPlan) {
    return {
        contractVersion: CAPABILITY_EXECUTOR_CONTRACT_VERSION,
        backendPlan: copyCapabilityExecutionBackendPlan(backendPlan),
        invocation: createCapabilityExecutionInvocation(backendPlan)
    };
}

function validateCapabilityExecutionInvocation(invocation, backendPlan) {
    const errors = [];

    if (!isPlainObject(invocation)) {
        return createValidationResult([
            createValidationError(
                "invocation",
                "invalid_capability_execution_invocation",
                "Capability execution invocation must be a plain object"
            )
        ]);
    }

    addForbiddenCapabilityExecutionKeyErrors(
        errors,
        invocation,
        "forbidden_capability_execution_invocation_key",
        "Capability execution invocation"
    );

    addUnknownCapabilityExecutionFieldErrors(
        errors,
        invocation,
        CAPABILITY_EXECUTION_INVOCATION_FIELDS,
        "invocation",
        "unknown_capability_execution_invocation_field",
        "capability execution invocation"
    );

    addRequiredCapabilityExecutionStringError(
        errors,
        invocation.actionId,
        "invocation.actionId",
        "invalid_capability_execution_action_id",
        "Capability execution invocation actionId"
    );
    addOptionalCapabilityExecutionStringError(
        errors,
        invocation.runId,
        "invocation.runId",
        "invalid_capability_execution_run_id",
        "Capability execution invocation runId"
    );
    addRequiredCapabilityExecutionStringError(
        errors,
        invocation.capability,
        "invocation.capability",
        "invalid_capability_execution_capability",
        "Capability execution invocation capability"
    );
    addRequiredCapabilityExecutionStringError(
        errors,
        invocation.serviceId,
        "invocation.serviceId",
        "invalid_capability_execution_service_id",
        "Capability execution invocation serviceId"
    );
    addRequiredCapabilityExecutionStringError(
        errors,
        invocation.adapterId,
        "invocation.adapterId",
        "invalid_capability_execution_adapter_id",
        "Capability execution invocation adapterId"
    );
    addRequiredCapabilityExecutionStringError(
        errors,
        invocation.backendKind,
        "invocation.backendKind",
        "invalid_capability_execution_backend_kind",
        "Capability execution invocation backendKind"
    );
    addRequiredCapabilityExecutionStringError(
        errors,
        invocation.resultContract,
        "invocation.resultContract",
        "invalid_capability_execution_result_contract",
        "Capability execution invocation resultContract"
    );
    addRequiredCapabilityExecutionStringError(
        errors,
        invocation.eventContract,
        "invocation.eventContract",
        "invalid_capability_execution_event_contract",
        "Capability execution invocation eventContract"
    );

    addCapabilityExecutionMetadataStringValidation(errors, invocation.routeId, "invocation.routeId");
    addCapabilityExecutionMetadataStringValidation(errors, invocation.modelBundleId, "invocation.modelBundleId");
    addCapabilityExecutionMetadataStringValidation(errors, invocation.hardwareProfileId, "invocation.hardwareProfileId");

    if (invocation.stream !== undefined && typeof invocation.stream !== "boolean") {
        errors.push(createValidationError(
            "invocation.stream",
            "invalid_capability_execution_stream_flag",
            "Capability execution invocation stream must be a boolean when provided"
        ));
    }

    if (
        invocation.timeoutMs !== undefined &&
        (
            typeof invocation.timeoutMs !== "number" ||
            !Number.isFinite(invocation.timeoutMs) ||
            invocation.timeoutMs < 0
        )
    ) {
        errors.push(createValidationError(
            "invocation.timeoutMs",
            "invalid_capability_execution_timeout_ms",
            "Capability execution invocation timeoutMs must be a finite non-negative number when provided"
        ));
    }

    if (isPlainObject(backendPlan)) {
        const action = backendPlan.servicePlan.routePlan.busAction.action;
        const route = backendPlan.servicePlan.routePlan.route;
        const service = backendPlan.servicePlan.service;
        const adapter = backendPlan.adapter;

        if (invocation.actionId !== action.actionId) {
            errors.push(createValidationError(
                "invocation.actionId",
                "capability_execution_action_id_mismatch",
                "Capability execution invocation actionId must match backendPlan actionId"
            ));
        }

        if (invocation.runId !== action.runId) {
            errors.push(createValidationError(
                "invocation.runId",
                "capability_execution_run_id_mismatch",
                "Capability execution invocation runId must match backendPlan runId"
            ));
        }

        if (invocation.capability !== action.capability) {
            errors.push(createValidationError(
                "invocation.capability",
                "capability_execution_capability_mismatch",
                "Capability execution invocation capability must match backendPlan action capability"
            ));
        }

        if (invocation.serviceId !== service.serviceId) {
            errors.push(createValidationError(
                "invocation.serviceId",
                "capability_execution_service_id_mismatch",
                "Capability execution invocation serviceId must match backendPlan serviceId"
            ));
        }

        if (invocation.adapterId !== adapter.adapterId) {
            errors.push(createValidationError(
                "invocation.adapterId",
                "capability_execution_adapter_id_mismatch",
                "Capability execution invocation adapterId must match backendPlan adapterId"
            ));
        }

        if (invocation.backendKind !== adapter.backendKind) {
            errors.push(createValidationError(
                "invocation.backendKind",
                "capability_execution_backend_kind_mismatch",
                "Capability execution invocation backendKind must match backendPlan adapter backendKind"
            ));
        }

        if (invocation.routeId !== route.routeId) {
            errors.push(createValidationError(
                "invocation.routeId",
                "capability_execution_route_id_mismatch",
                "Capability execution invocation routeId must match backendPlan routeId"
            ));
        }

        if (invocation.modelBundleId !== route.modelBundleId) {
            errors.push(createValidationError(
                "invocation.modelBundleId",
                "capability_execution_model_bundle_id_mismatch",
                "Capability execution invocation modelBundleId must match backendPlan route modelBundleId"
            ));
        }

        if (invocation.hardwareProfileId !== route.hardwareProfileId) {
            errors.push(createValidationError(
                "invocation.hardwareProfileId",
                "capability_execution_hardware_profile_id_mismatch",
                "Capability execution invocation hardwareProfileId must match backendPlan route hardwareProfileId"
            ));
        }

        if (invocation.stream !== (action.requirements?.stream === true)) {
            errors.push(createValidationError(
                "invocation.stream",
                "capability_execution_stream_mismatch",
                "Capability execution invocation stream must match backendPlan action stream requirement"
            ));
        }

        if (invocation.timeoutMs !== action.requirements?.timeoutMs) {
            errors.push(createValidationError(
                "invocation.timeoutMs",
                "capability_execution_timeout_ms_mismatch",
                "Capability execution invocation timeoutMs must match backendPlan action timeoutMs requirement"
            ));
        }

        if (invocation.resultContract !== adapter.contracts.result) {
            errors.push(createValidationError(
                "invocation.resultContract",
                "capability_execution_result_contract_mismatch",
                "Capability execution invocation resultContract must match backendPlan adapter result contract"
            ));
        }

        if (invocation.eventContract !== adapter.contracts.event) {
            errors.push(createValidationError(
                "invocation.eventContract",
                "capability_execution_event_contract_mismatch",
                "Capability execution invocation eventContract must match backendPlan adapter event contract"
            ));
        }
    }

    return createValidationResult(
        errors,
        errors.length === 0 ? copyCapabilityExecutionInvocation(invocation) : null
    );
}

function validateNormalizedCapabilityExecutionPlan(executionPlan) {
    const errors = [];

    if (!isPlainObject(executionPlan)) {
        return createValidationResult([
            createValidationError(
                "executionPlan",
                "invalid_capability_execution_plan",
                "Capability execution plan must be a plain object"
            )
        ]);
    }

    addForbiddenCapabilityExecutionKeyErrors(
        errors,
        executionPlan,
        "forbidden_capability_execution_plan_key",
        "Capability execution plan"
    );

    addUnknownCapabilityExecutionFieldErrors(
        errors,
        executionPlan,
        CAPABILITY_EXECUTION_PLAN_FIELDS,
        "executionPlan",
        "unknown_capability_execution_plan_field",
        "capability execution plan"
    );

    if (executionPlan.contractVersion !== CAPABILITY_EXECUTOR_CONTRACT_VERSION) {
        errors.push(createValidationError(
            "executionPlan.contractVersion",
            "unsupported_capability_execution_contract_version",
            `Capability execution plan contractVersion must be ${CAPABILITY_EXECUTOR_CONTRACT_VERSION}`,
            {
                expected: CAPABILITY_EXECUTOR_CONTRACT_VERSION
            }
        ));
    }

    const backendPlanResult = validateBackendAdapterPlanDescriptor(executionPlan.backendPlan);

    if (!backendPlanResult.ok) {
        errors.push(...prefixCapabilityExecutionValidationErrors(
            backendPlanResult.errors,
            "executionPlan",
            "capability_execution_plan"
        ));
    }

    if (errors.length > 0 || !backendPlanResult.ok) {
        return createValidationResult(errors);
    }

    const normalizedBackendPlan = backendPlanResult.value;
    const invocationResult = validateCapabilityExecutionInvocation(
        executionPlan.invocation,
        normalizedBackendPlan
    );

    if (!invocationResult.ok) {
        errors.push(...prefixCapabilityExecutionValidationErrors(
            invocationResult.errors,
            "executionPlan",
            "capability_execution_plan"
        ));
    }

    return createValidationResult(
        errors,
        errors.length === 0
            ? copyCapabilityExecutionPlan({
                  contractVersion: CAPABILITY_EXECUTOR_CONTRACT_VERSION,
                  backendPlan: normalizedBackendPlan,
                  invocation: invocationResult.value
              })
            : null
    );
}

function looksLikeCapabilityExecutionPlan(value) {
    if (!isPlainObject(value)) return false;
    if (value.contractVersion === CAPABILITY_EXECUTOR_CONTRACT_VERSION) return true;
    if (typeof value.contractVersion === "string" && value.contractVersion.startsWith("capability-executor.")) return true;
    return value.backendPlan !== undefined || value.invocation !== undefined;
}

export function validateCapabilityExecutionPlan(value) {
    if (looksLikeCapabilityExecutionPlan(value)) {
        return validateNormalizedCapabilityExecutionPlan(value);
    }

    const backendPlanResult = validateBackendAdapterPlanDescriptor(value);

    if (!backendPlanResult.ok) {
        return createValidationResult(backendPlanResult.errors);
    }

    const executionPlan = createCapabilityExecutionPlan(backendPlanResult.value);
    return validateNormalizedCapabilityExecutionPlan(executionPlan);
}

export function normalizeCapabilityExecutionPlan(backendAdapterPlan) {
    return assertCapabilityExecutionPlan(backendAdapterPlan);
}

export function assertCapabilityExecutionPlan(backendAdapterPlan) {
    return assertValidation(
        validateCapabilityExecutionPlan(backendAdapterPlan),
        "Capability execution plan validation failed"
    );
}
