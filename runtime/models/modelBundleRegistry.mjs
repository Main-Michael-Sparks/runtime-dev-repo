import {
    assertValidation,
    createValidationError,
    createValidationResult,
    isNonEmptyString,
    isPlainObject
} from "../bus/contractValidation.mjs";
import {
    assertModelBundleDefinition,
    copyModelBundleDefinition,
    normalizeModelBundleDefinition,
    validateModelBundleDefinition
} from "./modelBundleDefinition.mjs";
import {
    MODEL_BUNDLE_REGISTRY_SCHEMA_VERSION,
    addForbiddenModelBundleKeyErrors,
    addUnknownModelBundleFieldErrors,
    copyModelBundleRegistry,
    prefixModelBundleValidationErrors
} from "./modelBundleCommon.mjs";

const MODEL_BUNDLE_REGISTRY_FIELDS = new Set([
    "schemaVersion",
    "bundles"
]);

function addModelBundleRegistryDuplicateErrors(errors, bundles) {
    const seenBundleIds = new Map();

    for (let index = 0; index < bundles.length; index++) {
        const bundle = bundles[index];

        if (!isNonEmptyString(bundle.bundleId)) continue;

        if (seenBundleIds.has(bundle.bundleId)) {
            errors.push(createValidationError(
                `bundles[${index}].bundleId`,
                "duplicate_model_bundle_id",
                `Model bundle registry must not include duplicate bundleId entries: ${bundle.bundleId}`,
                {
                    bundleId: bundle.bundleId,
                    firstIndex: seenBundleIds.get(bundle.bundleId),
                    duplicateIndex: index
                }
            ));
        } else {
            seenBundleIds.set(bundle.bundleId, index);
        }
    }
}

export function normalizeModelBundleRegistry(registry) {
    const bundles = Array.isArray(registry?.bundles)
        ? registry.bundles.map((bundle) => normalizeModelBundleDefinition(bundle))
        : registry?.bundles;

    return {
        ...registry,
        schemaVersion: registry?.schemaVersion === undefined
            ? MODEL_BUNDLE_REGISTRY_SCHEMA_VERSION
            : registry.schemaVersion,
        bundles
    };
}

export function validateModelBundleRegistry(registry) {
    const errors = [];

    if (!isPlainObject(registry)) {
        return createValidationResult([
            createValidationError(
                "",
                "invalid_model_bundle_registry",
                "Model bundle registry must be a plain object"
            )
        ]);
    }

    const normalizedRegistry = normalizeModelBundleRegistry(registry);

    addForbiddenModelBundleKeyErrors(
        errors,
        registry,
        "forbidden_model_bundle_registry_key",
        "Model bundle registry"
    );
    addUnknownModelBundleFieldErrors(
        errors,
        registry,
        MODEL_BUNDLE_REGISTRY_FIELDS,
        "",
        "unknown_model_bundle_registry_field",
        "model bundle registry"
    );

    if (
        normalizedRegistry.schemaVersion !== undefined &&
        normalizedRegistry.schemaVersion !== MODEL_BUNDLE_REGISTRY_SCHEMA_VERSION
    ) {
        errors.push(createValidationError(
            "schemaVersion",
            "unsupported_model_bundle_registry_schema_version",
            `Unsupported model bundle registry schemaVersion: ${normalizedRegistry.schemaVersion}`,
            {
                expected: MODEL_BUNDLE_REGISTRY_SCHEMA_VERSION
            }
        ));
    }

    if (!Array.isArray(normalizedRegistry.bundles)) {
        errors.push(createValidationError(
            "bundles",
            "invalid_model_bundle_registry_bundles",
            "Model bundle registry bundles must be an array"
        ));

        return createValidationResult(errors);
    }

    const normalizedBundles = [];

    for (let index = 0; index < normalizedRegistry.bundles.length; index++) {
        const result = validateModelBundleDefinition(normalizedRegistry.bundles[index]);

        if (!result.ok) {
            errors.push(...prefixModelBundleValidationErrors(
                result.errors,
                `bundles[${index}]`,
                "model_bundle_registry_bundle"
            ));
            continue;
        }

        normalizedBundles.push(result.value);
    }

    if (normalizedBundles.length === normalizedRegistry.bundles.length) {
        addModelBundleRegistryDuplicateErrors(errors, normalizedBundles);
    }

    return createValidationResult(
        errors,
        errors.length === 0
            ? {
                  schemaVersion: normalizedRegistry.schemaVersion,
                  bundles: normalizedBundles
              }
            : null
    );
}

export function assertModelBundleRegistry(registry) {
    return assertValidation(
        validateModelBundleRegistry(registry),
        "Model bundle registry validation failed"
    );
}

export function createModelBundleRegistry(bundles = []) {
    return assertModelBundleRegistry({
        schemaVersion: MODEL_BUNDLE_REGISTRY_SCHEMA_VERSION,
        bundles
    });
}

export function listModelBundles(registry) {
    const normalizedRegistry = assertModelBundleRegistry(registry);
    return normalizedRegistry.bundles.map((bundle) => copyModelBundleDefinition(bundle));
}

export function getModelBundle(registry, bundleId) {
    const normalizedRegistry = assertModelBundleRegistry(registry);
    const normalizedBundleId = typeof bundleId === "string" ? bundleId.trim() : bundleId;
    const bundle = normalizedRegistry.bundles.find((entry) => entry.bundleId === normalizedBundleId);

    return bundle ? copyModelBundleDefinition(bundle) : null;
}

export function hasModelBundle(registry, bundleId) {
    return getModelBundle(registry, bundleId) !== null;
}

export function listModelBundlesForCapability(registry, capability) {
    const normalizedRegistry = assertModelBundleRegistry(registry);
    const normalizedCapability = typeof capability === "string" ? capability.trim() : capability;

    return normalizedRegistry.bundles
        .filter((bundle) => bundle.capabilities.includes(normalizedCapability))
        .map((bundle) => copyModelBundleDefinition(bundle));
}

export function listModelBundlesForBackendKind(registry, backendKind) {
    const normalizedRegistry = assertModelBundleRegistry(registry);
    const normalizedBackendKind = typeof backendKind === "string" ? backendKind.trim() : backendKind;

    return normalizedRegistry.bundles
        .filter((bundle) => bundle.backendKind === normalizedBackendKind)
        .map((bundle) => copyModelBundleDefinition(bundle));
}

export {
    assertModelBundleDefinition,
    copyModelBundleDefinition,
    validateModelBundleDefinition
};

export { copyModelBundleRegistry };
