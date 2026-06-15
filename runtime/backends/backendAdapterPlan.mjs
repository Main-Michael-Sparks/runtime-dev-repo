import {
    assertValidation,
    createValidationError,
    createValidationResult,
    isNonEmptyString,
    isPlainObject
} from "../bus/contractValidation.mjs";
import {
    CAPABILITY_SERVICE_CONTRACT_VERSION,
    CAPABILITY_SERVICE_REGISTRY_SCHEMA_VERSION,
    validateCapabilityServiceDefinition,
    validateCapabilityServicePlan
} from "../bus/capabilityServiceContract.mjs";
import {
    BACKEND_ADAPTER_CONTRACT_VERSION,
    copyBackendAdapterDefinition,
    copyBackendAdapterServicePlan,
    isSelectableBackendAdapterStatus,
    prefixBackendAdapterValidationErrors
} from "./backendAdapterCommon.mjs";
import {
    validateBackendAdapterRegistry
} from "./backendAdapterRegistry.mjs";

const BACKEND_ADAPTER_PLAN_FIELDS = new Set([
    "contractVersion",
    "routePlan",
    "service"
]);

function addUnknownBackendAdapterPlanFieldErrors(errors, objectValue, allowedFields, path, code, label) {
    if (!isPlainObject(objectValue)) return;

    for (const key of Object.keys(objectValue)) {
        if (allowedFields.has(key)) continue;

        errors.push(createValidationError(
            path ? `${path}.${key}` : key,
            code,
            `Unsupported field for ${label}: ${key}`,
            {
                key
            }
        ));
    }
}

function validateServicePlanForBackendAdapterPlan(servicePlan) {
    const errors = [];

    if (!isPlainObject(servicePlan)) {
        return createValidationResult([
            createValidationError(
                "servicePlan",
                "invalid_backend_adapter_service_plan",
                "Backend adapter plan servicePlan must be a plain object"
            )
        ]);
    }

    addUnknownBackendAdapterPlanFieldErrors(
        errors,
        servicePlan,
        BACKEND_ADAPTER_PLAN_FIELDS,
        "servicePlan",
        "unknown_backend_adapter_service_plan_field",
        "backend adapter servicePlan"
    );

    if (servicePlan.contractVersion !== CAPABILITY_SERVICE_CONTRACT_VERSION) {
        errors.push(createValidationError(
            "servicePlan.contractVersion",
            "unsupported_backend_adapter_service_plan_contract_version",
            `Backend adapter plan servicePlan.contractVersion must be ${CAPABILITY_SERVICE_CONTRACT_VERSION}`,
            {
                expected: CAPABILITY_SERVICE_CONTRACT_VERSION
            }
        ));
    }

    const serviceResult = validateCapabilityServiceDefinition(servicePlan.service);
    if (!serviceResult.ok) {
        errors.push(...prefixBackendAdapterValidationErrors(
            serviceResult.errors,
            "servicePlan.service",
            "backend_adapter_service_plan_service"
        ));
    }

    if (errors.length > 0 || !serviceResult.ok) {
        return createValidationResult(errors);
    }

    const serviceRegistry = {
        schemaVersion: CAPABILITY_SERVICE_REGISTRY_SCHEMA_VERSION,
        services: [serviceResult.value]
    };
    const servicePlanResult = validateCapabilityServicePlan(servicePlan.routePlan, serviceRegistry);

    if (!servicePlanResult.ok) {
        errors.push(...prefixBackendAdapterValidationErrors(
            servicePlanResult.errors,
            "servicePlan",
            "backend_adapter_service_plan"
        ));
    }

    return createValidationResult(
        errors,
        errors.length === 0 ? servicePlanResult.value : null
    );
}

function supportAllowsRequirement(adapterLevel, requestedLevel) {
    if (requestedLevel !== "required") return true;
    return adapterLevel === "supported" || adapterLevel === "required";
}

function addAdapterSupportCompatibilityError(errors, routeRequirement, adapterRequirement, path, code, message) {
    if (supportAllowsRequirement(adapterRequirement, routeRequirement)) return;

    errors.push(createValidationError(
        path,
        code,
        message,
        {
            routeRequirement,
            adapterRequirement
        }
    ));
}

