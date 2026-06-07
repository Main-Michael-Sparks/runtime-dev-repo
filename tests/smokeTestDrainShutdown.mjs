// smokeTestDrainShutdown.mjs
//
// Purpose:
// - Local smoke/regression test for Drain / Drain-With-Timeout Shutdown v1.
// - Mock modes provide deterministic lifecycle coverage.
// - Real modes test what this branch actually implements:
//   parent-side cancellation/rejection, drain shutdown, timeout fallback, and worker/model shutdown.
//
// Recommended location:
//   tests/smokeTestDrainShutdown.mjs
//
// Run deterministic/mock smoke:
//   node ./tests/smokeTestDrainShutdown.mjs
//
// Run real-runtime smoke against local node-llama-cpp/model setup:
//   REAL_RUNTIME=1 node ./tests/smokeTestDrainShutdown.mjs
//
// Run only real-runtime modes:
//   SMOKE_MODE=real-orchestrator node ./tests/smokeTestDrainShutdown.mjs
//   SMOKE_MODE=real-drain-idle node ./tests/smokeTestDrainShutdown.mjs
//   SMOKE_MODE=real-abort-parent-cancel node ./tests/smokeTestDrainShutdown.mjs
//   SMOKE_MODE=real-drain-timeout-parent-cancel node ./tests/smokeTestDrainShutdown.mjs
//
// Optional extended real integration mode:
//   SMOKE_MODE=real-drain-queued-completes-extended node ./tests/smokeTestDrainShutdown.mjs
//
// Notes:
// - Child processes isolate runtime/module state per scenario.
// - Mock runtime modes build a temporary fixture with a fake node-llama-cpp package.
// - Real-runtime modes import the repository runtime directly and require a working real model setup.
// - drain-with-timeout does not promise native prompt preemption or total wall-clock shutdown timeout.
// - Real abort/timeout modes assert parent-side request rejection first, then separately wait for worker/model shutdown.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const SMOKE_TEST_VERSION = "drain-shutdown-v1-branch-scoped-real-modes-v3";
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
    "llama_worker/llama.mjs",
    "llama_worker/cancellation/activeRequestRegistry.mjs",
    "llama_worker/cancellation/requestBoundaries.mjs",
    "llama_worker/lifecycle/modelDisposalPolicy.mjs",
    "llama_worker/lifecycle/modelLifecycle.mjs",
    "llama_worker/lifecycle/resetLifecycle.mjs",
    "llama_worker/lifecycle/shutdownLifecycle.mjs",
    "llama_worker/session/sessionDisposal.mjs",
    "llama_worker/session/sessionService.mjs",
    "llama_worker/context/contextOptions.mjs",
    "llama_worker/context/contextRetryService.mjs",
    "llama_worker/prompt/chunkFactory.mjs",
    "llama_worker/prompt/promptRunner.mjs",
    "llama_worker/state/workerState.mjs",
    "llama_worker/serialization/workerOperationQueue.mjs",
    "llama_worker/errors/promptAbort.mjs",
    "llama_worker/messages/outboundMessages.mjs",
    "llama_worker/messages/workerProtocolRouter.mjs"
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

function readPositiveIntEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;

  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }

  return value;
}

function shouldRunRealRuntimeModes() {
  return process.env.REAL_RUNTIME === "1";
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
        `[FAIL] ${label} rejected with unexpected message: ${err.message}`,
      );
    }

    console.log(`[OK] ${label} rejected:`, err.message);
    return err;
  }
}

async function consumeStream(req, { logChunks = false } = {}) {
  if (!req.stream) return;

  const reader = req.stream.getReader();

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    if (logChunks) {
      console.log("chunk:", JSON.stringify(value));
    }
  }
}

async function readPromptResult(req, { logChunks = false } = {}) {
  await consumeStream(req, { logChunks });
  return req.done;
}

function collectDone(req) {
  return req.done.then(
    (value) => ({ status: "resolved", value }),
    (err) => ({ status: "rejected", message: err.message }),
  );
}

function countRejectedWith(settled, expectedText) {
  return settled.filter(
    (result) => result.status === "rejected" &&
      String(result.message).includes(expectedText),
  ).length;
}

