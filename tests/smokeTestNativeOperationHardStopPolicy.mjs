// smokeTestNativeOperationHardStopPolicy.mjs
//
// Purpose:
// - Branch-scoped smoke coverage for Native Operation Hard Stop Policy v1, Option A.
// - Mock modes deterministically verify timeout detection / unhealthy reporting without
//   treating worker_thread termination as a safe native hard-stop boundary.
// - Real modes cover safe local-model paths and do not intentionally force native hangs.
//
// Run mock smoke only:
//   node ./tests/smokeTestNativeOperationHardStopPolicy.mjs
//
// Run mock + real-model smoke:
//   REAL_RUNTIME=1 node ./tests/smokeTestNativeOperationHardStopPolicy.mjs
//
// Run real-model smoke only:
//   SMOKE_MODE=real-orchestrator node ./tests/smokeTestNativeOperationHardStopPolicy.mjs

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const MODE = process.env.SMOKE_MODE || "orchestrator";
const RUN_REAL_RUNTIME = process.env.REAL_RUNTIME === "1";
const SELF_PATH = fileURLToPath(import.meta.url);
const TEST_DIR = path.dirname(SELF_PATH);
const REPO_ROOT = path.resolve(TEST_DIR, "..");

const RUNTIME_FILES = [
    "config.mjs",
    "configOverride.mjs",
    "contextRetryProfiles.mjs",
    "hardwareProbe.mjs",
    "inference.mjs",
    "nativeOperationPolicy.mjs",
    "nativeBoundaryCoordinator.mjs",
    "runtimeRequestSettlement.mjs",
    "runtimeLifecycleState.mjs",
    "runtimeSessionResetCoordinator.mjs",
    "runtimeShutdownCoordinator.mjs",
    "normalizer.mjs",
    "observer.mjs",
    "request.mjs",
    "retryProfiles.mjs",
    "scheduler.mjs",
    "streamController.mjs",
    "workerBridge.mjs",
    "llama_worker/llama.mjs"
];

function logSection(title) {
    console.log(`\n=== ${title} ===`);
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function withDeadline(promise, ms, label) {
    let timer;

    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => {
            reject(new Error(`[FAIL] ${label} timed out after ${ms}ms`));
        }, ms);
    });

    return Promise.race([promise, timeout]).finally(() => {
        clearTimeout(timer);
    });
}

async function expectReject(label, fn, expectedText = null) {
    try {
        await fn();
        throw new Error(`[FAIL] ${label} did not reject`);
    } catch (err) {
        if (String(err.message).startsWith("[FAIL]")) {
            throw err;
        }

        if (expectedText && !String(err.message).includes(expectedText)) {
            throw new Error(
                `[FAIL] ${label} rejected with unexpected message: ${err.message}`
            );
        }

        console.log(`[OK] ${label} rejected:`, err.message);
        return err;
    }
}

function readPositiveIntEnv(name, fallback) {
    const raw = process.env[name];
    if (raw === undefined || raw === "") return fallback;

    const value = Number(raw);
    if (!Number.isInteger(value) || value <= 0) {
        throw new Error(`${name} must be a positive integer`);
    }

    return value;
}

function getChildDeadlineMs(mode) {
    if (process.env.SMOKE_CHILD_DEADLINE_MS) {
        return Number(process.env.SMOKE_CHILD_DEADLINE_MS);
    }

    if (mode.startsWith("real-")) {
        return readPositiveIntEnv("REAL_SMOKE_CHILD_DEADLINE_MS", 900000);
    }

    return 30000;
}

function getRealReadyTimeoutMs() {
    return readPositiveIntEnv("REAL_READY_TIMEOUT_MS", 300000);
}

function getRealPromptDeadlineMs() {
    return readPositiveIntEnv("REAL_PROMPT_DEADLINE_MS", 300000);
}

function getRealLifecycleDeadlineMs() {
    return readPositiveIntEnv("REAL_LIFECYCLE_DEADLINE_MS", 300000);
}

function getRealInitDeadlineMs() {
    return readPositiveIntEnv("REAL_INIT_DEADLINE_MS", getRealReadyTimeoutMs() + 60000);
}

