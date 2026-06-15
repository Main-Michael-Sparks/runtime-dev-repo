const DANGEROUS_KEYS = new Set([
    "__proto__",
    "prototype",
    "constructor"
]);

function normalizePath(path) {
    if (Array.isArray(path)) {
        return path.join(".");
    }

    if (typeof path === "string") {
        return path;
    }

    return "";
}

function formatChildPath(parentPath, key) {
    if (typeof key === "number") {
        return `${parentPath}[${key}]`;
    }

    if (!parentPath) return String(key);
    return `${parentPath}.${String(key)}`;
}

function normalizeValidationError(error) {
    if (!isPlainObject(error)) {
        return createValidationError(
            "",
            "invalid_validation_error",
            "Validation error entries must be plain objects"
        );
    }

    const path = typeof error.path === "string" ? error.path : "";
    const code = isNonEmptyString(error.code) ? error.code : "invalid_validation_error";
    const message = isNonEmptyString(error.message)
        ? error.message
        : "Invalid validation error entry";
    const details = error.details === undefined ? null : error.details;

    return createValidationError(path, code, message, details);
}

export function isPlainObject(value) {
    if (value === null || typeof value !== "object") return false;

    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}

export function isNonEmptyString(value) {
    return typeof value === "string" && value.trim().length > 0;
}

export function isFiniteNonNegativeNumber(value) {
    return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function createValidationError(path, code, message, details = null) {
    return {
        path: normalizePath(path),
        code: isNonEmptyString(code) ? code : "invalid_validation_error",
        message: isNonEmptyString(message) ? message : "Invalid validation error",
        details: isPlainObject(details) ? { ...details } : null
    };
}

export function createValidationResult(errors, value = null) {
    const normalizedErrors = Array.isArray(errors)
        ? errors.map((error) => normalizeValidationError(error))
        : [
              createValidationError(
                  "",
                  "invalid_validation_result",
                  "Validation result errors must be an array"
              )
          ];

    return {
        ok: normalizedErrors.length === 0,
        value: normalizedErrors.length === 0 ? value : null,
        errors: normalizedErrors
    };
}

export function assertValidation(result, label = "Contract validation failed") {
    if (result?.ok === true) return result.value;

    const errors = Array.isArray(result?.errors) ? result.errors : [];
    const detail = errors.length > 0
        ? errors.map((error) => `${error.path || "<root>"}: ${error.message}`).join("; ")
        : "No validation error details were provided";
    const err = new Error(`${label}: ${detail}`);
    err.validationErrors = errors;
    throw err;
}

export function hasForbiddenPathLikeValue(value) {
    if (typeof value !== "string") return false;

    const trimmed = value.trim();
    if (!trimmed) return false;

    if (trimmed.includes("\0")) return true;
    if (trimmed.startsWith("/") || trimmed.startsWith("\\")) return true;
    if (trimmed.startsWith("~/")) return true;
    if (/^[A-Za-z]:[\\/]/.test(trimmed)) return true;
    if (trimmed.includes("../") || trimmed.includes("..\\")) return true;
    if (/^(?:modelPath|baseModel|mmprojPath|projectorPath):/i.test(trimmed)) return true;

    return false;
}

export function collectForbiddenKeys(value, forbiddenKeys, path = "") {
    const forbiddenSet = forbiddenKeys instanceof Set
        ? forbiddenKeys
        : new Set(Array.isArray(forbiddenKeys) ? forbiddenKeys : []);
    const found = [];

    function visit(currentValue, currentPath) {
        if (Array.isArray(currentValue)) {
            for (let index = 0; index < currentValue.length; index++) {
                visit(currentValue[index], formatChildPath(currentPath, index));
            }
            return;
        }

        if (!isPlainObject(currentValue)) return;

        for (const [key, childValue] of Object.entries(currentValue)) {
            const childPath = formatChildPath(currentPath, key);

            if (DANGEROUS_KEYS.has(key) || forbiddenSet.has(key)) {
                found.push({
                    path: childPath,
                    key
                });
            }

            visit(childValue, childPath);
        }
    }

    visit(value, normalizePath(path));
    return found;
}
