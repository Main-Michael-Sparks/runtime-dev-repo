import {
    assertValidation,
    createValidationError,
    createValidationResult,
    isNonEmptyString,
    isPlainObject
} from "../bus/contractValidation.mjs";
import {
    assertHardwareProfileDefinition,
    copyHardwareProfileDefinition,
    normalizeHardwareProfileDefinition,
    validateHardwareProfileDefinition
} from "./hardwareProfileDefinition.mjs";
import {
    HARDWARE_PROFILE_REGISTRY_SCHEMA_VERSION,
    addForbiddenHardwareProfileKeyErrors,
    addUnknownHardwareProfileFieldErrors,
    copyHardwareProfileRegistry,
    isSelectableHardwareProfileStatus,
    prefixHardwareProfileValidationErrors
} from "./hardwareProfileCommon.mjs";

const HARDWARE_PROFILE_REGISTRY_FIELDS = new Set([
    "schemaVersion",
    "profiles"
]);

function addHardwareProfileRegistryDuplicateErrors(errors, profiles) {
    const seenProfileIds = new Map();

    for (let index = 0; index < profiles.length; index++) {
        const profile = profiles[index];

        if (!isNonEmptyString(profile.profileId)) continue;

        if (seenProfileIds.has(profile.profileId)) {
            errors.push(createValidationError(
                `profiles[${index}].profileId`,
                "duplicate_hardware_profile_id",
                `Hardware profile registry must not include duplicate profileId entries: ${profile.profileId}`,
                {
                    profileId: profile.profileId,
                    firstIndex: seenProfileIds.get(profile.profileId),
                    duplicateIndex: index
                }
            ));
        } else {
            seenProfileIds.set(profile.profileId, index);
        }
    }
}

export function normalizeHardwareProfileRegistry(registry) {
    const profiles = Array.isArray(registry?.profiles)
        ? registry.profiles.map((profile) => normalizeHardwareProfileDefinition(profile))
        : registry?.profiles;

    return {
        ...registry,
        schemaVersion: registry?.schemaVersion === undefined
            ? HARDWARE_PROFILE_REGISTRY_SCHEMA_VERSION
            : registry.schemaVersion,
        profiles
    };
}

export function validateHardwareProfileRegistry(registry) {
    const errors = [];

    if (!isPlainObject(registry)) {
        return createValidationResult([
            createValidationError(
                "",
                "invalid_hardware_profile_registry",
                "Hardware profile registry must be a plain object"
            )
        ]);
    }

    const normalizedRegistry = normalizeHardwareProfileRegistry(registry);

    addForbiddenHardwareProfileKeyErrors(
        errors,
        registry,
        "forbidden_hardware_profile_registry_key",
        "Hardware profile registry"
    );
    addUnknownHardwareProfileFieldErrors(
        errors,
        registry,
        HARDWARE_PROFILE_REGISTRY_FIELDS,
        "",
        "unknown_hardware_profile_registry_field",
        "hardware profile registry"
    );

    if (
        normalizedRegistry.schemaVersion !== undefined &&
        normalizedRegistry.schemaVersion !== HARDWARE_PROFILE_REGISTRY_SCHEMA_VERSION
    ) {
        errors.push(createValidationError(
            "schemaVersion",
            "unsupported_hardware_profile_registry_schema_version",
            `Unsupported hardware profile registry schemaVersion: ${normalizedRegistry.schemaVersion}`,
            {
                expected: HARDWARE_PROFILE_REGISTRY_SCHEMA_VERSION
            }
        ));
    }

    if (!Array.isArray(normalizedRegistry.profiles)) {
        errors.push(createValidationError(
            "profiles",
            "invalid_hardware_profile_registry_profiles",
            "Hardware profile registry profiles must be an array"
        ));

        return createValidationResult(errors);
    }

    const normalizedProfiles = [];

    for (let index = 0; index < normalizedRegistry.profiles.length; index++) {
        const result = validateHardwareProfileDefinition(normalizedRegistry.profiles[index]);

        if (!result.ok) {
            errors.push(...prefixHardwareProfileValidationErrors(
                result.errors,
                `profiles[${index}]`,
                "hardware_profile_registry_profile"
            ));
            continue;
        }

        normalizedProfiles.push(result.value);
    }

    if (normalizedProfiles.length === normalizedRegistry.profiles.length) {
        addHardwareProfileRegistryDuplicateErrors(errors, normalizedProfiles);
    }

    return createValidationResult(
        errors,
        errors.length === 0
            ? {
                  schemaVersion: normalizedRegistry.schemaVersion,
                  profiles: normalizedProfiles
              }
            : null
    );
}

export function assertHardwareProfileRegistry(registry) {
    return assertValidation(
        validateHardwareProfileRegistry(registry),
        "Hardware profile registry validation failed"
    );
}

export function createHardwareProfileRegistry(profiles = []) {
    return assertHardwareProfileRegistry({
        schemaVersion: HARDWARE_PROFILE_REGISTRY_SCHEMA_VERSION,
        profiles
    });
}

export function listHardwareProfiles(registry) {
    const normalizedRegistry = assertHardwareProfileRegistry(registry);
    return normalizedRegistry.profiles.map((profile) => copyHardwareProfileDefinition(profile));
}

export function getHardwareProfile(registry, profileId) {
    const normalizedRegistry = assertHardwareProfileRegistry(registry);
    const normalizedProfileId = typeof profileId === "string" ? profileId.trim() : profileId;
    const profile = normalizedRegistry.profiles.find((entry) => entry.profileId === normalizedProfileId);

    return profile ? copyHardwareProfileDefinition(profile) : null;
}

export function hasHardwareProfile(registry, profileId) {
    return getHardwareProfile(registry, profileId) !== null;
}

export function listHardwareProfilesForCapability(registry, capability) {
    const normalizedRegistry = assertHardwareProfileRegistry(registry);
    const normalizedCapability = typeof capability === "string" ? capability.trim() : capability;

    return normalizedRegistry.profiles
        .filter((profile) => profile.capabilities.includes(normalizedCapability))
        .map((profile) => copyHardwareProfileDefinition(profile));
}

export function listHardwareProfilesForBackendKind(registry, backendKind) {
    const normalizedRegistry = assertHardwareProfileRegistry(registry);
    const normalizedBackendKind = typeof backendKind === "string" ? backendKind.trim() : backendKind;

    return normalizedRegistry.profiles
        .filter((profile) => profile.backendKinds.includes(normalizedBackendKind))
        .map((profile) => copyHardwareProfileDefinition(profile));
}

export function listHardwareProfilesForHardwareClass(registry, hardwareClass) {
    const normalizedRegistry = assertHardwareProfileRegistry(registry);
    const normalizedHardwareClass = typeof hardwareClass === "string" ? hardwareClass.trim() : hardwareClass;

    return normalizedRegistry.profiles
        .filter((profile) => profile.hardwareClass === normalizedHardwareClass)
        .map((profile) => copyHardwareProfileDefinition(profile));
}

export function listSelectableHardwareProfiles(registry) {
    const normalizedRegistry = assertHardwareProfileRegistry(registry);

    return normalizedRegistry.profiles
        .filter((profile) => isSelectableHardwareProfileStatus(profile.status))
        .map((profile) => copyHardwareProfileDefinition(profile));
}

export {
    assertHardwareProfileDefinition,
    copyHardwareProfileDefinition,
    validateHardwareProfileDefinition
};

export { copyHardwareProfileRegistry };