async function initRealModel(runtime, label) {
    console.log(`[SMOKE] ${label}: initModel start`);
    await withDeadline(
        runtime.initModel({
            attempts: 1,
            readyTimeoutMs: getRealReadyTimeoutMs(),
            retryDelayMs: 0
        }),
        getRealInitDeadlineMs(),
        `${label} initModel`
    );
    console.log(`[SMOKE] ${label}: initModel resolved`);
}

async function runChild(mode) {
    return new Promise((resolve, reject) => {
        console.log("[SMOKE] spawning child:", mode);

        let settled = false;
        const child = spawn(process.execPath, [SELF_PATH], {
            env: {
                ...process.env,
                SMOKE_MODE: mode
            },
            stdio: ["ignore", "pipe", "pipe"]
        });

        const deadlineMs = getChildDeadlineMs(mode);
        const deadline = setTimeout(() => {
            if (settled) return;
            settled = true;
            child.kill("SIGTERM");
            reject(new Error(`Child smoke mode ${mode} timed out after ${deadlineMs}ms`));
        }, deadlineMs);

        child.stdout.on("data", (chunk) => {
            process.stdout.write(chunk);
        });

        child.stderr.on("data", (chunk) => {
            process.stderr.write(chunk);
        });

        child.on("error", (err) => {
            if (settled) return;
            settled = true;
            clearTimeout(deadline);
            reject(err);
        });

        child.on("exit", (code) => {
            if (settled) return;
            settled = true;
            clearTimeout(deadline);

            console.log("[SMOKE] child exited:", mode, "code:", code);

            if (code === 0) {
                resolve();
                return;
            }

            reject(new Error(`Child smoke mode ${mode} failed with exit code ${code}`));
        });
    });
}

async function readEvents(eventLogPath) {
    const raw = await readFile(eventLogPath, "utf8").catch((err) => {
        if (err.code === "ENOENT") return "";
        throw err;
    });

    return raw
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => JSON.parse(line));
}

async function waitForEvent(eventLogPath, predicate, label, timeoutMs = 5000) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
        const events = await readEvents(eventLogPath);
        const found = events.find(predicate);
        if (found) return found;
        await sleep(20);
    }

    throw new Error(`[FAIL] timed out waiting for ${label}`);
}

async function consumeStream(req) {
    if (!req.stream) return;

    const reader = req.stream.getReader();

    while (true) {
        const { done } = await reader.read();
        if (done) break;
    }
}

async function readPromptResult(req) {
    await consumeStream(req);
    return req.done;
}

