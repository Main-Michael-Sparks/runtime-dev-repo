import {
    assertValidation,
    createValidationError,
    createValidationResult,
    isNonEmptyString,
    isPlainObject
} from "../bus/contractValidation.mjs";
import { isKnownCapability } from "../bus/capabilityTaxonomy.mjs";
import {
    HARDWARE_PROFILE_CLASSES,
    HARDWARE_PROFILE_PROCESS_MODES,
    HARDWARE_PROFILE_STATUSES,
    addForbiddenHardwareProfileKeyErrors,
    addForbiddenHardwareProfilePathLikeValueErrors,
    addHardwareProfileMetadataStringValidation,
    addHardwareProfileStringArrayValidation,
    addNonNegativeIntegerValidation,
    addPositiveIntegerValidation,
    addRequiredHardwareProfileStringError,
    addUnknownHardwareProfileFieldErrors,
    copyHardwareProfileDefinition,
    normalizeOptionalString,
    normalizeOptionalStringArray
} from "./hardwareProfileCommon.mjs";

const HARDWARE_PROFILE_STATUS_SET = new Set(HARDWARE_PROFILE_STATUSES);
const HARDWARE_PROFILE_CLASS_SET = new Set(HARDWARE_PROFILE_CLASSES);
const HARDWARE_PROFILE_PROCESS_MODE_SET = new Set(HARDWARE_PROFILE_PROCESS_MODES);

const HARDWARE_PROFILE_FIELDS = new Set([
    "profileId",
    "status",
    "label",
    "hardwareClass",
    "capabilities",
    "backendKinds",
    "processModes",
    "limits",
    "tuning",
    "media",
    "metadata"
]);

const HARDWARE_PROFILE_LIMIT_FIELDS = new Set([
    "maxConcurrentText",
    "maxConcurrentVision",
    "maxConcurrentEmbedding",
    "maxConcurrentTool",
    "maxQueueSizeText",
    "maxQueueSizeVision",
    "maxQueueSizeEmbedding",
    "maxQueueSizeTool",
    "maxImageBytes",
    "maxImagePixels",
    "timeoutMs"
]);

const HARDWARE_PROFILE_TUNING_FIELDS = new Set([
    "gpuLayers",
    "threads",
    "batchSize",
    "contextSize"
]);

const HARDWARE_PROFILE_THREAD_FIELDS = new Set([
    "ideal",
    "min"
]);

const HARDWARE_PROFILE_MEDIA_FIELDS = new Set([
    "imageResize"
]);

const HARDWARE_PROFILE_IMAGE_RESIZE_FIELDS = new Set([
    "enabled",
    "maxWidth",
    "maxHeight"
]);

export function isKnownHardwareProfileStatus(value) {
    return HARDWARE_PROFILE_STATUS_SET.has(value);
}

export function isKnownHardwareProfileClass(value) {
    return HARDWARE_PROFILE_CLASS_SET.has(value);
}

export function isKnownHardwareProfileProcessMode(value) {
    return HARDWARE_PROFILE_PROCESS_MODE_SET.has(value);
}

function normalizeThreads(threads) {
    if (!isPlainObject(threads)) return threads;

    return { ...threads };
}

function normalizeTuning(tuning) {
    if (!isPlainObject(tuning)) return tuning;

    return {
        ...tuning,
        contextSize: normalizeOptionalString(tuning.contextSize),
        threads: normalizeThreads(tuning.threads)
    };
}

function normalizeLimits(limits) {
    if (!isPlainObject(limits)) return limits;
    return { ...limits };
}

function normalizeMedia(media) {
    if (!isPlainObject(media)) return media;

    return {
        ...media,
        imageResize: isPlainObject(media.imageResize)
            ? { ...media.imageResize }
            : media.imageResize
    };
}

function validateHardwareProfileCapabilities(capabilities, errors) {
    addHardwareProfileStringArrayValidation(errors, capabilities, "capabilities");
    if (!Array.isArray(capabilities)) return;

    for (let index = 0; index < capabilities.length; index++) {
        const capability = typeof capabilities[index] === "string"
            ? capabilities[index].trim()
            : capabilities[index];
        if (!isNonEmptyString(capability)) continue;

        if (!isKnownCapability(capability)) {
            errors.push(createValidationError(
                `capabilities[${index}]`,
                "unknown_hardware_profile_capability",
                `Unknown hardware profile capability: ${capability}`,
                {
                    capability
                }
            ));
        }
    }
}

