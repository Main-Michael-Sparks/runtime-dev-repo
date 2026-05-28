// smokeTestWorkerNativeCancellationBoundary.mjs
//
// Purpose:
// - Branch-scoped deterministic smoke coverage for worker-native cancellation boundaries.
// - Verifies worker-side AbortSignal observation and disposal ordering with a fake node-llama-cpp.
// - Verifies MessageChannel cancel delivery through onToken polling during a blocked token loop.
// - Provides optional real-runtime modes that exercise the local model and node-llama-cpp AbortSignal path.
// - Complements smokeTestDrainShutdown.mjs, which primarily preserves parent-side shutdown behavior.
//
// Run deterministic/mock smoke:
//   node ./tests/smokeTestWorkerNativeCancellationBoundary.mjs
//
// Run mock + branch-scoped real-runtime smoke against local node-llama-cpp/model setup:
//   REAL_RUNTIME=1 node ./tests/smokeTestWorkerNativeCancellationBoundary.mjs
//
// Windows PowerShell:
//   $env:REAL_RUNTIME="1"; node ./tests/smokeTestWorkerNativeCancellationBoundary.mjs
//   Remove-Item Env:REAL_RUNTIME
//
// Windows cmd.exe:
//   set REAL_RUNTIME=1&& node ./tests/smokeTestWorkerNativeCancellationBoundary.mjs
//
// Run only real-runtime modes:
//   SMOKE_MODE=real-orchestrator node ./tests/smokeTestWorkerNativeCancellationBoundary.mjs
//   SMOKE_MODE=real-cancel-active-prompt-native-boundary node ./tests/smokeTestWorkerNativeCancellationBoundary.mjs
//   SMOKE_MODE=real-reset-session-active-prompt-native-boundary node ./tests/smokeTestWorkerNativeCancellationBoundary.mjs
//   SMOKE_MODE=real-shutdown-abort-native-boundary node ./tests/smokeTestWorkerNativeCancellationBoundary.mjs
//   SMOKE_MODE=real-drain-timeout-native-boundary node ./tests/smokeTestWorkerNativeCancellationBoundary.mjs
//
// Useful real-runtime tuning env vars:
//   REAL_READY_TIMEOUT_MS=120000
//   REAL_PROMPT_DEADLINE_MS=300000
//   REAL_SHUTDOWN_DEADLINE_MS=240000
//   REAL_ACTIVE_PROMPT_CANCEL_DELAY_MS=1
//   REAL_NATIVE_BOUNDARY_DEADLINE_MS=240000
//   REAL_FIRST_CHUNK_TIMEOUT_MS=120000
//   REAL_SMOKE_CONTEXT_SIZE=2048
//   REAL_SMOKE_BATCH_SIZE=128
//
// Notes:
// - Child processes isolate runtime/module state per scenario.
// - Mock modes build a temporary fixture with a fake node-llama-cpp package.
// - Real-runtime modes import the repository runtime directly and require a working local model setup.
// - Real-runtime modes cannot inspect worker internals directly; they prove native-boundary behavior by
//   requiring cancel/reset/shutdown to complete and then, where applicable, requiring the same session to work again.
// - The default active-prompt delay is intentionally short so fast local models do not finish before reset/shutdown is issued.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const SMOKE_TEST_VERSION = "worker-native-cancellation-boundary-v1-message-channel-v9";
const MODE = process.env.SMOKE_MODE || "orchestrator";
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

function readPositiveIntEnv(name, fallback) {
    const raw = process.env[name];
    if (raw === undefined || raw === "") return fallback;

    const value = Number(raw);
    if (!Number.isInteger(value) || value < 1) {
        throw new Error(`${name} must be a positive integer`);
    }

    return value;
}


function readOptionalPositiveIntEnv(name) {
    const raw = process.env[name];
    if (raw === undefined || raw === "") return null;

    const value = Number(raw);
    if (!Number.isInteger(value) || value < 1) {
        throw new Error(`${name} must be a positive integer`);
    }

    return value;
}

function buildRealInitOptions(readyTimeoutMs) {
    const contextSize = readOptionalPositiveIntEnv("REAL_SMOKE_CONTEXT_SIZE") ?? 2048;
    const batchSize = readOptionalPositiveIntEnv("REAL_SMOKE_BATCH_SIZE") ?? 128;

    return {
        attempts: 1,
        readyTimeoutMs,
        configOverride: {
            context: {
                contextSize,
                batchSize
            }
        }
    };
}

function shouldRunRealRuntimeModes() {
    const raw = String(process.env.REAL_RUNTIME ?? "").trim().toLowerCase();
    return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

async function waitForCondition(predicate, timeoutMs, label, intervalMs = 25) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
        if (predicate()) return true;
        await sleep(intervalMs);
    }

    throw new Error(`[FAIL] timed out waiting for ${label} after ${timeoutMs}ms`);
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

function startStreamPump(req, { logChunks = false } = {}) {
    const stats = {
        chunks: 0,
        text: ""
    };

    const done = (async () => {
        if (!req.stream) return stats;

        const reader = req.stream.getReader();

        while (true) {
            const { value, done: streamDone } = await reader.read();
            if (streamDone) break;

            stats.chunks += 1;
            stats.text += String(value ?? "");

            if (logChunks) {
                console.log("chunk:", JSON.stringify(value));
            }
        }

        return stats;
    })();

    return { stats, done };
}

