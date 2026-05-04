// smokeTestModelResetIdleIsolation.mjs
//
// Purpose:
// - Narrow isolation smoke for resetModel() idle crashes.
// - This is intentionally smaller than smokeTestLifecycleRegression.mjs.
// - Each mode runs in a fresh child process so native hard exits are isolated.
//
// Recommended location:
//   tests/smokeTestModelResetIdleIsolation.mjs
//
// Run all default isolation modes:
//   node ./tests/smokeTestModelResetIdleIsolation.mjs
//
// Run one mode:
//   SMOKE_MODE=reset-after-one-session node ./tests/smokeTestModelResetIdleIsolation.mjs
//
// Useful modes:
//   reset-no-session
//   reset-after-one-session
//   reset-after-two-sessions
//   reset-after-session-reset
//   fixture-creation-retry-disabled-reset-after-one-session
//   fixture-hardware-bounds-disabled-reset-after-one-session
//
// Notes:
// - Fixture modes create a temporary repo-like folder under the repo root so
//   node_modules resolution can still walk up to the real local install.
// - Fixture modes patch config.mjs only inside the temporary folder.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

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
  "llama_worker/llama.mjs",
];

function logSection(title) {
  console.log(`\n=== ${title} ===`);
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function runChild(mode) {
  return new Promise((resolve, reject) => {
    console.log("[ISOLATION] spawning child:", mode);

    const child = spawn(process.execPath, [SELF_PATH], {
      env: {
        ...process.env,
        SMOKE_MODE: mode,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout.on("data", (chunk) => {
      process.stdout.write(chunk);
    });

    child.stderr.on("data", (chunk) => {
      process.stderr.write(chunk);
    });

    child.on("error", reject);

    child.on("exit", (code) => {
      console.log("[ISOLATION] child exited:", mode, "code:", code);

      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(`Child isolation mode ${mode} failed with exit code ${code}`),
      );
    });
  });
}

function assertTextChanged(before, after, label) {
  assert.notEqual(before, after, `${label} patch did not change config text`);
}

async function createRuntimeFixture({
  creationRetryEnabled = null,
  allowHardwareDerivedBounds = null,
} = {}) {
  const tempDir = await mkdtemp(path.join(REPO_ROOT, ".tmp-reset-isolation-"));

  for (const rel of RUNTIME_FILES) {
    const src = path.join(REPO_ROOT, rel);
    const dest = path.join(tempDir, rel);
    await mkdir(path.dirname(dest), { recursive: true });
    await cp(src, dest);
  }

  const configPath = path.join(tempDir, "config.mjs");
  let configText = await readFile(configPath, "utf8");

  const originalWorkerDir = path.join(REPO_ROOT, "llama_worker");
  const realModelPath = path.resolve(
    originalWorkerDir,
    "../../../base/mistral-7b-instruct-v0.2.Q4_K_M.gguf",
  );

  const beforeModelPathPatch = configText;
  configText = configText.replace(
    /baseModel:\s*"[^"]+"/,
    `baseModel: ${JSON.stringify(realModelPath)}`,
  );
  assertTextChanged(
    beforeModelPathPatch,
    configText,
    "fixture absolute baseModel",
  );

  if (creationRetryEnabled !== null) {
    const before = configText;
    configText = configText.replace(
      /creationRetry:\s*\{\s*enabled:\s*(true|false),/,
      `creationRetry: {\n            enabled: ${creationRetryEnabled},`,
    );
    assertTextChanged(before, configText, "creationRetry.enabled");
  }

  if (allowHardwareDerivedBounds !== null) {
    const before = configText;
    configText = configText.replace(
      /allowHardwareDerivedBounds:\s*(true|false),/,
      `allowHardwareDerivedBounds: ${allowHardwareDerivedBounds},`,
    );
    assertTextChanged(before, configText, "allowHardwareDerivedBounds");
  }

  await writeFile(configPath, configText, "utf8");

  return tempDir;
}

async function importRuntimeFromRoot(rootDir, label) {
  const href = `${pathToFileURL(path.join(rootDir, "inference.mjs")).href}?isolation=${label}-${Date.now()}`;
  return import(href);
}

async function runResetNoSession(runtimeRoot, label) {
  logSection(`${label}: reset model idle with no session`);

  const { initModel, resetModel, prompt, shutdownRuntime } =
    await importRuntimeFromRoot(runtimeRoot, label);

  await initModel({
    attempts: 1,
    readyTimeoutMs: 120000,
  });
  console.log("[OK] init resolved");

  await resetModel();
  console.log("[OK] resetModel resolved with no prior session");

  const req = await prompt(
    "Say reset no session ok briefly.(use 10 words or less)",
    { stream: false },
  );
  const result = await req.done;
  console.log("[OK] post-reset prompt result:", String(result).slice(0, 120));

  await shutdownRuntime({ mode: "abort" });
  console.log("[OK] shutdown resolved");
}

async function runResetAfterOneSession(runtimeRoot, label) {
  logSection(`${label}: reset model idle after one session`);

  const { initModel, resetModel, prompt, shutdownRuntime } =
    await importRuntimeFromRoot(runtimeRoot, label);

  await initModel({
    attempts: 1,
    readyTimeoutMs: 120000,
  });
  console.log("[OK] init resolved");

  const first = await prompt(
    "Say before reset briefly.(use 10 words or less)",
    { stream: false },
  );
  console.log(
    "[OK] pre-reset prompt result:",
    String(await first.done).slice(0, 120),
  );

  await resetModel();
  console.log("[OK] resetModel resolved after one session");

  const after = await prompt("Say after reset briefly.(use 10 words or less)", {
    stream: false,
  });
  console.log(
    "[OK] post-reset prompt result:",
    String(await after.done).slice(0, 120),
  );

  await shutdownRuntime({ mode: "abort" });
  console.log("[OK] shutdown resolved");
}

async function runResetAfterTwoSessions(runtimeRoot, label) {
  logSection(`${label}: reset model idle after two sessions`);

  const { initModel, resetModel, prompt, shutdownRuntime } =
    await importRuntimeFromRoot(runtimeRoot, label);

  await initModel({
    attempts: 1,
    readyTimeoutMs: 120000,
  });
  console.log("[OK] init resolved");

  const a = await prompt(
    "Say default session before reset briefly.(use 10 words or less)",
    {
      stream: false,
      sessionId: "default",
    },
  );
  console.log(
    "[OK] default pre-reset result:",
    String(await a.done).slice(0, 120),
  );

  const b = await prompt(
    "Say alpha session before reset briefly.(use 10 words or less)",
    {
      stream: false,
      sessionId: "alpha",
    },
  );
  console.log(
    "[OK] alpha pre-reset result:",
    String(await b.done).slice(0, 120),
  );

  await resetModel();
  console.log("[OK] resetModel resolved after two sessions");

  const after = await prompt(
    "Say after two-session reset briefly.(use 10 words or less)",
    { stream: false },
  );
  console.log(
    "[OK] post-reset prompt result:",
    String(await after.done).slice(0, 120),
  );

  await shutdownRuntime({ mode: "abort" });
  console.log("[OK] shutdown resolved");
}

async function runResetAfterSessionReset(runtimeRoot, label) {
  logSection(`${label}: reset model after prior resetSession`);

  const { initModel, resetSession, resetModel, prompt, shutdownRuntime } =
    await importRuntimeFromRoot(runtimeRoot, label);

  await initModel({
    attempts: 1,
    readyTimeoutMs: 120000,
  });
  console.log("[OK] init resolved");

  const beta = await prompt(
    "Say beta before session reset briefly.(use 10 words or less)",
    {
      stream: false,
      sessionId: "beta",
    },
  );
  console.log(
    "[OK] beta pre-reset result:",
    String(await beta.done).slice(0, 120),
  );

  await resetSession("beta");
  console.log("[OK] resetSession(beta) resolved");

  await resetModel();
  console.log("[OK] resetModel resolved after prior session reset");

  const after = await prompt(
    "Say after prior session reset briefly.(use 10 words or less)",
    { stream: false },
  );
  console.log(
    "[OK] post-reset prompt result:",
    String(await after.done).slice(0, 120),
  );

  await shutdownRuntime({ mode: "abort" });
  console.log("[OK] shutdown resolved");
}

async function runFixture(label, fixtureOptions, scenario) {
  const fixtureDir = await createRuntimeFixture(fixtureOptions);

  try {
    await scenario(fixtureDir, label);
  } finally {
    await rm(fixtureDir, { recursive: true, force: true });
  }
}

async function orchestrator() {
  const modes = [
    "reset-no-session",
    "reset-after-one-session",
    "reset-after-two-sessions",
    "reset-after-session-reset",
    "fixture-creation-retry-disabled-reset-after-one-session",
    "fixture-hardware-bounds-disabled-reset-after-one-session",
  ];

  for (const mode of modes) {
    logSection(`child mode: ${mode}`);
    await runChild(mode);
  }

  console.log("\nAll model reset idle isolation checks finished.");
}

async function main() {
  console.log("[ISOLATION] mode:", MODE);

  switch (MODE) {
    case "orchestrator":
      await orchestrator();
      break;
    case "reset-no-session":
      await runResetNoSession(REPO_ROOT, MODE);
      break;
    case "reset-after-one-session":
      await runResetAfterOneSession(REPO_ROOT, MODE);
      break;
    case "reset-after-two-sessions":
        await sleep(60000)
        await runResetAfterTwoSessions(REPO_ROOT, MODE);
      break;
    case "reset-after-session-reset":
        await sleep(60000)
        await runResetAfterSessionReset(REPO_ROOT, MODE);
      break;
    case "fixture-creation-retry-disabled-reset-after-one-session":
                await sleep(60000)
      await runFixture(
        MODE,
        { creationRetryEnabled: false },
        runResetAfterOneSession,
      );
      break;
    case "fixture-hardware-bounds-disabled-reset-after-one-session":
                await sleep(60000)
      await runFixture(
        MODE,
        { allowHardwareDerivedBounds: false },
        runResetAfterOneSession,
      );
      break;
    default:
      throw new Error(`Unknown SMOKE_MODE: ${MODE}`);
  }
}

main().catch((err) => {
  console.error("\n[ISOLATION TEST FAILURE]");
  console.error(err);
  process.exitCode = 1;
});