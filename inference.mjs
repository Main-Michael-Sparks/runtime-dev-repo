import { config } from "./config.mjs";
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

let initStarted = false;
let initResolved = false;
let initInProgress = false;
let initCyclePromise = null;
let resolveReady;
let rejectReady;

let activeInitAttemptId = null;
let activeInitPlan = null;
let lastSuccessfulInitPlan = null;
let lastSuccessfulEffectiveConfig = null;
let lastSuccessfulProbe = null;
let lastFailedExplicitInit = null;
let nextInitAttemptId = 0;

const sessionsResetting = new Set();
const sessionResetWaiters = new Map();
let runtimeResetting = false;
let runtimeShuttingDown = false;
let modelResetWaiter = null;
let shutdownWaiter = null;

function createReadyPromise() {
    return new Promise((resolve, reject) => {
        resolveReady = resolve;
        rejectReady = reject;
    });
}

let readyPromise = createReadyPromise();

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
    nextInitAttemptId += 1;
    return nextInitAttemptId;
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
    initStarted = false;
    initResolved = false;
    activeInitAttemptId = null;
    scheduler.setReady(false);
    readyPromise = createReadyPromise();
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
    if (!lastSuccessfulInitPlan || !lastSuccessfulEffectiveConfig) {
        return null;
    }

    const profileName = lastSuccessfulInitPlan.profileName ?? "last-successful";
    const profile = {
        name: profileName,
        reason: "Last successful effective config",
        effectiveConfig: lastSuccessfulEffectiveConfig
    };

    const attemptPlan = buildInitAttemptPlan({
        strategy: "same-config-cold-worker",
        profiles: [profile],
        attempts: 1,
        readyTimeoutMs: lastSuccessfulInitPlan.readyTimeoutMs ?? 0,
        retryDelayMs: 0,
        nextAttemptId
    });

    return {
        enabled: true,
        strategy: "same-config-cold-worker",
        attempts: 1,
        readyTimeoutMs: lastSuccessfulInitPlan.readyTimeoutMs ?? 0,
        retryDelayMs: 0,
        configOverride: undefined,
        hardwareAware: lastSuccessfulInitPlan.hardwareAware ?? {},
        hasCustomProfileOptions: true,
        probe: lastSuccessfulProbe,
        profiles: [profile],
        attemptPlan
    };
}

