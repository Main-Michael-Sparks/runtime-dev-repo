import {
    collectForbiddenKeys,
    createValidationError,
    hasForbiddenPathLikeValue,
    isNonEmptyString,
    isPlainObject
} from "../bus/contractValidation.mjs";

export const CAPABILITY_ROUTER_CONTRACT_VERSION = "capability-router.v1";
export const CAPABILITY_ROUTE_MODEL_BUNDLE_PLAN_CONTRACT_VERSION = "capability-route-model-bundle-plan.v1";

export const CAPABILITY_ROUTE_STATUSES = Object.freeze([
    "contract-only",
    "planned",
    "implemented",
    "disabled",
    "deprecated"
]);

const CAPABILITY_ROUTE_SELECTABLE_STATUS_SET = new Set([
    "contract-only",
    "planned",
    "implemented"
]);

const FORBIDDEN_CAPABILITY_ROUTE_KEYS = new Set([
    "modelPath",
    "baseModel",
    "mmprojPath",
    "projectorPath",
    "backend",
    "backendAdapter",
    "backendOptions",
    "adapterArgs",
    "rawBackendPayload",
    "toolProcess",
    "command",
    "shell",
    "exec",
    "spawn",
    "stdio",
    "cwd",
    "env"
]);

export function isSelectableCapabilityRouteStatus(status) {
    return CAPABILITY_ROUTE_SELECTABLE_STATUS_SET.has(status);
}

export function normalizeOptionalString(value) {
    return typeof value === "string" ? value.trim() : value;
}

export function copyCapabilityRouterActionEnvelope(action) {
    return {
        ...action,
        source: isPlainObject(action?.source) ? { ...action.source } : action?.source,
        input: isPlainObject(action?.input)
            ? {
                  ...action.input,
                  contextRefs: Array.isArray(action.input.contextRefs)
                      ? [...action.input.contextRefs]
                      : action.input.contextRefs
              }
            : action?.input,
        requirements: isPlainObject(action?.requirements)
            ? { ...action.requirements }
            : action?.requirements,
        policy: isPlainObject(action?.policy) ? { ...action.policy } : action?.policy,
        trace: isPlainObject(action?.trace) ? { ...action.trace } : action?.trace
    };
}

export function copyCapabilityRouterCapabilityDefinition(definition) {
    return {
        ...definition,
        contracts: isPlainObject(definition?.contracts) ? { ...definition.contracts } : definition?.contracts,
        requirements: isPlainObject(definition?.requirements)
            ? { ...definition.requirements }
            : definition?.requirements,
        policy: isPlainObject(definition?.policy) ? { ...definition.policy } : definition?.policy,
        compatibility: isPlainObject(definition?.compatibility)
            ? {
                  ...definition.compatibility,
                  backendKinds: Array.isArray(definition.compatibility.backendKinds)
                      ? [...definition.compatibility.backendKinds]
                      : definition.compatibility.backendKinds
              }
            : definition?.compatibility
    };
}

export function copyCapabilityRouterBusAction(busAction) {
    return {
        contractVersion: busAction.contractVersion,
        action: copyCapabilityRouterActionEnvelope(busAction.action),
        capabilityDefinition: copyCapabilityRouterCapabilityDefinition(busAction.capabilityDefinition)
    };
}

export function copyCapabilityRouteDefinition(route) {
    return {
        ...route,
        requirements: isPlainObject(route?.requirements)
            ? { ...route.requirements }
            : route?.requirements
    };
}

export function addForbiddenCapabilityRouterKeyErrors(errors, objectValue, code, label) {
    const found = collectForbiddenKeys(objectValue, FORBIDDEN_CAPABILITY_ROUTE_KEYS);

    for (const entry of found) {
        errors.push(createValidationError(
            entry.path,
            code,
            `${label} must not include forbidden key: ${entry.key}`,
            {
                key: entry.key
            }
        ));
    }
}

export function addUnknownCapabilityRouterFieldErrors(errors, objectValue, allowedFields, path, code, label) {
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

export function addRequiredCapabilityRouterStringError(errors, value, path, code, label) {
    if (isNonEmptyString(value)) return;

    errors.push(createValidationError(
        path,
        code,
        `${label} must be a non-empty string`
    ));
}

function hasForbiddenMetadataValue(value) {
    if (typeof value !== "string") return false;

    const trimmed = value.trim();
    if (!trimmed) return false;

    return (
        hasForbiddenPathLikeValue(trimmed) ||
        trimmed.includes("/") ||
        trimmed.includes("\\") ||
        trimmed.startsWith(".")
    );
}

export function addCapabilityRouteMetadataStringValidation(errors, value, path) {
    if (value === undefined) return;

    if (!isNonEmptyString(value)) {
        errors.push(createValidationError(
            path,
            "invalid_route_metadata_id",
            `${path} must be a non-empty metadata string when provided`
        ));
        return;
    }

    if (hasForbiddenMetadataValue(value)) {
        errors.push(createValidationError(
            path,
            "forbidden_route_metadata_value",
            `${path} must be a metadata label, not a path or backend payload`
        ));
    }
}

export function prefixCapabilityRouterValidationErrors(errors, prefix, codePrefix) {
    return errors.map((error) => createValidationError(
        error.path ? `${prefix}.${error.path}` : prefix,
        `${codePrefix}_${error.code}`,
        error.message,
        error.details
    ));
}
