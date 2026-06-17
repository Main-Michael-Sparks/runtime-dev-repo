import {
    assertValidation,
    createValidationError,
    createValidationResult,
    isNonEmptyString,
    isPlainObject
} from "../bus/contractValidation.mjs";
import {
    CAPABILITY_REQUIREMENT_SUPPORT_LEVELS,
    isKnownCapabilityRequirementSupportLevel
} from "../bus/capabilityDefinition.mjs";
import { isKnownCapability } from "../bus/capabilityTaxonomy.mjs";
import {
    MODEL_BUNDLE_ARTIFACT_LAYOUT_KINDS,
    MODEL_BUNDLE_STATUSES,
    addForbiddenModelBundleKeyErrors,
    addForbiddenModelBundlePathLikeValueErrors,
    addModelBundleMetadataStringValidation,
    addModelBundleStringArrayValidation,
    addRequiredModelBundleStringError,
    addUnknownModelBundleFieldErrors,
    copyModelBundleDefinition,
    normalizeOptionalString,
    normalizeOptionalStringArray
} from "./modelBundleCommon.mjs";

const MODEL_BUNDLE_STATUS_SET = new Set(MODEL_BUNDLE_STATUSES);
const MODEL_BUNDLE_ARTIFACT_LAYOUT_KIND_SET = new Set(MODEL_BUNDLE_ARTIFACT_LAYOUT_KINDS);
const MODEL_BUNDLE_REQUIREMENT_SUPPORT_LEVEL_SET = new Set(CAPABILITY_REQUIREMENT_SUPPORT_LEVELS);

const MODEL_BUNDLE_FIELDS = new Set([
    "bundleId",
    "status",
    "label",
    "capabilities",
    "backendKind",
    "backendId",
    "defaultHardwareProfileId",
    "artifactLayout",
    "requirements",
    "metadata"
]);

const MODEL_BUNDLE_REQUIREMENT_FIELDS = new Set([
    "streaming",
    "cancellation",
    "timeout"
]);

const MODEL_BUNDLE_LAYOUT_FIELDS_BY_KIND = Object.freeze({
    "gguf-text": new Set([
        "kind",
        "modelPath"
    ]),
    "gguf-mmproj": new Set([
        "kind",
        "modelPath",
        "mmprojPath"
    ]),
    "hf-multimodal": new Set([
        "kind",
        "repo"
    ]),
    "server-managed": new Set([
        "kind",
        "endpoint"
    ]),
    "native-vision": new Set([
        "kind",
        "modelPath",
        "mmprojPath"
    ])
});

const MODEL_BUNDLE_LAYOUT_REQUIRED_FIELDS_BY_KIND = Object.freeze({
    "gguf-text": ["modelPath"],
    "gguf-mmproj": ["modelPath", "mmprojPath"],
    "hf-multimodal": ["repo"],
    "server-managed": ["endpoint"],
    "native-vision": ["modelPath"]
});

export function isKnownModelBundleStatus(value) {
    return MODEL_BUNDLE_STATUS_SET.has(value);
}

export function isKnownModelBundleArtifactLayoutKind(value) {
    return MODEL_BUNDLE_ARTIFACT_LAYOUT_KIND_SET.has(value);
}

export function isKnownModelBundleRequirementSupportLevel(value) {
    return MODEL_BUNDLE_REQUIREMENT_SUPPORT_LEVEL_SET.has(value);
}

function normalizeModelBundleRequirements(requirements) {
    if (!isPlainObject(requirements)) return requirements;

    return {
        ...requirements,
        streaming: normalizeOptionalString(requirements.streaming),
        cancellation: normalizeOptionalString(requirements.cancellation),
        timeout: normalizeOptionalString(requirements.timeout)
    };
}

function normalizeModelBundleArtifactLayout(artifactLayout) {
    if (!isPlainObject(artifactLayout)) return artifactLayout;

    const normalizedLayout = { ...artifactLayout };

    for (const key of ["kind", "modelPath", "mmprojPath", "repo", "endpoint"]) {
        if (key in normalizedLayout) {
            normalizedLayout[key] = normalizeOptionalString(normalizedLayout[key]);
        }
    }

    return normalizedLayout;
}

