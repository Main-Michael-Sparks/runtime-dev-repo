import { config } from "./config.mjs";
import { resolveNativeOperationHardStopConfig } from "./nativeOperationPolicy.mjs";
import {
    assertRuntimeHealthy,
    markRuntimeUnhealthy,
    waitForNativeOperationBoundary
} from "./nativeBoundaryCoordinator.mjs";
import {
    settleCompletedRequest,
    settleFailedRequest
} from "./runtimeRequestSettlement.mjs";
import { createRuntimeLifecycleState } from "./runtimeLifecycleState.mjs";
import { isPlainObject } from "./configOverride.mjs";
import { probeHardware } from "./hardwareProbe.mjs";
import {
    buildInitProfiles,
    buildInitAttemptPlan
} from "./retryProfiles.mjs";
import { normalizeToken } from "./normalizer.mjs";
import {
    traceQueued,
    traceRunning,
    traceDone,
    traceError,
    traceCanceled,
    traceDelete
} from "./observer.mjs";
import { createRequest } from "./request.mjs";
import {
    pushStream,
    closeStream,
    errorStream,
    cancelStream
} from "./streamController.mjs";
import {
    onWorkerMessage,
    sendToWorker,
    terminateWorker,
    recreateWorker
} from "./workerBridge.mjs";
import { createScheduler } from "./scheduler.mjs";

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

const VALID_SHUTDOWN_MODES = new Set([
    "abort",
    "drain",
    "drain-with-timeout"
]);

const lifecycle = createRuntimeLifecycleState();

const scheduler = createScheduler({
    maxInFlight: config.runtime.maxInFlight,
    sendToWorker,
    onDispatch(req) {
        traceRunning(req);
    }
});

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

function isSessionResetWaiterActive(waiter) {
    return waiter && waiter.timedOut !== true;
}