async function copyRuntimeFixture() {
    const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "runtime-option-a-"));

    for (const rel of RUNTIME_FILES) {
        const src = path.join(REPO_ROOT, rel);
        const dest = path.join(tmpRoot, rel);
        await mkdir(path.dirname(dest), { recursive: true });
        await cp(src, dest);
    }

    const configPath = path.join(tmpRoot, "config.mjs");
    let configText = await readFile(configPath, "utf8");
    configText = configText
        .replace(/maxInFlight:\s*\d+,/, "maxInFlight: Number(process.env.MOCK_MAX_IN_FLIGHT ?? 1),")
        .replace(/enabled:\s*true,\s*\n\s*resetModelTimeoutMs:/, "enabled: process.env.MOCK_NATIVE_HARD_STOP_ENABLED_RAW ?? (process.env.MOCK_NATIVE_HARD_STOP_ENABLED !== \"0\"),\n            resetModelTimeoutMs:")
        .replace(/resetModelTimeoutMs:\s*\d+,/, "resetModelTimeoutMs: Number(process.env.MOCK_RESET_MODEL_HARD_STOP_TIMEOUT_MS ?? 120000),")
        .replace(/shutdownTimeoutMs:\s*\d+,/, "shutdownTimeoutMs: Number(process.env.MOCK_SHUTDOWN_HARD_STOP_TIMEOUT_MS ?? 120000),")
        .replace(/resetSessionTimeoutMs:\s*\d+,/, "resetSessionTimeoutMs: Number(process.env.MOCK_RESET_SESSION_HARD_STOP_TIMEOUT_MS ?? 120000),")
        .replace(/timeoutAction:\s*"[^"]+"/, "timeoutAction: process.env.MOCK_NATIVE_TIMEOUT_ACTION ?? \"mark-unhealthy\"");
    await writeFile(configPath, configText);

    const fakePackageRoot = path.join(tmpRoot, "node_modules", "node-llama-cpp");
    await mkdir(fakePackageRoot, { recursive: true });
    await writeFile(
        path.join(fakePackageRoot, "package.json"),
        JSON.stringify({ type: "module", exports: "./index.js" }, null, 2)
    );

    await writeFile(
        path.join(fakePackageRoot, "index.js"),
        `
import { appendFileSync } from "node:fs";

let nextModelId = 0;
let nextContextId = 0;
let nextSessionId = 0;

function event(type, data = {}) {
  const eventLog = process.env.MOCK_EVENT_LOG;
  if (!eventLog) return;

  appendFileSync(eventLog, JSON.stringify({
    type,
    pid: process.pid,
    at: Date.now(),
    ...data,
  }) + "\\n");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function never() {
  return new Promise(() => {});
}

function readDelay(name, fallback) {
  const value = Number(process.env[name] ?? fallback);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

export async function getLlama() {
  event("llama.get");

  return {
    async loadModel() {
      await sleep(readDelay("MOCK_LOAD_DELAY_MS", 0));
      const modelId = ++nextModelId;
      event("model.load", { modelId });

      return {
        disposed: false,
        detokenize(tokens) {
          return String(tokens?.join ? tokens.join("") : tokens);
        },
        async createContext() {
          const contextId = ++nextContextId;
          event("context.create", { modelId, contextId });

          return {
            disposed: false,
            contextId,
            getSequence() {
              return { modelId, contextId };
            },
            async dispose() {
              this.disposed = true;
              event("context.dispose", { modelId, contextId });

              const contextDisposeDelayMs = readDelay("MOCK_CONTEXT_DISPOSE_DELAY_MS", 0);
              if (contextDisposeDelayMs > 0) {
                event("context.dispose.delay", { modelId, contextId, delayMs: contextDisposeDelayMs });
                await sleep(contextDisposeDelayMs);
              }

              if (process.env.MOCK_CONTEXT_DISPOSE_HANG === "1") {
                event("context.dispose.hang", { modelId, contextId });
                await never();
              }
            },
          };
        },
        async dispose() {
          this.disposed = true;
          event("model.dispose", { modelId });

          const modelDisposeDelayMs = readDelay("MOCK_MODEL_DISPOSE_DELAY_MS", 0);
          if (modelDisposeDelayMs > 0) {
            event("model.dispose.delay", { modelId, delayMs: modelDisposeDelayMs });
            await sleep(modelDisposeDelayMs);
          }

          if (process.env.MOCK_MODEL_DISPOSE_HANG === "1") {
            event("model.dispose.hang", { modelId });
            await never();
          }
        },
      };
    },
  };
}

export class LlamaChatSession {
  constructor({ contextSequence }) {
    this.contextSequence = contextSequence;
    this.sessionId = ++nextSessionId;
    this.disposed = false;
    event("session.create", {
      sessionId: this.sessionId,
      contextId: contextSequence?.contextId ?? null,
    });
  }

  async prompt(text, options = {}) {
    event("prompt.start", { text, sessionId: this.sessionId });

    if (process.env.MOCK_PROMPT_HANG === "1") {
      event("prompt.hang", { text, sessionId: this.sessionId });
      await never();
    }

    await sleep(readDelay("MOCK_PROMPT_DELAY_MS", 0));

    if (options.signal?.aborted) {
      event("prompt.abort-observed", { text, sessionId: this.sessionId });
      throw options.signal.reason ?? new Error("prompt aborted");
    }

    const output = "mock response: " + String(text).slice(0, 64);
    options.onToken?.(output);
    event("prompt.finish", { text, sessionId: this.sessionId });
    return output;
  }

  dispose() {
    this.disposed = true;
    event("session.dispose", { sessionId: this.sessionId });
  }
}
`
    );

    const eventLogPath = path.join(tmpRoot, "events.jsonl");
    await writeFile(eventLogPath, "");

    return { tmpRoot, eventLogPath };
}

