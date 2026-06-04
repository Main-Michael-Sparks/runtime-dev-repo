// smokeTestContextCreationCancelBoundary.mjs
//
// Purpose:
// - Branch-scoped deterministic smoke coverage for context-creation cancellation boundaries.
// - Verifies createSignal is passed to model.createContext(...).
// - Verifies cancel/reset/shutdown abort active context creation before disposal when the native layer observes createSignal.
// - Verifies safe fallback behavior when createContext ignores createSignal and returns only after cancellation.
// - Preserves context retry behavior for genuine createContext failures.
//
// Run deterministic/mock smoke:
//   node ./tests/smokeTestContextCreationCancelBoundary.mjs
//
// Run deterministic/mock smoke plus local real-model smoke:
//   REAL_RUNTIME=1 node ./tests/smokeTestContextCreationCancelBoundary.mjs
//
// Run real-model smoke only:
//   SMOKE_MODE=real-orchestrator node ./tests/smokeTestContextCreationCancelBoundary.mjs
//
// Run one mode:
//   SMOKE_MODE=mock-cancel-during-context-creation-aborts-create-signal node ./tests/smokeTestContextCreationCancelBoundary.mjs

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const MODE = process.env.SMOKE_MODE || "orchestrator";
const SELF_PATH = fileURLToPath(import.meta.url);
const TEST_DIR = path.dirname(SELF_PATH);
const REPO_ROOT = path.resolve(TEST_DIR, "..");

