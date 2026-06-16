import {
    assertValidation,
    createValidationError,
    createValidationResult,
    isNonEmptyString,
    isPlainObject
} from "../bus/contractValidation.mjs";
import {
    assertCapabilityRouteDefinition,
    copyCapabilityRouteDefinition,
    normalizeCapabilityRouteDefinition,
    validateCapabilityRouteDefinition
} from "./capabilityRouteDefinition.mjs";
import {
    CAPABILITY_ROUTER_CONTRACT_VERSION,
    addForbiddenCapabilityRouterKeyErrors,
    addUnknownCapabilityRouterFieldErrors,
    isSelectableCapabilityRouteStatus,
    prefixCapabilityRouterValidationErrors
} from "./capabilityRouterCommon.mjs";

const CAPABILITY_ROUTER_REGISTRY_FIELDS = new Set([
    "schemaVersion",
    "routes"
]);

function addRouteRegistryDuplicateErrors(errors, routes) {
    const seenRouteIds = new Map();
    const seenSelectableCapabilities = new Map();

    for (let index = 0; index < routes.length; index++) {
        const route = routes[index];

        if (isNonEmptyString(route.routeId)) {
            if (seenRouteIds.has(route.routeId)) {
                errors.push(createValidationError(
                    `routes[${index}].routeId`,
                    "duplicate_route_id",
                    `Capability router registry must not include duplicate routeId entries: ${route.routeId}`,
                    {
                        routeId: route.routeId,
                        firstIndex: seenRouteIds.get(route.routeId),
                        duplicateIndex: index
                    }
                ));
            } else {
                seenRouteIds.set(route.routeId, index);
            }
        }

        if (!isSelectableCapabilityRouteStatus(route.status)) continue;
        if (!isNonEmptyString(route.capability)) continue;

        if (seenSelectableCapabilities.has(route.capability)) {
            errors.push(createValidationError(
                `routes[${index}].capability`,
                "duplicate_selectable_route_for_capability",
                `Capability router registry must not include duplicate selectable routes for capability: ${route.capability}`,
                {
                    capability: route.capability,
                    firstIndex: seenSelectableCapabilities.get(route.capability),
                    duplicateIndex: index
                }
            ));
        } else {
            seenSelectableCapabilities.set(route.capability, index);
        }
    }
}

export function normalizeCapabilityRouterRegistry(registry) {
    const routes = Array.isArray(registry?.routes)
        ? registry.routes.map((route) => normalizeCapabilityRouteDefinition(route))
        : registry?.routes;

    return {
        ...registry,
        schemaVersion: registry?.schemaVersion === undefined
            ? CAPABILITY_ROUTER_CONTRACT_VERSION
            : registry.schemaVersion,
        routes
    };
}

export function validateCapabilityRouterRegistry(registry) {
    const errors = [];

    if (!isPlainObject(registry)) {
        return createValidationResult([
            createValidationError(
                "",
                "invalid_capability_router_registry",
                "Capability router registry must be a plain object"
            )
        ]);
    }

    addForbiddenCapabilityRouterKeyErrors(
        errors,
        registry,
        "forbidden_capability_router_registry_key",
        "Capability router registry"
    );
    addUnknownCapabilityRouterFieldErrors(
        errors,
        registry,
        CAPABILITY_ROUTER_REGISTRY_FIELDS,
        "",
        "unknown_capability_router_registry_field",
        "capability router registry"
    );

    if (
        registry.schemaVersion !== undefined &&
        registry.schemaVersion !== CAPABILITY_ROUTER_CONTRACT_VERSION
    ) {
        errors.push(createValidationError(
            "schemaVersion",
            "unsupported_capability_router_schema_version",
            `Unsupported capability router schemaVersion: ${registry.schemaVersion}`,
            {
                expected: CAPABILITY_ROUTER_CONTRACT_VERSION
            }
        ));
    }

    if (!Array.isArray(registry.routes)) {
        errors.push(createValidationError(
            "routes",
            "invalid_capability_routes",
            "Capability router registry routes must be an array"
        ));

        return createValidationResult(errors);
    }

    const normalizedRoutes = [];

    for (let index = 0; index < registry.routes.length; index++) {
        const result = validateCapabilityRouteDefinition(registry.routes[index]);

        if (!result.ok) {
            errors.push(...prefixCapabilityRouterValidationErrors(
                result.errors,
                `routes[${index}]`,
                "router_registry_route"
            ));
            continue;
        }

        normalizedRoutes.push(result.value);
    }

    if (normalizedRoutes.length === registry.routes.length) {
        addRouteRegistryDuplicateErrors(errors, normalizedRoutes);
    }

    return createValidationResult(
        errors,
        errors.length === 0
            ? {
                  schemaVersion: registry.schemaVersion ?? CAPABILITY_ROUTER_CONTRACT_VERSION,
                  routes: normalizedRoutes
              }
            : null
    );
}

export function assertCapabilityRouterRegistry(registry) {
    return assertValidation(
        validateCapabilityRouterRegistry(registry),
        "Capability router registry validation failed"
    );
}

export function createCapabilityRouterRegistry(routes = []) {
    return assertCapabilityRouterRegistry({
        schemaVersion: CAPABILITY_ROUTER_CONTRACT_VERSION,
        routes
    });
}

export function listCapabilityRoutes(registry) {
    const normalizedRegistry = assertCapabilityRouterRegistry(registry);
    return normalizedRegistry.routes.map((route) => copyCapabilityRouteDefinition(route));
}

export function getCapabilityRoute(registry, routeId) {
    const normalizedRegistry = assertCapabilityRouterRegistry(registry);
    const normalizedRouteId = typeof routeId === "string" ? routeId.trim() : routeId;
    const route = normalizedRegistry.routes.find((entry) => entry.routeId === normalizedRouteId);

    return route ? copyCapabilityRouteDefinition(route) : null;
}

export function hasCapabilityRoute(registry, routeId) {
    return getCapabilityRoute(registry, routeId) !== null;
}

export {
    assertCapabilityRouteDefinition,
    validateCapabilityRouteDefinition
};