async function withMockRuntime(fn, env = {}) {
    const { tmpRoot, eventLogPath } = await copyRuntimeFixture();
    const oldEnv = {};

    const mergedEnv = {
        MOCK_EVENT_LOG: eventLogPath,
        MOCK_RESET_MODEL_HARD_STOP_TIMEOUT_MS: 40,
        MOCK_SHUTDOWN_HARD_STOP_TIMEOUT_MS: 40,
        MOCK_RESET_SESSION_HARD_STOP_TIMEOUT_MS: 40,
        ...env
    };

    for (const [key, value] of Object.entries(mergedEnv)) {
        oldEnv[key] = process.env[key];
        process.env[key] = String(value);
    }

    try {
        const cacheBust = `${MODE}&t=${Date.now()}`;
        const inferenceUrl = pathToFileURL(path.join(tmpRoot, "inference.mjs")).href;
        const configUrl = pathToFileURL(path.join(tmpRoot, "config.mjs")).href;
        const runtime = await import(`${inferenceUrl}?mode=${cacheBust}`);
        const { config } = await import(configUrl);
        await fn(runtime, eventLogPath, config);
    } finally {
        for (const key of Object.keys(mergedEnv)) {
            if (oldEnv[key] === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = oldEnv[key];
            }
        }

        if (mergedEnv.MOCK_SKIP_TMP_CLEANUP !== 1 && mergedEnv.MOCK_SKIP_TMP_CLEANUP !== "1") {
            await rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
        }
    }
}

function exitAfterIntentionalStuckWorker() {
    process.exit(0);
}

async function modeResetModelTimeoutMarksUnhealthyWithoutTerminatingWorker() {
    logSection("resetModel timeout marks unhealthy without terminating worker");

    await withMockRuntime(async ({ initModel, resetModel, prompt }, eventLogPath) => {
        await initModel();

        await expectReject(
            "resetModel stuck native boundary",
            () => withDeadline(resetModel(), 5000, "resetModel timeout detection"),
            "Native operation timed out"
        );

        await expectReject(
            "prompt after resetModel native timeout",
            () => prompt("should reject while unhealthy", { stream: false }),
            "runtime is marked unhealthy"
        );

        const events = await readEvents(eventLogPath);
        assert(events.some((event) => event.type === "model.dispose.hang"), "model dispose should have hung");
        assert.equal(events.filter((event) => event.type === "model.load").length, 1, "worker should not be replaced before cooperative boundary");
    }, {
        MOCK_MODEL_DISPOSE_HANG: 1
    });

    console.log("[OK] resetModel timeout marked runtime unhealthy without worker replacement");
    exitAfterIntentionalStuckWorker();
}

async function modeShutdownTimeoutMarksUnhealthyWithoutTerminatingWorker() {
    logSection("shutdown timeout marks unhealthy without terminating worker");

    await withMockRuntime(async ({ initModel, shutdownRuntime, prompt }, eventLogPath) => {
        await initModel();

        await expectReject(
            "shutdown stuck native boundary",
            () => withDeadline(shutdownRuntime({ mode: "abort" }), 5000, "shutdown timeout detection"),
            "Native operation timed out"
        );

        await expectReject(
            "prompt after shutdown native timeout",
            () => prompt("should reject after stuck shutdown", { stream: false }),
            "runtime is marked unhealthy"
        );

        const events = await readEvents(eventLogPath);
        assert(events.some((event) => event.type === "model.dispose.hang"), "shutdown model dispose should have hung");
        assert.equal(events.filter((event) => event.type === "model.load").length, 1, "worker should not be replaced before shutdown boundary");
    }, {
        MOCK_MODEL_DISPOSE_HANG: 1
    });

    console.log("[OK] shutdown timeout marked runtime unhealthy without worker termination");
    exitAfterIntentionalStuckWorker();
}

