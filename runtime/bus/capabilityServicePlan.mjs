import {
    assertValidation,
    createValidationError,
    createValidationResult,
    isNonEmptyString,
    isPlainObject
} from "./contractValidation.mjs";
import { validateActionEnvelope } from "./actionEnvelope.mjs";
import { CAPABILITY_BUS_CONTRACT_VERSION } from "./capabilityBusContract.mjs";
import { validateCapabilityDefinition } from "./capabilityDefinition.mjs";
import {
    validateCapabilityRouteDefinition
} from "../router/capabilityRouteDefinition.mjs";
import { CAPABILITY_ROUTER_CONTRACT_VERSION } from "../router/capabilityRouterContract.mjs";
import {
    validateCapabilityServiceRegistry
} from "./capabilityServiceRegistry.mjs";
import {
    CAPABILITY_SERVICE_CONTRACT_VERSION,
    copyCapabilityServiceDefinition,
    copyCapabilityServiceRoutePlan,
    isSelectableCapabilityServiceStatus,
    prefixCapabilityServiceValidationErrors
} from "./capabilityServiceCommon.mjs";

const CAPABILITY_SERVICE_ROUTE_PLAN_FIELDS = new Set([
    "contractVersion",
    "busAction",
    "route"
]);

const CAPABILITY_SERVICE_BUS_ACTION_FIELDS = new Set([
    "contractVersion",
    "action",
    "capabilityDefinition"
]);

