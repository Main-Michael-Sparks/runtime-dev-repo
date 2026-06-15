export const CAPABILITIES = Object.freeze([
    "text.generate",
    "text.embed",
    "text.rerank",
    "retrieval.search",
    "memory.search",
    "memory.read",
    "memory.write",
    "checkpoint.export",
    "checkpoint.import",
    "vision.chat",
    "tool.call"
]);

export const ACTION_STATUSES = Object.freeze([
    "accepted",
    "queued",
    "running",
    "completed",
    "failed",
    "cancelled",
    "timeout",
    "policy_denied"
]);

export const ACTION_EVENT_TYPES = Object.freeze([
    "action.accepted",
    "action.started",
    "action.stream.delta",
    "action.completed",
    "action.failed",
    "action.cancelled",
    "action.timeout",
    "action.policyDenied"
]);

export const ACTION_SOURCE_KINDS = Object.freeze([
    "direct-api",
    "graph-node",
    "runtime-internal",
    "integration"
]);

const CAPABILITY_SET = new Set(CAPABILITIES);
const ACTION_STATUS_SET = new Set(ACTION_STATUSES);
const ACTION_EVENT_TYPE_SET = new Set(ACTION_EVENT_TYPES);
const ACTION_SOURCE_KIND_SET = new Set(ACTION_SOURCE_KINDS);

export function isKnownCapability(value) {
    return CAPABILITY_SET.has(value);
}

export function isKnownActionStatus(value) {
    return ACTION_STATUS_SET.has(value);
}

export function isKnownActionEventType(value) {
    return ACTION_EVENT_TYPE_SET.has(value);
}

export function isKnownActionSourceKind(value) {
    return ACTION_SOURCE_KIND_SET.has(value);
}