async function modeDrainTimeoutThenShutdownTimeoutMarksUnhealthy() {
    logSection("drain-with-timeout then shutdown timeout marks unhealthy");

    await withMockRuntime(async ({ initModel, shutdownRuntime, prompt }, eventLogPath) => {
        await initModel();

        const req = await prompt("slow drain timeout", { stream: false });
        req.done.catch(() => {});

        await waitForEvent(eventLogPath, (event) => event.type === "prompt.start", "prompt.start slow drain timeout");

        await Promise.all([
            expectReject("drain timeout canceled request", () => readPromptResult(req), "Runtime shutdown timeout"),
            expectReject(
                "drain-with-timeout stuck shutdown boundary",
                () => withDeadline(shutdownRuntime({ mode: "drain-with-timeout", timeoutMs: 30 }), 5000, "drain timeout native boundary"),
                "Native operation timed out"
            )
        ]);

        await expectReject(
            "prompt after drain shutdown native timeout",
            () => prompt("should reject after unhealthy drain timeout", { stream: false }),
            "runtime is marked unhealthy"
        );
    }, {
        MOCK_PROMPT_DELAY_MS: 500,
        MOCK_MODEL_DISPOSE_HANG: 1
    });

    console.log("[OK] drain-with-timeout marked runtime unhealthy after stuck shutdown boundary");
    exitAfterIntentionalStuckWorker();
}

async function modeResetSessionTimeoutRejectsAndKeepsSessionBlocked() {
    logSection("resetSession timeout rejects and keeps session blocked");

    await withMockRuntime(async ({ initModel, prompt, resetSession }, eventLogPath) => {
        await initModel();

        const before = await prompt("create alpha session", { sessionId: "alpha", stream: false });
        assert.match(await readPromptResult(before), /create alpha session/);

        await expectReject(
            "resetSession stuck boundary",
            () => withDeadline(resetSession("alpha"), 5000, "resetSession timeout detection"),
            "Session reset timed out"
        );

        await expectReject(
            "prompt for timed-out session remains blocked",
            () => prompt("should remain blocked", { sessionId: "alpha", stream: false }),
            "Session is resetting: alpha"
        );

        const events = await readEvents(eventLogPath);
        assert(events.some((event) => event.type === "context.dispose.hang"), "session reset context disposal should hang");
        assert.equal(events.filter((event) => event.type === "model.load").length, 1, "resetSession timeout should not replace worker");
    }, {
        MOCK_CONTEXT_DISPOSE_HANG: 1
    });

    console.log("[OK] resetSession timeout rejected without worker replacement");
    exitAfterIntentionalStuckWorker();
}

async function modeResetSessionTimeoutClearsWhenWorkerEventuallyCompletes() {
    logSection("resetSession timeout clears when worker eventually completes");

    await withMockRuntime(async ({ initModel, prompt, resetSession, shutdownRuntime }, eventLogPath) => {
        await initModel();

        const before = await prompt("create delayed alpha session", { sessionId: "alpha", stream: false });
        assert.match(await readPromptResult(before), /create delayed alpha session/);

        await expectReject(
            "resetSession delayed completion rejects at policy timeout",
            () => withDeadline(resetSession("alpha"), 5000, "resetSession delayed timeout"),
            "Session reset timed out"
        );

        await expectReject(
            "prompt for delayed-reset session remains blocked immediately after timeout",
            () => prompt("still blocked", { sessionId: "alpha", stream: false }),
            "Session is resetting: alpha"
        );

        await waitForEvent(eventLogPath, (event) => event.type === "context.dispose.delay", "delayed context dispose start");
        await sleep(200);

        const after = await prompt("alpha after delayed reset completion", { sessionId: "alpha", stream: false });
        assert.match(await withDeadline(readPromptResult(after), 5000, "prompt after delayed reset completion"), /alpha after delayed reset completion/);

        await withDeadline(shutdownRuntime({ mode: "abort" }), 5000, "shutdown after delayed reset completion");
    }, {
        MOCK_CONTEXT_DISPOSE_DELAY_MS: 120,
        MOCK_SHUTDOWN_HARD_STOP_TIMEOUT_MS: 1000
    });

    console.log("[OK] resetSession timeout cleared after cooperative completion");
}

async function modeTimeoutPolicyDisabledWaitsForCooperativeBoundary() {
    logSection("timeout policy disabled waits for cooperative resetModel boundary");

    await withMockRuntime(async ({ initModel, resetModel, prompt, shutdownRuntime }) => {
        await initModel();

        await withDeadline(resetModel(), 5000, "resetModel with timeout policy disabled");

        const after = await prompt("after disabled timeout reset", { stream: false });
        assert.match(await withDeadline(readPromptResult(after), 5000, "prompt after disabled reset"), /after disabled timeout reset/);

        await withDeadline(shutdownRuntime({ mode: "abort" }), 5000, "shutdown after disabled timeout reset");
    }, {
        MOCK_NATIVE_HARD_STOP_ENABLED: 0,
        MOCK_MODEL_DISPOSE_DELAY_MS: 120,
        MOCK_RESET_MODEL_HARD_STOP_TIMEOUT_MS: 20
    });

    console.log("[OK] timeout policy disabled waited for cooperative boundary");
}

