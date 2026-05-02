const DEFAULT_CREATION_RETRY = Object.freeze({
    enabled: true,
    maxAttempts: 4,
    fallbackContextSize: {
        min: 1024,
        max: 4096
    },
    allowHardwareDerivedBounds: true,
    minContextSize: 1024,
    maxContextSize: 4096,
    contextSizeShrinkRatio: 0.5,
    allowBatchReduction: true,
    fallbackBatchSize: 256,
    allowThreadFallback: true,
    fallbackThreads: {
        ideal: 0,
        min: 1
    },
    allowFlashAttentionFallback: true
});

const CONTEXT_CREATE_KEYS = [
    "contextSize",
    "batchSize",
    "threads",
    "flashAttention",
    "performanceTracking",
    "sequences",
    "failedCreationRemedy",
    "ignoreMemorySafetyChecks"
];

const CREATION_RETRY_KEYS = new Set([
    "enabled",
    "maxAttempts",
    "fallbackContextSize",
    "allowHardwareDerivedBounds",
    "minContextSize",
    "maxContextSize",
    "contextSizeShrinkRatio",
    "allowBatchReduction",
    "fallbackBatchSize",
    "allowThreadFallback",
    "fallbackThreads",
    "allowFlashAttentionFallback"
]);

function isPlainObject(value) {
    if (value === null || typeof value !== "object") return false;

    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}

function hasOwn(value, key) {
    return Object.prototype.hasOwnProperty.call(value, key);
}

function clonePlain(value) {
    if (Array.isArray(value)) {
        return value.map((item) => clonePlain(item));
    }

    if (isPlainObject(value)) {
        const out = {};

        for (const [key, child] of Object.entries(value)) {
            out[key] = clonePlain(child);
        }

        return out;
    }

    return value;
}

function assertPlainObject(value, name) {
    if (!isPlainObject(value)) {
        throw new Error(`${name} must be a plain object`);
    }
}

function assertPositiveInteger(value, name) {
    if (!Number.isInteger(value) || value < 1) {
        throw new Error(`${name} must be a positive integer`);
    }
}

function assertBoolean(value, name) {
    if (typeof value !== "boolean") {
        throw new Error(`${name} must be a boolean`);
    }
}

function assertRatio(value, name) {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value >= 1) {
        throw new Error(`${name} must be a number > 0 and < 1`);
    }
}

function validateContextSizeBound(value, name) {
    assertPlainObject(value, name);

    for (const key of Object.keys(value)) {
        if (key !== "min" && key !== "max") {
            throw new Error(`Unsupported ${name} option: ${key}`);
        }
    }

    assertPositiveInteger(value.min, `${name}.min`);
    assertPositiveInteger(value.max, `${name}.max`);

    if (value.min > value.max) {
        throw new Error(`${name}.min must be <= ${name}.max`);
    }
}

function validateThreads(value, name) {
    if (Number.isInteger(value) && value >= 0) return;

    assertPlainObject(value, name);

    for (const key of Object.keys(value)) {
        if (key !== "ideal" && key !== "min") {
            throw new Error(`Unsupported ${name} option: ${key}`);
        }
    }

    if (!Number.isInteger(value.ideal) || value.ideal < 0) {
        throw new Error(`${name}.ideal must be an integer >= 0`);
    }

    if (!Number.isInteger(value.min) || value.min < 1) {
        throw new Error(`${name}.min must be an integer >= 1`);
    }
}

function clampInteger(value, min, max) {
    return Math.max(min, Math.min(max, Math.floor(value)));
}

function isBoundedContextSize(value) {
    return isPlainObject(value) &&
        Number.isInteger(value.min) &&
        Number.isInteger(value.max) &&
        value.min > 0 &&
        value.max > 0 &&
        value.min <= value.max;
}

function stableStringify(value) {
    if (Array.isArray(value)) {
        return `[${value.map((item) => stableStringify(item)).join(",")}]`;
    }

    if (isPlainObject(value)) {
        return `{${Object.keys(value)
            .sort()
            .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
            .join(",")}}`;
    }

    return JSON.stringify(value);
}

function toContextCreateEquivalent(contextConfig) {
    const out = {};

    for (const key of CONTEXT_CREATE_KEYS) {
        if (hasOwn(contextConfig, key)) {
            out[key] = contextConfig[key];
        }
    }

    return out;
}

