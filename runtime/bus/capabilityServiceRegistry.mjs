import {
    assertValidation,
    createValidationError,
    createValidationResult,
    isNonEmptyString,
    isPlainObject
} from "./contractValidation.mjs";
import {
    assertCapabilityServiceDefinition,
    copyCapabilityServiceDefinition,
    normalizeCapabilityServiceDefinition,
    validateCapabilityServiceDefinition
} from "./capabilityServiceDefinition.mjs";
import {
    CAPABILITY_SERVICE_REGISTRY_SCHEMA_VERSION,
    addForbiddenCapabilityServiceKeyErrors,
    addUnknownCapabilityServiceFieldErrors,
    prefixCapabilityServiceValidationErrors
} from "./capabilityServiceCommon.mjs";

const CAPABILITY_SERVICE_REGISTRY_FIELDS = new Set([
    "schemaVersion",
    "services"
]);

function addServiceRegistryDuplicateErrors(errors, services) {
    const seenServiceIds = new Map();

    for (let index = 0; index < services.length; index++) {
        const service = services[index];

        if (!isNonEmptyString(service.serviceId)) continue;

        if (seenServiceIds.has(service.serviceId)) {
            errors.push(createValidationError(
                `services[${index}].serviceId`,
                "duplicate_service_id",
                `Capability service registry must not include duplicate serviceId entries: ${service.serviceId}`,
                {
                    serviceId: service.serviceId,
                    firstIndex: seenServiceIds.get(service.serviceId),
                    duplicateIndex: index
                }
            ));
        } else {
            seenServiceIds.set(service.serviceId, index);
        }
    }
}

export function normalizeCapabilityServiceRegistry(registry) {
    const services = Array.isArray(registry?.services)
        ? registry.services.map((service) => normalizeCapabilityServiceDefinition(service))
        : registry?.services;

    return {
        ...registry,
        schemaVersion: registry?.schemaVersion === undefined
            ? CAPABILITY_SERVICE_REGISTRY_SCHEMA_VERSION
            : registry.schemaVersion,
        services
    };
}

export function validateCapabilityServiceRegistry(registry) {
    const errors = [];

    if (!isPlainObject(registry)) {
        return createValidationResult([
            createValidationError(
                "",
                "invalid_capability_service_registry",
                "Capability service registry must be a plain object"
            )
        ]);
    }

    addForbiddenCapabilityServiceKeyErrors(
        errors,
        registry,
        "forbidden_capability_service_registry_key",
        "Capability service registry"
    );
    addUnknownCapabilityServiceFieldErrors(
        errors,
        registry,
        CAPABILITY_SERVICE_REGISTRY_FIELDS,
        "",
        "unknown_capability_service_registry_field",
        "capability service registry"
    );

    if (
        registry.schemaVersion !== undefined &&
        registry.schemaVersion !== CAPABILITY_SERVICE_REGISTRY_SCHEMA_VERSION
    ) {
        errors.push(createValidationError(
            "schemaVersion",
            "unsupported_capability_service_registry_schema_version",
            `Unsupported capability service registry schemaVersion: ${registry.schemaVersion}`,
            {
                expected: CAPABILITY_SERVICE_REGISTRY_SCHEMA_VERSION
            }
        ));
    }

    if (!Array.isArray(registry.services)) {
        errors.push(createValidationError(
            "services",
            "invalid_capability_services",
            "Capability service registry services must be an array"
        ));

        return createValidationResult(errors);
    }

    const normalizedServices = [];

    for (let index = 0; index < registry.services.length; index++) {
        const result = validateCapabilityServiceDefinition(registry.services[index]);

        if (!result.ok) {
            errors.push(...prefixCapabilityServiceValidationErrors(
                result.errors,
                `services[${index}]`,
                "service_registry_service"
            ));
            continue;
        }

        normalizedServices.push(result.value);
    }

    if (normalizedServices.length === registry.services.length) {
        addServiceRegistryDuplicateErrors(errors, normalizedServices);
    }

    return createValidationResult(
        errors,
        errors.length === 0
            ? {
                  schemaVersion: registry.schemaVersion ?? CAPABILITY_SERVICE_REGISTRY_SCHEMA_VERSION,
                  services: normalizedServices
              }
            : null
    );
}

export function assertCapabilityServiceRegistry(registry) {
    return assertValidation(
        validateCapabilityServiceRegistry(registry),
        "Capability service registry validation failed"
    );
}

export function createCapabilityServiceRegistry(services = []) {
    return assertCapabilityServiceRegistry({
        schemaVersion: CAPABILITY_SERVICE_REGISTRY_SCHEMA_VERSION,
        services
    });
}

export function listCapabilityServices(registry) {
    const normalizedRegistry = assertCapabilityServiceRegistry(registry);
    return normalizedRegistry.services.map((service) => copyCapabilityServiceDefinition(service));
}

export function getCapabilityService(registry, serviceId) {
    const normalizedRegistry = assertCapabilityServiceRegistry(registry);
    const normalizedServiceId = typeof serviceId === "string" ? serviceId.trim() : serviceId;
    const service = normalizedRegistry.services.find((entry) => entry.serviceId === normalizedServiceId);

    return service ? copyCapabilityServiceDefinition(service) : null;
}

export function hasCapabilityService(registry, serviceId) {
    return getCapabilityService(registry, serviceId) !== null;
}

export {
    assertCapabilityServiceDefinition,
    validateCapabilityServiceDefinition
};
