import {
    collectForbiddenKeys,
    createValidationError,
    hasForbiddenPathLikeValue,
    isNonEmptyString,
    isPlainObject
} from "../../bus/contractValidation.mjs";

export const EVENT_LOG_BACKEND_CONTRACT_VERSION = "runtime.eventLogBackend.v1";
export const EVENT_LOG_BACKEND_KIND = "eventLogStoreBackend";

export const EVENT_LOG_BACKEND_STATUSES = Object.freeze([
    "contract-only",
    "planned",
    "experimental",
    "implemented",
    "disabled",
    "deprecated"
]);

export const EVENT_LOG_APPEND_POLICIES = Object.freeze([
    "best-effort",
    "buffered",
    "fail-closed"
]);

export const EVENT_LOG_RUNTIME_WAIT_MODES = Object.freeze([
    "never",
    "until-accepted",
    "until-settled"
]);

export const EVENT_LOG_APPEND_ERROR_SURFACES = Object.freeze([
    "observe-only",
    "operation-result",
    "throw"
]);

const FORBIDDEN_EVENT_LOG_BACKEND_KEYS = new Set([
    "modelPath",
    "baseModel",
    "mmprojPath",
    "projectorPath",
    "backendOptions",
    "adapterArgs",
    "rawBackendPayload",
    "connectionString",
    "databaseUrl",
    "dbPath",
    "filePath",
    "directory",
    "adapterFactory",
    "createAdapter",
    "appendEvent",
    "readEvents",
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

function cloneValue(value) {
    if (Array.isArray(value)) {
        return value.map((entry) => cloneValue(entry));
    }

    if (isPlainObject(value)) {
        return Object.fromEntries(
            Object.entries(value).map(([key, entry]) => [key, cloneValue(entry)])
        );
    }

    return value;
}

function freezeValue(value) {
    if (Array.isArray(value)) {
        for (const entry of value) {
            freezeValue(entry);
        }

        return Object.freeze(value);
    }

    if (isPlainObject(value)) {
        for (const entry of Object.values(value)) {
            freezeValue(entry);
        }

        return Object.freeze(value);
    }

    return value;
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

export function copyAndFreezeEventLogBackendValue(value) {
    return freezeValue(cloneValue(value));
}

export function normalizeOptionalEventLogBackendString(value) {
    return typeof value === "string" ? value.trim() : value;
}

export function addEventLogBackendError(errors, path, code, message, details = null) {
    errors.push(createValidationError(path, code, message, details));
}

export function addForbiddenEventLogBackendKeyErrors(errors, objectValue, code, label) {
    const found = collectForbiddenKeys(objectValue, FORBIDDEN_EVENT_LOG_BACKEND_KEYS);

    for (const entry of found) {
        addEventLogBackendError(
            errors,
            entry.path,
            code,
            `${label} must not include forbidden key: ${entry.key}`,
            {
                key: entry.key
            }
        );
    }
}

export function addUnknownEventLogBackendFieldErrors(errors, objectValue, allowedFields, path, code, label) {
    if (!isPlainObject(objectValue)) return;

    for (const key of Object.keys(objectValue)) {
        if (allowedFields.has(key)) continue;

        addEventLogBackendError(
            errors,
            path ? `${path}.${key}` : key,
            code,
            `Unsupported field for ${label}: ${key}`,
            {
                key
            }
        );
    }
}

export function addRequiredEventLogBackendStringError(errors, value, path, code, label) {
    if (isNonEmptyString(value)) return;

    addEventLogBackendError(
        errors,
        path,
        code,
        `${label} must be a non-empty string`
    );
}

export function addEventLogBackendMetadataStringValidation(errors, value, path) {
    if (value === undefined) return;

    if (!isNonEmptyString(value)) {
        addEventLogBackendError(
            errors,
            path,
            "invalid_event_log_backend_metadata_id",
            `${path} must be a non-empty metadata string when provided`
        );
        return;
    }

    if (hasForbiddenMetadataValue(value)) {
        addEventLogBackendError(
            errors,
            path,
            "forbidden_event_log_backend_metadata_value",
            `${path} must be a metadata label, not a path or backend payload`
        );
    }
}

export function addEventLogBackendBooleanValidation(errors, value, path, code, label) {
    if (typeof value === "boolean") return;

    addEventLogBackendError(
        errors,
        path,
        code,
        `${label} must be a boolean`
    );
}
