export const ACTION_EVENT_LOG_STORE_CONTRACT_VERSION = "runtime.actionEventLogStore.v1";

export const ACTION_EVENT_LOG_DEFAULT_DURABLE_EVENT_TYPES = Object.freeze([
    "action.accepted",
    "action.started",
    "action.completed",
    "action.failed",
    "action.cancelled",
    "action.timeout",
    "action.policyDenied"
]);

export const ACTION_EVENT_LOG_HIGH_VOLUME_EVENT_TYPES = Object.freeze([
    "action.stream.delta"
]);

const DEFAULT_DURABLE_EVENT_TYPE_SET = new Set(ACTION_EVENT_LOG_DEFAULT_DURABLE_EVENT_TYPES);
const HIGH_VOLUME_EVENT_TYPE_SET = new Set(ACTION_EVENT_LOG_HIGH_VOLUME_EVENT_TYPES);

export function isDefaultDurableActionEventLogType(value) {
    return DEFAULT_DURABLE_EVENT_TYPE_SET.has(value);
}

export function isHighVolumeActionEventLogType(value) {
    return HIGH_VOLUME_EVENT_TYPE_SET.has(value);
}