async function attemptInitOnce(attempt) {
    resetInitBarrier();
    initStarted = true;
    activeInitAttemptId = attempt.initAttemptId;

    sendToWorker({
        type: "init",
        initAttemptId: attempt.initAttemptId,
        profileName: attempt.profileName,
        configSnapshot: createWorkerConfigSnapshot(
            attempt.effectiveConfig,
            activeInitPlan?.probe ?? null
        )
    });

    return withTimeout(
        readyPromise,
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

    activeInitPlan = initPlan;

    for (let index = 0; index < initPlan.attemptPlan.length; index++) {
        const attempt = initPlan.attemptPlan[index];
        attemptedProfiles.push(attempt.profileName);

        try {
            await attemptInitOnce(attempt);

            lastSuccessfulInitPlan = {
                strategy: initPlan.strategy,
                profileName: attempt.profileName,
                effectiveConfig: attempt.effectiveConfig,
                readyTimeoutMs: attempt.readyTimeoutMs,
                retryDelayMs: attempt.retryDelayMs,
                hardwareAware: initPlan.hardwareAware,
                attemptedProfiles: [...attemptedProfiles],
                probe: initPlan.probe ?? null
            };
            lastSuccessfulEffectiveConfig = attempt.effectiveConfig;
            lastSuccessfulProbe = initPlan.probe ?? null;
            lastFailedExplicitInit = null;
            activeInitAttemptId = null;
            activeInitPlan = null;
            return;
        } catch (err) {
            lastError = err;
            activeInitAttemptId = null;

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
    activeInitPlan = null;

    throw buildFinalInitError(initPlan, attemptedProfiles, lastError);
}

async function startInitCycle(initPlan) {
    initInProgress = true;
    initCyclePromise = runInitCycle(initPlan);

    try {
        return await initCyclePromise;
    } finally {
        initInProgress = false;
        initCyclePromise = null;
    }
}

async function ensureModelReady() {
    if (initResolved) return;

    if (initInProgress) {
        return initCyclePromise ?? readyPromise;
    }

    if (initStarted) {
        return readyPromise;
    }

    if (lastFailedExplicitInit && !lastSuccessfulInitPlan) {
        throw new Error(
            `Model is not initialized after failed explicit init. ` +
            `Call initModel() with corrected options before prompting. ` +
            `Last failure: ${lastFailedExplicitInit.error?.message ?? String(lastFailedExplicitInit.error)}`
        );
    }

    initInProgress = true;
    initCyclePromise = (async () => {
        const initPlan = lastSuccessfulInitPlan
            ? createFixedInitPlanFromLastSuccess()
            : await createInitPlan(resolveInitOptions());

        return runInitCycle(initPlan);
    })();

    try {
        return await initCyclePromise;
    } finally {
        initInProgress = false;
        initCyclePromise = null;
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
        if (msg.initAttemptId !== activeInitAttemptId) return;

        initResolved = true;
        scheduler.setReady(true);
        resolveReady();
        return;
    }

    if (msg.type === "reset_done") {
        if (msg.sessionId) {
            sessionsResetting.delete(msg.sessionId);

            const waiter = sessionResetWaiters.get(msg.sessionId);
            if (waiter) {
                sessionResetWaiters.delete(msg.sessionId);
                waiter.resolve();
            }
        }
        return;
    }

    if (msg.type === "model_reset_done") {
        const waiter = modelResetWaiter;
        modelResetWaiter = null;

        if (waiter) {
            waiter.resolve();
        }
        return;
    }

    if (msg.type === "shutdown_done") {
        const waiter = shutdownWaiter;
        shutdownWaiter = null;

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

        const resultText = req.streamEnabled ? req.finalText : (msg.res ?? req.finalText);

        closeStream(req);
        traceDone(req);
        req.resolveDone(resultText);
        traceDelete(req.id);
        return;
    }

    if (msg.type === "error") {
        const err = toErrorObject(msg.error);

        if (msg.initAttemptId !== undefined && msg.initAttemptId !== null) {
            if (msg.initAttemptId !== activeInitAttemptId) return;
            rejectReady(err);
            return;
        }

        if ((msg.id === undefined || msg.id === null) && runtimeResetting && modelResetWaiter) {
            const waiter = modelResetWaiter;
            modelResetWaiter = null;
            waiter.reject(err);
            return;
        }

        if ((msg.id === undefined || msg.id === null) && runtimeShuttingDown && shutdownWaiter) {
            const waiter = shutdownWaiter;
            shutdownWaiter = null;
            waiter.reject(err);
            return;
        }

        if ((msg.id === undefined || msg.id === null) && !initResolved && !msg.sessionId) {
            rejectReady(err);
            return;
        }

        if ((msg.id === undefined || msg.id === null) && msg.sessionId && sessionResetWaiters.has(msg.sessionId)) {
            sessionsResetting.delete(msg.sessionId);

            const waiter = sessionResetWaiters.get(msg.sessionId);
            sessionResetWaiters.delete(msg.sessionId);
            waiter.reject(err);
            return;
        }

        const req = scheduler.fail(msg.id);
        if (!req) return;

        traceError(req, err);
        errorStream(req, err);
        req.rejectDone(err);
        traceDelete(req.id);
    }
});

export async function initModel(options = {}) {
    if (runtimeShuttingDown) {
        throw new Error("Runtime is shutting down");
    }

    if (runtimeResetting) {
        throw new Error("Runtime is resetting");
    }

    if (initResolved) {
        if (hasMeaningfulInitOptions(options)) {
            throw new Error("Model already initialized; resetModel() required before changing init config");
        }

        return readyPromise;
    }

    if (initStarted || initInProgress) {
        throw new Error("Model initialization already in progress");
    }

    const rawHadCustomProfileOptions = hasCustomProfileOptions(options);
    const initOptions = resolveInitOptions(options);
    let initPlan = null;

    initInProgress = true;
    initCyclePromise = (async () => {
        initPlan = await createInitPlan(initOptions);
        return runInitCycle(initPlan);
    })();

    try {
        return await initCyclePromise;
    } catch (err) {
        if (rawHadCustomProfileOptions || initOptions.hasCustomProfileOptions) {
            lastFailedExplicitInit = {
                hadMeaningfulOptions: true,
                strategy: initOptions.strategy,
                attemptedProfiles: err.attemptedProfiles ?? initPlan?.attemptPlan?.map((attempt) => attempt.profileName) ?? [],
                error: err
            };
        }

        throw err;
    } finally {
        initInProgress = false;
        initCyclePromise = null;
    }
}

function assertPromptAdmissionAllowed(sessionId) {
    if (runtimeResetting) {
        throw new Error("Runtime is resetting");
    }

    if (runtimeShuttingDown) {
        throw new Error("Runtime is shutting down");
    }

    if (sessionsResetting.has(sessionId)) {
        throw new Error(`Session is resetting: ${sessionId}`);
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
    sendToWorker({
        type: "cancel",
        id: promptId
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
    if (runtimeResetting) {
        throw new Error("Runtime is resetting");
    }

    if (runtimeShuttingDown) {
        throw new Error("Runtime is shutting down");
    }

    const existing = sessionResetWaiters.get(sessionId);
    if (existing) {
        return existing.promise;
    }

    sessionsResetting.add(sessionId);

    let resolveReset;
    let rejectReset;
    const promise = new Promise((resolve, reject) => {
        resolveReset = resolve;
        rejectReset = reject;
    });

    sessionResetWaiters.set(sessionId, {
        promise,
        resolve: resolveReset,
        reject: rejectReset
    });

    const canceled = scheduler.cancelBySession(sessionId);

    for (const req of canceled) {
        sendToWorker({
            type: "cancel",
            id: req.id
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

    return promise;
}

export async function resetModel() {
    if (runtimeResetting) {
        throw new Error("Runtime is resetting");
    }

    if (runtimeShuttingDown) {
        throw new Error("Runtime is shutting down");
    }

    runtimeResetting = true;
    scheduler.setReady(false);

    const canceled = scheduler.cancelAll();

    for (const req of canceled) {
        sendToWorker({
            type: "cancel",
            id: req.id
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

    modelResetWaiter = {
        resolve: resolveReset,
        reject: rejectReset
    };

    try {
        sendToWorker({
            type: "reset_model"
        });

        await waitForWorkerReset;
        await terminateWorker();
        recreateWorker();

        const initPlan = createFixedInitPlanFromLastSuccess() ?? await createInitPlan(resolveInitOptions());
        await startInitCycle(initPlan);
    } finally {
        runtimeResetting = false;
        modelResetWaiter = null;
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
    return initInProgress || (initStarted && !initResolved);
}

function cancelRequestsForShutdown(reason) {
    const canceled = scheduler.cancelAll();

    for (const req of canceled) {
        sendToWorker({
            type: "cancel",
            id: req.id
        });

        cancelStream(req);
        traceCanceled(req);
        req.rejectDone(new Error(reason));
        traceDelete(req.id);
    }

    return canceled;
}

async function finalizeWorkerShutdown() {
    let resolveShutdown;
    let rejectShutdown;
    const waitForShutdown = new Promise((resolve, reject) => {
        resolveShutdown = resolve;
        rejectShutdown = reject;
    });

    shutdownWaiter = {
        resolve: resolveShutdown,
        reject: rejectShutdown
    };

    try {
        sendToWorker({
            type: "shutdown"
        });

        await waitForShutdown;
        await terminateWorker();
    } finally {
        shutdownWaiter = null;
    }
}

async function shutdownAbort() {
    runtimeShuttingDown = true;
    scheduler.setReady(false);
    cancelRequestsForShutdown("Runtime shutdown");
    await finalizeWorkerShutdown();
}

async function shutdownDrain() {
    runtimeShuttingDown = true;
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
    runtimeShuttingDown = true;

    const finishedBeforeTimeout = await waitForSchedulerIdleOrTimeout(timeoutMs);

    if (!finishedBeforeTimeout) {
        scheduler.setReady(false);
        cancelRequestsForShutdown("Runtime shutdown timeout");
    }

    await finalizeWorkerShutdown();
}

export async function shutdownRuntime(options = {}) {
    const { mode, timeoutMs } = validateShutdownOptions(options);

    if (runtimeResetting) {
        throw new Error("Runtime is resetting");
    }

    if (runtimeShuttingDown) {
        throw new Error("Runtime is shutting down");
    }

    if (isInitActive()) {
        throw new Error("Model initialization is in progress");
    }

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
