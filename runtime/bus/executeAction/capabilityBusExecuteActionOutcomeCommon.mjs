import {
    collectForbiddenKeys,
    createValidationError,
    hasForbiddenPathLikeValue,
    isNonEmptyString,
    isPlainObject
} from "../contractValidation.mjs";

export const CAPABILITY_BUS_EXECUTE_ACTION_OUTCOME_CONTRACT_VERSION = "capability-bus-execute-action-outcome.v1";
export const CAPABILITY_BUS_EXECUTE_ACTION_OUTCOME_STATUS = "accepted";
export const CAPABILITY_BUS_EXECUTE_ACTION_OUTCOME_BOUNDARY = "result-event-contract-only";
export const CAPABILITY_BUS_EXECUTE_ACTION_OUTCOME_EXECUTABLE = false;
export const CAPABILITY_BUS_EXECUTE_ACTION_OUTCOME_RUNTIME_SETTLEMENT = "not-wired";
export const CAPABILITY_BUS_EXECUTE_ACTION_OUTCOME_RUNTIME_WIRING = "not-wired";
export const CAPABILITY_BUS_EXECUTE_ACTION_OUTCOME_NATIVE_EXECUTION = "not-wired";

const FORBIDDEN_EXECUTE_ACTION_OUTCOME_KEYS = new Set([
    "modelPath",
    "baseModel",
    "mmprojPath",
    "projectorPath",
    "backendOptions",
    "adapterArgs",
    "rawBackend",
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
    "worker",
    "workerBridge",
    "llamaWorker",
    "llama_worker",
    "nodeLlamaCpp",
    "node-llama-cpp",
    "worker_threads",
    "child_process",
    "runtime",
    "runtimeRequest",
    "scheduler",
    "request",
    "streamController",
    "sendToWorker",
    "ReadableStream",
    "configOverride",
    "process",
    "childProcess"
]);

function copyPlainExecuteActionOutcomeValue(value) {
    if (Array.isArray(value)) {
        return value.map((entry) => copyPlainExecuteActionOutcomeValue(entry));
    }

    if (isPlainObject(value)) {
        const out = {};

        for (const [key, childValue] of Object.entries(value)) {
            out[key] = copyPlainExecuteActionOutcomeValue(childValue);
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

export function copyCapabilityBusExecuteActionOutcomeValue(value) {
    return copyPlainExecuteActionOutcomeValue(value);
}

export function copyCapabilityBusExecuteActionOutcomeDescriptor(descriptor) {
    return {
        contractVersion: descriptor?.contractVersion,
        status: descriptor?.status,
        action: copyCapabilityBusExecuteActionOutcomeValue(descriptor?.action),
        boundary: copyCapabilityBusExecuteActionOutcomeValue(descriptor?.boundary),
        orchestrationDescriptor: copyCapabilityBusExecuteActionOutcomeValue(descriptor?.orchestrationDescriptor),
        resultEnvelope: copyCapabilityBusExecuteActionOutcomeValue(descriptor?.resultEnvelope),
        actionEvent: copyCapabilityBusExecuteActionOutcomeValue(descriptor?.actionEvent),
        metadata: copyCapabilityBusExecuteActionOutcomeValue(descriptor?.metadata)
    };
}

export function addForbiddenCapabilityBusExecuteActionOutcomeKeyErrors(errors, objectValue, code, label) {
    const found = collectForbiddenKeys(objectValue, FORBIDDEN_EXECUTE_ACTION_OUTCOME_KEYS);

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

export function addUnknownCapabilityBusExecuteActionOutcomeFieldErrors(errors, objectValue, allowedFields, path, code, label) {
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

export function addRequiredCapabilityBusExecuteActionOutcomeStringError(errors, value, path, code, label) {
    if (isNonEmptyString(value)) return;

    errors.push(createValidationError(
        path,
        code,
        `${label} must be a non-empty string`
    ));
}

export function addOptionalCapabilityBusExecuteActionOutcomeStringError(errors, value, path, code, label) {
    if (value === undefined) return;

    addRequiredCapabilityBusExecuteActionOutcomeStringError(errors, value, path, code, label);
}

export function addCapabilityBusExecuteActionOutcomeMetadataStringValidation(errors, value, path) {
    if (value === undefined) return;

    if (!isNonEmptyString(value)) {
        errors.push(createValidationError(
            path,
            "invalid_capability_bus_execute_action_outcome_metadata_id",
            `${path} must be a non-empty metadata string when provided`
        ));
        return;
    }

    if (hasForbiddenMetadataValue(value)) {
        errors.push(createValidationError(
            path,
            "forbidden_capability_bus_execute_action_outcome_metadata_value",
            `${path} must be a metadata label, not a path or backend payload`
        ));
    }
}

export function prefixCapabilityBusExecuteActionOutcomeValidationErrors(errors, prefix, codePrefix) {
    if (!Array.isArray(errors)) return [];

    return errors.map((error) => createValidationError(
        prefix && error.path ? `${prefix}.${error.path}` : (prefix || error.path),
        codePrefix ? `${codePrefix}_${error.code}` : error.code,
        error.message,
        error.details
    ));
}
