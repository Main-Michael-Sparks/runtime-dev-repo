import {
    assertValidation,
    collectForbiddenKeys,
    createValidationError,
    createValidationResult,
    isNonEmptyString,
    isPlainObject
} from "./contractValidation.mjs";
import {
    normalizeCapabilityDefinition,
    validateCapabilityDefinition
} from "./capabilityDefinition.mjs";

export const CAPABILITY_REGISTRY_SCHEMA_VERSION = "capability-registry.v1";

const CAPABILITY_REGISTRY_FIELDS = new Set([
    "schemaVersion",
    "capabilities"
]);

const FORBIDDEN_CAPABILITY_REGISTRY_KEYS = new Set([
    "modelPath",
    "baseModel",
    "mmprojPath",
    "projectorPath",
    "backend",
    "backendAdapter",
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
    "env"
]);

function addForbiddenKeyErrors(errors, registry) {
    const found = collectForbiddenKeys(registry, FORBIDDEN_CAPABILITY_REGISTRY_KEYS);

    for (const entry of found) {
        errors.push(createValidationError(
            entry.path,
            "forbidden_capability_registry_key",
            `Capability registry must not include forbidden key: ${entry.key}`,
            {
                key: entry.key
            }
        ));
    }
}

function addUnknownRegistryFieldErrors(errors, registry) {
    if (!isPlainObject(registry)) return;

    for (const key of Object.keys(registry)) {
        if (CAPABILITY_REGISTRY_FIELDS.has(key)) continue;

        errors.push(createValidationError(
            key,
            "unknown_capability_registry_field",
            `Unsupported field for capability registry: ${key}`,
            {
                key
            }
        ));
    }
}

function addNestedDefinitionErrors(errors, definitionResult, index) {
    for (const error of definitionResult.errors) {
        errors.push({
            ...error,
            path: error.path ? `capabilities[${index}].${error.path}` : `capabilities[${index}]`
        });
    }
}

function addDuplicateDefinitionErrors(errors, normalizedDefinitions) {
    const seenCapabilities = new Map();
    const seenCapabilityVersions = new Map();

    for (let index = 0; index < normalizedDefinitions.length; index++) {
        const definition = normalizedDefinitions[index];
        const capability = definition.capability;
        const version = definition.version;

        if (!isNonEmptyString(capability) || !isNonEmptyString(version)) continue;

        if (seenCapabilities.has(capability)) {
            errors.push(createValidationError(
                `capabilities[${index}].capability`,
                "duplicate_capability",
                `Capability registry must not include duplicate capability definitions: ${capability}`,
                {
                    capability,
                    firstIndex: seenCapabilities.get(capability),
                    duplicateIndex: index
                }
            ));
        } else {
            seenCapabilities.set(capability, index);
        }

        const capabilityVersionKey = `${capability}@${version}`;
        if (seenCapabilityVersions.has(capabilityVersionKey)) {
            errors.push(createValidationError(
                `capabilities[${index}].version`,
                "duplicate_capability_version",
                `Capability registry must not include duplicate capability/version definitions: ${capabilityVersionKey}`,
                {
                    capability,
                    version,
                    firstIndex: seenCapabilityVersions.get(capabilityVersionKey),
                    duplicateIndex: index
                }
            ));
        } else {
            seenCapabilityVersions.set(capabilityVersionKey, index);
        }
    }
}

export function normalizeCapabilityRegistry(registry) {
    const capabilities = Array.isArray(registry?.capabilities)
        ? registry.capabilities.map((definition) => normalizeCapabilityDefinition(definition))
        : registry?.capabilities;

    return {
        ...registry,
        schemaVersion: registry?.schemaVersion === undefined
            ? CAPABILITY_REGISTRY_SCHEMA_VERSION
            : registry.schemaVersion,
        capabilities
    };
}

export function validateCapabilityRegistry(registry) {
    const errors = [];

    if (!isPlainObject(registry)) {
        return createValidationResult([
            createValidationError(
                "",
                "invalid_capability_registry",
                "Capability registry must be a plain object"
            )
        ]);
    }

    addForbiddenKeyErrors(errors, registry);
    addUnknownRegistryFieldErrors(errors, registry);

    if (
        registry.schemaVersion !== undefined &&
        registry.schemaVersion !== CAPABILITY_REGISTRY_SCHEMA_VERSION
    ) {
        errors.push(createValidationError(
            "schemaVersion",
            "unsupported_capability_registry_schema_version",
            `Unsupported capability registry schemaVersion: ${registry.schemaVersion}`,
            {
                expected: CAPABILITY_REGISTRY_SCHEMA_VERSION
            }
        ));
    }

    if (!Array.isArray(registry.capabilities)) {
        errors.push(createValidationError(
            "capabilities",
            "invalid_capabilities",
            "Capability registry capabilities must be an array"
        ));

        return createValidationResult(errors);
    }

    const normalizedDefinitions = [];

    for (let index = 0; index < registry.capabilities.length; index++) {
        const result = validateCapabilityDefinition(registry.capabilities[index]);

        if (!result.ok) {
            addNestedDefinitionErrors(errors, result, index);
            continue;
        }

        normalizedDefinitions.push(result.value);
    }

    if (normalizedDefinitions.length === registry.capabilities.length) {
        addDuplicateDefinitionErrors(errors, normalizedDefinitions);
    }

    return createValidationResult(
        errors,
        errors.length === 0
            ? {
                  schemaVersion: registry.schemaVersion ?? CAPABILITY_REGISTRY_SCHEMA_VERSION,
                  capabilities: normalizedDefinitions
              }
            : null
    );
}

export function assertCapabilityRegistry(registry) {
    return assertValidation(
        validateCapabilityRegistry(registry),
        "Capability registry validation failed"
    );
}

export function createCapabilityRegistry(definitions = []) {
    return assertCapabilityRegistry({
        schemaVersion: CAPABILITY_REGISTRY_SCHEMA_VERSION,
        capabilities: definitions
    });
}

export function listCapabilityDefinitions(registry) {
    const normalizedRegistry = assertCapabilityRegistry(registry);
    return normalizedRegistry.capabilities.map((definition) => ({ ...definition }));
}

export function getCapabilityDefinition(registry, capability) {
    const normalizedRegistry = assertCapabilityRegistry(registry);
    const normalizedCapability = typeof capability === "string" ? capability.trim() : capability;
    const definition = normalizedRegistry.capabilities.find((entry) => {
        return entry.capability === normalizedCapability;
    });

    return definition ? { ...definition } : null;
}

export function hasCapabilityDefinition(registry, capability) {
    return getCapabilityDefinition(registry, capability) !== null;
}
