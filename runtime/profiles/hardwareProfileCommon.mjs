import {
    collectForbiddenKeys,
    createValidationError,
    hasForbiddenPathLikeValue,
    isNonEmptyString,
    isPlainObject
} from "../bus/contractValidation.mjs";

export const HARDWARE_PROFILE_CONTRACT_VERSION = "hardware-profile.v1";
export const HARDWARE_PROFILE_REGISTRY_SCHEMA_VERSION = "hardware-profile-registry.v1";

export const HARDWARE_PROFILE_STATUSES = Object.freeze([
    "contract-only",
    "planned",
    "experimental",
    "configured",
    "disabled",
    "deprecated"
]);

export const HARDWARE_PROFILE_CLASSES = Object.freeze([
    "cpu-laptop",
    "cpu-desktop",
    "gpu-consumer",
    "gpu-workstation",
    "server-managed",
    "external-service",
    "unknown"
]);

export const HARDWARE_PROFILE_PROCESS_MODES = Object.freeze([
    "in-process-worker",
    "managed-worker",
    "oneshot-cli",
    "service",
    "external-service",
    "metadata-only"
]);

const HARDWARE_PROFILE_SELECTABLE_STATUS_SET = new Set([
    "contract-only",
    "planned",
    "experimental",
    "configured"
]);

const FORBIDDEN_HARDWARE_PROFILE_KEYS = new Set([
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
    "invoke",
    "workerBridge",
    "llama_worker",
    "nodeLlamaCpp",
    "configOverride"
]);

function clonePlainValue(value) {
    if (Array.isArray(value)) {
        return value.map((entry) => clonePlainValue(entry));
    }

    if (isPlainObject(value)) {
        const out = {};

        for (const [key, childValue] of Object.entries(value)) {
            out[key] = clonePlainValue(childValue);
        }

        return out;
    }

    return value;
}

function formatChildPath(parentPath, key) {
    if (!parentPath) return String(key);
    return `${parentPath}.${String(key)}`;
}

function hasForbiddenMetadataValue(value) {
    if (typeof value !== "string") return false;

    const trimmed = value.trim();
    if (!trimmed) return false;

    return hasForbiddenPathLikeValue(trimmed);
}

export function isSelectableHardwareProfileStatus(status) {
    return HARDWARE_PROFILE_SELECTABLE_STATUS_SET.has(status);
}

export function normalizeOptionalString(value) {
    return typeof value === "string" ? value.trim() : value;
}

export function normalizeOptionalStringArray(value) {
    if (!Array.isArray(value)) return value;
    return value.map((entry) => normalizeOptionalString(entry));
}

export function copyHardwareProfileDefinition(profile) {
    return clonePlainValue(profile);
}

export function copyHardwareProfileRegistry(registry) {
    return clonePlainValue(registry);
}

export function addForbiddenHardwareProfileKeyErrors(errors, objectValue, code, label) {
    const found = collectForbiddenKeys(objectValue, FORBIDDEN_HARDWARE_PROFILE_KEYS);

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

export function addUnknownHardwareProfileFieldErrors(errors, objectValue, allowedFields, path, code, label) {
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

export function addRequiredHardwareProfileStringError(errors, value, path, code, label) {
    if (isNonEmptyString(value)) return;

    errors.push(createValidationError(
        path,
        code,
        `${label} must be a non-empty string`
    ));
}

export function addHardwareProfileMetadataStringValidation(errors, value, path) {
    if (value === undefined) return;

    if (!isNonEmptyString(value)) {
        errors.push(createValidationError(
            path,
            "invalid_hardware_profile_metadata_id",
            `${path} must be a non-empty metadata string when provided`
        ));
        return;
    }

    if (hasForbiddenMetadataValue(value)) {
        errors.push(createValidationError(
            path,
            "forbidden_hardware_profile_metadata_value",
            `${path} must be a metadata label, not a path or backend payload`
        ));
    }
}

export function addHardwareProfileStringArrayValidation(errors, value, path, { required = true } = {}) {
    if (value === undefined && required === false) return;

    if (!Array.isArray(value)) {
        errors.push(createValidationError(
            path,
            "invalid_hardware_profile_string_array",
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
                "invalid_hardware_profile_string_array_entry",
                `${entryPath} must be a non-empty metadata string`
            ));
            continue;
        }

        const normalized = entry.trim();

        if (hasForbiddenMetadataValue(normalized)) {
            errors.push(createValidationError(
                entryPath,
                "forbidden_hardware_profile_string_array_value",
                `${entryPath} must be a metadata label, not a path or backend payload`
            ));
            continue;
        }

        if (seen.has(normalized)) {
            errors.push(createValidationError(
                entryPath,
                "duplicate_hardware_profile_string_array_entry",
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

export function addPositiveIntegerValidation(errors, value, path, code, label) {
    if (Number.isInteger(value) && value > 0) return;

    errors.push(createValidationError(
        path,
        code,
        `${label} must be a positive integer`
    ));
}

export function addNonNegativeIntegerValidation(errors, value, path, code, label) {
    if (Number.isInteger(value) && value >= 0) return;

    errors.push(createValidationError(
        path,
        code,
        `${label} must be a non-negative integer`
    ));
}

export function addForbiddenHardwareProfilePathLikeValueErrors(errors, objectValue, label) {
    function visit(value, path) {
        if (Array.isArray(value)) {
            for (let index = 0; index < value.length; index++) {
                visit(value[index], `${path}[${index}]`);
            }
            return;
        }

        if (isPlainObject(value)) {
            for (const [key, childValue] of Object.entries(value)) {
                visit(childValue, formatChildPath(path, key));
            }
            return;
        }

        if (typeof value !== "string") return;

        const trimmed = value.trim();
        if (!trimmed) return;
        if (!hasForbiddenPathLikeValue(trimmed)) return;

        errors.push(createValidationError(
            path,
            "forbidden_hardware_profile_path_like_value",
            `${label} must not include path-like values or raw model artifact references`,
            {
                value: trimmed
            }
        ));
    }

    visit(objectValue, "");
}

export function prefixHardwareProfileValidationErrors(errors, prefix, codePrefix) {
    if (!Array.isArray(errors)) return [];

    return errors.map((error) => createValidationError(
        prefix && error.path ? `${prefix}.${error.path}` : (prefix || error.path),
        codePrefix ? `${codePrefix}_${error.code}` : error.code,
        error.message,
        error.details
    ));
}