function selectBackendAdapterForRoute(registry, route, errors) {
    if (isNonEmptyString(route.backendId)) {
        const adapter = registry.adapters.find((entry) => entry.adapterId === route.backendId) ?? null;

        if (!adapter) {
            errors.push(createValidationError(
                "servicePlan.routePlan.route.backendId",
                "backend_adapter_missing_for_route",
                `Backend adapter registry does not define route backendId: ${route.backendId}`,
                {
                    backendId: route.backendId
                }
            ));
        }

        return adapter;
    }

    const matchingAdapters = registry.adapters.filter((adapter) => (
        adapter.backendKind === route.backendKind &&
        isSelectableBackendAdapterStatus(adapter.status)
    ));

    if (matchingAdapters.length === 0) {
        errors.push(createValidationError(
            "servicePlan.routePlan.route.backendKind",
            "backend_adapter_missing_for_route_backend_kind",
            `Backend adapter registry does not define a selectable adapter for route backendKind: ${route.backendKind}`,
            {
                backendKind: route.backendKind
            }
        ));
        return null;
    }

    if (matchingAdapters.length > 1) {
        errors.push(createValidationError(
            "servicePlan.routePlan.route.backendId",
            "backend_adapter_route_backend_id_required",
            `Capability route must include backendId because multiple selectable adapters share backendKind: ${route.backendKind}`,
            {
                backendKind: route.backendKind,
                adapterIds: matchingAdapters.map((adapter) => adapter.adapterId)
            }
        ));
        return null;
    }

    return matchingAdapters[0];
}

function addBackendAdapterPlanCompatibilityErrors(errors, servicePlan, adapter) {
    const action = servicePlan.routePlan.busAction.action;
    const route = servicePlan.routePlan.route;
    const service = servicePlan.service;

    if (!isSelectableBackendAdapterStatus(adapter.status)) {
        errors.push(createValidationError(
            "adapter.status",
            "backend_adapter_unselectable_status",
            `Backend adapter is not selectable: ${adapter.adapterId}`,
            {
                adapterId: adapter.adapterId,
                status: adapter.status
            }
        ));
    }

    if (adapter.backendKind !== route.backendKind) {
        errors.push(createValidationError(
            "adapter.backendKind",
            "backend_adapter_backend_kind_mismatch",
            "Backend adapter backendKind must match route backendKind",
            {
                adapterBackendKind: adapter.backendKind,
                routeBackendKind: route.backendKind
            }
        ));
    }

    if (adapter.compatibility.backendKind !== adapter.backendKind) {
        errors.push(createValidationError(
            "adapter.compatibility.backendKind",
            "backend_adapter_compatibility_kind_mismatch",
            "Backend adapter compatibility.backendKind must match adapter backendKind",
            {
                adapterBackendKind: adapter.backendKind,
                compatibilityBackendKind: adapter.compatibility.backendKind
            }
        ));
    }

    if (!adapter.capabilities.includes(service.capability)) {
        errors.push(createValidationError(
            "adapter.capabilities",
            `backend_adapter_capability_incompatible`,
            `Backend adapter does not support service capability: ${service.capability}`,
            {
                capability: service.capability,
                allowedCapabilities: [...adapter.capabilities]
            }
        ));
    }

    if (!adapter.capabilities.includes(route.capability)) {
        errors.push(createValidationError(
            "adapter.capabilities",
            `backend_adapter_route_capability_incompatible`,
            `Backend adapter does not support route capability: ${route.capability}`,
            {
                capability: route.capability,
                allowedCapabilities: [...adapter.capabilities]
            }
        ));
    }

    if (Array.isArray(adapter.services) && !adapter.services.includes(service.serviceId)) {
        errors.push(createValidationError(
            "adapter.services",
            "backend_adapter_service_incompatible",
            `Backend adapter does not support serviceId: ${service.serviceId}`,
            {
                serviceId: service.serviceId,
                allowedServices: [...adapter.services]
            }
        ));
    }

    if (adapter.compatibility.modelBundleRequired === true && !isNonEmptyString(route.modelBundleId)) {
        errors.push(createValidationError(
            "servicePlan.routePlan.route.modelBundleId",
            "backend_adapter_model_bundle_required",
            "Backend adapter requires a route modelBundleId"
        ));
    }

    if (adapter.compatibility.hardwareProfileRequired === true && !isNonEmptyString(route.hardwareProfileId)) {
        errors.push(createValidationError(
            "servicePlan.routePlan.route.hardwareProfileId",
            "backend_adapter_hardware_profile_required",
            "Backend adapter requires a route hardwareProfileId"
        ));
    }

    if (
        action.requirements?.stream === true &&
        (adapter.requirements.streaming === "unsupported" || adapter.result.streamingDeltas === "unsupported")
    ) {
        errors.push(createValidationError(
            "adapter.requirements.streaming",
            "backend_adapter_streaming_unsupported",
            "Backend adapter does not support a requested streaming action"
        ));
    }

    addAdapterSupportCompatibilityError(
        errors,
        route.requirements?.streaming,
        adapter.requirements.streaming,
        "adapter.requirements.streaming",
        "backend_adapter_route_streaming_incompatible",
        "Backend adapter streaming support is incompatible with the route requirement"
    );
    addAdapterSupportCompatibilityError(
        errors,
        route.requirements?.cancellation,
        adapter.requirements.cancellation,
        "adapter.requirements.cancellation",
        "backend_adapter_route_cancellation_incompatible",
        "Backend adapter cancellation support is incompatible with the route requirement"
    );
    addAdapterSupportCompatibilityError(
        errors,
        route.requirements?.timeout,
        adapter.requirements.timeout,
        "adapter.requirements.timeout",
        "backend_adapter_route_timeout_incompatible",
        "Backend adapter timeout support is incompatible with the route requirement"
    );

    if (action.requirements?.timeoutMs !== undefined && adapter.requirements.timeout === "unsupported") {
        errors.push(createValidationError(
            "adapter.requirements.timeout",
            "backend_adapter_timeout_unsupported",
            "Backend adapter does not support a requested timeout requirement"
        ));
    }

    if (service.result.streamingDeltas === "required" && adapter.result.streamingDeltas === "unsupported") {
        errors.push(createValidationError(
            "adapter.result.streamingDeltas",
            "backend_adapter_result_streaming_incompatible",
            "Backend adapter result streaming support is incompatible with the service result contract"
        ));
    }

    if (adapter.result.errorNormalization === "unsupported") {
        errors.push(createValidationError(
            "adapter.result.errorNormalization",
            "backend_adapter_error_normalization_unsupported",
            "Backend adapter must support error normalization for v1 service plans"
        ));
    }
}