async function waitForFirstStreamChunk(req, pump, label) {
    const timeoutMs = readPositiveIntEnv("REAL_FIRST_CHUNK_TIMEOUT_MS", 120000);

    await Promise.race([
        waitForCondition(
            () => pump.stats.chunks > 0,
            timeoutMs,
            `${label} first streamed chunk`,
            50
        ),
        pump.done.then(
            () => {
                if (pump.stats.chunks === 0) {
                    throw new Error(`[FAIL] ${label} stream closed before first streamed chunk`);
                }
            },
            (err) => {
                throw new Error(
                    `[FAIL] ${label} stream errored before first streamed chunk: ${err?.message ?? err}`
                );
            }
        ),
        req.done.then(
            (value) => {
                if (pump.stats.chunks === 0) {
                    throw new Error(
                        `[FAIL] ${label} request resolved before first streamed chunk: ${String(value).slice(0, 160)}`
                    );
                }
            },
            (err) => {
                throw new Error(
                    `[FAIL] ${label} request rejected before first streamed chunk: ${err?.message ?? err}`
                );
            }
        )
    ]);
}

function collectDone(req) {
    return req.done.then(
        (value) => ({ status: "resolved", value }),
        (err) => ({ status: "rejected", message: err.message })
    );
}

async function readExpectedRejectionAndPump(req, pump, label, expectedText, deadlineMs) {
    await withDeadline(pump.done, deadlineMs, `${label} stream close`);
    await expectReject(label, () => req.done, expectedText);
}

function longRealPrompt(label) {
    return `${label}. Begin immediately, then write a numbered list of 120 short items about runtime lifecycle safety. ` +
        `Keep each item short and continue until complete.`;
}

async function importRealRuntime(label) {
    const inferenceUrl = pathToFileURL(path.join(REPO_ROOT, "inference.mjs")).href;
    return import(`${inferenceUrl}?mode=${MODE}&label=${label}&t=${Date.now()}`);
}

async function readShortRealPrompt(prompt, text, options = {}) {
    const req = await prompt(text, {
        stream: false,
        ...options
    });

    return req.done;
}

async function warmRealSession(prompt, sessionId, label, deadlineMs) {
    const result = await withDeadline(
        readShortRealPrompt(prompt, "Reply with exactly: OK", { sessionId }),
        deadlineMs,
        `${label} warmup prompt`
    );

    if (typeof result !== "string" || result.length === 0) {
        throw new Error(`[FAIL] ${label} warmup prompt produced no text`);
    }

    console.log(`[OK] ${label} warmup prompt resolved`);
}

async function readEvents(eventLogPath) {
    let text = "";

    try {
        text = await readFile(eventLogPath, "utf8");
    } catch {
        return [];
    }

    return text
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
}

async function waitForEvent(eventLogPath, predicate, label, timeoutMs = 3000) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
        const events = await readEvents(eventLogPath);
        const found = events.find(predicate);

        if (found) return found;
        await sleep(10);
    }

    const events = await readEvents(eventLogPath);
    throw new Error(`[FAIL] timed out waiting for ${label}. Events: ${JSON.stringify(events, null, 2)}`);
}

function eventIndex(events, predicate) {
    return events.findIndex(predicate);
}