function summarizeSettled(settled) {
  return settled.map((result, index) => {
    if (result.status === "resolved") {
      const value = String(result.value ?? "");
      return {
        index,
        status: result.status,
        valueLength: value.length,
        valuePreview: value.slice(0, 80),
      };
    }

    return {
      index,
      status: result.status,
      message: result.message,
    };
  });
}

async function runChild(mode) {
  const childDeadlineMs = readPositiveIntEnv("SMOKE_CHILD_DEADLINE_MS", 300000);

  return new Promise((resolve, reject) => {
    console.log("[SMOKE] spawning child:", mode);

    let settled = false;
    let forceKillTimer = null;

    const child = spawn(process.execPath, [SELF_PATH], {
      env: {
        ...process.env,
        SMOKE_MODE: mode,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    const deadlineTimer = setTimeout(() => {
      if (settled) return;

      settled = true;
      console.error(
        `[SMOKE] child deadline exceeded for ${mode}; sending SIGTERM after ${childDeadlineMs}ms`,
      );

      child.kill("SIGTERM");

      forceKillTimer = setTimeout(() => {
        if (!child.killed) {
          child.kill("SIGKILL");
        }
      }, 5000);

      reject(new Error(`Child smoke mode ${mode} timed out after ${childDeadlineMs}ms`));
    }, childDeadlineMs);

    child.stdout.on("data", (chunk) => {
      process.stdout.write(chunk);
    });

    child.stderr.on("data", (chunk) => {
      process.stderr.write(chunk);
    });

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadlineTimer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      reject(err);
    });

    child.on("exit", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadlineTimer);
      if (forceKillTimer) clearTimeout(forceKillTimer);

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
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "runtime-drain-shutdown-"));

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
    "maxInFlight: Number(process.env.MOCK_MAX_IN_FLIGHT ?? 1),",
  );
  await writeFile(configPath, configText);

  const fakePackageRoot = path.join(tmpRoot, "node_modules", "node-llama-cpp");
  await mkdir(fakePackageRoot, { recursive: true });
  await writeFile(
    path.join(fakePackageRoot, "package.json"),
    JSON.stringify({ type: "module", exports: "./index.js" }, null, 2),
  );

  await writeFile(
    path.join(fakePackageRoot, "index.js"),
    `
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readDelay(name, fallback) {
  const value = Number(process.env[name] ?? fallback);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

export async function getLlama() {
  return {
    async loadModel() {
      await sleep(readDelay("MOCK_LOAD_DELAY_MS", 0));

      return {
        disposed: false,
        detokenize(tokens) {
          return String(tokens.join ? tokens.join("") : tokens);
        },
        async createContext() {
          await sleep(readDelay("MOCK_CONTEXT_DELAY_MS", 0));

          return {
            disposed: false,
            getSequence() {
              return { id: Math.random() };
            },
            async dispose() {
              this.disposed = true;
            },
          };
        },
        async dispose() {
          this.disposed = true;
        },
      };
    },
  };
}

export class LlamaChatSession {
  constructor({ contextSequence }) {
    this.contextSequence = contextSequence;
    this.disposed = false;
  }

  async prompt(text, options = {}) {
    await sleep(readDelay("MOCK_PROMPT_DELAY_MS", 25));

    const output = "mock response: " + String(text).slice(0, 32);
    options.onToken?.(output);
    return output;
  }

  dispose() {
    this.disposed = true;
  }
}
`,
  );

  return tmpRoot;
}

async function withMockRuntime(fn, env = {}) {
  const tmpRoot = await copyRuntimeFixture();
  const oldEnv = {};

  for (const [key, value] of Object.entries(env)) {
    oldEnv[key] = process.env[key];
    process.env[key] = String(value);
  }

  try {
    const runtimeUrl = pathToFileURL(path.join(tmpRoot, "runtime.mjs")).href;
    const runtime = await import(`${runtimeUrl}?mode=${MODE}&t=${Date.now()}`);
    await fn(runtime);
  } finally {
    for (const key of Object.keys(env)) {
      if (oldEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = oldEnv[key];
      }
    }

    await rm(tmpRoot, { recursive: true, force: true });
  }
}

