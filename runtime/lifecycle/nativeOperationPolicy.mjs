import { isPlainObject } from "../config/configOverride.mjs";

export const VALID_NATIVE_OPERATION_HARD_STOP_KEYS = new Set([
    "enabled",
    "resetModelTimeoutMs",
    "shutdownTimeoutMs",
    "resetSessionTimeoutMs",
    "timeoutAction"
]);

export const VALID_NATIVE_OPERATION_TIMEOUT_ACTIONS = new Set([
    "mark-unhealthy"
]);

function assertPlainObjectOrUndefined(value, name) {
    if (value !== undefined && !isPlainObject(value)) {
        throw new Error(`${name} must be a plain object`);
    }
}

function assertBoolean(value, name) {
    if (typeof value !== "boolean") {
        throw new Error(`${name} must be a boolean`);
    }
}

function assertNonNegativeInteger(value, name) {
    if (!Number.isInteger(value) || value < 0) {
        throw new Error(`${name} must be an integer >= 0`);
    }
}

function assertAllowedKeys(value, allowedKeys, name) {
    if (value === undefined) return;

    for (const key of Object.keys(value)) {
        if (!allowedKeys.has(key)) {
            throw new Error(`Unsupported ${name} option: ${key}`);
        }
    }
}

function assertNativeOperationTimeoutAction(value, name) {
    if (!VALID_NATIVE_OPERATION_TIMEOUT_ACTIONS.has(value)) {
        throw new Error(`Unsupported ${name}: ${value}`);
    }
}

export function resolveNativeOperationHardStopConfig(configSnapshot) {
    const raw = configSnapshot?.runtime?.nativeOperationHardStop ?? {};
    assertPlainObjectOrUndefined(raw, "runtime.nativeOperationHardStop");
    assertAllowedKeys(
        raw,
        VALID_NATIVE_OPERATION_HARD_STOP_KEYS,
        "runtime.nativeOperationHardStop"
    );

    const resolved = {
        enabled: raw.enabled ?? true,
        resetModelTimeoutMs: raw.resetModelTimeoutMs ?? 120000,
        shutdownTimeoutMs: raw.shutdownTimeoutMs ?? 120000,
        resetSessionTimeoutMs: raw.resetSessionTimeoutMs ?? 120000,
        timeoutAction: raw.timeoutAction ?? "mark-unhealthy"
    };

    assertBoolean(resolved.enabled, "runtime.nativeOperationHardStop.enabled");
    assertNonNegativeInteger(
        resolved.resetModelTimeoutMs,
        "runtime.nativeOperationHardStop.resetModelTimeoutMs"
    );
    assertNonNegativeInteger(
        resolved.shutdownTimeoutMs,
        "runtime.nativeOperationHardStop.shutdownTimeoutMs"
    );
    assertNonNegativeInteger(
        resolved.resetSessionTimeoutMs,
        "runtime.nativeOperationHardStop.resetSessionTimeoutMs"
    );
    assertNativeOperationTimeoutAction(
        resolved.timeoutAction,
        "runtime.nativeOperationHardStop.timeoutAction"
    );

    return resolved;
}

export function createNativeOperationTimeoutError({ operation, sessionId = null, timeoutMs }) {
    const sessionText = sessionId ? ` for session ${sessionId}` : "";
    const err = new Error(
        `Native operation timed out after ${timeoutMs}ms during ${operation}${sessionText}; ` +
        `runtime is marked unhealthy and requires process restart`
    );

    err.phase = "native-operation-timeout";
    err.operation = operation;
    err.sessionId = sessionId;
    err.timeoutMs = timeoutMs;

    return err;
}