async function modeCooperativeResetModelStillTerminatesAfterBoundary() {
    logSection("cooperative resetModel still rebuilds after model_reset_done");

    await withMockRuntime(async ({ initModel, resetModel, prompt, shutdownRuntime }, eventLogPath) => {
        await initModel();
        await withDeadline(resetModel(), 5000, "cooperative resetModel");

        const after = await prompt("after cooperative reset", { stream: false });
        assert.match(await withDeadline(readPromptResult(after), 5000, "prompt after cooperative reset"), /after cooperative reset/);

        await withDeadline(shutdownRuntime({ mode: "abort" }), 5000, "shutdown after cooperative reset");

        const events = await readEvents(eventLogPath);
        assert(events.filter((event) => event.type === "model.load").length >= 2, "cooperative resetModel should rebuild worker after safe boundary");
    });

    console.log("[OK] cooperative resetModel rebuilt after safe boundary");
}

async function modeCooperativeShutdownStillTerminatesAfterBoundary() {
    logSection("cooperative shutdown still terminates after shutdown_done");

    await withMockRuntime(async ({ initModel, shutdownRuntime, prompt }) => {
        await initModel();
        await withDeadline(shutdownRuntime({ mode: "abort" }), 5000, "cooperative shutdown");

        await expectReject(
            "prompt after cooperative shutdown",
            () => prompt("should reject after shutdown", { stream: false }),
            "Runtime is shutting down"
        );
    });

    console.log("[OK] cooperative shutdown completed after safe boundary");
}

async function modeInvalidHardStopConfigRejectsBeforeSideEffects() {
    logSection("invalid hard-stop config rejects before lifecycle side effects");

    await withMockRuntime(async ({ resetSession }, eventLogPath) => {
        await expectReject(
            "invalid timeout action",
            () => resetSession("alpha"),
            "Unsupported runtime.nativeOperationHardStop.timeoutAction"
        );


        const events = await readEvents(eventLogPath);
        assert.equal(events.length, 0, "invalid config should reject before worker side effects");
    }, {
        MOCK_NATIVE_TIMEOUT_ACTION: "unsafe-kill-worker",
        MOCK_SKIP_TMP_CLEANUP: 1
    });

    await withMockRuntime(async ({ resetModel, prompt }, eventLogPath) => {
        await expectReject(
            "invalid resetModel timeout",
            () => resetModel(),
            "runtime.nativeOperationHardStop.resetModelTimeoutMs must be an integer >= 0"
        );

        const req = await prompt("valid after previous isolated invalid config", { stream: false });
        assert.match(await withDeadline(readPromptResult(req), 5000, "prompt after invalid isolated config"), /valid after previous isolated invalid config/);

        const events = await readEvents(eventLogPath);
        assert(events.some((event) => event.type === "model.load"), "runtime should remain usable in separate valid fixture");
    }, {
        MOCK_RESET_MODEL_HARD_STOP_TIMEOUT_MS: -1,
        MOCK_SKIP_TMP_CLEANUP: 1
    });

    await withMockRuntime(async ({ shutdownRuntime }, eventLogPath) => {
        await expectReject(
            "invalid hard-stop enabled flag",
            () => shutdownRuntime({ mode: "abort" }),
            "runtime.nativeOperationHardStop.enabled must be a boolean"
        );

        const events = await readEvents(eventLogPath);
        assert.equal(events.length, 0, "invalid enabled config should reject before shutdown side effects");
    }, {
        MOCK_NATIVE_HARD_STOP_ENABLED_RAW: "not-boolean",
        MOCK_SKIP_TMP_CLEANUP: 1
    });

    console.log("[OK] invalid hard-stop config rejected before lifecycle side effects");
    exitAfterIntentionalStuckWorker();
}

