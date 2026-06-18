import {
    collectForbiddenKeys,
    createValidationError,
    hasForbiddenPathLikeValue,
    isNonEmptyString,
    isPlainObject
} from "../bus/contractValidation.mjs";

export const BACKEND_ADAPTER_INVOCATION_CONTRACT_VERSION = "backend-adapter-invocation.v1";
export const BACKEND_ADAPTER_INVOCATION_STATUS = "planned";
export const BACKEND_ADAPTER_INVOCATION_BOUNDARY = "contract-only";
export const BACKEND_ADAPTER_INVOCATION_EXECUTABLE = false;
export const BACKEND_ADAPTER_INVOCATION_RUNTIME_WIRING = "not-wired";
export const BACKEND_ADAPTER_INVOCATION_NATIVE_EXECUTION = "not-wired";

const FORBIDDEN_BACKEND_ADAPTER_INVOCATION_KEYS = new Set([
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
    "callback",
    "execute",
    "executeAction",
    "invoke",
    "workerBridge",
    "llamaWorker",
    "llama_worker",
    "nodeLlamaCpp",
    "node-llama-cpp",
    "worker_threads",
    "child_process",
    "runtime",
    "scheduler",
    "request",
    "streamController",
    "sendToWorker",
    "ReadableStream"
]);

function copyPlainBackendAdapterInvocationValue(value) {
    if (Array.isArray(value)) {
        return value.map((entry) => copyPlainBackendAdapterInvocationValue(entry));
    }

    if (isPlainObject(value)) {
        const out = {};

        for (const [key, childValue] of Object.entries(value)) {
            out[key] = copyPlainBackendAdapterInvocationValue(childValue);
        }

        return out;
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

export function normalizeBackendAdapterInvocationString(value) {
    return typeof value === "string" ? value.trim() : value;
}

export function copyBackendAdapterInvocationValue(value) {
    return copyPlainBackendAdapterInvocationValue(value);
}

export function copyBackendAdapterInvocationDescriptor(descriptor) {
    return {
        contractVersion: descriptor?.contractVersion,
        status: descriptor?.status,
        invocation: copyBackendAdapterInvocationValue(descriptor?.invocation),
        boundary: copyBackendAdapterInvocationValue(descriptor?.boundary)
    };
}

export function addForbiddenBackendAdapterInvocationKeyErrors(errors, objectValue, code, label) {
    const found = collectForbiddenKeys(objectValue, FORBIDDEN_BACKEND_ADAPTER_INVOCATION_KEYS);

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

export function addUnknownBackendAdapterInvocationFieldErrors(errors, objectValue, allowedFields, path, code, label) {
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

export function addRequiredBackendAdapterInvocationStringError(errors, value, path, code, label) {
    if (isNonEmptyString(value)) return;

    errors.push(createValidationError(
        path,
        code,
        `${label} must be a non-empty string`
    ));
}

export function addOptionalBackendAdapterInvocationStringError(errors, value, path, code, label) {
    if (value === undefined) return;

    addRequiredBackendAdapterInvocationStringError(errors, value, path, code, label);
}

export function addBackendAdapterInvocationMetadataStringValidation(errors, value, path) {
    if (value === undefined) return;

    if (!isNonEmptyString(value)) {
        errors.push(createValidationError(
            path,
            "invalid_backend_adapter_invocation_metadata_id",
            `${path} must be a non-empty metadata string when provided`
        ));
        return;
    }

    if (hasForbiddenMetadataValue(value)) {
        errors.push(createValidationError(
            path,
            "forbidden_backend_adapter_invocation_metadata_value",
            `${path} must be a metadata label, not a path or backend payload`
        ));
    }
}

export function prefixBackendAdapterInvocationValidationErrors(errors, prefix, codePrefix) {
    if (!Array.isArray(errors)) return [];

    return errors.map((error) => createValidationError(
        prefix && error.path ? `${prefix}.${error.path}` : (prefix || error.path),
        codePrefix ? `${codePrefix}_${error.code}` : error.code,
        error.message,
        error.details
    ));
}