function validateHardwareProfileProcessModes(processModes, errors) {
    addHardwareProfileStringArrayValidation(errors, processModes, "processModes", { required: false });
    if (!Array.isArray(processModes)) return;

    for (let index = 0; index < processModes.length; index++) {
        const mode = typeof processModes[index] === "string"
            ? processModes[index].trim()
            : processModes[index];
        if (!isNonEmptyString(mode)) continue;

        if (!isKnownHardwareProfileProcessMode(mode)) {
            errors.push(createValidationError(
                `processModes[${index}]`,
                "unknown_hardware_profile_process_mode",
                `Unknown hardware profile process mode: ${mode}`,
                {
                    processMode: mode
                }
            ));
        }
    }
}

function validateHardwareProfileLimits(limits, errors) {
    if (limits === undefined) return;

    if (!isPlainObject(limits)) {
        errors.push(createValidationError(
            "limits",
            "invalid_hardware_profile_limits",
            "Hardware profile limits must be a plain object when provided"
        ));
        return;
    }

    addUnknownHardwareProfileFieldErrors(
        errors,
        limits,
        HARDWARE_PROFILE_LIMIT_FIELDS,
        "limits",
        "unknown_hardware_profile_limit_field",
        "hardware profile limits"
    );

    for (const key of HARDWARE_PROFILE_LIMIT_FIELDS) {
        if (limits[key] === undefined) continue;
        addPositiveIntegerValidation(
            errors,
            limits[key],
            `limits.${key}`,
            "invalid_hardware_profile_limit_value",
            `Hardware profile limits.${key}`
        );
    }
}

function validateContextSize(contextSize, errors) {
    if (contextSize === undefined) return;

    if (contextSize === "auto") return;

    if (Number.isInteger(contextSize) && contextSize > 0) return;

    if (isPlainObject(contextSize)) {
        addUnknownHardwareProfileFieldErrors(
            errors,
            contextSize,
            new Set(["min", "max"]),
            "tuning.contextSize",
            "unknown_hardware_profile_context_size_field",
            "hardware profile tuning.contextSize"
        );

        if (contextSize.min !== undefined) {
            addPositiveIntegerValidation(
                errors,
                contextSize.min,
                "tuning.contextSize.min",
                "invalid_hardware_profile_context_size_value",
                "Hardware profile tuning.contextSize.min"
            );
        }

        if (contextSize.max !== undefined) {
            addPositiveIntegerValidation(
                errors,
                contextSize.max,
                "tuning.contextSize.max",
                "invalid_hardware_profile_context_size_value",
                "Hardware profile tuning.contextSize.max"
            );
        }

        if (
            Number.isInteger(contextSize.min) &&
            Number.isInteger(contextSize.max) &&
            contextSize.min > contextSize.max
        ) {
            errors.push(createValidationError(
                "tuning.contextSize",
                "invalid_hardware_profile_context_size_range",
                "Hardware profile tuning.contextSize.min must be less than or equal to max"
            ));
        }

        return;
    }

    errors.push(createValidationError(
        "tuning.contextSize",
        "invalid_hardware_profile_context_size_value",
        "Hardware profile tuning.contextSize must be \"auto\", a positive integer, or a { min, max } object"
    ));
}

function validateThreads(threads, errors) {
    if (threads === undefined) return;

    if (!isPlainObject(threads)) {
        errors.push(createValidationError(
            "tuning.threads",
            "invalid_hardware_profile_threads",
            "Hardware profile tuning.threads must be a plain object when provided"
        ));
        return;
    }

    addUnknownHardwareProfileFieldErrors(
        errors,
        threads,
        HARDWARE_PROFILE_THREAD_FIELDS,
        "tuning.threads",
        "unknown_hardware_profile_threads_field",
        "hardware profile tuning.threads"
    );

    if (threads.ideal !== undefined) {
        addNonNegativeIntegerValidation(
            errors,
            threads.ideal,
            "tuning.threads.ideal",
            "invalid_hardware_profile_threads_value",
            "Hardware profile tuning.threads.ideal"
        );
    }

    if (threads.min !== undefined) {
        addPositiveIntegerValidation(
            errors,
            threads.min,
            "tuning.threads.min",
            "invalid_hardware_profile_threads_value",
            "Hardware profile tuning.threads.min"
        );
    }
}

