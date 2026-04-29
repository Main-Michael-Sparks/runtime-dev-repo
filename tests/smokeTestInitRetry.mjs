// smokeTestInitRetry.mjs
//
// Purpose:
// - Local smoke/regression test for Init Retry v1.
// - Run after applying staged `config.mjs`, `inference.mjs`, and `workerBridge.mjs`
//   to your local `init-retry-logic` branch.
//
// Recommended location:
//   tests/smokeTestInitRetry.mjs
//
// Run:
//   node ./tests/smokeTestInitRetry.mjs
//
// Notes:
// - This test intentionally spawns isolated child processes for some cases so
//   each scenario gets a fresh module/runtime state.
// - Shutdown remains last within any scenario that uses it.
// - Timeout tests may take a few seconds because they intentionally force a
//   failed init attempt and then verify recovery.

import { spawn } from "child_process";
import process from "process";
import { fileURLToPath } from "url";

const MODE = process.env.SMOKE_MODE || "orchestrator";
const SELF_PATH = fileURLToPath(import.meta.url);

function logSection(title) {
  console.log(`\n=== ${title} ===`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function runChild(mode) {
  return new Promise((resolve, reject) => {
    console.log("[SMOKE] spawning child:", mode);

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
      console.log("[SMOKE] child exited:", mode, "code:", code);

      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(`Child smoke mode ${mode} failed with exit code ${code}`),
      );
    });
  });
}

async function modeDuplicateExplicitInit() {
  logSection("duplicate explicit init rejection");

  const { initModel, shutdownRuntime } =
    await import("../inference.mjs");

  const firstInit = initModel({
    attempts: 1,
    readyTimeoutMs: 120000,
  });

  await expectReject(
    "second explicit init while first is active",
    () => initModel({ attempts: 1 }),
    "Model initialization already in progress",
  );

  await firstInit;
  console.log("[OK] first explicit init resolved");

  await shutdownRuntime({ mode: "abort" });
  console.log("[OK] shutdown after duplicate-init test resolved");
}

async function modePromptAutoInit() {
  logSection("prompt auto-init via ensureModelReady");

  const { prompt, shutdownRuntime } = await import("../inference.mjs");

  const req = await prompt("Say hello briefly.");
  const result = await readPromptResult(req, { logChunks: false });

  if (!result || typeof result !== "string") {
    throw new Error("[FAIL] prompt auto-init produced no text result");
  }

  console.log("[OK] prompt auto-init result:", result.slice(0, 160));

  await shutdownRuntime({ mode: "abort" });
  console.log("[OK] shutdown after auto-init test resolved");
}

async function modeRetryTimeoutRecovery() {
  logSection("init ready-timeout failure then recovery");

  const { initModel, prompt, shutdownRuntime } =
    await import("../inference.mjs");

  await expectReject(
    "forced init timeout",
    () =>
      initModel({
        attempts: 1,
        readyTimeoutMs: 1,
        retryDelayMs: 0,
      }),
    "Model init failed after 1 attempt",
  );

  console.log("[OK] forced timeout did not crash runtime");

  await initModel({
    attempts: 2,
    readyTimeoutMs: 120000,
    retryDelayMs: 100,
  });

  console.log("[OK] init recovered after forced timeout");

  const req = await prompt("Say recovered briefly.");
  const result = await readPromptResult(req, { logChunks: false });
  console.log("[OK] post-recovery prompt result:", result.slice(0, 160));

  await shutdownRuntime({ mode: "abort" });
  console.log("[OK] shutdown after timeout recovery test resolved");
}

async function modeInvalidOptions() {
  logSection("invalid init options reject before worker init");

  const { initModel, shutdownRuntime } =
    await import("../inference.mjs");

  await expectReject(
    "unsupported init retry strategy",
    () => initModel({ strategy: "unsupported-strategy" }),
    "Unsupported init retry strategy",
  );

  await expectReject(
    "reserved configOverride",
    () =>
      initModel({
        configOverride: {
          context: {
            contextSize: 2048,
          },
        },
      }),
    "configOverride is reserved",
  );

  console.log("[OK] invalid options rejected cleanly");

  await shutdownRuntime({ mode: "abort" });
  console.log("[OK] shutdown after invalid-options test resolved");
}