async function loadRealRuntime(configMutator = null) {
    const { config } = await import("../config.mjs");

    if (configMutator) {
        configMutator(config);
    }

    const runtime = await import(`../inference.mjs?mode=${MODE}&t=${Date.now()}`);

    return { runtime, config };
}

async function modeRealHardStopConfigValidation() {
    logSection("real runtime hard-stop config validation");

    const { runtime, config } = await loadRealRuntime((candidateConfig) => {
        candidateConfig.runtime.nativeOperationHardStop.timeoutAction = "unsupported-action";
    });

    await expectReject(
        "real invalid timeout action",
        () => runtime.resetSession("real-config-invalid"),
        "Unsupported runtime.nativeOperationHardStop.timeoutAction"
    );

    config.runtime.nativeOperationHardStop.timeoutAction = "mark-unhealthy";
    config.runtime.nativeOperationHardStop.resetModelTimeoutMs = -1;

    await expectReject(
        "real invalid resetModel timeout",
        () => runtime.resetModel(),
        "runtime.nativeOperationHardStop.resetModelTimeoutMs must be an integer >= 0"
    );

    config.runtime.nativeOperationHardStop.resetModelTimeoutMs = 120000;
    config.runtime.nativeOperationHardStop.enabled = "false";

    await expectReject(
        "real invalid hard-stop enabled value",
        () => runtime.shutdownRuntime({ mode: "abort" }),
        "runtime.nativeOperationHardStop.enabled must be a boolean"
    );

    config.runtime.nativeOperationHardStop.enabled = true;
    await withDeadline(runtime.shutdownRuntime({ mode: "abort" }), getRealLifecycleDeadlineMs(), "real shutdown after config validation cleanup");

    console.log("[OK] real hard-stop config validation completed");
}

async function modeRealCooperativeResetModelNormalPath() {
    logSection("real cooperative resetModel normal path");

    const { runtime } = await loadRealRuntime();
    await initRealModel(runtime, "real cooperative resetModel");

    console.log("[SMOKE] real cooperative resetModel: resetModel start");
    await withDeadline(runtime.resetModel(), getRealLifecycleDeadlineMs(), "real cooperative resetModel");
    console.log("[SMOKE] real cooperative resetModel: resetModel resolved");

    // Post-reset prompt behavior is already covered by smokeTestLifecycleRegression.mjs.
    // This branch smoke only verifies that the cooperative resetModel boundary resolves
    // without triggering the native-operation timeout/unhealthy policy.
    await withDeadline(runtime.shutdownRuntime({ mode: "abort" }), getRealLifecycleDeadlineMs(), "real shutdown after cooperative resetModel");

    console.log("[OK] real cooperative resetModel boundary completed");
}

async function modeRealCooperativeShutdownNormalPath() {
    logSection("real cooperative shutdown normal path");

    const { runtime } = await loadRealRuntime();
    await initRealModel(runtime, "real cooperative shutdown");

    console.log("[SMOKE] real cooperative shutdown: shutdown start");
    await withDeadline(runtime.shutdownRuntime({ mode: "abort" }), getRealLifecycleDeadlineMs(), "real cooperative shutdown");
    console.log("[SMOKE] real cooperative shutdown: shutdown resolved");

    await expectReject(
        "real prompt after cooperative shutdown",
        () => runtime.prompt("should reject after shutdown", { stream: false }),
        "Runtime is shutting down"
    );

    console.log("[OK] real cooperative shutdown path completed");
}

async function modeRealDrainWithTimeoutNormalPath() {
    logSection("real drain-with-timeout normal path");

    const { runtime } = await loadRealRuntime();
    await initRealModel(runtime, "real drain-with-timeout");

    console.log("[SMOKE] real drain-with-timeout: pre-prompt start");
    const req = await runtime.prompt("Say a short drain response.");
    const result = await withDeadline(readPromptResult(req), getRealPromptDeadlineMs(), "real drain pre-prompt");
    console.log("[SMOKE] real drain-with-timeout: pre-prompt resolved");
    assert.equal(typeof result, "string");

    console.log("[SMOKE] real drain-with-timeout: shutdown start");
    await withDeadline(runtime.shutdownRuntime({ mode: "drain-with-timeout", timeoutMs: 1000 }), getRealLifecycleDeadlineMs(), "real drain-with-timeout normal shutdown");
    console.log("[SMOKE] real drain-with-timeout: shutdown resolved");

    await expectReject(
        "real prompt after drain-with-timeout shutdown",
        () => runtime.prompt("should reject after drain shutdown", { stream: false }),
        "Runtime is shutting down"
    );

    console.log("[OK] real drain-with-timeout normal path completed");
}