function validateHardwareProfileTuning(tuning, errors) {
    if (tuning === undefined) return;

    if (!isPlainObject(tuning)) {
        errors.push(createValidationError(
            "tuning",
            "invalid_hardware_profile_tuning",
            "Hardware profile tuning must be a plain object when provided"
        ));
        return;
    }

    addUnknownHardwareProfileFieldErrors(
        errors,
        tuning,
        HARDWARE_PROFILE_TUNING_FIELDS,
        "tuning",
        "unknown_hardware_profile_tuning_field",
        "hardware profile tuning"
    );

    if (tuning.gpuLayers !== undefined && tuning.gpuLayers !== "auto") {
        addNonNegativeIntegerValidation(
            errors,
            tuning.gpuLayers,
            "tuning.gpuLayers",
            "invalid_hardware_profile_gpu_layers",
            "Hardware profile tuning.gpuLayers"
        );
    }

    validateThreads(tuning.threads, errors);

    if (tuning.batchSize !== undefined) {
        addPositiveIntegerValidation(
            errors,
            tuning.batchSize,
            "tuning.batchSize",
            "invalid_hardware_profile_batch_size",
            "Hardware profile tuning.batchSize"
        );
    }

    validateContextSize(tuning.contextSize, errors);
}

function validateHardwareProfileMedia(media, errors) {
    if (media === undefined) return;

    if (!isPlainObject(media)) {
        errors.push(createValidationError(
            "media",
            "invalid_hardware_profile_media",
            "Hardware profile media must be a plain object when provided"
        ));
        return;
    }

    addUnknownHardwareProfileFieldErrors(
        errors,
        media,
        HARDWARE_PROFILE_MEDIA_FIELDS,
        "media",
        "unknown_hardware_profile_media_field",
        "hardware profile media"
    );

    const { imageResize } = media;
    if (imageResize === undefined) return;

    if (!isPlainObject(imageResize)) {
        errors.push(createValidationError(
            "media.imageResize",
            "invalid_hardware_profile_image_resize",
            "Hardware profile media.imageResize must be a plain object when provided"
        ));
        return;
    }

    addUnknownHardwareProfileFieldErrors(
        errors,
        imageResize,
        HARDWARE_PROFILE_IMAGE_RESIZE_FIELDS,
        "media.imageResize",
        "unknown_hardware_profile_image_resize_field",
        "hardware profile media.imageResize"
    );

    if (imageResize.enabled !== undefined && typeof imageResize.enabled !== "boolean") {
        errors.push(createValidationError(
            "media.imageResize.enabled",
            "invalid_hardware_profile_image_resize_enabled",
            "Hardware profile media.imageResize.enabled must be a boolean"
        ));
    }

    if (imageResize.maxWidth !== undefined) {
        addPositiveIntegerValidation(
            errors,
            imageResize.maxWidth,
            "media.imageResize.maxWidth",
            "invalid_hardware_profile_image_resize_dimension",
            "Hardware profile media.imageResize.maxWidth"
        );
    }

    if (imageResize.maxHeight !== undefined) {
        addPositiveIntegerValidation(
            errors,
            imageResize.maxHeight,
            "media.imageResize.maxHeight",
            "invalid_hardware_profile_image_resize_dimension",
            "Hardware profile media.imageResize.maxHeight"
        );
    }
}

function validateHardwareProfileMetadata(metadata, errors) {
    if (metadata === undefined) return;

    if (!isPlainObject(metadata)) {
        errors.push(createValidationError(
            "metadata",
            "invalid_hardware_profile_metadata",
            "Hardware profile metadata must be a plain object when provided"
        ));
    }
}

