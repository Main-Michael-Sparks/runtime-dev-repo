import {
    assertValidation,
    createValidationError,
    createValidationResult,
    isNonEmptyString,
    isPlainObject
} from "../bus/contractValidation.mjs";
import {
    isKnownCapabilityRequirementSupportLevel
} from "../bus/capabilityDefinition.mjs";
import { isKnownCapability } from "../bus/capabilityTaxonomy.mjs";
import {
    CAPABILITY_ROUTE_STATUSES,
    addCapabilityRouteMetadataStringValidation,
    addForbiddenCapabilityRouterKeyErrors,
    addRequiredCapabilityRouterStringError,
    addUnknownCapabilityRouterFieldErrors,
    copyCapabilityRouteDefinition,
    normalizeOptionalString
} from "./capabilityRouterCommon.mjs";

const CAPABILITY_ROUTE_STATUS_SET = new Set(CAPABILITY_ROUTE_STATUSES);

const CAPABILITY_ROUTE_FIELDS = new Set([
    "routeId",
    "capability",
    "status",
    "serviceId",
    "backendKind",
    "backendId",
    "modelBundleId",
    "hardwareProfileId",
    "requirements"
]);

const CAPABILITY_ROUTE_REQUIREMENT_FIELDS = new Set([
    "streaming",
    "cancellation",
    "timeout"
]);

function normalizeRouteRequirements(requirements) {
    if (requirements === undefined) return undefined;

    return {
        streaming: normalizeOptionalString(requirements?.streaming),
        cancellation: normalizeOptionalString(requirements?.cancellation),
        timeout: normalizeOptionalString(requirements?.timeout)
    };
}

function validateRouteRequirements(requirements, errors) {
    if (requirements === undefined) return;

    if (!isPlainObject(requirements)) {
        errors.push(createValidationError(
            "requirements",
            "invalid_route_requirements",
            "Capability route requirements must be a plain object when provided"
        ));
        return;
    }

    addUnknownCapabilityRouterFieldErrors(
        errors,
        requirements,
        CAPABILITY_ROUTE_REQUIREMENT_FIELDS,
        "requirements",
        "unknown_route_requirement_field",
        "capability route requirements"
    );

    for (const key of CAPABILITY_ROUTE_REQUIREMENT_FIELDS) {
        const value = requirements[key];
        if (value === undefined) continue;

        if (!isNonEmptyString(value)) {
            errors.push(createValidationError(
                `requirements.${key}`,
                "invalid_route_requirement_support_level",
                `requirements.${key} must be a non-empty support-level string when provided`
            ));
            continue;
        }

        if (!isKnownCapabilityRequirementSupportLevel(value)) {
            errors.push(createValidationError(
                `requirements.${key}`,
                "unknown_route_requirement_support_level",
                `Unknown route requirement support level: ${value}`,
                {
                    supportLevel: value
                }
            ));
        }
    }
}

export {
    CAPABILITY_ROUTER_CONTRACT_VERSION,
    CAPABILITY_ROUTE_MODEL_BUNDLE_PLAN_CONTRACT_VERSION,
    CAPABILITY_ROUTE_STATUSES
} from "./capabilityRouterCommon.mjs";

export function isKnownCapabilityRouteStatus(value) {
    return CAPABILITY_ROUTE_STATUS_SET.has(value);
}

export function normalizeCapabilityRouteDefinition(route) {
    return {
        ...route,
        routeId: normalizeOptionalString(route?.routeId),
        capability: normalizeOptionalString(route?.capability),
        status: normalizeOptionalString(route?.status),
        serviceId: normalizeOptionalString(route?.serviceId),
        backendKind: normalizeOptionalString(route?.backendKind),
        backendId: normalizeOptionalString(route?.backendId),
        modelBundleId: normalizeOptionalString(route?.modelBundleId),
        hardwareProfileId: normalizeOptionalString(route?.hardwareProfileId),
        requirements: normalizeRouteRequirements(route?.requirements)
    };
}

export function validateCapabilityRouteDefinition(route) {
    const errors = [];

    if (!isPlainObject(route)) {
        return createValidationResult([
            createValidationError(
                "",
                "invalid_capability_route",
                "Capability route definition must be a plain object"
            )
        ]);
    }

    addForbiddenCapabilityRouterKeyErrors(
        errors,
        route,
        "forbidden_capability_route_key",
        "Capability route definition"
    );
    addUnknownCapabilityRouterFieldErrors(
        errors,
        route,
        CAPABILITY_ROUTE_FIELDS,
        "",
        "unknown_capability_route_field",
        "capability route definition"
    );

    if (!isNonEmptyString(route.capability)) {
        errors.push(createValidationError(
            "capability",
            "missing_route_capability",
            "Capability route capability must be a non-empty string"
        ));
    } else if (!isKnownCapability(route.capability)) {
        errors.push(createValidationError(
            "capability",
            "unknown_route_capability",
            `Unknown route capability: ${route.capability}`,
            {
                capability: route.capability
            }
        ));
    }

    if (!isNonEmptyString(route.status)) {
        errors.push(createValidationError(
            "status",
            "missing_route_status",
            "Capability route status must be a non-empty string"
        ));
    } else if (!isKnownCapabilityRouteStatus(route.status)) {
        errors.push(createValidationError(
            "status",
            "unknown_route_status",
            `Unknown capability route status: ${route.status}`,
            {
                status: route.status
            }
        ));
    }

    addRequiredCapabilityRouterStringError(
        errors,
        route.routeId,
        "routeId",
        "missing_route_id",
        "Capability route routeId"
    );
    addRequiredCapabilityRouterStringError(
        errors,
        route.serviceId,
        "serviceId",
        "missing_route_service_id",
        "Capability route serviceId"
    );
    addRequiredCapabilityRouterStringError(
        errors,
        route.backendKind,
        "backendKind",
        "missing_route_backend_kind",
        "Capability route backendKind"
    );

    for (const key of [
        "routeId",
        "serviceId",
        "backendKind",
        "backendId",
        "modelBundleId",
        "hardwareProfileId"
    ]) {
        addCapabilityRouteMetadataStringValidation(errors, route[key], key);
    }

    validateRouteRequirements(route.requirements, errors);

    return createValidationResult(
        errors,
        errors.length === 0 ? normalizeCapabilityRouteDefinition(route) : null
    );
}

export function assertCapabilityRouteDefinition(route) {
    return assertValidation(
        validateCapabilityRouteDefinition(route),
        "Capability route definition validation failed"
    );
}

export { copyCapabilityRouteDefinition };
