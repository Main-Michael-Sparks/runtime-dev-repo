import {
    collectForbiddenKeys,
    createValidationError,
    hasForbiddenPathLikeValue,
    isNonEmptyString,
    isPlainObject
} from "../bus/contractValidation.mjs";

export const MODEL_BUNDLE_CONTRACT_VERSION = "model-bundle.v1";
export const MODEL_BUNDLE_REGISTRY_SCHEMA_VERSION = "model-bundle-registry.v1";

export const MODEL_BUNDLE_STATUSES = Object.freeze([
    "contract-only",
    "planned",
    "experimental",
    "configured",
    "disabled",
    "deprecated"
]);

export const MODEL_BUNDLE_ARTIFACT_LAYOUT_KINDS = Object.freeze([
    "gguf-text",
    "gguf-mmproj",
    "hf-multimodal",
    "server-managed",
    "native-vision"
]);

const MODEL_BUNDLE_SELECTABLE_STATUS_SET = new Set([
    "contract-only",
    "planned",
    "experimental",
    "configured"
]);

const FORBIDDEN_MODEL_BUNDLE_EXECUTION_KEYS = new Set([
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
    "env",
    "function",
    "handler",
    "execute",
    "executeAction",
    "invoke",
    "workerBridge",
    "llama_worker",
    "nodeLlamaCpp",
    "configOverride"
]);

const MODEL_BUNDLE_ARTIFACT_REF_KEYS = new Set([
    "modelPath",
    "baseModel",
    "mmprojPath",
    "projectorPath"
]);

function clonePlainValue(value) {
    if (Array.isArray(value)) {
        return value.map((entry) => clonePlainValue(entry));
    }

    if (isPlainObject(value)) {
        const out = {};

        for (const [key, childValue] of Object.entries(value)) {
            out[key] = clonePlainValue(childValue);
        }

        return out;
    }

    return value;
}

function formatChildPath(parentPath, key) {
    if (!parentPath) return String(key);
    return `${parentPath}.${String(key)}`;
}

function isArtifactLayoutPath(path) {
    if (path === "artifactLayout" || path.startsWith("artifactLayout.")) return true;
    return /(?:^|\.|\])artifactLayout(?:\.|$)/.test(path);
}

function hasForbiddenMetadataValue(value) {
    if (typeof value !== "string") return false;

    const trimmed = value.trim();
    if (!trimmed) return false;

    return (
        hasForbiddenPathLikeValue(trimmed) ||
        trimmed.includes("/") ||
        trimmed.includes("\\") ||
        trimmed.startsWith(".")
    );
}

export function isSelectableModelBundleStatus(status) {
    return MODEL_BUNDLE_SELECTABLE_STATUS_SET.has(status);
}

export function normalizeOptionalString(value) {
    return typeof value === "string" ? value.trim() : value;
}

export function normalizeOptionalStringArray(value) {
    if (!Array.isArray(value)) return value;
    return value.map((entry) => normalizeOptionalString(entry));
}

export function copyModelBundleDefinition(bundle) {
    return clonePlainValue(bundle);
}

export function copyModelBundleRegistry(registry) {
    return clonePlainValue(registry);
}

export function addForbiddenModelBundleKeyErrors(errors, objectValue, code, label) {
    const executionKeyEntries = collectForbiddenKeys(objectValue, FORBIDDEN_MODEL_BUNDLE_EXECUTION_KEYS);

    for (const entry of executionKeyEntries) {
        errors.push(createValidationError(
            entry.path,
            code,
            `${label} must not include forbidden key: ${entry.key}`,
            {
                key: entry.key
            }
        ));
    }

    const artifactRefEntries = collectForbiddenKeys(objectValue, MODEL_BUNDLE_ARTIFACT_REF_KEYS)
        .filter((entry) => !isArtifactLayoutPath(entry.path));

    for (const entry of artifactRefEntries) {
        errors.push(createValidationError(
            entry.path,
            "forbidden_model_bundle_request_path_key",
            `${label} must not include artifact path key outside artifactLayout: ${entry.key}`,
            {
                key: entry.key
            }
        ));
    }
}