function assertEventOrder(events, firstPredicate, secondPredicate, label) {
    const firstIndex = eventIndex(events, firstPredicate);
    const secondIndex = eventIndex(events, secondPredicate);

    assert.notEqual(firstIndex, -1, `[FAIL] missing first event for ${label}`);
    assert.notEqual(secondIndex, -1, `[FAIL] missing second event for ${label}`);
    assert.ok(firstIndex < secondIndex, `[FAIL] incorrect event order for ${label}`);
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

async function copyRuntimeFixture() {
    const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "runtime-worker-native-cancel-"));

    for (const rel of RUNTIME_FILES) {
        const src = path.join(REPO_ROOT, rel);
        const dest = path.join(tmpRoot, rel);
        await mkdir(path.dirname(dest), { recursive: true });
        await cp(src, dest);
    }

    const configPath = path.join(tmpRoot, "config.mjs");
    let configText = await readFile(configPath, "utf8");
    configText = configText.replace(
        /maxInFlight:\s*\d+,/,
        "maxInFlight: Number(process.env.MOCK_MAX_IN_FLIGHT ?? 2),"
    );
    configText = configText.replace(
        /maxCount:\s*\d+/,
        "maxCount: Number(process.env.MOCK_SESSION_MAX_COUNT ?? 50)"
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

function blockWorkerThread(ms) {
  if (ms <= 0) return;

  const buffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
  const view = new Int32Array(buffer);
  Atomics.wait(view, 0, 0, ms);
}

function settleAbort({ text, sessionId, signal, reject }) {
  const abortSettleDelayMs = readDelay("MOCK_ABORT_SETTLE_DELAY_MS", 0);
  event("prompt.abort-observed", { text, sessionId });

  setTimeout(() => {
    event("prompt.abort-settled", { text, sessionId });
    reject(signal.reason ?? new Error("aborted"));
  }, abortSettleDelayMs);
}

function waitForPromptOrAbort({ text, sessionId, signal }) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      event("prompt.abort-observed", { text, sessionId, beforeStart: true });
      reject(signal.reason ?? new Error("aborted"));
      return;
    }

    const promptDelayMs = readDelay("MOCK_PROMPT_DELAY_MS", 1000);
    const abortSettleDelayMs = readDelay("MOCK_ABORT_SETTLE_DELAY_MS", 0);

    let settled = false;
    let abortListener = null;

    const cleanup = () => {
      if (abortListener && signal) {
        signal.removeEventListener("abort", abortListener);
      }
    };

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      event("prompt.finish", { text, sessionId });
      resolve();
    }, promptDelayMs);

    abortListener = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      settleAbort({
        text,
        sessionId,
        signal,
        reject: (err) => {
          cleanup();
          reject(err);
        },
      });
    };

    signal?.addEventListener("abort", abortListener, { once: true });
  });
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
          return String(tokens.join ? tokens.join("") : tokens);
        },
        async createContext() {
          const contextId = ++nextContextId;
          event("context.create", { modelId, contextId });
          await sleep(readDelay("MOCK_CONTEXT_DELAY_MS", 0));

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

    const tokenLoopTicks = readInt("MOCK_TOKEN_LOOP_TICKS", 0);

    if (tokenLoopTicks > 0) {
      const blockMs = readDelay("MOCK_TOKEN_LOOP_BLOCK_MS", 5);

      for (let i = 0; i < tokenLoopTicks; i++) {
        if (options.signal?.aborted) {
          event("prompt.abort-observed", { text, sessionId: this.sessionId, beforeToken: true });
          throw options.signal.reason ?? new Error("aborted");
        }

        event("prompt.token", { text, sessionId: this.sessionId, index: i });
        options.onToken?.("tick-" + i + " ");

        if (options.signal?.aborted) {
          event("prompt.abort-observed", { text, sessionId: this.sessionId, afterToken: true });
          event("prompt.abort-settled", { text, sessionId: this.sessionId });
          throw options.signal.reason ?? new Error("aborted");
        }

        blockWorkerThread(blockMs);
      }

      event("prompt.finish", { text, sessionId: this.sessionId });
      return "mock response: " + String(text).slice(0, 32);
    }

    await waitForPromptOrAbort({ text, sessionId: this.sessionId, signal: options.signal });

    const output = "mock response: " + String(text).slice(0, 32);
    if (process.env.MOCK_SKIP_ON_TOKEN !== "1") {
      options.onToken?.(output);
    }
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
        const inferenceUrl = pathToFileURL(path.join(tmpRoot, "inference.mjs")).href;
        const runtime = await import(`${inferenceUrl}?mode=${MODE}&t=${Date.now()}`);
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

async function modeCancelActivePromptAbortsSignal() {
    logSection("cancel active prompt aborts worker signal");

    await withMockRuntime(async ({ initModel, prompt, cancelPrompt, shutdownRuntime }, eventLogPath) => {
        await initModel();

        const req = await prompt("cancel-active-A");
        req.done.catch(() => {});

        await waitForEvent(eventLogPath, (event) => (
            event.type === "prompt.start" && event.text === "cancel-active-A"
        ), "prompt.start cancel-active-A");

        assert.equal(cancelPrompt(req.id), true);
        await expectReject("parent canceled prompt", () => readPromptResult(req), "Prompt canceled");

        await waitForEvent(eventLogPath, (event) => (
            event.type === "prompt.abort-observed" && event.text === "cancel-active-A"
        ), "prompt.abort-observed cancel-active-A");

        await shutdownRuntime({ mode: "abort" });
    }, {
        MOCK_PROMPT_DELAY_MS: 1000
    });

    console.log("[OK] cancel active prompt reached worker abort signal");
}

async function modeMessageChannelCancelDuringBlockedTokenLoop() {
    logSection("MessageChannel cancel reaches worker during blocked token loop");

    await withMockRuntime(async ({ initModel, prompt, cancelPrompt, shutdownRuntime }, eventLogPath) => {
        await initModel();

        const req = await prompt("message-channel-token-loop-A");
        req.done.catch(() => {});

        await waitForEvent(eventLogPath, (event) => (
            event.type === "prompt.token" && event.text === "message-channel-token-loop-A"
        ), "prompt.token message-channel-token-loop-A");

        assert.equal(cancelPrompt(req.id), true);
        await expectReject("message-channel token-loop prompt canceled", () => readPromptResult(req), "Prompt canceled");

        await waitForEvent(eventLogPath, (event) => (
            event.type === "prompt.abort-observed" && event.text === "message-channel-token-loop-A"
        ), "MessageChannel prompt.abort-observed message-channel-token-loop-A", 5000);

        await shutdownRuntime({ mode: "abort" });
    }, {
        MOCK_TOKEN_LOOP_TICKS: 400,
        MOCK_TOKEN_LOOP_BLOCK_MS: 5
    });

    console.log("[OK] MessageChannel cancellation reached blocked token loop");
}

async function modeResetSessionAbortsBeforeDispose() {
    logSection("resetSession aborts active prompt before session dispose");

    await withMockRuntime(async ({ initModel, prompt, resetSession, shutdownRuntime }, eventLogPath) => {
        await initModel();

        const req = await prompt("reset-session-A", { sessionId: "alpha" });
        req.done.catch(() => {});

        await waitForEvent(eventLogPath, (event) => (
            event.type === "prompt.start" && event.text === "reset-session-A"
        ), "prompt.start reset-session-A");

        await Promise.all([
            expectReject("session reset canceled prompt", () => readPromptResult(req), "Session reset: alpha"),
            resetSession("alpha")
        ]);

        const events = await readEvents(eventLogPath);
        assertEventOrder(
            events,
            (event) => event.type === "prompt.abort-settled" && event.text === "reset-session-A",
            (event) => event.type === "session.dispose",
            "resetSession prompt abort before session dispose"
        );
        assertEventOrder(
            events,
            (event) => event.type === "prompt.abort-settled" && event.text === "reset-session-A",
            (event) => event.type === "context.dispose",
            "resetSession prompt abort before context dispose"
        );

        await shutdownRuntime({ mode: "abort" });
    }, {
        MOCK_PROMPT_DELAY_MS: 1000,
        MOCK_ABORT_SETTLE_DELAY_MS: 50
    });

    console.log("[OK] resetSession waited for native prompt boundary before dispose");
}

async function modeResetModelAbortsBeforeDispose() {
    logSection("resetModel aborts active prompts before model dispose");

    await withMockRuntime(async ({ initModel, prompt, resetModel, shutdownRuntime }, eventLogPath) => {
        await initModel();

        const req = await prompt("reset-model-A");
        req.done.catch(() => {});

        await waitForEvent(eventLogPath, (event) => (
            event.type === "prompt.start" && event.text === "reset-model-A"
        ), "prompt.start reset-model-A");

        await Promise.all([
            expectReject("model reset canceled prompt", () => readPromptResult(req), "Model reset"),
            resetModel()
        ]);

        const events = await readEvents(eventLogPath);
        assertEventOrder(
            events,
            (event) => event.type === "prompt.abort-settled" && event.text === "reset-model-A",
            (event) => event.type === "model.dispose",
            "resetModel prompt abort before model dispose"
        );

        await shutdownRuntime({ mode: "abort" });
    }, {
        MOCK_PROMPT_DELAY_MS: 1000,
        MOCK_ABORT_SETTLE_DELAY_MS: 50
    });

    console.log("[OK] resetModel waited for native prompt boundary before model dispose");
}

async function modeShutdownAbortAbortsBeforeDispose() {
    logSection("shutdown abort waits for native abort before model dispose");

    await withMockRuntime(async ({ initModel, prompt, shutdownRuntime }, eventLogPath) => {
        await initModel();

        const req = await prompt("shutdown-abort-A");
        req.done.catch(() => {});

        await waitForEvent(eventLogPath, (event) => (
            event.type === "prompt.start" && event.text === "shutdown-abort-A"
        ), "prompt.start shutdown-abort-A");

        await Promise.all([
            expectReject("shutdown canceled prompt", () => readPromptResult(req), "Runtime shutdown"),
            shutdownRuntime({ mode: "abort" })
        ]);

        const events = await readEvents(eventLogPath);
        assertEventOrder(
            events,
            (event) => event.type === "prompt.abort-settled" && event.text === "shutdown-abort-A",
            (event) => event.type === "model.dispose",
            "shutdown abort prompt boundary before model dispose"
        );
    }, {
        MOCK_PROMPT_DELAY_MS: 1000,
        MOCK_ABORT_SETTLE_DELAY_MS: 50
    });

    console.log("[OK] shutdown abort waited for native prompt boundary before model dispose");
}

async function modeDrainTimeoutAbortsBeforeDispose() {
    logSection("drain-with-timeout aborts after timeout before dispose");

    await withMockRuntime(async ({ initModel, prompt, shutdownRuntime }, eventLogPath) => {
        await initModel();

        const req = await prompt("drain-timeout-A");
        req.done.catch(() => {});

        await waitForEvent(eventLogPath, (event) => (
            event.type === "prompt.start" && event.text === "drain-timeout-A"
        ), "prompt.start drain-timeout-A");

        await Promise.all([
            expectReject("drain-timeout canceled prompt", () => readPromptResult(req), "Runtime shutdown timeout"),
            shutdownRuntime({ mode: "drain-with-timeout", timeoutMs: 25 })
        ]);

        const events = await readEvents(eventLogPath);
        assertEventOrder(
            events,
            (event) => event.type === "prompt.abort-settled" && event.text === "drain-timeout-A",
            (event) => event.type === "model.dispose",
            "drain-timeout prompt boundary before model dispose"
        );
    }, {
        MOCK_PROMPT_DELAY_MS: 1000,
        MOCK_ABORT_SETTLE_DELAY_MS: 50
    });

    console.log("[OK] drain-with-timeout waited for native prompt boundary before dispose");
}

async function modeStreamDoneFallsBackToPromptResult() {
    logSection("streaming done falls back to prompt result when no chunks arrive");

    await withMockRuntime(async ({ prompt, shutdownRuntime }) => {
        const req = await prompt("stream fallback prompt uses result");
        const result = await readPromptResult(req);

        assert.equal(typeof result, "string");
        assert.ok(result.length > 0, "streaming prompt should resolve done with prompt result fallback");
        assert.match(result, /mock response/);

        await shutdownRuntime({ mode: "abort" });
    }, {
        MOCK_SKIP_ON_TOKEN: "1"
    });

    console.log("[OK] streaming done used prompt result fallback when no chunks arrived");
}

async function modeDrainCompletesWithoutAbort() {
    logSection("plain drain completes accepted work without abort");

    await withMockRuntime(async ({ initModel, prompt, shutdownRuntime }, eventLogPath) => {
        await initModel();

        const req = await prompt("plain-drain-A");
        const shutdownPromise = shutdownRuntime({ mode: "drain" });
        const result = await readPromptResult(req);
        await shutdownPromise;

        assert.ok(String(result).includes("mock response"));

        const events = await readEvents(eventLogPath);
        assert.equal(
            eventIndex(events, (event) => event.type === "prompt.abort-observed"),
            -1,
            "[FAIL] plain drain should not abort active prompt"
        );
    }, {
        MOCK_PROMPT_DELAY_MS: 40
    });

    console.log("[OK] plain drain completed accepted work without abort");
}

async function modeCancelThenNextSameSessionWaits() {
    logSection("same-session prompt waits for previous abort boundary");

    await withMockRuntime(async ({ initModel, prompt, cancelPrompt, shutdownRuntime }, eventLogPath) => {
        await initModel();

        const first = await prompt("same-session-A", { sessionId: "alpha" });
        first.done.catch(() => {});

        await waitForEvent(eventLogPath, (event) => (
            event.type === "prompt.start" && event.text === "same-session-A"
        ), "prompt.start same-session-A");

        assert.equal(cancelPrompt(first.id), true);
        await expectReject("first same-session prompt canceled", () => readPromptResult(first), "Prompt canceled");

        const second = await prompt("same-session-B", { sessionId: "alpha" });
        const secondResult = await readPromptResult(second);
        assert.ok(String(secondResult).includes("mock response"));

        const events = await readEvents(eventLogPath);
        assertEventOrder(
            events,
            (event) => event.type === "prompt.abort-settled" && event.text === "same-session-A",
            (event) => event.type === "prompt.start" && event.text === "same-session-B",
            "same-session next prompt waits for prior abort boundary"
        );

        await shutdownRuntime({ mode: "abort" });
    }, {
        MOCK_MAX_IN_FLIGHT: 2,
        MOCK_PROMPT_DELAY_MS: 1000,
        MOCK_ABORT_SETTLE_DELAY_MS: 200
    });

    console.log("[OK] same-session prompt waited for previous abort boundary");
}

async function modeModelResetRejectsDuringSessionReset() {
    logSection("resetModel rejects while session reset is in progress");

    await withMockRuntime(async ({ initModel, prompt, resetSession, resetModel, shutdownRuntime }, eventLogPath) => {
        await initModel();

        const req = await prompt("overlap-reset-model-A", { sessionId: "alpha" });
        req.done.catch(() => {});

        await waitForEvent(eventLogPath, (event) => (
            event.type === "prompt.start" && event.text === "overlap-reset-model-A"
        ), "prompt.start overlap-reset-model-A");

        const resetSessionPromise = resetSession("alpha");

        await expectReject(
            "resetModel during active session reset",
            () => resetModel(),
            "Model reset cannot start while a session reset is in progress"
        );

        await expectReject("overlap prompt canceled by session reset", () => readPromptResult(req), "Session reset: alpha");
        await resetSessionPromise;
        await shutdownRuntime({ mode: "abort" });
    }, {
        MOCK_PROMPT_DELAY_MS: 1000,
        MOCK_ABORT_SETTLE_DELAY_MS: 200
    });

    console.log("[OK] resetModel rejected cleanly during active session reset");
}

async function modeShutdownRejectsDuringSessionReset() {
    logSection("shutdownRuntime rejects while session reset is in progress");

    await withMockRuntime(async ({ initModel, prompt, resetSession, shutdownRuntime }, eventLogPath) => {
        await initModel();

        const req = await prompt("overlap-shutdown-A", { sessionId: "alpha" });
        req.done.catch(() => {});

        await waitForEvent(eventLogPath, (event) => (
            event.type === "prompt.start" && event.text === "overlap-shutdown-A"
        ), "prompt.start overlap-shutdown-A");

        const resetSessionPromise = resetSession("alpha");

        await expectReject(
            "shutdown during active session reset",
            () => shutdownRuntime({ mode: "abort" }),
            "Runtime shutdown cannot start while a session reset is in progress"
        );

        await expectReject("overlap prompt canceled by session reset", () => readPromptResult(req), "Session reset: alpha");
        await resetSessionPromise;
        await shutdownRuntime({ mode: "abort" });
    }, {
        MOCK_PROMPT_DELAY_MS: 1000,
        MOCK_ABORT_SETTLE_DELAY_MS: 200
    });

    console.log("[OK] shutdownRuntime rejected cleanly during active session reset");
}


async function modeCancelDuringContextCreationDisposesPartialArtifacts() {
    logSection("cancel during context creation disposes partial artifacts");

    await withMockRuntime(async ({ initModel, prompt, cancelPrompt, shutdownRuntime }, eventLogPath) => {
        await initModel();

        const req = await prompt("context-cancel-A", { sessionId: "alpha" });
        req.done.catch(() => {});

        await waitForEvent(eventLogPath, (event) => (
            event.type === "context.create"
        ), "context.create context-cancel-A");

        assert.equal(cancelPrompt(req.id), true);
        await expectReject("context-creation prompt canceled", () => readPromptResult(req), "Prompt canceled");

        await waitForEvent(eventLogPath, (event) => (
            event.type === "context.dispose"
        ), "context.dispose after context cancellation");

        const events = await readEvents(eventLogPath);
        assert.equal(
            eventIndex(events, (event) => event.type === "prompt.start" && event.text === "context-cancel-A"),
            -1,
            "[FAIL] canceled during context creation should not enter session.prompt"
        );

        await shutdownRuntime({ mode: "abort" });
    }, {
        MOCK_CONTEXT_DELAY_MS: 200,
        MOCK_PROMPT_DELAY_MS: 1000
    });

    console.log("[OK] cancel during context creation disposed partial artifacts without prompt start");
}

async function modeSessionMaxRejectsWhenAllSessionsActive() {
    logSection("session max rejects instead of evicting active session");

    await withMockRuntime(async ({ initModel, prompt, cancelPrompt, shutdownRuntime }, eventLogPath) => {
        await initModel();

        const alpha = await prompt("active-eviction-alpha", { sessionId: "alpha" });
        alpha.done.catch(() => {});

        await waitForEvent(eventLogPath, (event) => (
            event.type === "prompt.start" && event.text === "active-eviction-alpha"
        ), "prompt.start active-eviction-alpha");

        const beta = await prompt("active-eviction-beta", { sessionId: "beta" });

        await expectReject(
            "new session while all sessions active",
            () => readPromptResult(beta),
            "Cannot create session: all sessions are active"
        );

        const eventsBeforeCleanup = await readEvents(eventLogPath);
        assert.equal(
            eventIndex(eventsBeforeCleanup, (event) => event.type === "session.dispose"),
            -1,
            "[FAIL] active session should not be evicted/disposed while alpha prompt is running"
        );
        assert.equal(
            eventIndex(eventsBeforeCleanup, (event) => event.type === "context.dispose"),
            -1,
            "[FAIL] active context should not be evicted/disposed while alpha prompt is running"
        );

        assert.equal(cancelPrompt(alpha.id), true);
        await expectReject("active alpha cleanup cancel", () => readPromptResult(alpha), "Prompt canceled");
        await shutdownRuntime({ mode: "abort" });
    }, {
        MOCK_MAX_IN_FLIGHT: 2,
        MOCK_SESSION_MAX_COUNT: 1,
        MOCK_PROMPT_DELAY_MS: 1000
    });

    console.log("[OK] active session eviction was rejected safely");
}

async function modeRealCancelActivePromptNativeBoundary() {
    logSection("real runtime cancel active prompt reaches native boundary");

    const { initModel, prompt, cancelPrompt, shutdownRuntime } = await importRealRuntime("real-cancel-active-prompt-native-boundary");
    const readyTimeoutMs = readPositiveIntEnv("REAL_READY_TIMEOUT_MS", 120000);
    const cancelDelayMs = readPositiveIntEnv("REAL_ACTIVE_PROMPT_CANCEL_DELAY_MS", 1);
    const nativeBoundaryDeadlineMs = readPositiveIntEnv("REAL_NATIVE_BOUNDARY_DEADLINE_MS", 240000);
    const shutdownDeadlineMs = readPositiveIntEnv("REAL_SHUTDOWN_DEADLINE_MS", 240000);
    const promptDeadlineMs = readPositiveIntEnv("REAL_PROMPT_DEADLINE_MS", 300000);

    await initModel(buildRealInitOptions(readyTimeoutMs));
    await warmRealSession(prompt, "real-cancel-alpha", "real cancel session", promptDeadlineMs);

    const req = await prompt(longRealPrompt("Real cancel active prompt native-boundary smoke"), {
        sessionId: "real-cancel-alpha",
        stream: true
    });
    const pump = startStreamPump(req);

    await waitForFirstStreamChunk(req, pump, "real cancel active prompt");
    await sleep(cancelDelayMs);
    assert.equal(cancelPrompt(req.id), true);
    await readExpectedRejectionAndPump(req, pump, "real canceled prompt", "Prompt canceled", nativeBoundaryDeadlineMs);

    const followResult = await withDeadline(
        readShortRealPrompt(prompt, "After cancellation, answer with exactly: OK", { sessionId: "real-cancel-alpha" }),
        promptDeadlineMs,
        "real same-session prompt after cancellation"
    );

    assert.equal(typeof followResult, "string");
    assert.ok(followResult.length > 0, "same-session prompt after cancellation should return text");

    await withDeadline(shutdownRuntime({ mode: "abort" }), shutdownDeadlineMs, "real cancel native-boundary cleanup shutdown");
    console.log("[OK] real cancel active prompt reached native boundary and same session remained usable");
}

async function modeRealResetSessionActivePromptNativeBoundary() {
    logSection("real runtime resetSession active prompt reaches native boundary");

    const { initModel, prompt, resetSession, shutdownRuntime } = await importRealRuntime("real-reset-session-active-prompt-native-boundary");
    const readyTimeoutMs = readPositiveIntEnv("REAL_READY_TIMEOUT_MS", 120000);
    const cancelDelayMs = readPositiveIntEnv("REAL_ACTIVE_PROMPT_CANCEL_DELAY_MS", 1);
    const nativeBoundaryDeadlineMs = readPositiveIntEnv("REAL_NATIVE_BOUNDARY_DEADLINE_MS", 240000);
    const shutdownDeadlineMs = readPositiveIntEnv("REAL_SHUTDOWN_DEADLINE_MS", 240000);
    const promptDeadlineMs = readPositiveIntEnv("REAL_PROMPT_DEADLINE_MS", 300000);

    await initModel(buildRealInitOptions(readyTimeoutMs));
    await warmRealSession(prompt, "real-reset-alpha", "real reset session", promptDeadlineMs);

    const req = await prompt(longRealPrompt("Real resetSession active prompt native-boundary smoke"), {
        sessionId: "real-reset-alpha",
        stream: true
    });
    const pump = startStreamPump(req);

    await waitForFirstStreamChunk(req, pump, "real resetSession active prompt");
    await sleep(cancelDelayMs);

    await Promise.all([
        readExpectedRejectionAndPump(req, pump, "real session-reset canceled prompt", "Session reset: real-reset-alpha", nativeBoundaryDeadlineMs),
        withDeadline(resetSession("real-reset-alpha"), nativeBoundaryDeadlineMs, "real resetSession native boundary")
    ]);

    const followResult = await withDeadline(
        readShortRealPrompt(prompt, "After resetSession, answer with exactly: OK", { sessionId: "real-reset-alpha" }),
        promptDeadlineMs,
        "real same-session prompt after resetSession"
    );

    assert.equal(typeof followResult, "string");
    assert.ok(followResult.length > 0, "same-session prompt after resetSession should return text");

    await withDeadline(shutdownRuntime({ mode: "abort" }), shutdownDeadlineMs, "real resetSession native-boundary cleanup shutdown");
    console.log("[OK] real resetSession waited for native boundary and same session remained usable");
}

async function modeRealShutdownAbortNativeBoundary() {
    logSection("real runtime shutdown abort reaches native boundary");

    const { initModel, prompt, shutdownRuntime } = await importRealRuntime("real-shutdown-abort-native-boundary");
    const readyTimeoutMs = readPositiveIntEnv("REAL_READY_TIMEOUT_MS", 120000);
    const cancelDelayMs = readPositiveIntEnv("REAL_ACTIVE_PROMPT_CANCEL_DELAY_MS", 1);
    const nativeBoundaryDeadlineMs = readPositiveIntEnv("REAL_NATIVE_BOUNDARY_DEADLINE_MS", 240000);
    const promptDeadlineMs = readPositiveIntEnv("REAL_PROMPT_DEADLINE_MS", 300000);

    await initModel(buildRealInitOptions(readyTimeoutMs));
    await warmRealSession(prompt, "real-shutdown-alpha", "real shutdown session", promptDeadlineMs);

    const req = await prompt(longRealPrompt("Real shutdown abort native-boundary smoke"), {
        sessionId: "real-shutdown-alpha",
        stream: true
    });
    const pump = startStreamPump(req);

    await waitForFirstStreamChunk(req, pump, "real shutdown abort active prompt");
    await sleep(cancelDelayMs);

    await Promise.all([
        readExpectedRejectionAndPump(req, pump, "real shutdown canceled prompt", "Runtime shutdown", nativeBoundaryDeadlineMs),
        withDeadline(shutdownRuntime({ mode: "abort" }), nativeBoundaryDeadlineMs, "real shutdown abort native boundary")
    ]);

    await expectReject(
        "prompt after real shutdown abort",
        () => prompt("This should reject after shutdown."),
        "Runtime is shutting down"
    );

    console.log("[OK] real shutdown abort reached native boundary and completed shutdown");
}

async function modeRealDrainTimeoutNativeBoundary() {
    logSection("real runtime drain-with-timeout reaches native boundary");

    const { initModel, prompt, shutdownRuntime } = await importRealRuntime("real-drain-timeout-native-boundary");
    const readyTimeoutMs = readPositiveIntEnv("REAL_READY_TIMEOUT_MS", 120000);
    const nativeBoundaryDeadlineMs = readPositiveIntEnv("REAL_NATIVE_BOUNDARY_DEADLINE_MS", 240000);
    const timeoutMs = readPositiveIntEnv("REAL_DRAIN_TIMEOUT_MS", 150);
    const promptDeadlineMs = readPositiveIntEnv("REAL_PROMPT_DEADLINE_MS", 300000);

    await initModel(buildRealInitOptions(readyTimeoutMs));
    await warmRealSession(prompt, "real-timeout-alpha", "real drain-timeout session", promptDeadlineMs);

    const req = await prompt(longRealPrompt("Real drain-with-timeout native-boundary smoke"), {
        sessionId: "real-timeout-alpha",
        stream: true
    });
    const pump = startStreamPump(req);

    await waitForFirstStreamChunk(req, pump, "real drain-timeout active prompt");

    await Promise.all([
        readExpectedRejectionAndPump(req, pump, "real drain-timeout canceled prompt", "Runtime shutdown timeout", nativeBoundaryDeadlineMs),
        withDeadline(shutdownRuntime({ mode: "drain-with-timeout", timeoutMs }), nativeBoundaryDeadlineMs, "real drain-timeout native boundary")
    ]);

    await expectReject(
        "prompt after real drain-timeout shutdown",
        () => prompt("This should reject after drain-timeout shutdown."),
        "Runtime is shutting down"
    );

    console.log("[OK] real drain-with-timeout reached native boundary and completed shutdown");
}

async function realOrchestrator() {
    const modes = [
        "real-cancel-active-prompt-native-boundary",
        "real-reset-session-active-prompt-native-boundary",
        "real-shutdown-abort-native-boundary",
        "real-drain-timeout-native-boundary"
    ];

    console.log("[SMOKE] real orchestrator modes:", modes.join(", "));

    for (const mode of modes) {
        logSection(`real child mode: ${mode}`);
        await runChild(mode);
    }

    console.log("\nAll branch-scoped real worker-native cancellation boundary smoke tests finished.");
}

async function orchestrator() {
    const modes = [
        "mock-cancel-active-prompt-aborts-signal",
        "mock-message-channel-cancel-during-blocked-token-loop",
        "mock-reset-session-aborts-before-session-dispose",
        "mock-reset-model-aborts-before-model-dispose",
        "mock-shutdown-abort-aborts-before-model-dispose",
        "mock-drain-timeout-aborts-before-model-dispose",
        "mock-stream-done-falls-back-to-prompt-result",
        "mock-drain-completes-without-abort",
        "mock-cancel-active-then-next-same-session-waits-for-abort-boundary",
        "mock-reset-model-rejects-during-session-reset",
        "mock-shutdown-rejects-during-session-reset",
        "mock-cancel-during-context-creation-disposes-partial-artifacts",
        "mock-session-max-rejects-when-all-sessions-active"
    ];

    if (shouldRunRealRuntimeModes()) {
        modes.push(
            "real-cancel-active-prompt-native-boundary",
            "real-reset-session-active-prompt-native-boundary",
            "real-shutdown-abort-native-boundary",
            "real-drain-timeout-native-boundary"
        );
    }

    console.log("[SMOKE] orchestrator modes:", modes.join(", "));

    for (const mode of modes) {
        logSection(`child mode: ${mode}`);
        await runChild(mode);
    }

    console.log("\nAll worker-native cancellation boundary smoke tests finished.");
}

async function main() {
    console.log("[SMOKE] mode:", MODE);
    console.log("[SMOKE] version:", SMOKE_TEST_VERSION);
    console.log("[SMOKE] file:", SELF_PATH);
    console.log("[SMOKE] REAL_RUNTIME:", process.env.REAL_RUNTIME ?? "<unset>");

    switch (MODE) {
        case "orchestrator":
            await orchestrator();
            break;
        case "mock-cancel-active-prompt-aborts-signal":
            await modeCancelActivePromptAbortsSignal();
            break;
        case "mock-message-channel-cancel-during-blocked-token-loop":
            await modeMessageChannelCancelDuringBlockedTokenLoop();
            break;
        case "mock-reset-session-aborts-before-session-dispose":
            await modeResetSessionAbortsBeforeDispose();
            break;
        case "mock-reset-model-aborts-before-model-dispose":
            await modeResetModelAbortsBeforeDispose();
            break;
        case "mock-shutdown-abort-aborts-before-model-dispose":
            await modeShutdownAbortAbortsBeforeDispose();
            break;
        case "mock-drain-timeout-aborts-before-model-dispose":
            await modeDrainTimeoutAbortsBeforeDispose();
            break;
        case "mock-stream-done-falls-back-to-prompt-result":
            await modeStreamDoneFallsBackToPromptResult();
            break;
        case "mock-drain-completes-without-abort":
            await modeDrainCompletesWithoutAbort();
            break;
        case "mock-cancel-active-then-next-same-session-waits-for-abort-boundary":
            await modeCancelThenNextSameSessionWaits();
            break;
        case "mock-reset-model-rejects-during-session-reset":
            await modeModelResetRejectsDuringSessionReset();
            break;
        case "mock-shutdown-rejects-during-session-reset":
            await modeShutdownRejectsDuringSessionReset();
            break;
        case "mock-cancel-during-context-creation-disposes-partial-artifacts":
            await modeCancelDuringContextCreationDisposesPartialArtifacts();
            break;
        case "mock-session-max-rejects-when-all-sessions-active":
            await modeSessionMaxRejectsWhenAllSessionsActive();
            break;
        case "real-orchestrator":
            await realOrchestrator();
            break;
        case "real-cancel-active-prompt-native-boundary":
            await modeRealCancelActivePromptNativeBoundary();
            break;
        case "real-reset-session-active-prompt-native-boundary":
            await modeRealResetSessionActivePromptNativeBoundary();
            break;
        case "real-shutdown-abort-native-boundary":
            await modeRealShutdownAbortNativeBoundary();
            break;
        case "real-drain-timeout-native-boundary":
            await modeRealDrainTimeoutNativeBoundary();
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
