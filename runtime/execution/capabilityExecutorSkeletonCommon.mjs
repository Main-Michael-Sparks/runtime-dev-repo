import {
    collectForbiddenKeys,
    createValidationError,
    hasForbiddenPathLikeValue,
    isPlainObject
} from "../bus/contractValidation.mjs";

export const CAPABILITY_EXECUTOR_SKELETON_CONTRACT_VERSION = "capability-executor-skeleton.v1";
export const CAPABILITY_EXECUTOR_SKELETON_STATUS = "planned";
export const CAPABILITY_EXECUTOR_SKELETON_EXECUTOR_BOUNDARY = "skeleton-only";
export const CAPABILITY_EXECUTOR_SKELETON_EXECUTABLE = false;
export const CAPABILITY_EXECUTOR_SKELETON_ADAPTER_INVOCATION = "not-implemented";
export const CAPABILITY_EXECUTOR_SKELETON_RUNTIME_WIRING = "not-wired";

const FORBIDDEN_CAPABILITY_EXECUTOR_SKELETON_KEYS = new Set([
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
    "llama_worker",
    "nodeLlamaCpp",
    "node-llama-cpp",
    "worker_threads",
    "child_process",
    "scheduler",
    "sendToWorker",
    "ReadableStream"
]);

function copyPlainExecutorSkeletonValue(value) {
    if (Array.isArray(value)) {
        return value.map((entry) => copyPlainExecutorSkeletonValue(entry));
    }

    if (isPlainObject(value)) {
        const out = {};

        for (const [key, childValue] of Object.entries(value)) {
            out[key] = copyPlainExecutorSkeletonValue(childValue);
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

export function copyCapabilityExecutorSkeletonValue(value) {
    return copyPlainExecutorSkeletonValue(value);
}

export function copyCapabilityExecutorSkeletonPlan(plan) {
    return {
        contractVersion: plan?.contractVersion,
        status: plan?.status,
        executionPlan: copyCapabilityExecutorSkeletonValue(plan?.executionPlan),
        invocation: copyCapabilityExecutorSkeletonValue(plan?.invocation),
        boundary: copyCapabilityExecutorSkeletonValue(plan?.boundary)
    };
}

export function addForbiddenCapabilityExecutorSkeletonKeyErrors(errors, objectValue, code, label) {
    const found = collectForbiddenKeys(objectValue, FORBIDDEN_CAPABILITY_EXECUTOR_SKELETON_KEYS);

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

export function addUnknownCapabilityExecutorSkeletonFieldErrors(errors, objectValue, allowedFields, path, code, label) {
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

export function addCapabilityExecutorSkeletonMetadataStringValidation(errors, value, path) {
    if (value === undefined) return;

    if (typeof value !== "string" || value.trim().length === 0) {
        errors.push(createValidationError(
            path,
            "invalid_capability_executor_skeleton_metadata_id",
            `${path} must be a non-empty metadata string when provided`
        ));
        return;
    }

    if (hasForbiddenMetadataValue(value)) {
        errors.push(createValidationError(
            path,
            "forbidden_capability_executor_skeleton_metadata_value",
            `${path} must be a metadata label, not a path or backend payload`
        ));
    }
}

export function prefixCapabilityExecutorSkeletonValidationErrors(errors, prefix, codePrefix) {
    if (!Array.isArray(errors)) return [];

    return errors.map((error) => createValidationError(
        prefix && error.path ? `${prefix}.${error.path}` : (prefix || error.path),
        codePrefix ? `${codePrefix}_${error.code}` : error.code,
        error.message,
        error.details
    ));
}
