import { applyConfigOverride } from "./configOverride.mjs";

const VALID_STRATEGIES = new Set([
    "same-config-cold-worker",
    "degraded-config-cold-worker",
    "hardware-aware-cold-worker"
]);

const HARDWARE_AWARE_KEYS = new Set([
    "enabled",
    "probe",
    "maxProfiles",
    "allowCpuModelLoadFallback",
    "allowBatchReduction",
    "allowContextAutoFallback"
]);

function isPlainObject(value) {
    if (value === null || typeof value !== "object") return false;

    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}

function hasOwnKeys(value) {
    return isPlainObject(value) && Object.keys(value).length > 0;
}

function assertPlainObjectOrUndefined(value, name) {
    if (value !== undefined && !isPlainObject(value)) {
        throw new Error(`${name} must be a plain object`);
    }
}

function assertPositiveInteger(value, name) {
    if (!Number.isInteger(value) || value < 1) {
        throw new Error(`${name} must be a positive integer`);
    }
}

function assertNonNegativeInteger(value, name) {
    if (!Number.isInteger(value) || value < 0) {
        throw new Error(`${name} must be an integer >= 0`);
    }
}

function normalizeBoolean(value, fallback, name) {
    if (value === undefined) return fallback;
    if (typeof value !== "boolean") {
        throw new Error(`${name} must be a boolean`);
    }
    return value;
}

function validateHardwareAwareKeys(hardwareAware) {
    if (hardwareAware === undefined) return;

    for (const key of Object.keys(hardwareAware)) {
        if (!HARDWARE_AWARE_KEYS.has(key)) {
            throw new Error(`Unsupported hardwareAware option: ${key}`);
        }
    }
}

function buildCpuSafePatch() {
    return {
        modelLoad: {
            gpuLayers: 0,
            useMlock: false
        },
        context: {
            flashAttention: false
        }
    };
}

function buildMemorySafePatch({
    probe,
    allowCpuModelLoadFallback,
    allowBatchReduction,
    allowContextAutoFallback
}) {
    const patch = {};
    const context = {};
    const recommendedThreads = probe?.cpu?.recommendedThreads;

    if (allowCpuModelLoadFallback) {
        patch.modelLoad = {
            gpuLayers: 0,
            useMlock: false
        };
    }

    if (allowBatchReduction) {
        context.batchSize = 256;
    }

    if (allowContextAutoFallback) {
        context.contextSize = "auto";
        context.failedCreationRemedy = {
            retries: 6,
            autoContextSizeShrink: 0.16
        };
    }

    if (allowBatchReduction || allowContextAutoFallback || allowCpuModelLoadFallback) {
        context.threads = Number.isInteger(recommendedThreads) && recommendedThreads > 0
            ? {
                  ideal: recommendedThreads,
                  min: 1
              }
            : {
                  ideal: 0,
                  min: 1
              };
        context.flashAttention = false;
    }

    if (Object.keys(context).length > 0) {
        patch.context = context;
    }

    return patch;
}

function normalizeProfileOptions(options = {}) {
    assertPlainObjectOrUndefined(options, "options");
    assertPlainObjectOrUndefined(options.hardwareAware, "hardwareAware");
    validateHardwareAwareKeys(options.hardwareAware);

    const strategy = options.strategy ?? "same-config-cold-worker";

    if (!VALID_STRATEGIES.has(strategy)) {
        throw new Error(`Unsupported init retry strategy: ${strategy}`);
    }

    if (options.attempts !== undefined) {
        assertPositiveInteger(options.attempts, "attempts");
    }

    if (options.readyTimeoutMs !== undefined) {
        assertNonNegativeInteger(options.readyTimeoutMs, "readyTimeoutMs");
    }

    if (options.retryDelayMs !== undefined) {
        assertNonNegativeInteger(options.retryDelayMs, "retryDelayMs");
    }

    const hardwareAware = {
        enabled: normalizeBoolean(options.hardwareAware?.enabled, false, "hardwareAware.enabled"),
        probe: normalizeBoolean(options.hardwareAware?.probe, true, "hardwareAware.probe"),
        maxProfiles: options.hardwareAware?.maxProfiles ?? 3,
        allowCpuModelLoadFallback: normalizeBoolean(
            options.hardwareAware?.allowCpuModelLoadFallback,
            true,
            "hardwareAware.allowCpuModelLoadFallback"
        ),
        allowBatchReduction: normalizeBoolean(
            options.hardwareAware?.allowBatchReduction,
            true,
            "hardwareAware.allowBatchReduction"
        ),
        allowContextAutoFallback: normalizeBoolean(
            options.hardwareAware?.allowContextAutoFallback,
            true,
            "hardwareAware.allowContextAutoFallback"
        )
    };

    assertPositiveInteger(hardwareAware.maxProfiles, "hardwareAware.maxProfiles");

    return {
        ...options,
        strategy,
        hardwareAware
    };
}