async function submitBoundedPrompts(runtime, {
  maxAcceptedPrompts = 8,
  maxSubmitAttempts = 20,
  enqueueWindowMs = 750,
  delayBetweenSubmissionsMs = 10,
  promptPrefix = "drain timeout pressure",
  promptOptions = {},
} = {}) {
  const accepted = [];
  const startedAt = Date.now();

  for (let attempt = 0; attempt < maxSubmitAttempts; attempt++) {
    if (accepted.length >= maxAcceptedPrompts) break;
    if (Date.now() - startedAt >= enqueueWindowMs) break;

    try {
      const req = await runtime.prompt(`${promptPrefix} ${attempt}`, promptOptions);
      accepted.push(req);
      req.done.catch(() => {});
    } catch (err) {
      const message = String(err.message);

      if (
        message.includes("Backpressure: queue full") ||
        message.includes("Runtime is shutting down")
      ) {
        console.log("[SMOKE] stopping prompt feeder:", message);
        break;
      }

      throw err;
    }

    if (delayBetweenSubmissionsMs > 0) {
      await sleep(delayBetweenSubmissionsMs);
    }
  }

  return accepted;
}

async function modeInvalidShutdownOptions() {
  logSection("invalid shutdown options");

  await withMockRuntime(async ({ shutdownRuntime }) => {
    await expectReject(
      "unsupported shutdown mode",
      () => shutdownRuntime({ mode: "unsupported" }),
      "Unsupported shutdown mode",
    );

    await expectReject(
      "missing drain-with-timeout timeoutMs",
      () => shutdownRuntime({ mode: "drain-with-timeout" }),
      "timeoutMs is required",
    );

    await expectReject(
      "invalid drain-with-timeout timeoutMs",
      () => shutdownRuntime({ mode: "drain-with-timeout", timeoutMs: 0 }),
      "timeoutMs must be a positive integer",
    );

    await expectReject(
      "timeoutMs with drain",
      () => shutdownRuntime({ mode: "drain", timeoutMs: 100 }),
      "timeoutMs is only supported",
    );

    await shutdownRuntime({ mode: "abort" });
    console.log("[OK] cleanup abort shutdown resolved");
  });
}

async function modeAbortExistingContract() {
  logSection("abort existing shutdown contract");

  await withMockRuntime(async ({ initModel, prompt, shutdownRuntime }) => {
    await initModel({ attempts: 1, readyTimeoutMs: 5000 });

    const req = await prompt("abort should cancel this request");
    const done = req.done;

    await shutdownRuntime({ mode: "abort" });

    await expectReject(
      "abort canceled accepted request",
      () => done,
      "Runtime shutdown",
    );

    await expectReject(
      "prompt after abort shutdown",
      () => prompt("should reject after abort"),
      "Runtime is shutting down",
    );

    console.log("[OK] abort shutdown contract held");
  }, {
    MOCK_PROMPT_DELAY_MS: 500,
    MOCK_MAX_IN_FLIGHT: 1,
  });
}

async function modeDrainIdle() {
  logSection("drain idle shutdown");

  await withMockRuntime(async ({ initModel, prompt, shutdownRuntime }) => {
    await initModel({ attempts: 1, readyTimeoutMs: 5000 });
    await shutdownRuntime({ mode: "drain" });

    await expectReject(
      "prompt after drain shutdown",
      () => prompt("should reject after drain"),
      "Runtime is shutting down",
    );

    console.log("[OK] drain idle shutdown resolved");
  });
}

async function modeDrainQueuedCompletes() {
  logSection("drain queued accepted work completes");

  await withMockRuntime(async ({ initModel, prompt, shutdownRuntime }) => {
    await initModel({ attempts: 1, readyTimeoutMs: 5000 });

    const requests = [];
    for (let i = 0; i < 4; i++) {
      requests.push(await prompt(`drain queued completes ${i}`));
    }

    const shutdown = shutdownRuntime({ mode: "drain" });

    const results = await Promise.all(
      requests.map((req) => readPromptResult(req)),
    );

    for (const result of results) {
      assert.equal(typeof result, "string");
      assert.match(result, /mock response:/);
    }

    await shutdown;
    console.log("[OK] drain allowed queued accepted work to finish");
  }, {
    MOCK_PROMPT_DELAY_MS: 75,
    MOCK_MAX_IN_FLIGHT: 1,
  });
}