function createBackendAdapterPlan(servicePlan, adapter) {
    return {
        contractVersion: BACKEND_ADAPTER_CONTRACT_VERSION,
        servicePlan: copyBackendAdapterServicePlan(servicePlan),
        adapter: copyBackendAdapterDefinition(adapter)
    };
}

export function normalizeBackendAdapterPlan(servicePlan, backendAdapterRegistry) {
    return assertBackendAdapterPlan(servicePlan, backendAdapterRegistry);
}

export function validateBackendAdapterPlan(servicePlan, backendAdapterRegistry) {
    const errors = [];
    const servicePlanResult = validateServicePlanForBackendAdapterPlan(servicePlan);
    const registryResult = validateBackendAdapterRegistry(backendAdapterRegistry);

    if (!servicePlanResult.ok) {
        errors.push(...servicePlanResult.errors);
    }

    if (!registryResult.ok) {
        errors.push(...prefixBackendAdapterValidationErrors(
            registryResult.errors,
            "backendAdapterRegistry",
            "backend_adapter_plan_registry"
        ));
    }

    if (errors.length > 0) {
        return createValidationResult(errors);
    }

    const normalizedServicePlan = servicePlanResult.value;
    const normalizedRegistry = registryResult.value;
    const adapter = selectBackendAdapterForRoute(
        normalizedRegistry,
        normalizedServicePlan.routePlan.route,
        errors
    );

    if (!adapter) {
        return createValidationResult(errors);
    }

    addBackendAdapterPlanCompatibilityErrors(errors, normalizedServicePlan, adapter);

    return createValidationResult(
        errors,
        errors.length === 0
            ? createBackendAdapterPlan(normalizedServicePlan, adapter)
            : null
    );
}

export function assertBackendAdapterPlan(servicePlan, backendAdapterRegistry) {
    return assertValidation(
        validateBackendAdapterPlan(servicePlan, backendAdapterRegistry),
        "Backend adapter plan validation failed"
    );
}
