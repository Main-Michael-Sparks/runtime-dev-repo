import {
    collectForbiddenKeys,
    createValidationError,
    hasForbiddenPathLikeValue,
    isNonEmptyString,
    isPlainObject
} from "../contractValidation.mjs";

export const CAPABILITY_BUS_EXECUTE_ACTION_ORCHESTRATION_CONTRACT_VERSION = "capability-bus-execute-action-orchestration.v1";
export const CAPABILITY_BUS_EXECUTE_ACTION_ORCHESTRATION_STATUS = "accepted";
export const CAPABILITY_BUS_EXECUTE_ACTION_ORCHESTRATION_BOUNDARY = "composition-only";
export const CAPABILITY_BUS_EXECUTE_ACTION_ORCHESTRATION_EXECUTABLE = false;
export const CAPABILITY_BUS_EXECUTE_ACTION_ORCHESTRATION_ADAPTER_INVOCATION = "contract-only";
export const CAPABILITY_BUS_EXECUTE_ACTION_ORCHESTRATION_RUNTIME_WIRING = "not-wired";
export const CAPABILITY_BUS_EXECUTE_ACTION_ORCHESTRATION_NATIVE_EXECUTION = "not-wired";

export const CAPABILITY_BUS_EXECUTE_ACTION_ORCHESTRATION_CHAIN = Object.freeze([
    "actionEnvelope",
    "capabilityBusAction",
    "capabilityRoutePlan",
    "capabilityServicePlan",
    "backendAdapterPlan",
    "capabilityExecutionPlan",
    "capabilityExecutorSkeletonPlan",
    "backendAdapterInvocationDescriptor"
]);

const FORBIDDEN_EXECUTE_ACTION_ORCHESTRATION_KEYS = new Set([
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

function copyPlainExecuteActionOrchestrationValue(value) {
    if (Array.isArray(value)) {
        return value.map((entry) => copyPlainExecuteActionOrchestrationValue(entry));
    }

    if (isPlainObject(value)) {
        const out = {};

        for (const [key, childValue] of Object.entries(value)) {
            out[key] = copyPlainExecuteActionOrchestrationValue(childValue);
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

export function copyCapabilityBusExecuteActionOrchestrationValue(value) {
    return copyPlainExecuteActionOrchestrationValue(value);
}

export function copyCapabilityBusExecuteActionOrchestrationDescriptor(descriptor) {
    return {
        contractVersion: descriptor?.contractVersion,
        status: descriptor?.status,
        action: copyCapabilityBusExecuteActionOrchestrationValue(descriptor?.action),
        orchestration: copyCapabilityBusExecuteActionOrchestrationValue(descriptor?.orchestration),
        executeActionPlan: copyCapabilityBusExecuteActionOrchestrationValue(descriptor?.executeActionPlan),
        executorSkeletonPlan: copyCapabilityBusExecuteActionOrchestrationValue(descriptor?.executorSkeletonPlan),
        backendAdapterInvocationDescriptor: copyCapabilityBusExecuteActionOrchestrationValue(descriptor?.backendAdapterInvocationDescriptor),
        boundary: copyCapabilityBusExecuteActionOrchestrationValue(descriptor?.boundary)
    };
}

export function addForbiddenCapabilityBusExecuteActionOrchestrationKeyErrors(errors, objectValue, code, label) {
    const found = collectForbiddenKeys(objectValue, FORBIDDEN_EXECUTE_ACTION_ORCHESTRATION_KEYS);

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

export function addUnknownCapabilityBusExecuteActionOrchestrationFieldErrors(errors, objectValue, allowedFields, path, code, label) {
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

export function addRequiredCapabilityBusExecuteActionOrchestrationStringError(errors, value, path, code, label) {
    if (isNonEmptyString(value)) return;

    errors.push(createValidationError(
        path,
        code,
        `${label} must be a non-empty string`
    ));
}

export function addOptionalCapabilityBusExecuteActionOrchestrationStringError(errors, value, path, code, label) {
    if (value === undefined) return;

    addRequiredCapabilityBusExecuteActionOrchestrationStringError(errors, value, path, code, label);
}

export function addCapabilityBusExecuteActionOrchestrationMetadataStringValidation(errors, value, path) {
    if (value === undefined) return;

    if (!isNonEmptyString(value)) {
        errors.push(createValidationError(
            path,
            "invalid_capability_bus_execute_action_orchestration_metadata_id",
            `${path} must be a non-empty metadata string when provided`
        ));
        return;
    }

    if (hasForbiddenMetadataValue(value)) {
        errors.push(createValidationError(
            path,
            "forbidden_capability_bus_execute_action_orchestration_metadata_value",
            `${path} must be a metadata label, not a path or backend payload`
        ));
    }
}

export function prefixCapabilityBusExecuteActionOrchestrationValidationErrors(errors, prefix, codePrefix) {
    if (!Array.isArray(errors)) return [];

    return errors.map((error) => createValidationError(
        prefix && error.path ? `${prefix}.${error.path}` : (prefix || error.path),
        codePrefix ? `${codePrefix}_${error.code}` : error.code,
        error.message,
        error.details
    ));
}