function addRequirementSupportLevelError(errors, value, path) {
    if (!isNonEmptyString(value)) {
        errors.push(createValidationError(
            path,
            "missing_model_bundle_requirement_support_level",
            `${path} must be a non-empty support-level string`
        ));
        return;
    }

    if (!isKnownCapabilityRequirementSupportLevel(value)) {
        errors.push(createValidationError(
            path,
            "unknown_model_bundle_requirement_support_level",
            `Unknown model bundle requirement support level: ${value}`,
            {
                supportLevel: value
            }
        ));
    }
}

function validateModelBundleCapabilities(capabilities, errors) {
    addModelBundleStringArrayValidation(errors, capabilities, "capabilities");
    if (!Array.isArray(capabilities)) return;

    for (let index = 0; index < capabilities.length; index++) {
        const capability = typeof capabilities[index] === "string"
            ? capabilities[index].trim()
            : capabilities[index];
        if (!isNonEmptyString(capability)) continue;

        if (!isKnownCapability(capability)) {
            errors.push(createValidationError(
                `capabilities[${index}]`,
                "unknown_model_bundle_capability",
                `Unknown model bundle capability: ${capability}`,
                {
                    capability
                }
            ));
        }
    }
}

function validateModelBundleRequirements(requirements, errors) {
    if (requirements === undefined) return;

    if (!isPlainObject(requirements)) {
        errors.push(createValidationError(
            "requirements",
            "invalid_model_bundle_requirements",
            "Model bundle requirements must be a plain object when provided"
        ));
        return;
    }

    addUnknownModelBundleFieldErrors(
        errors,
        requirements,
        MODEL_BUNDLE_REQUIREMENT_FIELDS,
        "requirements",
        "unknown_model_bundle_requirement_field",
        "model bundle requirements"
    );

    for (const key of MODEL_BUNDLE_REQUIREMENT_FIELDS) {
        if (requirements[key] === undefined) continue;
        addRequirementSupportLevelError(errors, requirements[key], `requirements.${key}`);
    }
}

function addArtifactLayoutRequiredFieldErrors(errors, layout, kind) {
    const requiredFields = MODEL_BUNDLE_LAYOUT_REQUIRED_FIELDS_BY_KIND[kind] || [];

    for (const field of requiredFields) {
        addRequiredModelBundleStringError(
            errors,
            layout[field],
            `artifactLayout.${field}`,
            "missing_model_bundle_artifact_layout_field",
            `Model bundle artifactLayout.${field}`
        );
    }
}

function validateModelBundleArtifactLayout(artifactLayout, errors) {
    if (!isPlainObject(artifactLayout)) {
        errors.push(createValidationError(
            "artifactLayout",
            "invalid_model_bundle_artifact_layout",
            "Model bundle artifactLayout must be a plain object"
        ));
        return;
    }

    addRequiredModelBundleStringError(
        errors,
        artifactLayout.kind,
        "artifactLayout.kind",
        "missing_model_bundle_artifact_layout_kind",
        "Model bundle artifactLayout.kind"
    );

    if (!isNonEmptyString(artifactLayout.kind)) return;

    if (!isKnownModelBundleArtifactLayoutKind(artifactLayout.kind)) {
        errors.push(createValidationError(
            "artifactLayout.kind",
            "unknown_model_bundle_artifact_layout_kind",
            `Unknown model bundle artifactLayout.kind: ${artifactLayout.kind}`,
            {
                kind: artifactLayout.kind
            }
        ));
        return;
    }

    const allowedFields = MODEL_BUNDLE_LAYOUT_FIELDS_BY_KIND[artifactLayout.kind];

    addUnknownModelBundleFieldErrors(
        errors,
        artifactLayout,
        allowedFields,
        "artifactLayout",
        "unknown_model_bundle_artifact_layout_field",
        "model bundle artifactLayout"
    );
    addArtifactLayoutRequiredFieldErrors(errors, artifactLayout, artifactLayout.kind);

    for (const [key, value] of Object.entries(artifactLayout)) {
        if (key === "kind") continue;
        addRequiredModelBundleStringError(
            errors,
            value,
            `artifactLayout.${key}`,
            "invalid_model_bundle_artifact_layout_value",
            `Model bundle artifactLayout.${key}`
        );
    }
}