function deriveBoundFromFixedContextSize(baseContextSize, creationRetry) {
    if (!Number.isInteger(baseContextSize) || baseContextSize < 1) return null;

    const max = clampInteger(
        baseContextSize * creationRetry.contextSizeShrinkRatio,
        creationRetry.minContextSize,
        creationRetry.maxContextSize
    );

    const min = Math.min(creationRetry.minContextSize, max);

    return { min, max };
}

function deriveBoundFromBoundedContextSize(baseContextSize, creationRetry) {
    if (!isBoundedContextSize(baseContextSize)) return null;

    const shrunkenMax = clampInteger(
        baseContextSize.max * creationRetry.contextSizeShrinkRatio,
        creationRetry.minContextSize,
        creationRetry.maxContextSize
    );

    const shrunkenMin = clampInteger(
        baseContextSize.min * creationRetry.contextSizeShrinkRatio,
        creationRetry.minContextSize,
        creationRetry.maxContextSize
    );

    return {
        min: Math.min(shrunkenMin, shrunkenMax),
        max: shrunkenMax
    };
}

function deriveBoundFromHardwareProbe(hardwareProbe, creationRetry) {
    if (!creationRetry.allowHardwareDerivedBounds) return null;

    const safeBudgetBytes = hardwareProbe?.memory?.safeBudgetBytes;
    if (!Number.isFinite(safeBudgetBytes) || safeBudgetBytes <= 0) return null;

    const gib = safeBudgetBytes / (1024 ** 3);

    let targetMax;
    if (gib >= 12) {
        targetMax = 8192;
    } else if (gib >= 8) {
        targetMax = 6144;
    } else if (gib >= 4) {
        targetMax = 4096;
    } else if (gib >= 2) {
        targetMax = 2048;
    } else {
        targetMax = creationRetry.minContextSize;
    }

    const max = clampInteger(targetMax, creationRetry.minContextSize, creationRetry.maxContextSize);
    const min = Math.min(creationRetry.minContextSize, max);

    return { min, max };
}

export function normalizeContextCreationRetryOptions(contextConfig = {}) {
    assertPlainObject(contextConfig, "contextConfig");

    const raw = contextConfig.creationRetry ?? {};
    assertPlainObject(raw, "context.creationRetry");

    for (const key of Object.keys(raw)) {
        if (!CREATION_RETRY_KEYS.has(key)) {
            throw new Error(`Unsupported context.creationRetry option: ${key}`);
        }
    }

    const creationRetry = {
        ...clonePlain(DEFAULT_CREATION_RETRY),
        ...clonePlain(raw)
    };

    assertBoolean(creationRetry.enabled, "context.creationRetry.enabled");
    assertPositiveInteger(creationRetry.maxAttempts, "context.creationRetry.maxAttempts");

    if (creationRetry.fallbackContextSize !== undefined && creationRetry.fallbackContextSize !== null) {
        validateContextSizeBound(
            creationRetry.fallbackContextSize,
            "context.creationRetry.fallbackContextSize"
        );
    }

    assertBoolean(
        creationRetry.allowHardwareDerivedBounds,
        "context.creationRetry.allowHardwareDerivedBounds"
    );
    assertPositiveInteger(creationRetry.minContextSize, "context.creationRetry.minContextSize");
    assertPositiveInteger(creationRetry.maxContextSize, "context.creationRetry.maxContextSize");

    if (creationRetry.minContextSize > creationRetry.maxContextSize) {
        throw new Error("context.creationRetry.minContextSize must be <= maxContextSize");
    }

    assertRatio(
        creationRetry.contextSizeShrinkRatio,
        "context.creationRetry.contextSizeShrinkRatio"
    );
    assertBoolean(creationRetry.allowBatchReduction, "context.creationRetry.allowBatchReduction");
    assertPositiveInteger(creationRetry.fallbackBatchSize, "context.creationRetry.fallbackBatchSize");
    assertBoolean(creationRetry.allowThreadFallback, "context.creationRetry.allowThreadFallback");
    validateThreads(creationRetry.fallbackThreads, "context.creationRetry.fallbackThreads");
    assertBoolean(
        creationRetry.allowFlashAttentionFallback,
        "context.creationRetry.allowFlashAttentionFallback"
    );

    if (creationRetry.fallbackContextSize) {
        creationRetry.fallbackContextSize = {
            min: clampInteger(
                creationRetry.fallbackContextSize.min,
                creationRetry.minContextSize,
                creationRetry.maxContextSize
            ),
            max: clampInteger(
                creationRetry.fallbackContextSize.max,
                creationRetry.minContextSize,
                creationRetry.maxContextSize
            )
        };

        if (creationRetry.fallbackContextSize.min > creationRetry.fallbackContextSize.max) {
            creationRetry.fallbackContextSize.min = creationRetry.fallbackContextSize.max;
        }
    }

    return creationRetry;
}

