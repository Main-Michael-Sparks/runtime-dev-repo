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
    validateCapabilityRouterRegistry
} from "./capabilityRouterRegistry.mjs";
import {
    CAPABILITY_ROUTER_CONTRACT_VERSION,
    copyCapabilityRouteDefinition,
    copyCapabilityRouterBusAction,
    isSelectableCapabilityRouteStatus,
    prefixCapabilityRouterValidationErrors
} from "./capabilityRouterCommon.mjs";

function createRoutePlan(busAction, route) {
    return {
        contractVersion: CAPABILITY_ROUTER_CONTRACT_VERSION,
        busAction: copyCapabilityRouterBusAction(busAction),
        route: copyCapabilityRouteDefinition(route)
    };
}

function validateBusActionForRoutePlan(busAction) {
    const errors = [];

    if (!isPlainObject(busAction)) {
        return createValidationResult([
            createValidationError(
                "busAction",
                "invalid_bus_action",
                "Capability route plan busAction must be a plain object"
            )
        ]);
    }

    if (busAction.contractVersion !== CAPABILITY_BUS_CONTRACT_VERSION) {
        errors.push(createValidationError(
            "busAction.contractVersion",
            "unsupported_bus_action_contract_version",
            `Capability route plan busAction.contractVersion must be ${CAPABILITY_BUS_CONTRACT_VERSION}`,
            {
                expected: CAPABILITY_BUS_CONTRACT_VERSION
            }
        ));
    }

    const actionResult = validateActionEnvelope(busAction.action);
    if (!actionResult.ok) {
        errors.push(...prefixCapabilityRouterValidationErrors(
            actionResult.errors,
            "busAction.action",
            "route_plan_action"
        ));
    }

    const definitionResult = validateCapabilityDefinition(busAction.capabilityDefinition);
    if (!definitionResult.ok) {
        errors.push(...prefixCapabilityRouterValidationErrors(
            definitionResult.errors,
            "busAction.capabilityDefinition",
            "route_plan_capability_definition"
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
            "route_plan_capability_mismatch",
            "Capability route plan busAction action and capabilityDefinition must describe the same capability",
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

function selectRouteForBusAction(normalizedRegistry, capability) {
    const matchingRoutes = normalizedRegistry.routes.filter((route) => route.capability === capability);
    const selectableRoute = matchingRoutes.find((route) => isSelectableCapabilityRouteStatus(route.status));

    return {
        matchingRoutes,
        selectableRoute: selectableRoute ?? null
    };
}

function addRoutePlanCompatibilityErrors(errors, busAction, route) {
    const action = busAction.action;
    const definition = busAction.capabilityDefinition;
    const compatibility = definition.compatibility ?? {};

    if (
        Array.isArray(compatibility.backendKinds) &&
        !compatibility.backendKinds.includes(route.backendKind)
    ) {
        errors.push(createValidationError(
            "route.backendKind",
            "route_backend_kind_incompatible",
            `Capability route backendKind is not allowed for capability: ${route.backendKind}`,
            {
                backendKind: route.backendKind,
                allowedBackendKinds: [...compatibility.backendKinds]
            }
        ));
    }

    if (compatibility.modelBundleRequired === true && !isNonEmptyString(route.modelBundleId)) {
        errors.push(createValidationError(
            "route.modelBundleId",
            "route_model_bundle_required",
            "Capability route modelBundleId is required by capability compatibility metadata"
        ));
    }

    if (
        action.requirements?.stream === true &&
        route.requirements?.streaming === "unsupported"
    ) {
        errors.push(createValidationError(
            "route.requirements.streaming",
            "route_streaming_unsupported",
            "Capability route does not support a requested streaming action"
        ));
    }

    const contextRefs = Array.isArray(action.input?.contextRefs) ? action.input.contextRefs : [];
    if (compatibility.contextRefs === false && contextRefs.length > 0) {
        errors.push(createValidationError(
            "busAction.action.input.contextRefs",
            "route_context_refs_incompatible",
            "Capability route cannot plan an action with contextRefs when capability compatibility disables contextRefs"
        ));
    }
}

export function normalizeCapabilityRoutePlan(busAction, routerRegistry) {
    return assertCapabilityRoutePlan(busAction, routerRegistry);
}

export function validateCapabilityRoutePlan(busAction, routerRegistry) {
    const errors = [];
    const busActionResult = validateBusActionForRoutePlan(busAction);
    const routerRegistryResult = validateCapabilityRouterRegistry(routerRegistry);

    if (!busActionResult.ok) {
        errors.push(...busActionResult.errors);
    }

    if (!routerRegistryResult.ok) {
        errors.push(...prefixCapabilityRouterValidationErrors(
            routerRegistryResult.errors,
            "routerRegistry",
            "route_plan_router_registry"
        ));
    }

    if (errors.length > 0) {
        return createValidationResult(errors);
    }

    const normalizedBusAction = busActionResult.value;
    const normalizedRegistry = routerRegistryResult.value;
    const { matchingRoutes, selectableRoute } = selectRouteForBusAction(
        normalizedRegistry,
        normalizedBusAction.action.capability
    );

    if (!selectableRoute) {
        if (matchingRoutes.length > 0) {
            return createValidationResult([
                createValidationError(
                    "route.status",
                    "route_unselectable_status",
                    `Capability route is not selectable for capability: ${normalizedBusAction.action.capability}`,
                    {
                        capability: normalizedBusAction.action.capability,
                        statuses: matchingRoutes.map((route) => route.status)
                    }
                )
            ]);
        }

        return createValidationResult([
            createValidationError(
                "routerRegistry.routes",
                "route_missing_for_capability",
                `Capability router registry does not define a selectable route for capability: ${normalizedBusAction.action.capability}`,
                {
                    capability: normalizedBusAction.action.capability
                }
            )
        ]);
    }

    if (selectableRoute.capability !== normalizedBusAction.capabilityDefinition.capability) {
        errors.push(createValidationError(
            "route.capability",
            "route_capability_mismatch",
            "Capability route must match the bus action capability definition",
            {
                routeCapability: selectableRoute.capability,
                definitionCapability: normalizedBusAction.capabilityDefinition.capability
            }
        ));
    }

    addRoutePlanCompatibilityErrors(errors, normalizedBusAction, selectableRoute);

    return createValidationResult(
        errors,
        errors.length === 0
            ? createRoutePlan(normalizedBusAction, selectableRoute)
            : null
    );
}

export function assertCapabilityRoutePlan(busAction, routerRegistry) {
    return assertValidation(
        validateCapabilityRoutePlan(busAction, routerRegistry),
        "Capability route plan validation failed"
    );
}