function assertNoActiveSessionResetInProgress(operationName) {
    for (const waiter of lifecycle.sessionResetWaiters.values()) {
        if (isSessionResetWaiterActive(waiter)) {
            throw new Error(`${operationName} cannot start while a session reset is in progress`);
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

function nextAttemptId() {
    return lifecycle.nextAttemptId();
}

function resolveInitOptions(options = {}) {
    assertPlainObjectOrUndefined(options, "init options");
    assertAllowedKeys(options, VALID_INIT_OPTION_KEYS, "init");

    const defaults = config.runtime.initRetry ?? {};
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

function resetInitBarrier() {
    lifecycle.resetInitBarrier();
    scheduler.setReady(false);
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

function shouldProbeForInitPlan(initOptions, effectiveConfigCandidate = config) {
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

async function createInitPlan(initOptions) {
    const probe = shouldProbeForInitPlan(initOptions, config)
        ? await probeHardware(initOptions.hardwareAware)
        : null;

    const profiles = buildInitProfiles({
        baseConfig: config,
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
        nextAttemptId
    });

    return {
        ...initOptions,
        probe,
        profiles,
        attempts: attemptPlan.length,
        attemptPlan
    };
}

function createFixedInitPlanFromLastSuccess() {
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
        nextAttemptId
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

async function attemptInitOnce(attempt) {
    resetInitBarrier();
    lifecycle.initStarted = true;
    lifecycle.activeInitAttemptId = attempt.initAttemptId;

    sendToWorker({
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

async function runInitCycle(initPlan) {
    let lastError = null;
    const attemptedProfiles = [];

    lifecycle.activeInitPlan = initPlan;

    for (let index = 0; index < initPlan.attemptPlan.length; index++) {
        const attempt = initPlan.attemptPlan[index];
        attemptedProfiles.push(attempt.profileName);

        try {
            await attemptInitOnce(attempt);

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
                await terminateWorker();
            } catch (terminateErr) {
                lastError = terminateErr;
            }

            if (index >= initPlan.attemptPlan.length - 1) {
                break;
            }

            recreateWorker();

            if (attempt.retryDelayMs > 0) {
                await sleep(attempt.retryDelayMs);
            }
        }
    }

    resetInitBarrier();
    lifecycle.activeInitPlan = null;

    throw buildFinalInitError(initPlan, attemptedProfiles, lastError);
}

async function startInitCycle(initPlan) {
    lifecycle.initInProgress = true;
    lifecycle.initCyclePromise = runInitCycle(initPlan);

    try {
        return await lifecycle.initCyclePromise;
    } finally {
        lifecycle.initInProgress = false;
        lifecycle.initCyclePromise = null;
    }
}

async function ensureModelReady() {
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
            ? createFixedInitPlanFromLastSuccess()
            : await createInitPlan(resolveInitOptions());

        return runInitCycle(initPlan);
    })();

    try {
        return await lifecycle.initCyclePromise;
    } finally {
        lifecycle.initInProgress = false;
        lifecycle.initCyclePromise = null;
    }
}

function toErrorObject(raw) {
    if (raw instanceof Error) return raw;

    if (raw && typeof raw === "object") {
        const err = new Error(raw.message || "Worker error");
        if (raw.stack) err.stack = raw.stack;
        if (raw.phase) err.phase = raw.phase;
        if (raw.sessionId) err.sessionId = raw.sessionId;
        return err;
    }

    return new Error(String(raw));
}

onWorkerMessage((msg) => {
    if (msg.type === "ready") {
        if (msg.initAttemptId !== lifecycle.activeInitAttemptId) return;

        lifecycle.initResolved = true;
        scheduler.setReady(true);
        lifecycle.resolveReady();
        return;
    }

    if (msg.type === "reset_done") {
        if (msg.sessionId) {
            lifecycle.sessionsResetting.delete(msg.sessionId);

            const waiter = lifecycle.sessionResetWaiters.get(msg.sessionId);
            if (waiter) {
                lifecycle.sessionResetWaiters.delete(msg.sessionId);

                if (!waiter.timedOut) {
                    waiter.resolve();
                }
            }
        }
        return;
    }

    if (msg.type === "model_reset_done") {
        const waiter = lifecycle.modelResetWaiter;
        lifecycle.modelResetWaiter = null;

        if (waiter) {
            waiter.resolve();
        }
        return;
    }

    if (msg.type === "shutdown_done") {
        const waiter = lifecycle.shutdownWaiter;
        lifecycle.shutdownWaiter = null;

        if (waiter) {
            waiter.resolve();
        }
        return;
    }

    if (msg.type === "stream") {
        const req = scheduler.getRequest(msg.id);
        if (!req || req.status === "canceled" || req.status === "done") return;

        const token = normalizeToken(msg.token, config);
        req.finalText += token;
        pushStream(req, token, config);
        return;
    }

    if (msg.type === "done") {
        const req = scheduler.complete(msg.id);
        if (!req) return;

        settleCompletedRequest(req, msg, {
            closeStream,
            traceDone,
            traceDelete
        });
        return;
    }

    if (msg.type === "error") {
        const err = toErrorObject(msg.error);

        if (msg.initAttemptId !== undefined && msg.initAttemptId !== null) {
            if (msg.initAttemptId !== lifecycle.activeInitAttemptId) return;
            lifecycle.rejectReady(err);
            return;
        }

        if ((msg.id === undefined || msg.id === null) && lifecycle.runtimeResetting && lifecycle.modelResetWaiter) {
            const waiter = lifecycle.modelResetWaiter;
            lifecycle.modelResetWaiter = null;
            waiter.reject(err);
            return;
        }

        if ((msg.id === undefined || msg.id === null) && lifecycle.runtimeShuttingDown && lifecycle.shutdownWaiter) {
            const waiter = lifecycle.shutdownWaiter;
            lifecycle.shutdownWaiter = null;
            waiter.reject(err);
            return;
        }

        if ((msg.id === undefined || msg.id === null) && !lifecycle.initResolved && !msg.sessionId) {
            lifecycle.rejectReady(err);
            return;
        }

        if ((msg.id === undefined || msg.id === null) && msg.sessionId && lifecycle.sessionResetWaiters.has(msg.sessionId)) {
            lifecycle.sessionsResetting.delete(msg.sessionId);

            const waiter = lifecycle.sessionResetWaiters.get(msg.sessionId);
            lifecycle.sessionResetWaiters.delete(msg.sessionId);

            if (!waiter.timedOut) {
                waiter.reject(err);
            }
            return;
        }

        const req = scheduler.fail(msg.id);
        if (!req) return;

        settleFailedRequest(req, err, {
            errorStream,
            traceError,
            traceDelete
        });
    }
});

export async function initModel(options = {}) {
    assertRuntimeHealthy(lifecycle);

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
    const initOptions = resolveInitOptions(options);
    let initPlan = null;

    lifecycle.initInProgress = true;
    lifecycle.initCyclePromise = (async () => {
        initPlan = await createInitPlan(initOptions);
        return runInitCycle(initPlan);
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

function assertPromptAdmissionAllowed(sessionId) {
    assertRuntimeHealthy(lifecycle);

    if (lifecycle.runtimeResetting) {
        throw new Error("Runtime is resetting");
    }

    if (lifecycle.runtimeShuttingDown) {
        throw new Error("Runtime is shutting down");
    }

    if (lifecycle.sessionsResetting.has(sessionId)) {
        throw new Error(`Session is resetting: ${sessionId}`);
    }
}

function assertNoSessionResetInProgress(operationName) {
    assertNoActiveSessionResetInProgress(operationName);
}

function notifyRequestCancellationRequested(req, reason = "Prompt canceled") {
    if (!req?.parentCancelPort || req.status !== "running") return;

    try {
        req.parentCancelPort.postMessage({
            type: "cancel",
            id: req.id,
            sessionId: req.sessionId,
            reason
        });
    } catch {
        // no-op: port may already be closed during cleanup
    }
}

function notifyRequestsCancellationRequested(requests, reason) {
    for (const req of requests) {
        notifyRequestCancellationRequested(req, reason);
    }
}

export async function prompt(text, options = {}) {
    const sessionId = options.sessionId || "default";

    assertPromptAdmissionAllowed(sessionId);

    await ensureModelReady();

    assertPromptAdmissionAllowed(sessionId);

    if (scheduler.queuedCount() >= config.runtime.maxQueueSize) {
        throw new Error("Backpressure: queue full");
    }

    const req = createRequest(text, options);
    traceQueued(req);
    scheduler.enqueue(req);

    return {
        id: req.id,
        stream: req.stream,
        done: req.done
    };
}

export function cancelPrompt(promptId) {
    const existing = scheduler.getRequest(promptId);
    notifyRequestCancellationRequested(existing, "Prompt canceled");

    sendToWorker({
        type: "cancel",
        id: promptId,
        sessionId: existing?.sessionId ?? null,
        reason: "Prompt canceled"
    });

    const req = scheduler.cancel(promptId);
    if (!req) return false;

    cancelStream(req);
    traceCanceled(req);
    req.rejectDone(new Error("Prompt canceled"));
    traceDelete(req.id);

    return true;
}

export async function resetSession(sessionId = "default") {
    assertRuntimeHealthy(lifecycle);

    if (lifecycle.runtimeResetting) {
        throw new Error("Runtime is resetting");
    }

    if (lifecycle.runtimeShuttingDown) {
        throw new Error("Runtime is shutting down");
    }

    const hardStopConfig = resolveNativeOperationHardStopConfig(config);

    const existing = lifecycle.sessionResetWaiters.get(sessionId);
    if (existing?.timedOut) {
        throw new Error(`Session is resetting: ${sessionId}`);
    }

    if (existing) {
        return existing.promise;
    }

    lifecycle.sessionsResetting.add(sessionId);

    let resolveReset;
    let rejectReset;
    const workerBoundary = new Promise((resolve, reject) => {
        resolveReset = resolve;
        rejectReset = reject;
    });

    workerBoundary.catch(() => {});

    const waiter = {
        promise: workerBoundary,
        resolve: resolveReset,
        reject: rejectReset,
        timedOut: false
    };

    lifecycle.sessionResetWaiters.set(sessionId, waiter);

    const canceled = scheduler.cancelBySession(sessionId);
    notifyRequestsCancellationRequested(canceled, `Session reset: ${sessionId}`);

    for (const req of canceled) {
        sendToWorker({
            type: "cancel",
            id: req.id,
            sessionId: req.sessionId,
            reason: `Session reset: ${sessionId}`
        });

        cancelStream(req);
        traceCanceled(req);
        req.rejectDone(new Error(`Session reset: ${sessionId}`));
        traceDelete(req.id);
    }

    sendToWorker({
        type: "reset_session",
        sessionId
    });

    const result = await waitForNativeOperationBoundary(
        workerBoundary,
        hardStopConfig.resetSessionTimeoutMs,
        `resetSession(${sessionId})`,
        hardStopConfig
    );

    if (result.timedOut) {
        waiter.timedOut = true;
        throw new Error(
            `Session reset timed out after ${hardStopConfig.resetSessionTimeoutMs}ms: ${sessionId}; ` +
            `session remains blocked until reset completes or process restart recovers it`
        );
    }
}

export async function resetModel() {
    assertRuntimeHealthy(lifecycle);

    if (lifecycle.runtimeResetting) {
        throw new Error("Runtime is resetting");
    }

    if (lifecycle.runtimeShuttingDown) {
        throw new Error("Runtime is shutting down");
    }

    const hardStopConfig = resolveNativeOperationHardStopConfig(config);
    assertNoSessionResetInProgress("Model reset");

    lifecycle.runtimeResetting = true;
    scheduler.setReady(false);

    const canceled = scheduler.cancelAll();
    notifyRequestsCancellationRequested(canceled, "Model reset");

    for (const req of canceled) {
        sendToWorker({
            type: "cancel",
            id: req.id,
            sessionId: req.sessionId,
            reason: "Model reset"
        });

        cancelStream(req);
        traceCanceled(req);
        req.rejectDone(new Error("Model reset"));
        traceDelete(req.id);
    }

    let resolveReset;
    let rejectReset;
    const waitForWorkerReset = new Promise((resolve, reject) => {
        resolveReset = resolve;
        rejectReset = reject;
    });

    waitForWorkerReset.catch(() => {});

    lifecycle.modelResetWaiter = {
        resolve: resolveReset,
        reject: rejectReset
    };

    try {
        sendToWorker({
            type: "reset_model"
        });

        const result = await waitForNativeOperationBoundary(
            waitForWorkerReset,
            hardStopConfig.resetModelTimeoutMs,
            "resetModel",
            hardStopConfig
        );

        if (result.timedOut) {
            const err = markRuntimeUnhealthy(lifecycle, {
                operation: "resetModel",
                timeoutMs: hardStopConfig.resetModelTimeoutMs
            });
            throw err;
        }

        lifecycle.sessionsResetting.clear();
        lifecycle.sessionResetWaiters.clear();

        await terminateWorker();
        recreateWorker();

        const initPlan = createFixedInitPlanFromLastSuccess() ?? await createInitPlan(resolveInitOptions());
        await startInitCycle(initPlan);
    } finally {
        lifecycle.runtimeResetting = false;
        lifecycle.modelResetWaiter = null;
    }
}

function validateShutdownOptions(options = {}) {
    assertPlainObjectOrUndefined(options, "shutdown options");

    const {
        mode = "abort",
        timeoutMs
    } = options;

    if (!VALID_SHUTDOWN_MODES.has(mode)) {
        throw new Error(`Unsupported shutdown mode: ${mode}`);
    }

    if (mode === "drain-with-timeout") {
        if (timeoutMs === undefined) {
            throw new Error("timeoutMs is required for drain-with-timeout shutdown");
        }

        assertPositiveInteger(timeoutMs, "timeoutMs");
    } else if (timeoutMs !== undefined) {
        throw new Error("timeoutMs is only supported for drain-with-timeout shutdown");
    }

    return { mode, timeoutMs };
}

function isInitActive() {
    return lifecycle.initInProgress || (lifecycle.initStarted && !lifecycle.initResolved);
}

function cancelRequestsForShutdown(reason) {
    const canceled = scheduler.cancelAll();
    notifyRequestsCancellationRequested(canceled, reason);

    for (const req of canceled) {
        sendToWorker({
            type: "cancel",
            id: req.id,
            sessionId: req.sessionId,
            reason
        });

        cancelStream(req);
        traceCanceled(req);
        req.rejectDone(new Error(reason));
        traceDelete(req.id);
    }

    return canceled;
}

async function finalizeWorkerShutdown() {
    const hardStopConfig = resolveNativeOperationHardStopConfig(config);

    let resolveShutdown;
    let rejectShutdown;
    const waitForShutdown = new Promise((resolve, reject) => {
        resolveShutdown = resolve;
        rejectShutdown = reject;
    });

    waitForShutdown.catch(() => {});

    lifecycle.shutdownWaiter = {
        resolve: resolveShutdown,
        reject: rejectShutdown
    };

    try {
        sendToWorker({
            type: "shutdown"
        });

        const result = await waitForNativeOperationBoundary(
            waitForShutdown,
            hardStopConfig.shutdownTimeoutMs,
            "shutdown",
            hardStopConfig
        );

        if (result.timedOut) {
            const err = markRuntimeUnhealthy(lifecycle, {
                operation: "shutdown",
                timeoutMs: hardStopConfig.shutdownTimeoutMs
            });
            throw err;
        }

        lifecycle.sessionsResetting.clear();
        lifecycle.sessionResetWaiters.clear();

        await terminateWorker();
    } finally {
        lifecycle.shutdownWaiter = null;
    }
}

async function shutdownAbort() {
    lifecycle.runtimeShuttingDown = true;
    scheduler.setReady(false);
    cancelRequestsForShutdown("Runtime shutdown");
    await finalizeWorkerShutdown();
}

async function shutdownDrain() {
    lifecycle.runtimeShuttingDown = true;
    await scheduler.waitForIdle();
    await finalizeWorkerShutdown();
}

function waitForSchedulerIdleOrTimeout(timeoutMs) {
    let timer;

    const idlePromise = scheduler.waitForIdle().then(() => true);
    const timeoutPromise = new Promise((resolve) => {
        timer = setTimeout(() => {
            resolve(false);
        }, timeoutMs);
    });

    return Promise.race([idlePromise, timeoutPromise]).finally(() => {
        clearTimeout(timer);
    });
}

async function shutdownDrainWithTimeout(timeoutMs) {
    lifecycle.runtimeShuttingDown = true;

    const finishedBeforeTimeout = await waitForSchedulerIdleOrTimeout(timeoutMs);

    if (!finishedBeforeTimeout) {
        scheduler.setReady(false);
        cancelRequestsForShutdown("Runtime shutdown timeout");
    }

    await finalizeWorkerShutdown();
}

export async function shutdownRuntime(options = {}) {
    const { mode, timeoutMs } = validateShutdownOptions(options);
    resolveNativeOperationHardStopConfig(config);
    assertRuntimeHealthy(lifecycle);

    if (lifecycle.runtimeResetting) {
        throw new Error("Runtime is resetting");
    }

    if (lifecycle.runtimeShuttingDown) {
        throw new Error("Runtime is shutting down");
    }

    if (isInitActive()) {
        throw new Error("Model initialization is in progress");
    }

    assertNoSessionResetInProgress("Runtime shutdown");

    if (mode === "abort") {
        await shutdownAbort();
        return;
    }

    if (mode === "drain") {
        await shutdownDrain();
        return;
    }

    if (mode === "drain-with-timeout") {
        await shutdownDrainWithTimeout(timeoutMs);
        return;
    }

    throw new Error(`Shutdown mode is not implemented yet: ${mode}`);
}