async function modeDrainTimeoutCancelsRemaining() {
  logSection("drain-with-timeout cancels remaining accepted work");

  await withMockRuntime(async ({ initModel, prompt, shutdownRuntime }) => {
    await initModel({ attempts: 1, readyTimeoutMs: 5000 });

    const requests = await submitBoundedPrompts({ prompt }, {
      maxAcceptedPrompts: 8,
      maxSubmitAttempts: 20,
      enqueueWindowMs: 750,
      delayBetweenSubmissionsMs: 5,
    });

    assert(
      requests.length >= 2,
      `expected at least two accepted prompts for timeout pressure, got ${requests.length}`,
    );

    const doneResults = requests.map(collectDone);
    await shutdownRuntime({ mode: "drain-with-timeout", timeoutMs: 100 });

    const settled = await Promise.all(doneResults);
    const timeoutRejected = countRejectedWith(settled, "Runtime shutdown timeout");

    assert(
      timeoutRejected >= 1,
      `expected at least one timeout-canceled request; got ${JSON.stringify(settled)}`,
    );

    await expectReject(
      "prompt after drain-with-timeout shutdown",
      () => prompt("should reject after drain-with-timeout"),
      "Runtime is shutting down",
    );

    console.log(
      `[OK] drain-with-timeout canceled ${timeoutRejected} accepted request(s) after parent-side timeout`,
    );
  }, {
    MOCK_PROMPT_DELAY_MS: 750,
    MOCK_MAX_IN_FLIGHT: 1,
  });
}

async function modeShutdownDuringActiveInitRejects() {
  logSection("shutdown during active init rejects");

  await withMockRuntime(async ({ initModel, shutdownRuntime }) => {
    const init = initModel({ attempts: 1, readyTimeoutMs: 5000 });

    await expectReject(
      "shutdown during active init",
      () => shutdownRuntime({ mode: "abort" }),
      "Model initialization is in progress",
    );

    await init;
    await shutdownRuntime({ mode: "abort" });
    console.log("[OK] active-init shutdown rejected without canceling init");
  }, {
    MOCK_LOAD_DELAY_MS: 500,
  });
}

async function importRealRuntime(label) {
  const runtimeUrl = pathToFileURL(path.join(REPO_ROOT, "runtime.mjs")).href;
  return import(`${runtimeUrl}?mode=${MODE}&label=${label}&t=${Date.now()}`);
}

async function modeRealDrainIdle() {
  logSection("real runtime drain idle shutdown");

  const { initModel, prompt, shutdownRuntime } = await importRealRuntime("real-drain-idle");
  const readyTimeoutMs = readPositiveIntEnv("REAL_READY_TIMEOUT_MS", 120000);
  const shutdownDeadlineMs = readPositiveIntEnv("REAL_SHUTDOWN_DEADLINE_MS", 180000);

  await initModel({ attempts: 1, readyTimeoutMs });
  await withDeadline(
    shutdownRuntime({ mode: "drain" }),
    shutdownDeadlineMs,
    "real drain idle shutdown",
  );

  await expectReject(
    "prompt after real drain shutdown",
    () => prompt("This should reject after real drain shutdown."),
    "Runtime is shutting down",
  );

  console.log("[OK] real runtime drain idle shutdown resolved");
}

