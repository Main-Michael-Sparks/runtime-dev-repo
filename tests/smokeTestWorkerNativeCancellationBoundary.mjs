// smokeTestWorkerNativeCancellationBoundary.mjs
//
// Purpose:
// - Branch-scoped deterministic smoke coverage for worker-native cancellation boundaries.
// - Verifies worker-side AbortSignal observation and disposal ordering with a fake node-llama-cpp.
// - Complements smokeTestDrainShutdown.mjs, which primarily preserves parent-side shutdown behavior.
//
// Run:
//   node ./tests/smokeTestWorkerNativeCancellationBoundary.mjs

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const SMOKE_TEST_VERSION = "worker-native-cancellation-boundary-v1-mock-v1";
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
      event("prompt.abort-observed", { text, sessionId });

      setTimeout(() => {
        cleanup();
        event("prompt.abort-settled", { text, sessionId });
        reject(signal.reason ?? new Error("aborted"));
      }, abortSettleDelayMs);
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
    await waitForPromptOrAbort({ text, sessionId: this.sessionId, signal: options.signal });

    const output = "mock response: " + String(text).slice(0, 32);
    options.onToken?.(output);
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

async function orchestrator() {
    const modes = [
        "mock-cancel-active-prompt-aborts-signal",
        "mock-reset-session-aborts-before-session-dispose",
        "mock-reset-model-aborts-before-model-dispose",
        "mock-shutdown-abort-aborts-before-model-dispose",
        "mock-drain-timeout-aborts-before-model-dispose",
        "mock-drain-completes-without-abort",
        "mock-cancel-active-then-next-same-session-waits-for-abort-boundary",
        "mock-reset-model-rejects-during-session-reset",
        "mock-shutdown-rejects-during-session-reset",
        "mock-cancel-during-context-creation-disposes-partial-artifacts",
        "mock-session-max-rejects-when-all-sessions-active"
    ];

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

    switch (MODE) {
        case "orchestrator":
            await orchestrator();
            break;
        case "mock-cancel-active-prompt-aborts-signal":
            await modeCancelActivePromptAbortsSignal();
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
        default:
            throw new Error(`Unknown SMOKE_MODE: ${MODE}`);
    }
}

main().catch((err) => {
    console.error("\n[SMOKE TEST FAILURE]");
    console.error(err);
    process.exitCode = 1;
});