export function normalizeHardwareProfileDefinition(profile) {
    return {
        ...profile,
        profileId: normalizeOptionalString(profile?.profileId),
        status: normalizeOptionalString(profile?.status),
        label: normalizeOptionalString(profile?.label),
        hardwareClass: normalizeOptionalString(profile?.hardwareClass),
        capabilities: normalizeOptionalStringArray(profile?.capabilities),
        backendKinds: normalizeOptionalStringArray(profile?.backendKinds),
        processModes: normalizeOptionalStringArray(profile?.processModes),
        limits: normalizeLimits(profile?.limits),
        tuning: normalizeTuning(profile?.tuning),
        media: normalizeMedia(profile?.media),
        metadata: isPlainObject(profile?.metadata) ? copyHardwareProfileDefinition(profile.metadata) : profile?.metadata
    };
}

export function validateHardwareProfileDefinition(profile) {
    const errors = [];

    if (!isPlainObject(profile)) {
        return createValidationResult([
            createValidationError(
                "",
                "invalid_hardware_profile",
                "Hardware profile definition must be a plain object"
            )
        ]);
    }

    const normalizedProfile = normalizeHardwareProfileDefinition(profile);

    addForbiddenHardwareProfileKeyErrors(
        errors,
        profile,
        "forbidden_hardware_profile_key",
        "Hardware profile definition"
    );
    addForbiddenHardwareProfilePathLikeValueErrors(
        errors,
        profile,
        "Hardware profile definition"
    );
    addUnknownHardwareProfileFieldErrors(
        errors,
        profile,
        HARDWARE_PROFILE_FIELDS,
        "",
        "unknown_hardware_profile_field",
        "hardware profile definition"
    );

    addRequiredHardwareProfileStringError(
        errors,
        normalizedProfile.profileId,
        "profileId",
        "missing_hardware_profile_id",
        "Hardware profile profileId"
    );
    addRequiredHardwareProfileStringError(
        errors,
        normalizedProfile.label,
        "label",
        "missing_hardware_profile_label",
        "Hardware profile label"
    );

    if (!isNonEmptyString(normalizedProfile.status)) {
        errors.push(createValidationError(
            "status",
            "missing_hardware_profile_status",
            "Hardware profile status must be a non-empty string"
        ));
    } else if (!isKnownHardwareProfileStatus(normalizedProfile.status)) {
        errors.push(createValidationError(
            "status",
            "unknown_hardware_profile_status",
            `Unknown hardware profile status: ${normalizedProfile.status}`,
            {
                status: normalizedProfile.status
            }
        ));
    }

    if (!isNonEmptyString(normalizedProfile.hardwareClass)) {
        errors.push(createValidationError(
            "hardwareClass",
            "missing_hardware_profile_class",
            "Hardware profile hardwareClass must be a non-empty string"
        ));
    } else if (!isKnownHardwareProfileClass(normalizedProfile.hardwareClass)) {
        errors.push(createValidationError(
            "hardwareClass",
            "unknown_hardware_profile_class",
            `Unknown hardware profile class: ${normalizedProfile.hardwareClass}`,
            {
                hardwareClass: normalizedProfile.hardwareClass
            }
        ));
    }

    addHardwareProfileMetadataStringValidation(errors, normalizedProfile.profileId, "profileId");
    addHardwareProfileMetadataStringValidation(errors, normalizedProfile.label, "label");
    addHardwareProfileMetadataStringValidation(errors, normalizedProfile.hardwareClass, "hardwareClass");

    validateHardwareProfileCapabilities(normalizedProfile.capabilities, errors);
    addHardwareProfileStringArrayValidation(errors, normalizedProfile.backendKinds, "backendKinds");
    validateHardwareProfileProcessModes(normalizedProfile.processModes, errors);
    validateHardwareProfileLimits(normalizedProfile.limits, errors);
    validateHardwareProfileTuning(normalizedProfile.tuning, errors);
    validateHardwareProfileMedia(normalizedProfile.media, errors);
    validateHardwareProfileMetadata(normalizedProfile.metadata, errors);

    return createValidationResult(
        errors,
        errors.length === 0 ? copyHardwareProfileDefinition(normalizedProfile) : null
    );
}

export function assertHardwareProfileDefinition(profile) {
    return assertValidation(
        validateHardwareProfileDefinition(profile),
        "Hardware profile definition validation failed"
    );
}

export { copyHardwareProfileDefinition };