async function modeRealAbortParentCancel() {
  logSection("real runtime abort parent-side cancellation + model shutdown");

  const { initModel, prompt, shutdownRuntime } = await importRealRuntime("real-abort-parent-cancel");
  const readyTimeoutMs = readPositiveIntEnv("REAL_READY_TIMEOUT_MS", 120000);
  const parentCancelDeadlineMs = readPositiveIntEnv("REAL_PARENT_CANCEL_DEADLINE_MS", 30000);
  const shutdownDeadlineMs = readPositiveIntEnv("REAL_SHUTDOWN_DEADLINE_MS", 240000);

  await initModel({ attempts: 1, readyTimeoutMs });

  const requests = await submitBoundedPrompts({ prompt }, {
    maxAcceptedPrompts: readPositiveIntEnv("REAL_ABORT_MAX_ACCEPTED_PROMPTS", 6),
    maxSubmitAttempts: readPositiveIntEnv("REAL_ABORT_MAX_SUBMIT_ATTEMPTS", 12),
    enqueueWindowMs: readPositiveIntEnv("REAL_ABORT_ENQUEUE_WINDOW_MS", 1500),
    delayBetweenSubmissionsMs: readPositiveIntEnv("REAL_ABORT_SUBMIT_DELAY_MS", 10),
    promptPrefix: "Real abort parent cancellation smoke. Write a detailed paragraph number",
    promptOptions: { stream: false },
  });

  assert(
    requests.length >= 1,
    `expected at least one accepted prompt for real abort pressure, got ${requests.length}`,
  );

  const doneResults = requests.map(collectDone);
  const shutdown = shutdownRuntime({ mode: "abort" });

  let shutdownCompleted = false;
  try {
    const settled = await withDeadline(
      Promise.all(doneResults),
      parentCancelDeadlineMs,
      "real abort parent-side request rejection",
    );

    const shutdownRejected = countRejectedWith(settled, "Runtime shutdown");

    assert(
      shutdownRejected >= 1,
      `expected at least one real abort-canceled request; got ${JSON.stringify(summarizeSettled(settled))}`,
    );

    await withDeadline(shutdown, shutdownDeadlineMs, "real abort worker/model shutdown");
    shutdownCompleted = true;
  } finally {
    if (!shutdownCompleted) {
      await withDeadline(shutdown, shutdownDeadlineMs, "real abort worker/model shutdown cleanup");
    }
  }

  await expectReject(
    "prompt after real abort shutdown",
    () => prompt("This should reject after real abort shutdown."),
    "Runtime is shutting down",
  );

  console.log("[OK] real abort rejected request parent-side and completed worker/model shutdown");
}

async function modeRealDrainTimeoutParentCancel() {
  logSection("real runtime drain-with-timeout parent-side cancellation + model shutdown");

  const { initModel, prompt, shutdownRuntime } = await importRealRuntime("real-drain-timeout-parent-cancel");
  const readyTimeoutMs = readPositiveIntEnv("REAL_READY_TIMEOUT_MS", 120000);
  const parentCancelDeadlineMs = readPositiveIntEnv("REAL_PARENT_CANCEL_DEADLINE_MS", 30000);
  const shutdownDeadlineMs = readPositiveIntEnv("REAL_SHUTDOWN_DEADLINE_MS", 240000);
  const timeoutMs = readPositiveIntEnv("REAL_DRAIN_TIMEOUT_MS", 150);

  await initModel({ attempts: 1, readyTimeoutMs });

  const requests = await submitBoundedPrompts({ prompt }, {
    maxAcceptedPrompts: readPositiveIntEnv("REAL_TIMEOUT_MAX_ACCEPTED_PROMPTS", 8),
    maxSubmitAttempts: readPositiveIntEnv("REAL_TIMEOUT_MAX_SUBMIT_ATTEMPTS", 16),
    enqueueWindowMs: readPositiveIntEnv("REAL_TIMEOUT_ENQUEUE_WINDOW_MS", 1500),
    delayBetweenSubmissionsMs: readPositiveIntEnv("REAL_TIMEOUT_SUBMIT_DELAY_MS", 10),
    promptPrefix: "Drain timeout real runtime pressure. Write a detailed paragraph number",
    promptOptions: { stream: false },
  });

  assert(
    requests.length >= 2,
    `expected at least two accepted prompts for real timeout pressure, got ${requests.length}`,
  );

  const doneResults = requests.map(collectDone);
  const shutdown = shutdownRuntime({ mode: "drain-with-timeout", timeoutMs });

  let shutdownCompleted = false;
  try {
    const settled = await withDeadline(
      Promise.all(doneResults),
      parentCancelDeadlineMs,
      "real drain-with-timeout parent-side request rejection",
    );

    const timeoutRejected = countRejectedWith(settled, "Runtime shutdown timeout");

    assert(
      timeoutRejected >= 1,
      `expected at least one real timeout-canceled request; got ${JSON.stringify(summarizeSettled(settled))}`,
    );

    await withDeadline(shutdown, shutdownDeadlineMs, "real drain-with-timeout worker/model shutdown");
    shutdownCompleted = true;

    console.log(
      `[OK] real drain-with-timeout parent-canceled ${timeoutRejected} request(s) and completed worker/model shutdown`,
    );
  } finally {
    if (!shutdownCompleted) {
      await withDeadline(shutdown, shutdownDeadlineMs, "real drain-with-timeout worker/model shutdown cleanup");
    }
  }

  await expectReject(
    "prompt after real drain-with-timeout shutdown",
    () => prompt("This should reject after real drain-with-timeout shutdown."),
    "Runtime is shutting down",
  );
}