export function addUnknownModelBundleFieldErrors(errors, objectValue, allowedFields, path, code, label) {
    if (!isPlainObject(objectValue)) return;

    for (const key of Object.keys(objectValue)) {
        if (allowedFields.has(key)) continue;

        errors.push(createValidationError(
            path ? `${path}.${key}` : key,
            code,
            `Unsupported field for ${label}: ${key}`,
            {
                key
            }
        ));
    }
}

export function addRequiredModelBundleStringError(errors, value, path, code, label) {
    if (isNonEmptyString(value)) return;

    errors.push(createValidationError(
        path,
        code,
        `${label} must be a non-empty string`
    ));
}

export function addModelBundleMetadataStringValidation(errors, value, path) {
    if (value === undefined) return;

    if (!isNonEmptyString(value)) {
        errors.push(createValidationError(
            path,
            "invalid_model_bundle_metadata_id",
            `${path} must be a non-empty metadata string when provided`
        ));
        return;
    }

    if (hasForbiddenMetadataValue(value)) {
        errors.push(createValidationError(
            path,
            "forbidden_model_bundle_metadata_value",
            `${path} must be a metadata label, not a path or backend payload`
        ));
    }
}

export function addModelBundleStringArrayValidation(errors, value, path, { required = true } = {}) {
    if (value === undefined && required === false) return;

    if (!Array.isArray(value)) {
        errors.push(createValidationError(
            path,
            "invalid_model_bundle_string_array",
            `${path} must be an array of non-empty metadata strings`
        ));
        return;
    }

    const seen = new Map();

    for (let index = 0; index < value.length; index++) {
        const entry = value[index];
        const entryPath = `${path}[${index}]`;

        if (!isNonEmptyString(entry)) {
            errors.push(createValidationError(
                entryPath,
                "invalid_model_bundle_string_array_entry",
                `${entryPath} must be a non-empty metadata string`
            ));
            continue;
        }

        const normalized = entry.trim();

        if (hasForbiddenMetadataValue(normalized)) {
            errors.push(createValidationError(
                entryPath,
                "forbidden_model_bundle_string_array_value",
                `${entryPath} must be a metadata label, not a path or backend payload`
            ));
            continue;
        }

        if (seen.has(normalized)) {
            errors.push(createValidationError(
                entryPath,
                "duplicate_model_bundle_string_array_entry",
                `${path} must not include duplicate metadata string entries: ${normalized}`,
                {
                    value: normalized,
                    firstIndex: seen.get(normalized),
                    duplicateIndex: index
                }
            ));
        } else {
            seen.set(normalized, index);
        }
    }
}

export function addForbiddenModelBundlePathLikeValueErrors(errors, objectValue, label) {
    function visit(value, path) {
        if (Array.isArray(value)) {
            for (let index = 0; index < value.length; index++) {
                visit(value[index], `${path}[${index}]`);
            }
            return;
        }

        if (isPlainObject(value)) {
            for (const [key, childValue] of Object.entries(value)) {
                visit(childValue, formatChildPath(path, key));
            }
            return;
        }

        if (typeof value !== "string") return;
        if (isArtifactLayoutPath(path)) return;

        const trimmed = value.trim();
        if (!trimmed) return;

        if (!(
            hasForbiddenPathLikeValue(trimmed) ||
            trimmed.includes("/") ||
            trimmed.includes("\\") ||
            trimmed.startsWith(".")
        )) return;

        errors.push(createValidationError(
            path,
            "forbidden_model_bundle_path_like_value",
            `${label} must not include path-like values outside artifactLayout`,
            {
                value: trimmed
            }
        ));
    }

    visit(objectValue, "");
}

export function prefixModelBundleValidationErrors(errors, prefix, codePrefix) {
    if (!Array.isArray(errors)) return [];

    return errors.map((error) => createValidationError(
        prefix && error.path ? `${prefix}.${error.path}` : (prefix || error.path),
        codePrefix ? `${codePrefix}_${error.code}` : error.code,
        error.message,
        error.details
    ));
}