function capProfiles(profiles, maxProfiles) {
    assertPositiveInteger(maxProfiles, "maxProfiles");
    return profiles.slice(0, maxProfiles);
}

export function buildInitProfiles({
    baseConfig,
    configOverride,
    probe = null,
    options = {}
}) {
    const normalized = normalizeProfileOptions(options);
    const hasOverride = hasOwnKeys(configOverride);

    const startingConfig = applyConfigOverride(baseConfig, configOverride);
    const profiles = [];

    profiles.push({
        name: hasOverride ? "user-override" : "base",
        reason: hasOverride ? "User-provided configOverride" : "Base config",
        effectiveConfig: startingConfig
    });

    if (normalized.strategy === "same-config-cold-worker") {
        return profiles;
    }

    if (normalized.hardwareAware.allowCpuModelLoadFallback) {
        profiles.push({
            name: hasOverride ? "hardware-safe-from-override" : "hardware-safe",
            reason: "Safe model-load fallback",
            effectiveConfig: applyConfigOverride(startingConfig, buildCpuSafePatch())
        });
    }

    if (
        normalized.hardwareAware.allowBatchReduction ||
        normalized.hardwareAware.allowContextAutoFallback
    ) {
        profiles.push({
            name: hasOverride ? "memory-safe-from-override" : "memory-safe",
            reason: "Memory-safe context/batch fallback",
            effectiveConfig: applyConfigOverride(
                startingConfig,
                buildMemorySafePatch({
                    probe,
                    allowCpuModelLoadFallback: normalized.hardwareAware.allowCpuModelLoadFallback,
                    allowBatchReduction: normalized.hardwareAware.allowBatchReduction,
                    allowContextAutoFallback: normalized.hardwareAware.allowContextAutoFallback
                })
            )
        });
    }

    return capProfiles(profiles, normalized.hardwareAware.maxProfiles);
}

export function buildInitAttemptPlan({
    strategy = "same-config-cold-worker",
    profiles,
    attempts,
    readyTimeoutMs,
    retryDelayMs,
    nextAttemptId
}) {
    if (!VALID_STRATEGIES.has(strategy)) {
        throw new Error(`Unsupported init retry strategy: ${strategy}`);
    }

    if (!Array.isArray(profiles) || profiles.length === 0) {
        throw new Error("buildInitAttemptPlan requires at least one profile");
    }

    assertNonNegativeInteger(readyTimeoutMs, "readyTimeoutMs");
    assertNonNegativeInteger(retryDelayMs, "retryDelayMs");

    if (attempts !== undefined) {
        assertPositiveInteger(attempts, "attempts");
    }

    if (typeof nextAttemptId !== "function") {
        throw new Error("buildInitAttemptPlan requires nextAttemptId() function");
    }

    const totalAttempts = strategy === "same-config-cold-worker"
        ? (attempts ?? 1)
        : (attempts ?? profiles.length);

    assertPositiveInteger(totalAttempts, "totalAttempts");

    const selectedProfiles = strategy === "same-config-cold-worker"
        ? Array.from({ length: totalAttempts }, () => profiles[0])
        : profiles.slice(0, totalAttempts);

    return selectedProfiles.map((profile, index) => ({
        attemptNumber: index + 1,
        initAttemptId: nextAttemptId(),
        profileName: profile.name,
        reason: profile.reason,
        effectiveConfig: profile.effectiveConfig,
        readyTimeoutMs,
        retryDelayMs
    }));
}