async function modeRealDrainQueuedCompletesExtended() {
  logSection("real runtime drain queued accepted work completes extended integration");

  const { initModel, prompt, shutdownRuntime } = await importRealRuntime("real-drain-queued-completes-extended");
  const readyTimeoutMs = readPositiveIntEnv("REAL_READY_TIMEOUT_MS", 120000);
  const promptDeadlineMs = readPositiveIntEnv("REAL_PROMPT_DEADLINE_MS", 300000);
  const shutdownDeadlineMs = readPositiveIntEnv("REAL_SHUTDOWN_DEADLINE_MS", 240000);
  const promptCount = readPositiveIntEnv("REAL_DRAIN_PROMPTS", 1);

  await initModel({ attempts: 1, readyTimeoutMs });

  const requests = [];
  for (let i = 0; i < promptCount; i++) {
    requests.push(await prompt(
      `Drain extended real runtime prompt ${i}. Answer with one short sentence.`,
      { stream: false },
    ));
  }

  const shutdown = shutdownRuntime({ mode: "drain" });

  const results = await Promise.all(
    requests.map((req, index) => withDeadline(
      req.done,
      promptDeadlineMs,
      `real extended drain prompt ${index}`,
    )),
  );

  for (const result of results) {
    assert.equal(typeof result, "string");
    assert(result.length > 0, "real extended drain prompt result should not be empty");
  }

  await withDeadline(shutdown, shutdownDeadlineMs, "real extended drain shutdown");

  await expectReject(
    "prompt after real extended drain shutdown",
    () => prompt("This should reject after real extended drain shutdown."),
    "Runtime is shutting down",
  );

  console.log(`[OK] real extended drain completed ${results.length} accepted prompt(s)`);
}

async function realOrchestrator() {
  const modes = [
    "real-drain-idle",
    "real-abort-parent-cancel",
    "real-drain-timeout-parent-cancel",
  ];

  console.log("[SMOKE] real orchestrator modes:", modes.join(", "));

  for (const mode of modes) {
    logSection(`real child mode: ${mode}`);
    await runChild(mode);
  }

  console.log("\nAll branch-scoped real drain-shutdown smoke tests finished.");
}

async function orchestrator() {
  const modes = [
    "invalid-shutdown-options",
    "abort-existing-contract",
    "drain-idle",
    "drain-queued-completes",
    "drain-timeout-cancels-remaining",
    "shutdown-during-active-init-rejects",
  ];

  if (shouldRunRealRuntimeModes()) {
    modes.push(
      "real-drain-idle",
      "real-abort-parent-cancel",
      "real-drain-timeout-parent-cancel",
    );
  }

  console.log("[SMOKE] orchestrator modes:", modes.join(", "));

  for (const mode of modes) {
    logSection(`child mode: ${mode}`);
    await runChild(mode);
  }

  console.log("\nAll drain-shutdown smoke tests finished.");
}

async function main() {
  console.log("[SMOKE] mode:", MODE);
  console.log("[SMOKE] version:", SMOKE_TEST_VERSION);
  console.log("[SMOKE] file:", SELF_PATH);

  switch (MODE) {
    case "orchestrator":
      await orchestrator();
      break;
    case "invalid-shutdown-options":
      await modeInvalidShutdownOptions();
      break;
    case "abort-existing-contract":
      await modeAbortExistingContract();
      break;
    case "drain-idle":
      await modeDrainIdle();
      break;
    case "drain-queued-completes":
      await modeDrainQueuedCompletes();
      break;
    case "drain-timeout-cancels-remaining":
      await modeDrainTimeoutCancelsRemaining();
      break;
    case "shutdown-during-active-init-rejects":
      await modeShutdownDuringActiveInitRejects();
      break;
    case "real-orchestrator":
      await realOrchestrator();
      break;
    case "real-drain-idle":
      await modeRealDrainIdle();
      break;
    case "real-abort-parent-cancel":
      await modeRealAbortParentCancel();
      break;
    case "real-drain-timeout-parent-cancel":
      await modeRealDrainTimeoutParentCancel();
      break;
    case "real-drain-queued-completes-extended":
      await modeRealDrainQueuedCompletesExtended();
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
