import {
    isPlainObject
} from "../contractValidation.mjs";
import {
    assertCapabilityBusExecuteActionPlan
} from "./capabilityBusExecuteActionPlan.mjs";
import {
    normalizeCapabilityBusExecuteActionOrchestrationDescriptor
} from "./capabilityBusExecuteActionOrchestration.mjs";
import {
    runExecuteAction
} from "./capabilityBusExecuteActionExecution.mjs";
import {
    createDefaultExecuteActionRegistries
} from "./defaultExecuteActionRegistries.mjs";

const RAW_ACTION_ENVELOPE_MARKERS = Object.freeze([
    "actionId",
    "source",
    "capability",
    "intent",
    "input"
]);

const ORCHESTRATION_INPUT_MARKERS = Object.freeze([
    "orchestration",
    "boundary",
    "executeActionPlan",
    "executorSkeletonPlan",
    "backendAdapterInvocationDescriptor",
    "busAction",
    "routePlan",
    "servicePlan",
    "backendPlan",
    "executionPlan"
]);

function hasAnyOwnKey(value, keys) {
    return keys.some((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function hasExecuteActionContractVersion(value) {
    if (typeof value.contractVersion !== "string") return false;

    return (
        value.contractVersion.startsWith("capability-bus-execute-action.") ||
        value.contractVersion.startsWith("capability-bus-execute-action-orchestration.")
    );
}

export function looksLikeRawActionEnvelope(value) {
    if (!isPlainObject(value)) return false;
    if (hasExecuteActionContractVersion(value)) return false;
    if (hasAnyOwnKey(value, ORCHESTRATION_INPUT_MARKERS)) return false;

    return hasAnyOwnKey(value, RAW_ACTION_ENVELOPE_MARKERS);
}

function resolveExecuteActionRegistries(deps) {
    return deps.executeActionRegistries ?? createDefaultExecuteActionRegistries();
}

export async function runExecuteActionDispatch(actionInput, deps = {}, options = {}) {
    if (!looksLikeRawActionEnvelope(actionInput)) {
        return runExecuteAction(actionInput, deps, options);
    }

    const registries = resolveExecuteActionRegistries(deps);
    const executeActionPlan = assertCapabilityBusExecuteActionPlan(actionInput, registries);
    const orchestration = normalizeCapabilityBusExecuteActionOrchestrationDescriptor(executeActionPlan);

    return runExecuteAction(orchestration, deps, options);
}