async function modeLifecycleRegression() {
  logSection("lifecycle regression after init retry changes");

  const {
    initModel,
    prompt,
    cancelPrompt,
    resetSession,
    resetModel,
    shutdownRuntime,
  } = await import("../inference.mjs");

  const { getTrace, getAllTraces } = await import("../observer.mjs");

  await initModel({
    attempts: 2,
    readyTimeoutMs: 120000,
    retryDelayMs: 100,
  });
  console.log("[OK] explicit init resolved");

  logSection("basic prompt");
  const basic = await prompt("Say hello briefly.");
  console.log("trace after basic prompt:", getTrace(basic.id));
  const basicResult = await readPromptResult(basic, { logChunks: false });
  console.log("[OK] basic prompt result:", basicResult.slice(0, 160));
  console.log("trace after basic done:", getTrace(basic.id));

  logSection("concurrent prompts");
  const a = await prompt("Answer with a short sentence beginning with A.");
  const b = await prompt("Answer with a short sentence beginning with B.");
  console.log("trace snapshot after enqueue:", [...getAllTraces().entries()]);
  const [aResult, bResult] = await Promise.all([
    readPromptResult(a, { logChunks: false }),
    readPromptResult(b, { logChunks: false }),
  ]);
  console.log("[OK] concurrent results:", [
    aResult.slice(0, 80),
    bResult.slice(0, 80),
  ]);
  console.log("trace snapshot after completion:", [
    ...getAllTraces().entries(),
  ]);

  logSection("cancel active prompt");
  const cancelReq = await prompt("Write a long explanation of recursion.");
  console.log("before cancel:", getTrace(cancelReq.id));

  setTimeout(() => {
    const canceled = cancelPrompt(cancelReq.id);
    console.log("cancel called:", canceled);
    console.log("after cancel:", getTrace(cancelReq.id));
  }, 100);

  try {
    await readPromptResult(cancelReq, { logChunks: false });
    throw new Error("[FAIL] canceled prompt resolved unexpectedly");
  } catch (err) {
    if (String(err.message).startsWith("[FAIL]")) throw err;
    console.log("[OK] canceled prompt rejected:", err.message);
  }

  logSection("session reset idle");
  await resetSession("alpha");
  console.log("[OK] resetSession(alpha) resolved");

  const alpha = await prompt("Say hello from alpha.", { sessionId: "alpha" });
  console.log(
    "[OK] alpha post-reset result:",
    (await readPromptResult(alpha)).slice(0, 160),
  );

  logSection("session reset active");
  const beta = await prompt("Write a long explanation of recursion.", {
    sessionId: "beta",
  });

  const betaReset = (async () => {
    await sleep(100);
    await resetSession("beta");
    console.log("[OK] resetSession(beta) resolved");
  })();

  try {
    await readPromptResult(beta, { logChunks: false });
    throw new Error("[FAIL] beta prompt resolved unexpectedly after reset");
  } catch (err) {
    if (String(err.message).startsWith("[FAIL]")) throw err;
    console.log("[OK] beta request rejected:", err.message);
  }

  await betaReset;

  logSection("model reset idle");
  await resetModel();
  console.log("[OK] resetModel idle resolved");

  const afterIdleReset = await prompt("Say hello after idle model reset.");
  console.log(
    "[OK] post-idle-reset prompt result:",
    (await readPromptResult(afterIdleReset)).slice(0, 160),
  );

  logSection("model reset active");
  const active = await prompt("Write a long explanation of recursion.");

  const activeReset = (async () => {
    await sleep(100);
    const resetPromise = resetModel();

    await expectReject(
      "prompt during active model reset",
      () => prompt("This should reject while model reset is active."),
      "Runtime is resetting",
    );

    await resetPromise;
    console.log("[OK] resetModel active resolved");
  })();

  try {
    await readPromptResult(active, { logChunks: false });
    throw new Error(
      "[FAIL] active prompt resolved unexpectedly after model reset",
    );
  } catch (err) {
    if (String(err.message).startsWith("[FAIL]")) throw err;
    console.log("[OK] active prompt rejected:", err.message);
  }

  await activeReset;

  const afterActiveReset = await prompt("Say hello after active model reset.");
  console.log(
    "[OK] post-active-reset prompt result:",
    (await readPromptResult(afterActiveReset)).slice(0, 160),
  );

  logSection("shutdown idle");
  await shutdownRuntime({ mode: "abort" });
  console.log("[OK] shutdownRuntime resolved");

  await expectReject(
    "prompt after shutdown",
    () => prompt("This should reject after shutdown."),
    "Runtime is shutting down",
  );
}

async function orchestrator() {
  const modes = [
    "invalid-options",
    "duplicate-explicit-init",
    "prompt-auto-init",
    "retry-timeout-recovery",
    "lifecycle-regression",
  ];

  for (const mode of modes) {
    logSection(`child mode: ${mode}`);
    await runChild(mode);
  }

  console.log("\nAll init-retry smoke tests finished.");
}

async function main() {
  console.log("[SMOKE] mode:", MODE);
  switch (MODE) {
    case "orchestrator":
      await orchestrator();
      break;
    case "invalid-options":
      await modeInvalidOptions();
      break;
    case "duplicate-explicit-init":
      await modeDuplicateExplicitInit();
      break;
    case "prompt-auto-init":
      await modePromptAutoInit();
      break;
    case "retry-timeout-recovery":
      await modeRetryTimeoutRecovery();
      break;
    case "lifecycle-regression":
      await modeLifecycleRegression();
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