function validateModelBundleMetadata(metadata, errors) {
    if (metadata === undefined) return;

    if (!isPlainObject(metadata)) {
        errors.push(createValidationError(
            "metadata",
            "invalid_model_bundle_metadata",
            "Model bundle metadata must be a plain object when provided"
        ));
        return;
    }
}

export function normalizeModelBundleDefinition(bundle) {
    return {
        ...bundle,
        bundleId: normalizeOptionalString(bundle?.bundleId),
        status: normalizeOptionalString(bundle?.status),
        label: normalizeOptionalString(bundle?.label),
        capabilities: normalizeOptionalStringArray(bundle?.capabilities),
        backendKind: normalizeOptionalString(bundle?.backendKind),
        backendId: normalizeOptionalString(bundle?.backendId),
        defaultHardwareProfileId: normalizeOptionalString(bundle?.defaultHardwareProfileId),
        artifactLayout: normalizeModelBundleArtifactLayout(bundle?.artifactLayout),
        requirements: normalizeModelBundleRequirements(bundle?.requirements),
        metadata: isPlainObject(bundle?.metadata) ? copyModelBundleDefinition(bundle.metadata) : bundle?.metadata
    };
}

export function validateModelBundleDefinition(bundle) {
    const errors = [];

    if (!isPlainObject(bundle)) {
        return createValidationResult([
            createValidationError(
                "",
                "invalid_model_bundle",
                "Model bundle definition must be a plain object"
            )
        ]);
    }

    const normalizedBundle = normalizeModelBundleDefinition(bundle);

    addForbiddenModelBundleKeyErrors(
        errors,
        bundle,
        "forbidden_model_bundle_key",
        "Model bundle definition"
    );
    addForbiddenModelBundlePathLikeValueErrors(
        errors,
        bundle,
        "Model bundle definition"
    );
    addUnknownModelBundleFieldErrors(
        errors,
        bundle,
        MODEL_BUNDLE_FIELDS,
        "",
        "unknown_model_bundle_field",
        "model bundle definition"
    );

    addRequiredModelBundleStringError(
        errors,
        normalizedBundle.bundleId,
        "bundleId",
        "missing_model_bundle_id",
        "Model bundle bundleId"
    );
    addRequiredModelBundleStringError(
        errors,
        normalizedBundle.backendKind,
        "backendKind",
        "missing_model_bundle_backend_kind",
        "Model bundle backendKind"
    );

    if (!isNonEmptyString(normalizedBundle.status)) {
        errors.push(createValidationError(
            "status",
            "missing_model_bundle_status",
            "Model bundle status must be a non-empty string"
        ));
    } else if (!isKnownModelBundleStatus(normalizedBundle.status)) {
        errors.push(createValidationError(
            "status",
            "unknown_model_bundle_status",
            `Unknown model bundle status: ${normalizedBundle.status}`,
            {
                status: normalizedBundle.status
            }
        ));
    }

    addModelBundleMetadataStringValidation(errors, normalizedBundle.bundleId, "bundleId");
    addModelBundleMetadataStringValidation(errors, normalizedBundle.label, "label");
    addModelBundleMetadataStringValidation(errors, normalizedBundle.backendKind, "backendKind");
    addModelBundleMetadataStringValidation(errors, normalizedBundle.backendId, "backendId");
    addModelBundleMetadataStringValidation(
        errors,
        normalizedBundle.defaultHardwareProfileId,
        "defaultHardwareProfileId"
    );

    validateModelBundleCapabilities(normalizedBundle.capabilities, errors);
    validateModelBundleArtifactLayout(normalizedBundle.artifactLayout, errors);
    validateModelBundleRequirements(normalizedBundle.requirements, errors);
    validateModelBundleMetadata(normalizedBundle.metadata, errors);

    return createValidationResult(
        errors,
        errors.length === 0 ? copyModelBundleDefinition(normalizedBundle) : null
    );
}

export function assertModelBundleDefinition(bundle) {
    return assertValidation(
        validateModelBundleDefinition(bundle),
        "Model bundle definition validation failed"
    );
}

export { copyModelBundleDefinition };
