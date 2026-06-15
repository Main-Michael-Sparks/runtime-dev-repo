import {
    collectForbiddenKeys,
    createValidationError,
    hasForbiddenPathLikeValue,
    isNonEmptyString,
    isPlainObject
} from "../bus/contractValidation.mjs";

export const BACKEND_ADAPTER_CONTRACT_VERSION = "backend-adapter.v1";
export const BACKEND_ADAPTER_REGISTRY_SCHEMA_VERSION = "backend-adapter-registry.v1";

export const BACKEND_ADAPTER_STATUSES = Object.freeze([
    "contract-only",
    "planned",
    "experimental",
    "implemented",
    "disabled",
    "deprecated"
]);

const BACKEND_ADAPTER_SELECTABLE_STATUS_SET = new Set([
    "contract-only",
    "planned",
    "experimental",
    "implemented"
]);

const FORBIDDEN_BACKEND_ADAPTER_KEYS = new Set([
    "modelPath",
    "baseModel",
    "mmprojPath",
    "projectorPath",
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

export function isSelectableBackendAdapterStatus(status) {
    return BACKEND_ADAPTER_SELECTABLE_STATUS_SET.has(status);
}

export function normalizeOptionalString(value) {
    return typeof value === "string" ? value.trim() : value;
}

export function normalizeOptionalStringArray(value) {
    if (!Array.isArray(value)) return value;
    return value.map((entry) => normalizeOptionalString(entry));
}

export function copyBackendAdapterDefinition(adapter) {
    return {
        ...adapter,
        capabilities: Array.isArray(adapter?.capabilities)
            ? [...adapter.capabilities]
            : adapter?.capabilities,
        services: Array.isArray(adapter?.services)
            ? [...adapter.services]
            : adapter?.services,
        contracts: isPlainObject(adapter?.contracts) ? { ...adapter.contracts } : adapter?.contracts,
        result: isPlainObject(adapter?.result)
            ? {
                  ...adapter.result,
                  outputFields: Array.isArray(adapter.result.outputFields)
                      ? [...adapter.result.outputFields]
                      : adapter.result.outputFields
              }
            : adapter?.result,
        requirements: isPlainObject(adapter?.requirements)
            ? { ...adapter.requirements }
            : adapter?.requirements,
        compatibility: isPlainObject(adapter?.compatibility)
            ? { ...adapter.compatibility }
            : adapter?.compatibility
    };
}

export function copyBackendAdapterRegistry(registry) {
    return {
        schemaVersion: registry.schemaVersion,
        adapters: Array.isArray(registry.adapters)
            ? registry.adapters.map((adapter) => copyBackendAdapterDefinition(adapter))
            : registry.adapters
    };
}

export function copyBackendAdapterServicePlan(servicePlan) {
    return {
        ...servicePlan,
        routePlan: servicePlan?.routePlan,
        service: servicePlan?.service
    };
}

export function addForbiddenBackendAdapterKeyErrors(errors, objectValue, code, label) {
    const found = collectForbiddenKeys(objectValue, FORBIDDEN_BACKEND_ADAPTER_KEYS);

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

export function addUnknownBackendAdapterFieldErrors(errors, objectValue, allowedFields, path, code, label) {
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

export function addRequiredBackendAdapterStringError(errors, value, path, code, label) {
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

export function addBackendAdapterMetadataStringValidation(errors, value, path) {
    if (value === undefined) return;

    if (!isNonEmptyString(value)) {
        errors.push(createValidationError(
            path,
            "invalid_backend_adapter_metadata_id",
            `${path} must be a non-empty metadata string when provided`
        ));
        return;
    }

    if (hasForbiddenMetadataValue(value)) {
        errors.push(createValidationError(
            path,
            "forbidden_backend_adapter_metadata_value",
            `${path} must be a metadata label, not a path or backend payload`
        ));
    }
}

export function addBackendAdapterStringArrayValidation(errors, value, path, { required = true } = {}) {
    if (value === undefined && required === false) return;

    if (!Array.isArray(value)) {
        errors.push(createValidationError(
            path,
            "invalid_backend_adapter_string_array",
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
                "invalid_backend_adapter_string_array_entry",
                `${entryPath} must be a non-empty metadata string`
            ));
            continue;
        }

        const normalized = entry.trim();

        if (hasForbiddenMetadataValue(normalized)) {
            errors.push(createValidationError(
                entryPath,
                "forbidden_backend_adapter_string_array_value",
                `${entryPath} must be a metadata label, not a path or backend payload`
            ));
            continue;
        }

        if (seen.has(normalized)) {
            errors.push(createValidationError(
                entryPath,
                "duplicate_backend_adapter_string_array_entry",
                `${path} must not include duplicate metadata string entries: ${normalized}`,
                {
                    value: normalized,
                    firstIndex: seen.get(normalized),
                    duplicateIndex: index
                }
            ));
        } else {
            seen.set(normalized, index);
        }
    }
}

export function prefixBackendAdapterValidationErrors(errors, prefix, codePrefix) {
    if (!Array.isArray(errors)) return [];

    return errors.map((error) => createValidationError(
        prefix && error.path ? `${prefix}.${error.path}` : (prefix || error.path),
        codePrefix ? `${codePrefix}_${error.code}` : error.code,
        error.message,
        error.details
    ));
}
