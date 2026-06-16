import {
    collectForbiddenKeys,
    createValidationError,
    hasForbiddenPathLikeValue,
    isNonEmptyString,
    isPlainObject
} from "../bus/contractValidation.mjs";

export const CAPABILITY_EXECUTOR_CONTRACT_VERSION = "capability-executor.v1";

const FORBIDDEN_CAPABILITY_EXECUTION_KEYS = new Set([
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
    "nodeLlamaCpp"
]);

function copyPlainMetadataValue(value) {
    if (Array.isArray(value)) {
        return value.map((entry) => copyPlainMetadataValue(entry));
    }

    if (isPlainObject(value)) {
        const out = {};

        for (const [key, childValue] of Object.entries(value)) {
            out[key] = copyPlainMetadataValue(childValue);
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

export function copyCapabilityExecutionInvocation(invocation) {
    return copyPlainMetadataValue(invocation);
}

export function copyCapabilityExecutionBackendPlan(backendPlan) {
    return copyPlainMetadataValue(backendPlan);
}

export function copyCapabilityExecutionPlan(plan) {
    return {
        contractVersion: plan?.contractVersion,
        backendPlan: copyCapabilityExecutionBackendPlan(plan?.backendPlan),
        invocation: copyCapabilityExecutionInvocation(plan?.invocation)
    };
}

export function addForbiddenCapabilityExecutionKeyErrors(errors, objectValue, code, label) {
    const found = collectForbiddenKeys(objectValue, FORBIDDEN_CAPABILITY_EXECUTION_KEYS);

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

export function addUnknownCapabilityExecutionFieldErrors(errors, objectValue, allowedFields, path, code, label) {
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

export function addRequiredCapabilityExecutionStringError(errors, value, path, code, label) {
    if (isNonEmptyString(value)) return;

    errors.push(createValidationError(
        path,
        code,
        `${label} must be a non-empty string`
    ));
}

export function addOptionalCapabilityExecutionStringError(errors, value, path, code, label) {
    if (value === undefined) return;

    addRequiredCapabilityExecutionStringError(errors, value, path, code, label);
}

export function addCapabilityExecutionMetadataStringValidation(errors, value, path) {
    if (value === undefined) return;

    if (!isNonEmptyString(value)) {
        errors.push(createValidationError(
            path,
            "invalid_capability_execution_metadata_id",
            `${path} must be a non-empty metadata string when provided`
        ));
        return;
    }

    if (hasForbiddenMetadataValue(value)) {
        errors.push(createValidationError(
            path,
            "forbidden_capability_execution_metadata_value",
            `${path} must be a metadata label, not a path or backend payload`
        ));
    }
}

export function prefixCapabilityExecutionValidationErrors(errors, prefix, codePrefix) {
    if (!Array.isArray(errors)) return [];

    return errors.map((error) => createValidationError(
        prefix && error.path ? `${prefix}.${error.path}` : (prefix || error.path),
        codePrefix ? `${codePrefix}_${error.code}` : error.code,
        error.message,
        error.details
    ));
}
