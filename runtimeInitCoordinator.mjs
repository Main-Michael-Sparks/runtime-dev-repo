import { isPlainObject } from "./configOverride.mjs";
import { probeHardware } from "./hardwareProbe.mjs";
import {
    buildInitProfiles,
    buildInitAttemptPlan
} from "./retryProfiles.mjs";

const VALID_INIT_OPTION_KEYS = new Set([
    "enabled",
    "attempts",
    "readyTimeoutMs",
    "retryDelayMs",
    "strategy",
    "configOverride",
    "hardwareAware"
]);

const VALID_HARDWARE_AWARE_KEYS = new Set([
    "enabled",
    "probe",
    "maxProfiles",
    "allowCpuModelLoadFallback",
    "allowBatchReduction",
    "allowContextAutoFallback"
]);

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout(promise, timeoutMs, label) {
    if (!timeoutMs || timeoutMs <= 0) return promise;

    let timer;

    const timeoutPromise = new Promise((_, reject) => {
        timer = setTimeout(() => {
            reject(new Error(`${label} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
    });

    return Promise.race([promise, timeoutPromise]).finally(() => {
        clearTimeout(timer);
    });
}

function assertPlainObjectOrUndefined(value, name) {
    if (value !== undefined && !isPlainObject(value)) {
        throw new Error(`${name} must be a plain object`);
    }
}

function assertBoolean(value, name) {
    if (typeof value !== "boolean") {
        throw new Error(`${name} must be a boolean`);
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

function assertAllowedKeys(value, allowedKeys, name) {
    if (value === undefined) return;

    for (const key of Object.keys(value)) {
        if (!allowedKeys.has(key)) {
            throw new Error(`Unsupported ${name} option: ${key}`);
        }
    }
}

function normalizeBoolean(value, fallback, name) {
    if (value === undefined) return fallback;
    assertBoolean(value, name);
    return value;
}

function normalizeHardwareAwareOptions(defaults = {}, overrides = {}) {
    assertPlainObjectOrUndefined(defaults, "runtime.initRetry.hardwareAware");
    assertPlainObjectOrUndefined(overrides, "hardwareAware");
    assertAllowedKeys(overrides, VALID_HARDWARE_AWARE_KEYS, "hardwareAware");

    const merged = {
        enabled: defaults.enabled ?? false,
        probe: defaults.probe ?? true,
        maxProfiles: defaults.maxProfiles ?? 3,
        allowCpuModelLoadFallback: defaults.allowCpuModelLoadFallback ?? true,
        allowBatchReduction: defaults.allowBatchReduction ?? true,
        allowContextAutoFallback: defaults.allowContextAutoFallback ?? true,
        ...overrides
    };

    merged.enabled = normalizeBoolean(merged.enabled, false, "hardwareAware.enabled");
    merged.probe = normalizeBoolean(merged.probe, true, "hardwareAware.probe");
    merged.allowCpuModelLoadFallback = normalizeBoolean(
        merged.allowCpuModelLoadFallback,
        true,
        "hardwareAware.allowCpuModelLoadFallback"
    );
    merged.allowBatchReduction = normalizeBoolean(
        merged.allowBatchReduction,
        true,
        "hardwareAware.allowBatchReduction"
    );
    merged.allowContextAutoFallback = normalizeBoolean(
        merged.allowContextAutoFallback,
        true,
        "hardwareAware.allowContextAutoFallback"
    );

    assertPositiveInteger(merged.maxProfiles, "hardwareAware.maxProfiles");

    return merged;
}

function hasMeaningfulInitOptions(options = {}) {
    assertPlainObjectOrUndefined(options, "init options");
    return Object.keys(options).length > 0;
}

function hasCustomProfileOptions(options = {}) {
    assertPlainObjectOrUndefined(options, "init options");

    if (options.configOverride !== undefined && options.configOverride !== null) return true;
    if (options.strategy !== undefined && options.strategy !== "same-config-cold-worker") return true;
    if (options.hardwareAware !== undefined) return true;

    return false;
}

function nextAttemptId(ctx) {
    return ctx.lifecycle.nextAttemptId();
}

function resolveInitOptions(ctx, options = {}) {
    assertPlainObjectOrUndefined(options, "init options");
    assertAllowedKeys(options, VALID_INIT_OPTION_KEYS, "init");

    const defaults = ctx.config.runtime.initRetry ?? {};
    const strategy = options.strategy ?? defaults.strategy ?? "same-config-cold-worker";

    const enabled = options.enabled ?? defaults.enabled ?? false;
    assertBoolean(enabled, "enabled");

    const readyTimeoutMs = options.readyTimeoutMs ?? defaults.readyTimeoutMs ?? 0;
    const retryDelayMs = options.retryDelayMs ?? defaults.retryDelayMs ?? 0;

    assertNonNegativeInteger(readyTimeoutMs, "readyTimeoutMs");
    assertNonNegativeInteger(retryDelayMs, "retryDelayMs");

    let attempts;

    if (!enabled) {
        attempts = 1;
    } else if (options.attempts !== undefined) {
        attempts = options.attempts;
    } else if (strategy === "same-config-cold-worker") {
        attempts = defaults.attempts ?? 1;
    } else {
        attempts = undefined;
    }

    if (attempts !== undefined) {
        assertPositiveInteger(attempts, "attempts");
    }

    return {
        enabled,
        attempts,
        readyTimeoutMs,
        retryDelayMs,
        strategy,
        configOverride: options.configOverride,
        hardwareAware: normalizeHardwareAwareOptions(
            defaults.hardwareAware ?? {},
            options.hardwareAware ?? {}
        ),
        hasCustomProfileOptions: hasCustomProfileOptions(options)
    };
}

function resetInitBarrier(ctx) {
    ctx.lifecycle.resetInitBarrier();
    ctx.scheduler.setReady(false);
}

function shouldProbeForHardwareAwareInit(initOptions) {
    return initOptions.strategy === "hardware-aware-cold-worker" &&
        initOptions.hardwareAware.probe;
}

function shouldProbeForContextCreationRetry(effectiveConfig) {
    const creationRetry = effectiveConfig?.context?.creationRetry;

    return creationRetry?.enabled !== false &&
        creationRetry?.allowHardwareDerivedBounds === true;
}

function shouldProbeForInitPlan(ctx, initOptions, effectiveConfigCandidate = ctx.config) {
    return shouldProbeForHardwareAwareInit(initOptions) ||
        shouldProbeForContextCreationRetry(effectiveConfigCandidate);
}

function createWorkerConfigSnapshot(effectiveConfig, probe) {
    if (!probe) return effectiveConfig;

    return {
        ...effectiveConfig,
        hardwareProbe: probe
    };
}

async function createInitPlan(ctx, initOptions) {
    const probe = shouldProbeForInitPlan(ctx, initOptions, ctx.config)
        ? await probeHardware(initOptions.hardwareAware)
        : null;

    const profiles = buildInitProfiles({
        baseConfig: ctx.config,
        configOverride: initOptions.configOverride,
        probe,
        options: initOptions
    });

    const attemptPlan = buildInitAttemptPlan({
        strategy: initOptions.strategy,
        profiles,
        attempts: initOptions.attempts,
        readyTimeoutMs: initOptions.readyTimeoutMs,
        retryDelayMs: initOptions.retryDelayMs,
        nextAttemptId: () => nextAttemptId(ctx)
    });

    return {
        ...initOptions,
        probe,
        profiles,
        attempts: attemptPlan.length,
        attemptPlan
    };
}

function createFixedInitPlanFromLastSuccess(ctx) {
    const { lifecycle } = ctx;

    if (!lifecycle.lastSuccessfulInitPlan || !lifecycle.lastSuccessfulEffectiveConfig) {
        return null;
    }

    const profileName = lifecycle.lastSuccessfulInitPlan.profileName ?? "last-successful";
    const profile = {
        name: profileName,
        reason: "Last successful effective config",
        effectiveConfig: lifecycle.lastSuccessfulEffectiveConfig
    };

    const attemptPlan = buildInitAttemptPlan({
        strategy: "same-config-cold-worker",
        profiles: [profile],
        attempts: 1,
        readyTimeoutMs: lifecycle.lastSuccessfulInitPlan.readyTimeoutMs ?? 0,
        retryDelayMs: 0,
        nextAttemptId: () => nextAttemptId(ctx)
    });

    return {
        enabled: true,
        strategy: "same-config-cold-worker",
        attempts: 1,
        readyTimeoutMs: lifecycle.lastSuccessfulInitPlan.readyTimeoutMs ?? 0,
        retryDelayMs: 0,
        configOverride: undefined,
        hardwareAware: lifecycle.lastSuccessfulInitPlan.hardwareAware ?? {},
        hasCustomProfileOptions: true,
        probe: lifecycle.lastSuccessfulProbe,
        profiles: [profile],
        attemptPlan
    };
}

async function attemptInitOnce(ctx, attempt) {
    const { lifecycle } = ctx;

    resetInitBarrier(ctx);
    lifecycle.initStarted = true;
    lifecycle.activeInitAttemptId = attempt.initAttemptId;

    ctx.sendToWorker({
        type: "init",
        initAttemptId: attempt.initAttemptId,
        profileName: attempt.profileName,
        configSnapshot: createWorkerConfigSnapshot(
            attempt.effectiveConfig,
            lifecycle.activeInitPlan?.probe ?? null
        )
    });

    return withTimeout(
        lifecycle.readyPromise,
        attempt.readyTimeoutMs,
        "Model initialization"
    );
}

function buildFinalInitError(initPlan, attemptedProfiles, lastError) {
    const err = new Error(
        `Model init failed after ${attemptedProfiles.length} attempt(s). ` +
        `Strategy: ${initPlan.strategy}. ` +
        `Attempted profiles: ${attemptedProfiles.join(", ")}. ` +
        `Last error: ${lastError?.message ?? String(lastError)}`
    );

    err.strategy = initPlan.strategy;
    err.attemptedProfiles = attemptedProfiles;
    err.lastError = lastError;

    return err;
}

async function runInitCycle(ctx, initPlan) {
    const { lifecycle } = ctx;

    let lastError = null;
    const attemptedProfiles = [];

    lifecycle.activeInitPlan = initPlan;

    for (let index = 0; index < initPlan.attemptPlan.length; index++) {
        const attempt = initPlan.attemptPlan[index];
        attemptedProfiles.push(attempt.profileName);

        try {
            await attemptInitOnce(ctx, attempt);

            lifecycle.lastSuccessfulInitPlan = {
                strategy: initPlan.strategy,
                profileName: attempt.profileName,
                effectiveConfig: attempt.effectiveConfig,
                readyTimeoutMs: attempt.readyTimeoutMs,
                retryDelayMs: attempt.retryDelayMs,
                hardwareAware: initPlan.hardwareAware,
                attemptedProfiles: [...attemptedProfiles],
                probe: initPlan.probe ?? null
            };
            lifecycle.lastSuccessfulEffectiveConfig = attempt.effectiveConfig;
            lifecycle.lastSuccessfulProbe = initPlan.probe ?? null;
            lifecycle.lastFailedExplicitInit = null;
            lifecycle.activeInitAttemptId = null;
            lifecycle.activeInitPlan = null;
            return;
        } catch (err) {
            lastError = err;
            lifecycle.activeInitAttemptId = null;

            try {
                await ctx.terminateWorker();
            } catch (terminateErr) {
                lastError = terminateErr;
            }

            if (index >= initPlan.attemptPlan.length - 1) {
                break;
            }

            ctx.recreateWorker();

            if (attempt.retryDelayMs > 0) {
                await sleep(attempt.retryDelayMs);
            }
        }
    }

    resetInitBarrier(ctx);
    lifecycle.activeInitPlan = null;

    throw buildFinalInitError(initPlan, attemptedProfiles, lastError);
}

export async function startInitCycle(ctx, initPlan) {
    const { lifecycle } = ctx;

    lifecycle.initInProgress = true;
    lifecycle.initCyclePromise = runInitCycle(ctx, initPlan);

    try {
        return await lifecycle.initCyclePromise;
    } finally {
        lifecycle.initInProgress = false;
        lifecycle.initCyclePromise = null;
    }
}

export async function ensureModelReadyCoordinator(ctx) {
    const { lifecycle } = ctx;

    if (lifecycle.initResolved) return;

    if (lifecycle.initInProgress) {
        return lifecycle.initCyclePromise ?? lifecycle.readyPromise;
    }

    if (lifecycle.initStarted) {
        return lifecycle.readyPromise;
    }

    if (lifecycle.lastFailedExplicitInit && !lifecycle.lastSuccessfulInitPlan) {
        throw new Error(
            `Model is not initialized after failed explicit init. ` +
            `Call initModel() with corrected options before prompting. ` +
            `Last failure: ${lifecycle.lastFailedExplicitInit.error?.message ?? String(lifecycle.lastFailedExplicitInit.error)}`
        );
    }

    lifecycle.initInProgress = true;
    lifecycle.initCyclePromise = (async () => {
        const initPlan = lifecycle.lastSuccessfulInitPlan
            ? createFixedInitPlanFromLastSuccess(ctx)
            : await createInitPlan(ctx, resolveInitOptions(ctx));

        return runInitCycle(ctx, initPlan);
    })();

    try {
        return await lifecycle.initCyclePromise;
    } finally {
        lifecycle.initInProgress = false;
        lifecycle.initCyclePromise = null;
    }
}

export async function initModelCoordinator(ctx, options = {}) {
    const { lifecycle } = ctx;

    ctx.assertRuntimeHealthy(lifecycle);

    if (lifecycle.runtimeShuttingDown) {
        throw new Error("Runtime is shutting down");
    }

    if (lifecycle.runtimeResetting) {
        throw new Error("Runtime is resetting");
    }

    if (lifecycle.initResolved) {
        if (hasMeaningfulInitOptions(options)) {
            throw new Error("Model already initialized; resetModel() required before changing init config");
        }

        return lifecycle.readyPromise;
    }

    if (lifecycle.initStarted || lifecycle.initInProgress) {
        throw new Error("Model initialization already in progress");
    }

    const rawHadCustomProfileOptions = hasCustomProfileOptions(options);
    const initOptions = resolveInitOptions(ctx, options);
    let initPlan = null;

    lifecycle.initInProgress = true;
    lifecycle.initCyclePromise = (async () => {
        initPlan = await createInitPlan(ctx, initOptions);
        return runInitCycle(ctx, initPlan);
    })();

    try {
        return await lifecycle.initCyclePromise;
    } catch (err) {
        if (rawHadCustomProfileOptions || initOptions.hasCustomProfileOptions) {
            lifecycle.lastFailedExplicitInit = {
                hadMeaningfulOptions: true,
                strategy: initOptions.strategy,
                attemptedProfiles: err.attemptedProfiles ?? initPlan?.attemptPlan?.map((attempt) => attempt.profileName) ?? [],
                error: err
            };
        }

        throw err;
    } finally {
        lifecycle.initInProgress = false;
        lifecycle.initCyclePromise = null;
    }
}

export async function reinitializeModelAfterReset(ctx) {
    const initPlan = createFixedInitPlanFromLastSuccess(ctx) ??
        await createInitPlan(ctx, resolveInitOptions(ctx));

    await startInitCycle(ctx, initPlan);
}
