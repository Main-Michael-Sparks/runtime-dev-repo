import {
    createValidationError,
    isPlainObject
} from "../contractValidation.mjs";

export const CAPABILITY_BUS_EXECUTE_ACTION_CONTRACT_VERSION = "capability-bus-execute-action.v1";

export function copyCapabilityBusExecuteActionValue(value) {
    if (Array.isArray(value)) {
        return value.map((entry) => copyCapabilityBusExecuteActionValue(entry));
    }

    if (isPlainObject(value)) {
        const out = {};

        for (const [key, childValue] of Object.entries(value)) {
            out[key] = copyCapabilityBusExecuteActionValue(childValue);
        }

        return out;
    }

    return value;
}

export function copyCapabilityBusExecuteActionIdentity(identity) {
    return copyCapabilityBusExecuteActionValue(identity);
}

export function copyCapabilityBusExecuteActionPlan(plan) {
    return copyCapabilityBusExecuteActionValue(plan);
}

export function prefixCapabilityBusExecuteActionValidationErrors(errors, prefix, codePrefix) {
    if (!Array.isArray(errors)) return [];

    return errors.map((error) => createValidationError(
        prefix && error.path ? `${prefix}.${error.path}` : (prefix || error.path),
        codePrefix ? `${codePrefix}_${error.code}` : error.code,
        error.message,
        error.details
    ));
}