const RUNTIME_FILES = [
    "runtime/config/config.mjs",
    "runtime/config/configOverride.mjs",
    "runtime/config/contextRetryProfiles.mjs",
    "runtime/config/hardwareProbe.mjs",
    "runtime.mjs",
    "runtime/lifecycle/nativeOperationPolicy.mjs",
    "runtime/lifecycle/nativeBoundaryCoordinator.mjs",
    "runtime/request/runtimeRequestSettlement.mjs",
    "runtime/lifecycle/runtimeLifecycleState.mjs",
    "runtime/lifecycle/runtimeSessionResetCoordinator.mjs",
    "runtime/lifecycle/runtimeShutdownCoordinator.mjs",
    "runtime/lifecycle/runtimeInitCoordinator.mjs",
    "runtime/lifecycle/runtimeModelResetCoordinator.mjs",
    "runtime/lifecycle/workerProtocolRouter.mjs",
    "runtime/stream/normalizer.mjs",
    "runtime/observability/observer.mjs",
    "runtime/request/request.mjs",
    "runtime/config/retryProfiles.mjs",
    "runtime/request/scheduler.mjs",
    "runtime/stream/streamController.mjs",
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

async function runChild(mode) {
    return new Promise((resolve, reject) => {
        console.log("[SMOKE] spawning child:", mode);

        const child = spawn(process.execPath, [SELF_PATH], {
            env: {
                ...process.env,
                SMOKE_MODE: mode
            },
            stdio: ["ignore", "pipe", "pipe"]
        });

        child.stdout.on("data", (chunk) => {
            process.stdout.write(chunk);
        });

        child.stderr.on("data", (chunk) => {
            process.stderr.write(chunk);
        });

        child.on("error", reject);

        child.on("exit", (code) => {
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
        await sleep(25);
    }

    throw new Error(`[FAIL] timed out waiting for ${label}`);
}

function assertNoEvent(events, predicate, label) {
    assert.equal(
        events.some(predicate),
        false,
        `${label} should not have occurred`
    );
}

function assertEventOrder(events, firstPredicate, secondPredicate, label) {
    const firstIndex = events.findIndex(firstPredicate);
    const secondIndex = events.findIndex(secondPredicate);

    assert.notEqual(firstIndex, -1, `${label}: first event not found`);
    assert.notEqual(secondIndex, -1, `${label}: second event not found`);
    assert(
        firstIndex < secondIndex,
        `${label}: first event index ${firstIndex} should be before second event index ${secondIndex}`
    );
}

async function readPromptResult(req) {
    if (req.stream) {
        const reader = req.stream.getReader();

        while (true) {
            const { done } = await reader.read();
            if (done) break;
        }
    }

    return req.done;
}

async function copyRuntimeFixture() {
    const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "runtime-context-cancel-"));

    for (const rel of RUNTIME_FILES) {
        const src = path.join(REPO_ROOT, rel);
        const dest = path.join(tmpRoot, rel);
        await mkdir(path.dirname(dest), { recursive: true });
        await cp(src, dest);
    }

    const configPath = path.join(tmpRoot, "runtime/config/config.mjs");
    let configText = await readFile(configPath, "utf8");
    configText = configText.replace(
        /maxInFlight:\s*\d+,/,
        "maxInFlight: Number(process.env.MOCK_MAX_IN_FLIGHT ?? 2),"
    );
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
let createContextAttempts = 0;

function event(type, data = {}) {
  const eventLog = process.env.MOCK_EVENT_LOG;
  if (!eventLog) return;

  appendFileSync(eventLog, JSON.stringify({
    type,
    at: Date.now(),
    ...data,
  }) + "\\n");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readDelay(name, fallback) {
  const value = Number(process.env[name] ?? fallback);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function readInt(name, fallback) {
  const value = Number(process.env[name] ?? fallback);
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

function createContextAbortPromise({ modelId, contextId, signal }) {
  return new Promise((_, reject) => {
    if (!signal) return;

    const settleDelayMs = readDelay("MOCK_CONTEXT_ABORT_SETTLE_DELAY_MS", 0);

    const settle = (when) => {
      event("context.abort-observed", {
        modelId,
        contextId,
        when,
        reason: signal.reason?.message ?? String(signal.reason ?? "aborted"),
      });

      setTimeout(() => {
        event("context.abort-settled", { modelId, contextId });
        reject(signal.reason ?? new Error("context aborted"));
      }, settleDelayMs);
    };

    if (signal.aborted) {
      settle("before-start");
      return;
    }

    signal.addEventListener("abort", () => settle("during-create"), { once: true });
  });
}

async function waitForContextOrAbort({ modelId, contextId, signal }) {
  const delayMs = readDelay("MOCK_CONTEXT_DELAY_MS", 0);

  if (process.env.MOCK_IGNORE_CREATE_SIGNAL === "1") {
    await sleep(delayMs);
    return;
  }

  await Promise.race([
    sleep(delayMs),
    createContextAbortPromise({ modelId, contextId, signal }),
  ]);
}

export async function getLlama() {
  event("llama.get");

  return {
    async loadModel() {
      const modelId = ++nextModelId;
      event("model.load", { modelId });
      await sleep(readDelay("MOCK_LOAD_DELAY_MS", 0));

      return {
        disposed: false,
        detokenize(tokens) {
          return String(tokens?.join ? tokens.join("") : tokens);
        },
        async createContext(options = {}) {
          const contextId = ++nextContextId;
          createContextAttempts += 1;

          event("context.create", {
            modelId,
            contextId,
            attempt: createContextAttempts,
            hasCreateSignal: !!options.createSignal,
            createSignalAbortedAtStart: options.createSignal?.aborted === true,
            optionKeys: Object.keys(options).sort(),
          });

          const failCount = readInt("MOCK_CONTEXT_FAILS", 0);
          if (createContextAttempts <= failCount) {
            event("context.fail", { modelId, contextId, attempt: createContextAttempts });
            throw new Error("mock createContext failure #" + createContextAttempts);
          }

          await waitForContextOrAbort({
            modelId,
            contextId,
            signal: options.createSignal,
          });

          event("context.finish", { modelId, contextId, attempt: createContextAttempts });

          return {
            disposed: false,
            contextId,
            getSequence() {
              return { modelId, contextId };
            },
            async dispose() {
              this.disposed = true;
              event("context.dispose", { modelId, contextId });
            },
          };
        },
        async dispose() {
          this.disposed = true;
          event("model.dispose", { modelId });
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

    if (options.signal?.aborted) {
      event("prompt.abort-observed", { text, sessionId: this.sessionId, beforeStart: true });
      throw options.signal.reason ?? new Error("prompt aborted");
    }

    await sleep(readDelay("MOCK_PROMPT_DELAY_MS", 0));

    if (options.signal?.aborted) {
      event("prompt.abort-observed", { text, sessionId: this.sessionId, afterDelay: true });
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
        ...env
    };

    for (const [key, value] of Object.entries(mergedEnv)) {
        oldEnv[key] = process.env[key];
        process.env[key] = String(value);
    }

    try {
        const runtimeUrl = pathToFileURL(path.join(tmpRoot, "runtime.mjs")).href;
        const runtime = await import(`${runtimeUrl}?mode=${MODE}&t=${Date.now()}`);
        await fn(runtime, eventLogPath);
    } finally {
        for (const key of Object.keys(mergedEnv)) {
            if (oldEnv[key] === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = oldEnv[key];
            }
        }

        await rm(tmpRoot, { recursive: true, force: true });
    }
}

async function modeCreateSignalIsPassed() {
    logSection("createSignal is passed to createContext");

    await withMockRuntime(async ({ initModel, prompt, shutdownRuntime }, eventLogPath) => {
        await initModel();

        const req = await prompt("create-signal-passed", { stream: false });
        const result = await readPromptResult(req);
        assert.match(result, /create-signal-passed/, "mock prompt completed");

        await shutdownRuntime({ mode: "abort" });

        const events = await readEvents(eventLogPath);
        const creates = events.filter((event) => event.type === "context.create");
        assert.equal(creates.length, 1, "one context was created");
        assert.equal(creates[0].hasCreateSignal, true, "createSignal option was present");
        assert.equal(creates[0].optionKeys.includes("createSignal"), true, "createSignal key reached createContext options");
    });

    console.log("[OK] createSignal reached createContext");
}

async function modeCancelDuringContextCreationAbortsCreateSignal() {
    logSection("cancel during context creation aborts createSignal");

    await withMockRuntime(async ({ initModel, prompt, cancelPrompt, shutdownRuntime }, eventLogPath) => {
        await initModel();

        const req = await prompt("cancel-context-A", { stream: false });
        req.done.catch(() => {});

        await waitForEvent(eventLogPath, (event) => (
            event.type === "context.create" && event.hasCreateSignal === true
        ), "context.create with createSignal");

        assert.equal(cancelPrompt(req.id), true, "parent cancel accepted");
        await expectReject("parent canceled context-creating prompt", () => readPromptResult(req), "Prompt canceled");

        await waitForEvent(eventLogPath, (event) => event.type === "context.abort-settled", "context.abort-settled");

        await shutdownRuntime({ mode: "abort" });

        const events = await readEvents(eventLogPath);
        assert.equal(events.filter((event) => event.type === "context.create").length, 1, "canceled request did not retry context creation");
        assertNoEvent(events, (event) => event.type === "prompt.start", "prompt.start after context cancellation");
    }, {
        MOCK_CONTEXT_DELAY_MS: 1000,
        MOCK_CONTEXT_ABORT_SETTLE_DELAY_MS: 25
    });

    console.log("[OK] cancel during context creation aborted createSignal");
}

async function modeContextAbortDoesNotRetryCanceledRequest() {
    logSection("context abort does not retry canceled request");

    await withMockRuntime(async ({ initModel, prompt, cancelPrompt, shutdownRuntime }, eventLogPath) => {
        await initModel();

        const req = await prompt("cancel-no-retry-A", { stream: false });
        req.done.catch(() => {});

        await waitForEvent(eventLogPath, (event) => event.type === "context.create", "context.create cancel-no-retry-A");

        assert.equal(cancelPrompt(req.id), true);
        await expectReject("canceled context request", () => readPromptResult(req), "Prompt canceled");
        await waitForEvent(eventLogPath, (event) => event.type === "context.abort-settled", "context.abort-settled cancel-no-retry-A");

        await shutdownRuntime({ mode: "abort" });

        const events = await readEvents(eventLogPath);
        assert.equal(events.filter((event) => event.type === "context.create").length, 1, "cancellation stops retry ladder");
    }, {
        MOCK_CONTEXT_DELAY_MS: 1000,
        MOCK_CONTEXT_ABORT_SETTLE_DELAY_MS: 10
    });

    console.log("[OK] canceled context creation did not retry");
}

async function modeContextFailureStillRetries() {
    logSection("genuine context failure still retries");

    await withMockRuntime(async ({ initModel, prompt, shutdownRuntime }, eventLogPath) => {
        await initModel();

        const req = await prompt("context-failure-retries", { stream: false });
        const result = await readPromptResult(req);
        assert.match(result, /context-failure-retries/);

        await shutdownRuntime({ mode: "abort" });

        const events = await readEvents(eventLogPath);
        const creates = events.filter((event) => event.type === "context.create");
        const failures = events.filter((event) => event.type === "context.fail");

        assert.equal(creates.length, 3, "two genuine failures then one successful retry");
        assert.equal(failures.length, 2, "two forced context failures occurred");
        assert.equal(creates.every((event) => event.hasCreateSignal === true), true, "every retry attempt receives createSignal");
    }, {
        MOCK_CONTEXT_FAILS: 2
    });

    console.log("[OK] genuine context creation failures still retry");
}

async function modeIgnoredCreateSignalDisposesPartialArtifacts() {
    logSection("ignored createSignal returns later and partial artifacts are disposed");

    await withMockRuntime(async ({ initModel, prompt, cancelPrompt, shutdownRuntime }, eventLogPath) => {
        await initModel();

        const req = await prompt("ignored-signal-A", { stream: false });
        req.done.catch(() => {});

        await waitForEvent(eventLogPath, (event) => event.type === "context.create", "context.create ignored-signal-A");

        assert.equal(cancelPrompt(req.id), true);
        await expectReject("ignored-signal parent request canceled", () => readPromptResult(req), "Prompt canceled");

        await waitForEvent(eventLogPath, (event) => event.type === "context.dispose", "context.dispose ignored-signal-A");

        await shutdownRuntime({ mode: "abort" });

        const events = await readEvents(eventLogPath);
        assert.equal(events.filter((event) => event.type === "context.create").length, 1, "ignored createSignal did not cause retry");
        assert.equal(events.some((event) => event.type === "session.dispose"), true, "partial session was disposed");
        assert.equal(events.some((event) => event.type === "context.dispose"), true, "partial context was disposed");
        assertNoEvent(events, (event) => event.type === "prompt.start", "prompt.start after ignored-signal cancellation");
    }, {
        MOCK_CONTEXT_DELAY_MS: 100,
        MOCK_IGNORE_CREATE_SIGNAL: 1
    });

    console.log("[OK] ignored createSignal fallback disposed partial artifacts");
}

async function modeResetSessionDuringContextCreation() {
    logSection("resetSession aborts context creation before resolving");

    await withMockRuntime(async ({ initModel, prompt, resetSession, shutdownRuntime }, eventLogPath) => {
        await initModel();

        const req = await prompt("reset-context-A", { sessionId: "alpha", stream: false });
        req.done.catch(() => {});

        await waitForEvent(eventLogPath, (event) => event.type === "context.create", "context.create reset-context-A");

        const resetPromise = resetSession("alpha");

        await Promise.all([
            expectReject("session reset canceled context request", () => readPromptResult(req), "Session reset: alpha"),
            withDeadline(resetPromise, 5000, "resetSession during context creation")
        ]);

        const events = await readEvents(eventLogPath);
        assert.equal(events.some((event) => event.type === "context.abort-observed"), true, "context abort should be observed during resetSession");
        assert.equal(events.some((event) => event.type === "context.abort-settled"), true, "context abort boundary should settle during resetSession");
        assertNoEvent(events, (event) => event.type === "prompt.start", "prompt.start after resetSession context abort");

        await shutdownRuntime({ mode: "abort" });
    }, {
        MOCK_CONTEXT_DELAY_MS: 1000,
        MOCK_CONTEXT_ABORT_SETTLE_DELAY_MS: 25
    });

    console.log("[OK] resetSession waited for context creation boundary");
}

async function modeResetModelDuringContextCreation() {
    logSection("resetModel aborts context creation before model dispose");

    await withMockRuntime(async ({ initModel, prompt, resetModel, shutdownRuntime }, eventLogPath) => {
        await initModel();

        const req = await prompt("reset-model-context-A", { stream: false });
        req.done.catch(() => {});

        await waitForEvent(eventLogPath, (event) => event.type === "context.create", "context.create reset-model-context-A");

        await Promise.all([
            expectReject("model reset canceled context request", () => readPromptResult(req), "Model reset"),
            resetModel()
        ]);

        const events = await readEvents(eventLogPath);
        assertEventOrder(
            events,
            (event) => event.type === "context.abort-settled",
            (event) => event.type === "model.dispose",
            "resetModel context boundary before model.dispose"
        );
        assertNoEvent(events, (event) => event.type === "prompt.start", "prompt.start after resetModel context abort");

        await shutdownRuntime({ mode: "abort" });
    }, {
        MOCK_CONTEXT_DELAY_MS: 1000,
        MOCK_CONTEXT_ABORT_SETTLE_DELAY_MS: 25
    });

    console.log("[OK] resetModel waited for context creation boundary before dispose");
}

async function modeShutdownAbortDuringContextCreation() {
    logSection("shutdown abort waits for context creation abort before model dispose");

    await withMockRuntime(async ({ initModel, prompt, shutdownRuntime }, eventLogPath) => {
        await initModel();

        const req = await prompt("shutdown-context-A", { stream: false });
        req.done.catch(() => {});

        await waitForEvent(eventLogPath, (event) => event.type === "context.create", "context.create shutdown-context-A");

        await Promise.all([
            expectReject("shutdown canceled context request", () => readPromptResult(req), "Runtime shutdown"),
            shutdownRuntime({ mode: "abort" })
        ]);

        const events = await readEvents(eventLogPath);
        assertEventOrder(
            events,
            (event) => event.type === "context.abort-settled",
            (event) => event.type === "model.dispose",
            "shutdown context boundary before model.dispose"
        );
        assertNoEvent(events, (event) => event.type === "prompt.start", "prompt.start after shutdown context abort");
    }, {
        MOCK_CONTEXT_DELAY_MS: 1000,
        MOCK_CONTEXT_ABORT_SETTLE_DELAY_MS: 25
    });

    console.log("[OK] shutdown abort waited for context creation boundary before dispose");
}

async function modeDrainTimeoutDuringContextCreation() {
    logSection("drain-with-timeout aborts context creation only after timeout");

    await withMockRuntime(async ({ initModel, prompt, shutdownRuntime }, eventLogPath) => {
        await initModel();

        const req = await prompt("drain-timeout-context-A", { stream: false });
        req.done.catch(() => {});

        await waitForEvent(eventLogPath, (event) => event.type === "context.create", "context.create drain-timeout-context-A");

        await Promise.all([
            expectReject("drain timeout canceled context request", () => readPromptResult(req), "Runtime shutdown"),
            shutdownRuntime({ mode: "drain-with-timeout", timeoutMs: 50 })
        ]);

        const events = await readEvents(eventLogPath);
        assertEventOrder(
            events,
            (event) => event.type === "context.abort-settled",
            (event) => event.type === "model.dispose",
            "drain-timeout context boundary before model.dispose"
        );
    }, {
        MOCK_CONTEXT_DELAY_MS: 1000,
        MOCK_CONTEXT_ABORT_SETTLE_DELAY_MS: 25
    });

    console.log("[OK] drain-with-timeout aborted context creation after timeout");
}

async function modePlainDrainDoesNotAbortContextCreation() {
    logSection("plain drain does not abort context creation");

    await withMockRuntime(async ({ initModel, prompt, shutdownRuntime }, eventLogPath) => {
        await initModel();

        const req = await prompt("plain-drain-context-A", { stream: false });
        const shutdownPromise = (async () => {
            await waitForEvent(eventLogPath, (event) => event.type === "context.create", "context.create plain-drain-context-A");
            return shutdownRuntime({ mode: "drain" });
        })();

        const result = await withDeadline(readPromptResult(req), 5000, "plain drain prompt result");
        assert.match(result, /plain-drain-context-A/);

        await withDeadline(shutdownPromise, 5000, "plain drain shutdown");

        const events = await readEvents(eventLogPath);
        assertNoEvent(events, (event) => event.type === "context.abort-observed", "context abort during plain drain");
        assert.equal(events.some((event) => event.type === "prompt.finish"), true, "accepted prompt finished during plain drain");
    }, {
        MOCK_CONTEXT_DELAY_MS: 100,
        MOCK_PROMPT_DELAY_MS: 1
    });

    console.log("[OK] plain drain did not abort context creation");
}


function readEnvInt(name, fallback) {
    const value = Number(process.env[name] ?? fallback);
    return Number.isInteger(value) && value > 0 ? value : fallback;
}

async function realPromptResult(req) {
    return readPromptResult(req);
}

async function realInit(runtime) {
    await withDeadline(
        runtime.initModel({
            attempts: 2,
            readyTimeoutMs: readEnvInt("REAL_READY_TIMEOUT_MS", 120000),
            retryDelayMs: 100,
            configOverride: {
                context: {
                    contextSize: readEnvInt("REAL_SMOKE_CONTEXT_SIZE", 2048),
                    batchSize: readEnvInt("REAL_SMOKE_BATCH_SIZE", 128)
                }
            }
        }),
        readEnvInt("REAL_READY_TIMEOUT_MS", 120000) + 30000,
        "real initModel"
    );
}

async function modeRealFreshSessionCancelContextBoundary() {
    logSection("real fresh-session cancel context boundary");

    const runtime = await import(pathToFileURL(path.join(REPO_ROOT, "runtime.mjs")).href);
    await realInit(runtime);

    const sessionId = `real-cancel-${Date.now()}`;
    const req = await runtime.prompt("Write a long explanation of recursion.", {
        sessionId,
        stream: true
    });

    req.done.catch(() => {});

    setTimeout(() => {
        runtime.cancelPrompt(req.id);
    }, readEnvInt("REAL_CONTEXT_CANCEL_DELAY_MS", 25));

    await withDeadline(
        expectReject("real fresh-session cancel request", () => realPromptResult(req), "Prompt canceled"),
        readEnvInt("REAL_CONTEXT_BOUNDARY_DEADLINE_MS", 240000),
        "real fresh-session cancel boundary"
    );

    const after = await runtime.prompt("Say OK briefly.", { sessionId, stream: false });
    await withDeadline(realPromptResult(after), readEnvInt("REAL_PROMPT_DEADLINE_MS", 300000), "real prompt after cancel boundary");

    await withDeadline(
        runtime.shutdownRuntime({ mode: "abort" }),
        readEnvInt("REAL_SHUTDOWN_DEADLINE_MS", 240000),
        "real shutdown after cancel boundary"
    );

    console.log("[OK] real fresh-session cancel context boundary completed");
}

async function modeRealFreshSessionResetContextBoundary() {
    logSection("real fresh-session reset context boundary");

    const runtime = await import(pathToFileURL(path.join(REPO_ROOT, "runtime.mjs")).href);
    await realInit(runtime);

    const sessionId = `real-reset-${Date.now()}`;
    const req = await runtime.prompt("Write a long explanation of recursion.", {
        sessionId,
        stream: true
    });

    req.done.catch(() => {});

    await sleep(readEnvInt("REAL_CONTEXT_CANCEL_DELAY_MS", 25));

    await Promise.all([
        withDeadline(
            expectReject("real fresh-session reset request", () => realPromptResult(req), `Session reset: ${sessionId}`),
            readEnvInt("REAL_CONTEXT_BOUNDARY_DEADLINE_MS", 240000),
            "real reset request rejection"
        ),
        withDeadline(
            runtime.resetSession(sessionId),
            readEnvInt("REAL_CONTEXT_BOUNDARY_DEADLINE_MS", 240000),
            "real resetSession context boundary"
        )
    ]);

    const after = await runtime.prompt("Say OK briefly.", { sessionId, stream: false });
    await withDeadline(realPromptResult(after), readEnvInt("REAL_PROMPT_DEADLINE_MS", 300000), "real prompt after reset boundary");

    await withDeadline(
        runtime.shutdownRuntime({ mode: "abort" }),
        readEnvInt("REAL_SHUTDOWN_DEADLINE_MS", 240000),
        "real shutdown after reset boundary"
    );

    console.log("[OK] real fresh-session reset context boundary completed");
}

async function modeRealFreshSessionShutdownContextBoundary() {
    logSection("real fresh-session shutdown context boundary");

    const runtime = await import(pathToFileURL(path.join(REPO_ROOT, "runtime.mjs")).href);
    await realInit(runtime);

    const sessionId = `real-shutdown-${Date.now()}`;
    const req = await runtime.prompt("Write a long explanation of recursion.", {
        sessionId,
        stream: true
    });

    req.done.catch(() => {});

    await sleep(readEnvInt("REAL_CONTEXT_CANCEL_DELAY_MS", 25));

    await Promise.all([
        withDeadline(
            expectReject("real fresh-session shutdown request", () => realPromptResult(req), "Runtime shutdown"),
            readEnvInt("REAL_CONTEXT_BOUNDARY_DEADLINE_MS", 240000),
            "real shutdown request rejection"
        ),
        withDeadline(
            runtime.shutdownRuntime({ mode: "abort" }),
            readEnvInt("REAL_SHUTDOWN_DEADLINE_MS", 240000),
            "real shutdown context boundary"
        )
    ]);

    console.log("[OK] real fresh-session shutdown context boundary completed");
}

async function realOrchestrator() {
    const modes = [
        "real-fresh-session-cancel-context-boundary",
        "real-fresh-session-reset-context-boundary",
        "real-fresh-session-shutdown-context-boundary"
    ];

    for (const mode of modes) {
        logSection(`child mode: ${mode}`);
        await runChild(mode);
    }

    console.log("\nAll real context creation cancel-boundary smoke tests finished.");
}

async function orchestrator() {
    const modes = [
        "mock-create-signal-is-passed-to-create-context",
        "mock-cancel-during-context-creation-aborts-create-signal",
        "mock-context-abort-does-not-retry-canceled-request",
        "mock-context-real-failure-still-retries",
        "mock-context-abort-cleans-partial-artifacts",
        "mock-reset-session-during-context-creation-aborts-before-dispose",
        "mock-reset-model-during-context-creation-aborts-before-model-dispose",
        "mock-shutdown-abort-during-context-creation-aborts-before-model-dispose",
        "mock-drain-timeout-during-context-creation-aborts-after-timeout",
        "mock-plain-drain-does-not-abort-context-creation"
    ];

    for (const mode of modes) {
        logSection(`child mode: ${mode}`);
        await runChild(mode);
    }

    if (process.env.REAL_RUNTIME === "1") {
        logSection("real-runtime modes");
        await realOrchestrator();
    }

    console.log("\nAll context creation cancel-boundary smoke tests finished.");
}

async function main() {
    console.log("[SMOKE] mode:", MODE);

    switch (MODE) {
        case "orchestrator":
            await orchestrator();
            break;
        case "mock-create-signal-is-passed-to-create-context":
            await modeCreateSignalIsPassed();
            break;
        case "mock-cancel-during-context-creation-aborts-create-signal":
            await modeCancelDuringContextCreationAbortsCreateSignal();
            break;
        case "mock-context-abort-does-not-retry-canceled-request":
            await modeContextAbortDoesNotRetryCanceledRequest();
            break;
        case "mock-context-real-failure-still-retries":
            await modeContextFailureStillRetries();
            break;
        case "mock-context-abort-cleans-partial-artifacts":
            await modeIgnoredCreateSignalDisposesPartialArtifacts();
            break;
        case "mock-reset-session-during-context-creation-aborts-before-dispose":
            await modeResetSessionDuringContextCreation();
            break;
        case "mock-reset-model-during-context-creation-aborts-before-model-dispose":
            await modeResetModelDuringContextCreation();
            break;
        case "mock-shutdown-abort-during-context-creation-aborts-before-model-dispose":
            await modeShutdownAbortDuringContextCreation();
            break;
        case "mock-drain-timeout-during-context-creation-aborts-after-timeout":
            await modeDrainTimeoutDuringContextCreation();
            break;
        case "mock-plain-drain-does-not-abort-context-creation":
            await modePlainDrainDoesNotAbortContextCreation();
            break;
        case "real-orchestrator":
            await realOrchestrator();
            break;
        case "real-fresh-session-cancel-context-boundary":
            await modeRealFreshSessionCancelContextBoundary();
            break;
        case "real-fresh-session-reset-context-boundary":
            await modeRealFreshSessionResetContextBoundary();
            break;
        case "real-fresh-session-shutdown-context-boundary":
            await modeRealFreshSessionShutdownContextBoundary();
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
