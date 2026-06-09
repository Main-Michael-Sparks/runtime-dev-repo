const DANGEROUS_KEYS = new Set([
    "__proto__",
    "prototype",
    "constructor"
]);

function formatPath(path) {
    return path.length > 0 ? path.join(".") : "configOverride";
}

function hasOwn(value, key) {
    return Object.prototype.hasOwnProperty.call(value, key);
}

export function isPlainObject(value) {
    if (value === null || typeof value !== "object") return false;

    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}

export function assertSafeMergeKey(key, path = []) {
    if (DANGEROUS_KEYS.has(key)) {
        throw new Error(`Unsafe configOverride key rejected at ${formatPath([...path, key])}`);
    }
}

function assertNoUnsafePrimitive(value, path) {
    if (value === undefined) {
        throw new Error(`Invalid undefined value at ${formatPath(path)}`);
    }

    if (typeof value === "number" && !Number.isFinite(value)) {
        throw new Error(`Invalid non-finite number at ${formatPath(path)}`);
    }

    if (typeof value === "function") {
        throw new Error(`Invalid function value at ${formatPath(path)}`);
    }

    if (typeof value === "symbol") {
        throw new Error(`Invalid symbol value at ${formatPath(path)}`);
    }
}

function assertBoolean(value, path) {
    if (typeof value !== "boolean") {
        throw new Error(`Expected boolean at ${formatPath(path)}`);
    }
}

function assertIntegerAtLeast(value, min, path) {
    if (!Number.isInteger(value) || value < min) {
        throw new Error(`Expected integer >= ${min} at ${formatPath(path)}`);
    }
}

function assertPositiveInteger(value, path) {
    assertIntegerAtLeast(value, 1, path);
}

function validateContextSize(value, path) {
    if (value === "auto") return;

    if (Number.isInteger(value) && value > 0) return;

    if (!isPlainObject(value)) {
        throw new Error(`Expected "auto", positive integer, or { min, max } at ${formatPath(path)}`);
    }

    const keys = Object.keys(value);
    for (const key of keys) {
        assertSafeMergeKey(key, path);
        if (key !== "min" && key !== "max") {
            throw new Error(`Unsupported contextSize key at ${formatPath([...path, key])}`);
        }
    }

    if (!hasOwn(value, "min") || !hasOwn(value, "max")) {
        throw new Error(`contextSize object requires min and max at ${formatPath(path)}`);
    }

    assertPositiveInteger(value.min, [...path, "min"]);
    assertPositiveInteger(value.max, [...path, "max"]);

    if (value.min > value.max) {
        throw new Error(`contextSize.min must be <= contextSize.max at ${formatPath(path)}`);
    }
}

function validateThreads(value, path) {
    if (Number.isInteger(value) && value >= 0) return;

    if (!isPlainObject(value)) {
        throw new Error(`Expected integer >= 0 or { ideal, min } at ${formatPath(path)}`);
    }

    const keys = Object.keys(value);
    for (const key of keys) {
        assertSafeMergeKey(key, path);
        if (key !== "ideal" && key !== "min") {
            throw new Error(`Unsupported threads key at ${formatPath([...path, key])}`);
        }
    }

    if (!hasOwn(value, "ideal") || !hasOwn(value, "min")) {
        throw new Error(`threads object requires ideal and min at ${formatPath(path)}`);
    }

    assertIntegerAtLeast(value.ideal, 0, [...path, "ideal"]);
    assertIntegerAtLeast(value.min, 1, [...path, "min"]);
}

const OVERRIDE_SCHEMA = {
    modelLoad: {
        gpuLayers: (value, path) => assertIntegerAtLeast(value, 0, path),
        useMmap: assertBoolean,
        useMlock: assertBoolean,
        ignoreMemorySafetyChecks: assertBoolean
    },
    context: {
        contextSize: validateContextSize,
        batchSize: assertPositiveInteger,
        threads: validateThreads,
        flashAttention: assertBoolean,
        performanceTracking: assertBoolean,
        sequences: assertPositiveInteger,
        failedCreationRemedy: {
            retries: (value, path) => assertIntegerAtLeast(value, 0, path),
            autoContextSizeShrink(value, path) {
                if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value >= 1) {
                    throw new Error(`Expected number > 0 and < 1 at ${formatPath(path)}`);
                }
            }
        },
        ignoreMemorySafetyChecks: assertBoolean
    }
};

function validateAgainstSchema(value, schema, path = []) {
    assertNoUnsafePrimitive(value, path);

    if (typeof schema === "function") {
        schema(value, path);
        return;
    }

    if (!isPlainObject(value)) {
        throw new Error(`Expected object at ${formatPath(path)}`);
    }

    for (const [key, childValue] of Object.entries(value)) {
        assertSafeMergeKey(key, path);

        const childSchema = schema[key];
        const childPath = [...path, key];

        if (!childSchema) {
            throw new Error(`Unsupported configOverride path: ${formatPath(childPath)}`);
        }

        validateAgainstSchema(childValue, childSchema, childPath);
    }
}

export function validateConfigOverride(configOverride) {
    if (configOverride === undefined) return;

    if (!isPlainObject(configOverride)) {
        throw new Error("configOverride must be a plain object");
    }

    validateAgainstSchema(configOverride, OVERRIDE_SCHEMA);
}

export function deepClonePlain(value, path = []) {
    assertNoUnsafePrimitive(value, path);

    if (Array.isArray(value)) {
        return value.map((item, index) => deepClonePlain(item, [...path, String(index)]));
    }

    if (isPlainObject(value)) {
        const out = {};

        for (const [key, childValue] of Object.entries(value)) {
            assertSafeMergeKey(key, path);
            out[key] = deepClonePlain(childValue, [...path, key]);
        }

        return out;
    }

    return value;
}

export function deepFreeze(value) {
    if (value === null || typeof value !== "object") return value;

    for (const childValue of Object.values(value)) {
        deepFreeze(childValue);
    }

    return Object.freeze(value);
}

function applyValidatedPatch(target, patch, path = []) {
    if (patch === undefined) return target;

    for (const [key, patchValue] of Object.entries(patch)) {
        assertSafeMergeKey(key, path);

        const childPath = [...path, key];
        const targetValue = target[key];

        if (isPlainObject(patchValue)) {
            if (!isPlainObject(targetValue)) {
                target[key] = deepClonePlain(patchValue, childPath);
                continue;
            }

            applyValidatedPatch(targetValue, patchValue, childPath);
            continue;
        }

        target[key] = deepClonePlain(patchValue, childPath);
    }

    return target;
}

export function applyConfigOverride(baseConfig, configOverride) {
    validateConfigOverride(configOverride);

    const effectiveConfig = deepClonePlain(baseConfig);
    applyValidatedPatch(effectiveConfig, configOverride);

    return deepFreeze(effectiveConfig);
}