function addUnknownRoutePlanFieldErrors(errors, objectValue, allowedFields, path, code, label) {
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

function validateBusActionForServicePlan(busAction) {
    const errors = [];

    if (!isPlainObject(busAction)) {
        return createValidationResult([
            createValidationError(
                "busAction",
                "invalid_service_plan_bus_action",
                "Capability service plan routePlan.busAction must be a plain object"
            )
        ]);
    }

    addUnknownRoutePlanFieldErrors(
        errors,
        busAction,
        CAPABILITY_SERVICE_BUS_ACTION_FIELDS,
        "busAction",
        "unknown_service_plan_bus_action_field",
        "capability service plan busAction"
    );

    if (busAction.contractVersion !== CAPABILITY_BUS_CONTRACT_VERSION) {
        errors.push(createValidationError(
            "busAction.contractVersion",
            "unsupported_service_plan_bus_action_contract_version",
            `Capability service plan routePlan.busAction.contractVersion must be ${CAPABILITY_BUS_CONTRACT_VERSION}`,
            {
                expected: CAPABILITY_BUS_CONTRACT_VERSION
            }
        ));
    }

    const actionResult = validateActionEnvelope(busAction.action);
    if (!actionResult.ok) {
        errors.push(...prefixCapabilityServiceValidationErrors(
            actionResult.errors,
            "busAction.action",
            "service_plan_action"
        ));
    }

    const definitionResult = validateCapabilityDefinition(busAction.capabilityDefinition);
    if (!definitionResult.ok) {
        errors.push(...prefixCapabilityServiceValidationErrors(
            definitionResult.errors,
            "busAction.capabilityDefinition",
            "service_plan_capability_definition"
        ));
    }

    if (!actionResult.ok || !definitionResult.ok) {
        return createValidationResult(errors);
    }

    const normalizedAction = actionResult.value;
    const normalizedDefinition = definitionResult.value;

    if (normalizedAction.capability !== normalizedDefinition.capability) {
        errors.push(createValidationError(
            "busAction.capabilityDefinition.capability",
            "service_plan_capability_mismatch",
            "Capability service plan routePlan busAction action and capabilityDefinition must describe the same capability",
            {
                actionCapability: normalizedAction.capability,
                definitionCapability: normalizedDefinition.capability
            }
        ));
    }

    return createValidationResult(
        errors,
        errors.length === 0
            ? {
                  contractVersion: CAPABILITY_BUS_CONTRACT_VERSION,
                  action: normalizedAction,
                  capabilityDefinition: normalizedDefinition
              }
            : null
    );
}

function validateRoutePlanForServicePlan(routePlan) {
    const errors = [];

    if (!isPlainObject(routePlan)) {
        return createValidationResult([
            createValidationError(
                "routePlan",
                "invalid_capability_route_plan",
                "Capability service plan routePlan must be a plain object"
            )
        ]);
    }

    addUnknownRoutePlanFieldErrors(
        errors,
        routePlan,
        CAPABILITY_SERVICE_ROUTE_PLAN_FIELDS,
        "routePlan",
        "unknown_service_plan_route_plan_field",
        "capability service plan routePlan"
    );

    if (routePlan.contractVersion !== CAPABILITY_ROUTER_CONTRACT_VERSION) {
        errors.push(createValidationError(
            "routePlan.contractVersion",
            "unsupported_capability_route_plan_contract_version",
            `Capability service plan routePlan.contractVersion must be ${CAPABILITY_ROUTER_CONTRACT_VERSION}`,
            {
                expected: CAPABILITY_ROUTER_CONTRACT_VERSION
            }
        ));
    }

    const busActionResult = validateBusActionForServicePlan(routePlan.busAction);
    if (!busActionResult.ok) {
        errors.push(...prefixCapabilityServiceValidationErrors(
            busActionResult.errors,
            "routePlan",
            "service_plan_route_plan"
        ));
    }

    const routeResult = validateCapabilityRouteDefinition(routePlan.route);
    if (!routeResult.ok) {
        errors.push(...prefixCapabilityServiceValidationErrors(
            routeResult.errors,
            "routePlan.route",
            "service_plan_route"
        ));
    }

    if (!busActionResult.ok || !routeResult.ok) {
        return createValidationResult(errors);
    }

    const normalizedBusAction = busActionResult.value;
    const normalizedRoute = routeResult.value;

    if (normalizedRoute.capability !== normalizedBusAction.action.capability) {
        errors.push(createValidationError(
            "routePlan.route.capability",
            "service_plan_route_action_capability_mismatch",
            "Capability service plan route must match the routePlan bus action capability",
            {
                routeCapability: normalizedRoute.capability,
                actionCapability: normalizedBusAction.action.capability
            }
        ));
    }

    return createValidationResult(
        errors,
        errors.length === 0
            ? {
                  contractVersion: CAPABILITY_ROUTER_CONTRACT_VERSION,
                  busAction: normalizedBusAction,
                  route: normalizedRoute
              }
            : null
    );
}

function findServiceForRoute(serviceRegistry, serviceId) {
    return serviceRegistry.services.find((service) => service.serviceId === serviceId) ?? null;
}

function serviceSupportsRequiredLevel(serviceLevel) {
    return serviceLevel === "supported" || serviceLevel === "required";
}

function addSupportCompatibilityError(errors, routeRequirement, serviceRequirement, path, code, message) {
    if (routeRequirement !== "required") return;
    if (serviceSupportsRequiredLevel(serviceRequirement)) return;

    errors.push(createValidationError(
        path,
        code,
        message,
        {
            routeRequirement,
            serviceRequirement
        }
    ));
}

function addServicePlanCompatibilityErrors(errors, routePlan, service) {
    const action = routePlan.busAction.action;
    const definition = routePlan.busAction.capabilityDefinition;
    const route = routePlan.route;

    if (service.capability !== route.capability) {
        errors.push(createValidationError(
            "service.capability",
            "service_capability_mismatch",
            "Capability service must match the selected route capability",
            {
                serviceCapability: service.capability,
                routeCapability: route.capability
            }
        ));
    }

    if (service.serviceId !== route.serviceId) {
        errors.push(createValidationError(
            "service.serviceId",
            "service_id_mismatch",
            "Capability service must match the selected route serviceId",
            {
                serviceId: service.serviceId,
                routeServiceId: route.serviceId
            }
        ));
    }

    if (
        Array.isArray(service.compatibility.backendKinds) &&
        !service.compatibility.backendKinds.includes(route.backendKind)
    ) {
        errors.push(createValidationError(
            "service.compatibility.backendKinds",
            "service_backend_kind_incompatible",
            `Capability service does not support route backendKind: ${route.backendKind}`,
            {
                backendKind: route.backendKind,
                allowedBackendKinds: [...service.compatibility.backendKinds]
            }
        ));
    }

    if (service.compatibility.modelBundleRequired === true && !isNonEmptyString(route.modelBundleId)) {
        errors.push(createValidationError(
            "routePlan.route.modelBundleId",
            "service_model_bundle_required",
            "Capability service requires a route modelBundleId"
        ));
    }

    if (service.compatibility.hardwareProfileRequired === true && !isNonEmptyString(route.hardwareProfileId)) {
        errors.push(createValidationError(
            "routePlan.route.hardwareProfileId",
            "service_hardware_profile_required",
            "Capability service requires a route hardwareProfileId"
        ));
    }

    if (
        action.requirements?.stream === true &&
        (service.requirements.streaming === "unsupported" || service.result.streamingDeltas === "unsupported")
    ) {
        errors.push(createValidationError(
            "service.requirements.streaming",
            "service_streaming_unsupported",
            "Capability service does not support a requested streaming action"
        ));
    }

    addSupportCompatibilityError(
        errors,
        route.requirements?.streaming,
        service.requirements.streaming,
        "service.requirements.streaming",
        "service_route_streaming_incompatible",
        "Capability service streaming support is incompatible with the route requirement"
    );
    addSupportCompatibilityError(
        errors,
        route.requirements?.cancellation,
        service.requirements.cancellation,
        "service.requirements.cancellation",
        "service_route_cancellation_incompatible",
        "Capability service cancellation support is incompatible with the route requirement"
    );
    addSupportCompatibilityError(
        errors,
        route.requirements?.timeout,
        service.requirements.timeout,
        "service.requirements.timeout",
        "service_route_timeout_incompatible",
        "Capability service timeout support is incompatible with the route requirement"
    );

    if (action.requirements?.timeoutMs !== undefined && service.requirements.timeout === "unsupported") {
        errors.push(createValidationError(
            "service.requirements.timeout",
            "service_timeout_unsupported",
            "Capability service does not support a requested timeout requirement"
        ));
    }

    const contextRefs = Array.isArray(action.input?.contextRefs) ? action.input.contextRefs : [];
    if (contextRefs.length > 0 && service.input.contextRefs === "unsupported") {
        errors.push(createValidationError(
            "service.input.contextRefs",
            "service_context_refs_unsupported",
            "Capability service does not support action input contextRefs"
        ));
    }

    if (definition.compatibility?.contextRefs === false && service.input.contextRefs === "required") {
        errors.push(createValidationError(
            "service.input.contextRefs",
            "service_context_refs_required_but_capability_disables_context_refs",
            "Capability service requires contextRefs but the capability definition disables contextRefs"
        ));
    }
}

function createServicePlan(routePlan, service) {
    return {
        contractVersion: CAPABILITY_SERVICE_CONTRACT_VERSION,
        routePlan: copyCapabilityServiceRoutePlan(routePlan),
        service: copyCapabilityServiceDefinition(service)
    };
}

export function normalizeCapabilityServicePlan(routePlan, serviceRegistry) {
    return assertCapabilityServicePlan(routePlan, serviceRegistry);
}

export function validateCapabilityServicePlan(routePlan, serviceRegistry) {
    const errors = [];
    const routePlanResult = validateRoutePlanForServicePlan(routePlan);
    const serviceRegistryResult = validateCapabilityServiceRegistry(serviceRegistry);

    if (!routePlanResult.ok) {
        errors.push(...routePlanResult.errors);
    }

    if (!serviceRegistryResult.ok) {
        errors.push(...prefixCapabilityServiceValidationErrors(
            serviceRegistryResult.errors,
            "serviceRegistry",
            "service_plan_service_registry"
        ));
    }

    if (errors.length > 0) {
        return createValidationResult(errors);
    }

    const normalizedRoutePlan = routePlanResult.value;
    const normalizedRegistry = serviceRegistryResult.value;
    const service = findServiceForRoute(normalizedRegistry, normalizedRoutePlan.route.serviceId);

    if (!service) {
        return createValidationResult([
            createValidationError(
                "routePlan.route.serviceId",
                "service_missing_for_route",
                `Capability service registry does not define route serviceId: ${normalizedRoutePlan.route.serviceId}`,
                {
                    serviceId: normalizedRoutePlan.route.serviceId
                }
            )
        ]);
    }

    if (!isSelectableCapabilityServiceStatus(service.status)) {
        return createValidationResult([
            createValidationError(
                "service.status",
                "service_unselectable_status",
                `Capability service is not selectable: ${service.serviceId}`,
                {
                    serviceId: service.serviceId,
                    status: service.status
                }
            )
        ]);
    }

    addServicePlanCompatibilityErrors(errors, normalizedRoutePlan, service);

    return createValidationResult(
        errors,
        errors.length === 0
            ? createServicePlan(normalizedRoutePlan, service)
            : null
    );
}

export function assertCapabilityServicePlan(routePlan, serviceRegistry) {
    return assertValidation(
        validateCapabilityServicePlan(routePlan, serviceRegistry),
        "Capability service plan validation failed"
    );
}
