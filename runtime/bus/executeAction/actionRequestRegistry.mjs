function normalizeActionId(actionId) {
    if (typeof actionId !== "string") return null;

    const trimmed = actionId.trim();
    return trimmed.length > 0 ? trimmed : null;
}

function createRegistryError(message, details = {}) {
    const err = new Error(message);
    err.code = details.code ?? "action_request_registry_error";
    err.kind = details.kind ?? "validation";
    err.details = { ...details };
    return err;
}

function copyOptionalMetadata(record, action) {
    if (action?.runId !== undefined) record.runId = action.runId;
    if (action?.capability !== undefined) record.capability = action.capability;
    if (action?.backend !== undefined) record.backend = action.backend;
}

function assertRegistry(registry) {
    if (!registry || !(registry.active instanceof Map)) {
        throw createRegistryError("Invalid action request registry", {
            code: "invalid_action_request_registry"
        });
    }
}

function createActiveActionError(actionId) {
    return createRegistryError(`Active action already registered: ${actionId}`, {
        code: "duplicate_active_action_id",
        actionId
    });
}

export function createActionRequestRegistry() {
    return {
        active: new Map()
    };
}

export function reserveActionRequest(registry, action) {
    assertRegistry(registry);

    const actionId = normalizeActionId(action?.actionId);

    if (!actionId) {
        throw createRegistryError("Action request registry requires action.actionId", {
            code: "missing_action_request_id"
        });
    }

    if (registry.active.has(actionId)) {
        throw createActiveActionError(actionId);
    }

    const record = {
        actionId,
        state: "reserved",
        reservedAt: Date.now()
    };

    copyOptionalMetadata(record, action);
    registry.active.set(actionId, record);

    return { ...record };
}

export function bindActionRequest(registry, actionId, requestId, handle = {}) {
    assertRegistry(registry);

    const normalizedActionId = normalizeActionId(actionId);

    if (!normalizedActionId) {
        throw createRegistryError("Action request bind requires actionId", {
            code: "missing_action_request_id"
        });
    }

    if (requestId === undefined || requestId === null) {
        throw createRegistryError(`Action request bind requires requestId: ${normalizedActionId}`, {
            code: "missing_action_request_handle_id",
            actionId: normalizedActionId
        });
    }

    const record = registry.active.get(normalizedActionId);

    if (!record) {
        throw createRegistryError(`Action request is not reserved: ${normalizedActionId}`, {
            code: "missing_reserved_action_request",
            actionId: normalizedActionId
        });
    }

    if (record.state !== "reserved") {
        throw createActiveActionError(normalizedActionId);
    }

    record.requestId = requestId;
    record.state = "bound";
    record.boundAt = Date.now();
    copyOptionalMetadata(record, handle);

    return { ...record };
}

export function releaseActionRequest(registry, actionId) {
    assertRegistry(registry);

    const normalizedActionId = normalizeActionId(actionId);

    if (!normalizedActionId) return false;

    return registry.active.delete(normalizedActionId);
}

export function getActionRequest(registry, actionId) {
    assertRegistry(registry);

    const normalizedActionId = normalizeActionId(actionId);

    if (!normalizedActionId) return null;

    const record = registry.active.get(normalizedActionId);
    return record ? { ...record } : null;
}

export function cancelActionRequest(registry, actionId, cancelRequest, options = {}) {
    assertRegistry(registry);

    const normalizedActionId = normalizeActionId(actionId);

    if (!normalizedActionId || typeof cancelRequest !== "function") return false;

    const record = registry.active.get(normalizedActionId);

    if (!record || record.state !== "bound") return false;

    const canceled = cancelRequest(record.requestId, {
        actionId: normalizedActionId,
        reason: options.reason ?? "Action canceled"
    });

    return canceled === true;
}
