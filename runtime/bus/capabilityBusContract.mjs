import {
    assertValidation,
    createValidationError,
    createValidationResult
} from "./contractValidation.mjs";
import { validateActionEnvelope } from "./actionEnvelope.mjs";
import {
    validateCapabilityRegistry
} from "./capabilityRegistryContract.mjs";

export const CAPABILITY_BUS_CONTRACT_VERSION = "capability-bus.v1";

function prefixValidationErrors(errors, prefix, codePrefix) {
    return errors.map((error) => createValidationError(
        error.path ? `${prefix}.${error.path}` : prefix,
        `${codePrefix}_${error.code}`,
        error.message,
        error.details
    ));
}

function copyCapabilityDefinition(definition) {
    return {
        ...definition,
        contracts: { ...definition.contracts },
        requirements: { ...definition.requirements },
        policy: { ...definition.policy },
        compatibility: {
            ...definition.compatibility,
            backendKinds: Array.isArray(definition.compatibility?.backendKinds)
                ? [...definition.compatibility.backendKinds]
                : definition.compatibility?.backendKinds
        }
    };
}

function copyActionEnvelope(action) {
    return {
        ...action,
        source: action.source && typeof action.source === "object" ? { ...action.source } : action.source,
        input: action.input && typeof action.input === "object" && !Array.isArray(action.input)
            ? {
                  ...action.input,
                  contextRefs: Array.isArray(action.input.contextRefs)
                      ? [...action.input.contextRefs]
                      : action.input.contextRefs
              }
            : action.input,
        requirements: action.requirements && typeof action.requirements === "object"
            ? { ...action.requirements }
            : action.requirements,
        policy: action.policy && typeof action.policy === "object"
            ? { ...action.policy }
            : action.policy,
        trace: action.trace && typeof action.trace === "object" ? { ...action.trace } : action.trace
    };
}

function createBusAction(action, definition) {
    return {
        contractVersion: CAPABILITY_BUS_CONTRACT_VERSION,
        action: copyActionEnvelope(action),
        capabilityDefinition: copyCapabilityDefinition(definition)
    };
}

function findCapabilityDefinition(registry, capability) {
    return registry.capabilities.find((definition) => definition.capability === capability) ?? null;
}

export function normalizeCapabilityBusAction(actionEnvelope, registry) {
    return assertCapabilityBusAction(actionEnvelope, registry);
}

export function validateCapabilityBusAction(actionEnvelope, registry) {
    const errors = [];
    const actionResult = validateActionEnvelope(actionEnvelope);
    const registryResult = validateCapabilityRegistry(registry);

    if (!actionResult.ok) {
        errors.push(...prefixValidationErrors(
            actionResult.errors,
            "action",
            "bus_action"
        ));
    }

    if (!registryResult.ok) {
        errors.push(...prefixValidationErrors(
            registryResult.errors,
            "registry",
            "bus_registry"
        ));
    }

    if (errors.length > 0) {
        return createValidationResult(errors);
    }

    const normalizedAction = actionResult.value;
    const normalizedRegistry = registryResult.value;
    const definition = findCapabilityDefinition(normalizedRegistry, normalizedAction.capability);

    if (!definition) {
        return createValidationResult([
            createValidationError(
                "action.capability",
                "capability_bus_missing_definition",
                `Capability Bus registry does not define requested capability: ${normalizedAction.capability}`,
                {
                    capability: normalizedAction.capability
                }
            )
        ]);
    }

    if (definition.status === "deprecated") {
        return createValidationResult([
            createValidationError(
                "capabilityDefinition.status",
                "capability_bus_deprecated_definition",
                `Capability Bus intake rejects deprecated capability definitions: ${normalizedAction.capability}`,
                {
                    capability: normalizedAction.capability,
                    status: definition.status
                }
            )
        ]);
    }

    return createValidationResult(
        [],
        createBusAction(normalizedAction, definition)
    );
}

export function assertCapabilityBusAction(actionEnvelope, registry) {
    return assertValidation(
        validateCapabilityBusAction(actionEnvelope, registry),
        "Capability Bus contract validation failed"
    );
}
