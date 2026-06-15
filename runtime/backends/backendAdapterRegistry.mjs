import {
    assertValidation,
    createValidationError,
    createValidationResult,
    isNonEmptyString,
    isPlainObject
} from "../bus/contractValidation.mjs";
import {
    assertBackendAdapterDefinition,
    copyBackendAdapterDefinition,
    normalizeBackendAdapterDefinition,
    validateBackendAdapterDefinition
} from "./backendAdapterDefinition.mjs";
import {
    BACKEND_ADAPTER_REGISTRY_SCHEMA_VERSION,
    addForbiddenBackendAdapterKeyErrors,
    addUnknownBackendAdapterFieldErrors,
    prefixBackendAdapterValidationErrors
} from "./backendAdapterCommon.mjs";

const BACKEND_ADAPTER_REGISTRY_FIELDS = new Set([
    "schemaVersion",
    "adapters"
]);

function addAdapterRegistryDuplicateErrors(errors, adapters) {
    const seenAdapterIds = new Map();

    for (let index = 0; index < adapters.length; index++) {
        const adapter = adapters[index];

        if (!isNonEmptyString(adapter.adapterId)) continue;

        if (seenAdapterIds.has(adapter.adapterId)) {
            errors.push(createValidationError(
                `adapters[${index}].adapterId`,
                "duplicate_backend_adapter_id",
                `Backend adapter registry must not include duplicate adapterId entries: ${adapter.adapterId}`,
                {
                    adapterId: adapter.adapterId,
                    firstIndex: seenAdapterIds.get(adapter.adapterId),
                    duplicateIndex: index
                }
            ));
        } else {
            seenAdapterIds.set(adapter.adapterId, index);
        }
    }
}

export function normalizeBackendAdapterRegistry(registry) {
    const adapters = Array.isArray(registry?.adapters)
        ? registry.adapters.map((adapter) => normalizeBackendAdapterDefinition(adapter))
        : registry?.adapters;

    return {
        ...registry,
        schemaVersion: registry?.schemaVersion === undefined
            ? BACKEND_ADAPTER_REGISTRY_SCHEMA_VERSION
            : registry.schemaVersion,
        adapters
    };
}

export function validateBackendAdapterRegistry(registry) {
    const errors = [];

    if (!isPlainObject(registry)) {
        return createValidationResult([
            createValidationError(
                "",
                "invalid_backend_adapter_registry",
                "Backend adapter registry must be a plain object"
            )
        ]);
    }

    addForbiddenBackendAdapterKeyErrors(
        errors,
        registry,
        "forbidden_backend_adapter_registry_key",
        "Backend adapter registry"
    );
    addUnknownBackendAdapterFieldErrors(
        errors,
        registry,
        BACKEND_ADAPTER_REGISTRY_FIELDS,
        "",
        "unknown_backend_adapter_registry_field",
        "backend adapter registry"
    );

    if (
        registry.schemaVersion !== undefined &&
        registry.schemaVersion !== BACKEND_ADAPTER_REGISTRY_SCHEMA_VERSION
    ) {
        errors.push(createValidationError(
            "schemaVersion",
            "unsupported_backend_adapter_registry_schema_version",
            `Unsupported backend adapter registry schemaVersion: ${registry.schemaVersion}`,
            {
                expected: BACKEND_ADAPTER_REGISTRY_SCHEMA_VERSION
            }
        ));
    }

    if (!Array.isArray(registry.adapters)) {
        errors.push(createValidationError(
            "adapters",
            "invalid_backend_adapters",
            "Backend adapter registry adapters must be an array"
        ));

        return createValidationResult(errors);
    }

    const normalizedAdapters = [];

    for (let index = 0; index < registry.adapters.length; index++) {
        const result = validateBackendAdapterDefinition(registry.adapters[index]);

        if (!result.ok) {
            errors.push(...prefixBackendAdapterValidationErrors(
                result.errors,
                `adapters[${index}]`,
                "backend_adapter_registry_adapter"
            ));
            continue;
        }

        normalizedAdapters.push(result.value);
    }

    if (normalizedAdapters.length === registry.adapters.length) {
        addAdapterRegistryDuplicateErrors(errors, normalizedAdapters);
    }

    return createValidationResult(
        errors,
        errors.length === 0
            ? {
                  schemaVersion: registry.schemaVersion ?? BACKEND_ADAPTER_REGISTRY_SCHEMA_VERSION,
                  adapters: normalizedAdapters
              }
            : null
    );
}

export function assertBackendAdapterRegistry(registry) {
    return assertValidation(
        validateBackendAdapterRegistry(registry),
        "Backend adapter registry validation failed"
    );
}

export function createBackendAdapterRegistry(adapters = []) {
    return assertBackendAdapterRegistry({
        schemaVersion: BACKEND_ADAPTER_REGISTRY_SCHEMA_VERSION,
        adapters
    });
}

export function listBackendAdapters(registry) {
    const normalizedRegistry = assertBackendAdapterRegistry(registry);
    return normalizedRegistry.adapters.map((adapter) => copyBackendAdapterDefinition(adapter));
}

export function getBackendAdapter(registry, adapterId) {
    const normalizedRegistry = assertBackendAdapterRegistry(registry);
    const normalizedAdapterId = typeof adapterId === "string" ? adapterId.trim() : adapterId;
    const adapter = normalizedRegistry.adapters.find((entry) => entry.adapterId === normalizedAdapterId);

    return adapter ? copyBackendAdapterDefinition(adapter) : null;
}

export function hasBackendAdapter(registry, adapterId) {
    return getBackendAdapter(registry, adapterId) !== null;
}

export {
    assertBackendAdapterDefinition,
    validateBackendAdapterDefinition
};
