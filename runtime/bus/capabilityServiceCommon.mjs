import {
    collectForbiddenKeys,
    createValidationError,
    hasForbiddenPathLikeValue,
    isNonEmptyString,
    isPlainObject
} from "./contractValidation.mjs";

export const CAPABILITY_SERVICE_CONTRACT_VERSION = "capability-service.v1";
export const CAPABILITY_SERVICE_REGISTRY_SCHEMA_VERSION = "capability-service-registry.v1";

export const CAPABILITY_SERVICE_STATUSES = Object.freeze([
    "contract-only",
    "planned",
    "experimental",
    "implemented",
    "disabled",
    "deprecated"
]);

const CAPABILITY_SERVICE_SELECTABLE_STATUS_SET = new Set([
    "contract-only",
    "planned",
    "experimental",
    "implemented"
]);

const FORBIDDEN_CAPABILITY_SERVICE_KEYS = new Set([
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
    "env",
    "function",
    "handler",
    "execute",
    "executeAction",
    "invoke"
]);

export function isSelectableCapabilityServiceStatus(status) {
    return CAPABILITY_SERVICE_SELECTABLE_STATUS_SET.has(status);
}

export function normalizeOptionalString(value) {
    return typeof value === "string" ? value.trim() : value;
}

export function normalizeOptionalStringArray(value) {
    if (!Array.isArray(value)) return value;
    return value.map((entry) => normalizeOptionalString(entry));
}

export function copyCapabilityServiceDefinition(service) {
    return {
        ...service,
        contracts: isPlainObject(service?.contracts) ? { ...service.contracts } : service?.contracts,
        input: isPlainObject(service?.input)
            ? {
                  ...service.input,
                  requiredFields: Array.isArray(service.input.requiredFields)
                      ? [...service.input.requiredFields]
                      : service.input.requiredFields,
                  optionalFields: Array.isArray(service.input.optionalFields)
                      ? [...service.input.optionalFields]
                      : service.input.optionalFields
              }
            : service?.input,
        result: isPlainObject(service?.result)
            ? {
                  ...service.result,
                  outputFields: Array.isArray(service.result.outputFields)
                      ? [...service.result.outputFields]
                      : service.result.outputFields
              }
            : service?.result,
        requirements: isPlainObject(service?.requirements)
            ? { ...service.requirements }
            : service?.requirements,
        compatibility: isPlainObject(service?.compatibility)
            ? {
                  ...service.compatibility,
                  backendKinds: Array.isArray(service.compatibility.backendKinds)
                      ? [...service.compatibility.backendKinds]
                      : service.compatibility.backendKinds
              }
            : service?.compatibility
    };
}

export function copyCapabilityServiceActionEnvelope(action) {
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

export function copyCapabilityServiceCapabilityDefinition(definition) {
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

export function copyCapabilityServiceBusAction(busAction) {
    return {
        contractVersion: busAction.contractVersion,
        action: copyCapabilityServiceActionEnvelope(busAction.action),
        capabilityDefinition: copyCapabilityServiceCapabilityDefinition(busAction.capabilityDefinition)
    };
}

export function copyCapabilityServiceRoute(route) {
    return {
        ...route,
        requirements: isPlainObject(route?.requirements)
            ? { ...route.requirements }
            : route?.requirements
    };
}

export function copyCapabilityServiceRoutePlan(routePlan) {
    return {
        contractVersion: routePlan.contractVersion,
        busAction: copyCapabilityServiceBusAction(routePlan.busAction),
        route: copyCapabilityServiceRoute(routePlan.route)
    };
}

export function addForbiddenCapabilityServiceKeyErrors(errors, objectValue, code, label) {
    const found = collectForbiddenKeys(objectValue, FORBIDDEN_CAPABILITY_SERVICE_KEYS);

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

export function addUnknownCapabilityServiceFieldErrors(errors, objectValue, allowedFields, path, code, label) {
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

export function addRequiredCapabilityServiceStringError(errors, value, path, code, label) {
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

export function addCapabilityServiceMetadataStringValidation(errors, value, path) {
    if (value === undefined) return;

    if (!isNonEmptyString(value)) {
        errors.push(createValidationError(
            path,
            "invalid_service_metadata_id",
            `${path} must be a non-empty metadata string when provided`
        ));
        return;
    }

    if (hasForbiddenMetadataValue(value)) {
        errors.push(createValidationError(
            path,
            "forbidden_service_metadata_value",
            `${path} must be a metadata label, not a path or backend payload`
        ));
    }
}

export function addCapabilityServiceStringArrayValidation(errors, value, path, { required = true } = {}) {
    if (value === undefined && required === false) return;

    if (!Array.isArray(value)) {
        errors.push(createValidationError(
            path,
            "invalid_service_string_array",
            `${path} must be an array of non-empty metadata strings`
        ));
        return;
    }

    const seen = new Map();

    for (let index = 0; index < value.length; index++) {
        const entry = value[index];
        const entryPath = `${path}[${index}]`;

        if (!isNonEmptyString(entry)) {
            errors.push(createValidationError(
                entryPath,
                "invalid_service_string_array_entry",
                `${entryPath} must be a non-empty metadata string`
            ));
            continue;
        }

        const normalizedEntry = entry.trim();

        if (hasForbiddenMetadataValue(normalizedEntry)) {
            errors.push(createValidationError(
                entryPath,
                "forbidden_service_metadata_value",
                `${entryPath} must be a metadata label, not a path or backend payload`
            ));
        }

        if (seen.has(normalizedEntry)) {
            errors.push(createValidationError(
                entryPath,
                "duplicate_service_string_array_entry",
                `${path} must not include duplicate entries: ${normalizedEntry}`,
                {
                    value: normalizedEntry,
                    firstIndex: seen.get(normalizedEntry),
                    duplicateIndex: index
                }
            ));
        } else {
            seen.set(normalizedEntry, index);
        }
    }
}

export function prefixCapabilityServiceValidationErrors(errors, prefix, codePrefix) {
    return errors.map((error) => createValidationError(
        error.path ? `${prefix}.${error.path}` : prefix,
        `${codePrefix}_${error.code}`,
        error.message,
        error.details
    ));
}