export function deriveBoundedContextSize({
    baseContextSize,
    creationRetry,
    hardwareProbe = null
}) {
    const normalized = normalizeContextCreationRetryOptions({
        creationRetry: creationRetry ?? {}
    });

    const hardwareBound = deriveBoundFromHardwareProbe(hardwareProbe, normalized);
    if (hardwareBound) return hardwareBound;

    if (normalized.fallbackContextSize) {
        return clonePlain(normalized.fallbackContextSize);
    }

    const fixedBound = deriveBoundFromFixedContextSize(baseContextSize, normalized);
    if (fixedBound) return fixedBound;

    const boundedBound = deriveBoundFromBoundedContextSize(baseContextSize, normalized);
    if (boundedBound) return boundedBound;

    return {
        min: normalized.minContextSize,
        max: normalized.maxContextSize
    };
}

function addUniqueProfile(profiles, profile) {
    const signature = stableStringify(toContextCreateEquivalent(profile.context));

    if (profiles.some((existing) => existing.signature === signature)) {
        return;
    }

    profiles.push({
        ...profile,
        signature
    });
}

function stripInternalProfileFields(profile) {
    const { signature, ...publicProfile } = profile;
    return publicProfile;
}

function getFallbackBatchSize(baseContext, creationRetry) {
    const baseBatchSize = baseContext.batchSize;

    if (Number.isInteger(baseBatchSize) && baseBatchSize > 0) {
        return Math.min(baseBatchSize, creationRetry.fallbackBatchSize);
    }

    return creationRetry.fallbackBatchSize;
}

export function buildContextRetryProfiles({
    baseContextConfig,
    creationRetry,
    hardwareProbe = null
}) {
    assertPlainObject(baseContextConfig, "baseContextConfig");

    const normalizedRetry = normalizeContextCreationRetryOptions({
        ...baseContextConfig,
        creationRetry: creationRetry ?? baseContextConfig.creationRetry
    });

    const profiles = [];
    const baseContext = clonePlain(baseContextConfig);
    delete baseContext.creationRetry;

    const fallbackBatchSize = getFallbackBatchSize(baseContext, normalizedRetry);

    addUniqueProfile(profiles, {
        name: "base-context",
        reason: "Current active context config",
        context: baseContext
    });

    if (!normalizedRetry.enabled) {
        return profiles.map(stripInternalProfileFields);
    }

    if (normalizedRetry.allowBatchReduction) {
        addUniqueProfile(profiles, {
            name: "batch-safe-context",
            reason: "Reduced context batch size",
            context: {
                ...clonePlain(baseContext),
                batchSize: fallbackBatchSize
            }
        });
    }

    const boundedContextSize = deriveBoundedContextSize({
        baseContextSize: baseContext.contextSize,
        creationRetry: normalizedRetry,
        hardwareProbe
    });

    addUniqueProfile(profiles, {
        name: "bounded-context-safe",
        reason: "Bounded context size fallback",
        context: {
            ...clonePlain(baseContext),
            contextSize: boundedContextSize,
            ...(normalizedRetry.allowBatchReduction
                ? { batchSize: fallbackBatchSize }
                : {})
        }
    });

    const conservativeContext = {
        ...clonePlain(baseContext),
        contextSize: boundedContextSize,
        ...(normalizedRetry.allowBatchReduction
            ? { batchSize: fallbackBatchSize }
            : {}),
        ...(normalizedRetry.allowThreadFallback
            ? { threads: clonePlain(normalizedRetry.fallbackThreads) }
            : {}),
        ...(normalizedRetry.allowFlashAttentionFallback
            ? { flashAttention: false }
            : {})
    };

    addUniqueProfile(profiles, {
        name: "conservative-context",
        reason: "Conservative context creation fallback",
        context: conservativeContext
    });

    return profiles
        .slice(0, normalizedRetry.maxAttempts)
        .map(stripInternalProfileFields);
}
