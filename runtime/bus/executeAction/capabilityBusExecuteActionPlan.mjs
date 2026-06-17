import {
    assertValidation,
    createValidationError,
    createValidationResult,
    isPlainObject
} from "../contractValidation.mjs";
import {
    validateCapabilityBusAction
} from "../capabilityBusContract.mjs";
import {
    validateCapabilityRoutePlan
} from "../../router/capabilityRouterContract.mjs";
import {
    validateCapabilityServicePlan
} from "../capabilityServiceContract.mjs";
import {
    validateBackendAdapterPlan
} from "../../backends/backendAdapterContract.mjs";
import {
    validateCapabilityExecutionPlan
} from "../../execution/capabilityExecutorContract.mjs";
import {
    CAPABILITY_BUS_EXECUTE_ACTION_CONTRACT_VERSION,
    copyCapabilityBusExecuteActionPlan,
    prefixCapabilityBusExecuteActionValidationErrors
} from "./capabilityBusExecuteActionCommon.mjs";

const EXECUTE_ACTION_REGISTRY_FIELDS = new Set([
    "capabilityRegistry",
    "routerRegistry",
    "serviceRegistry",
    "backendAdapterRegistry"
]);

function validateExecuteActionRegistries(registries) {
    const errors = [];

    if (!isPlainObject(registries)) {
        return createValidationResult([
            createValidationError(
                "registries",
                "invalid_execute_action_registries",
                "Capability Bus execute-action registries must be a plain object"
            )
        ]);
    }

    for (const key of Object.keys(registries)) {
        if (EXECUTE_ACTION_REGISTRY_FIELDS.has(key)) continue;

        errors.push(createValidationError(
            `registries.${key}`,
            "unknown_execute_action_registry_field",
            `Unsupported registry field for Capability Bus execute-action contract: ${key}`,
            {
                key
            }
        ));
    }

    return createValidationResult(
        errors,
        errors.length === 0
            ? {
                  capabilityRegistry: registries.capabilityRegistry,
                  routerRegistry: registries.routerRegistry,
                  serviceRegistry: registries.serviceRegistry,
                  backendAdapterRegistry: registries.backendAdapterRegistry
              }
            : null
    );
}

function createActionIdentity(action) {
    const identity = {
        actionId: action.actionId,
        capability: action.capability
    };

    if (action.runId !== undefined) {
        identity.runId = action.runId;
    }

    return identity;
}

function createAcceptedExecuteActionPlan({
    busAction,
    routePlan,
    servicePlan,
    backendPlan,
    executionPlan
}) {
    return copyCapabilityBusExecuteActionPlan({
        contractVersion: CAPABILITY_BUS_EXECUTE_ACTION_CONTRACT_VERSION,
        status: "accepted",
        action: createActionIdentity(busAction.action),
        busAction,
        routePlan,
        servicePlan,
        backendPlan,
        executionPlan
    });
}

function appendPrefixedErrors(errors, result, prefix, codePrefix) {
    if (result.ok) return;

    errors.push(...prefixCapabilityBusExecuteActionValidationErrors(
        result.errors,
        prefix,
        codePrefix
    ));
}

export function validateCapabilityBusExecuteActionPlan(actionEnvelope, registries) {
    const errors = [];
    const registriesResult = validateExecuteActionRegistries(registries);

    appendPrefixedErrors(
        errors,
        registriesResult,
        "registries",
        "execute_action_registries"
    );

    if (!registriesResult.ok) {
        return createValidationResult(errors);
    }

    const normalizedRegistries = registriesResult.value;
    const busActionResult = validateCapabilityBusAction(
        actionEnvelope,
        normalizedRegistries.capabilityRegistry
    );

    appendPrefixedErrors(
        errors,
        busActionResult,
        "busAction",
        "execute_action_bus"
    );

    if (!busActionResult.ok) {
        return createValidationResult(errors);
    }

    const routePlanResult = validateCapabilityRoutePlan(
        busActionResult.value,
        normalizedRegistries.routerRegistry
    );

    appendPrefixedErrors(
        errors,
        routePlanResult,
        "routePlan",
        "execute_action_route"
    );

    if (!routePlanResult.ok) {
        return createValidationResult(errors);
    }

    const servicePlanResult = validateCapabilityServicePlan(
        routePlanResult.value,
        normalizedRegistries.serviceRegistry
    );

    appendPrefixedErrors(
        errors,
        servicePlanResult,
        "servicePlan",
        "execute_action_service"
    );

    if (!servicePlanResult.ok) {
        return createValidationResult(errors);
    }

    const backendPlanResult = validateBackendAdapterPlan(
        servicePlanResult.value,
        normalizedRegistries.backendAdapterRegistry
    );

    appendPrefixedErrors(
        errors,
        backendPlanResult,
        "backendPlan",
        "execute_action_backend"
    );

    if (!backendPlanResult.ok) {
        return createValidationResult(errors);
    }

    const executionPlanResult = validateCapabilityExecutionPlan(backendPlanResult.value);

    appendPrefixedErrors(
        errors,
        executionPlanResult,
        "executionPlan",
        "execute_action_execution"
    );

    if (!executionPlanResult.ok) {
        return createValidationResult(errors);
    }

    return createValidationResult(
        [],
        createAcceptedExecuteActionPlan({
            busAction: busActionResult.value,
            routePlan: routePlanResult.value,
            servicePlan: servicePlanResult.value,
            backendPlan: backendPlanResult.value,
            executionPlan: executionPlanResult.value
        })
    );
}

export function normalizeCapabilityBusExecuteActionPlan(actionEnvelope, registries) {
    return assertCapabilityBusExecuteActionPlan(actionEnvelope, registries);
}

export function assertCapabilityBusExecuteActionPlan(actionEnvelope, registries) {
    return assertValidation(
        validateCapabilityBusExecuteActionPlan(actionEnvelope, registries),
        "Capability Bus execute-action contract validation failed"
    );
}