async function realOrchestrator() {
    const modes = [
        "real-hard-stop-config-validation",
        "real-cooperative-reset-model-normal-path",
        "real-cooperative-shutdown-normal-path",
        "real-drain-with-timeout-normal-path"
    ];

    for (const mode of modes) {
        logSection(`child mode: ${mode}`);
        await runChild(mode);
    }

    console.log("\nAll real native operation timeout policy smoke tests finished.");
}

async function orchestrator() {
    const modes = [
        "mock-reset-model-timeout-marks-unhealthy-without-terminating-worker",
        "mock-shutdown-timeout-marks-unhealthy-without-terminating-worker",
        "mock-drain-timeout-then-shutdown-timeout-marks-unhealthy",
        "mock-reset-session-timeout-rejects-and-keeps-session-blocked",
        "mock-reset-session-timeout-clears-when-worker-eventually-completes",
        "mock-timeout-policy-disabled-waits-for-cooperative-boundary",
        "mock-cooperative-reset-model-still-terminates-after-boundary",
        "mock-cooperative-shutdown-still-terminates-after-boundary",
        "mock-invalid-hard-stop-config-rejects-before-side-effects"
    ];

    for (const mode of modes) {
        logSection(`child mode: ${mode}`);
        await runChild(mode);
    }

    console.log("\nAll native operation timeout policy smoke tests finished.");
}

async function main() {
    console.log("[SMOKE] mode:", MODE);

    switch (MODE) {
        case "orchestrator":
            await orchestrator();
            if (RUN_REAL_RUNTIME) {
                await realOrchestrator();
            }
            break;
        case "real-orchestrator":
            await realOrchestrator();
            break;
        case "mock-reset-model-timeout-marks-unhealthy-without-terminating-worker":
            await modeResetModelTimeoutMarksUnhealthyWithoutTerminatingWorker();
            break;
        case "mock-shutdown-timeout-marks-unhealthy-without-terminating-worker":
            await modeShutdownTimeoutMarksUnhealthyWithoutTerminatingWorker();
            break;
        case "mock-drain-timeout-then-shutdown-timeout-marks-unhealthy":
            await modeDrainTimeoutThenShutdownTimeoutMarksUnhealthy();
            break;
        case "mock-reset-session-timeout-rejects-and-keeps-session-blocked":
            await modeResetSessionTimeoutRejectsAndKeepsSessionBlocked();
            break;
        case "mock-reset-session-timeout-clears-when-worker-eventually-completes":
            await modeResetSessionTimeoutClearsWhenWorkerEventuallyCompletes();
            break;
        case "mock-timeout-policy-disabled-waits-for-cooperative-boundary":
            await modeTimeoutPolicyDisabledWaitsForCooperativeBoundary();
            break;
        case "mock-cooperative-reset-model-still-terminates-after-boundary":
            await modeCooperativeResetModelStillTerminatesAfterBoundary();
            break;
        case "mock-cooperative-shutdown-still-terminates-after-boundary":
            await modeCooperativeShutdownStillTerminatesAfterBoundary();
            break;
        case "mock-invalid-hard-stop-config-rejects-before-side-effects":
            await modeInvalidHardStopConfigRejectsBeforeSideEffects();
            break;
        case "real-hard-stop-config-validation":
            await modeRealHardStopConfigValidation();
            break;
        case "real-cooperative-reset-model-normal-path":
            await modeRealCooperativeResetModelNormalPath();
            break;
        case "real-cooperative-shutdown-normal-path":
            await modeRealCooperativeShutdownNormalPath();
            break;
        case "real-drain-with-timeout-normal-path":
            await modeRealDrainWithTimeoutNormalPath();
            break;
        default:
            throw new Error(`Unknown SMOKE_MODE: ${MODE}`);
    }
}

main().catch((err) => {
    console.error("\n[SMOKE TEST FAILURE]");
    console.error(err);
    process.exitCode = 1;
});
