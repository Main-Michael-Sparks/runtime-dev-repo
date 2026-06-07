// smokeTestRealRuntimeContextCancelShutdownDiagnostics.mjs
//
// Purpose:
// - Real-runtime regression smoke coverage for the shutdown timeout found after
//   cancel -> successful follow-up prompt -> terminal shutdown.
// - Keeps the bugfix branch's important real-runtime repro variants available
//   without relying on diagnostic worker tracing/progress env flags.
//
// Run the core regression modes:
//   node ./tests/smokeTestRealRuntimeContextCancelShutdownDiagnostics.mjs
//
// Run one mode:
//   SMOKE_MODE=real-cancel-new-session-followup-shutdown node ./tests/smokeTestRealRuntimeContextCancelShutdownDiagnostics.mjs
//   SMOKE_MODE=real-cancel-same-session-followup-shutdown node ./tests/smokeTestRealRuntimeContextCancelShutdownDiagnostics.mjs
//   SMOKE_MODE=real-cancel-same-session-followup-reset-new-session-then-shutdown node ./tests/smokeTestRealRuntimeContextCancelShutdownDiagnostics.mjs

import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const MODE = process.env.SMOKE_MODE || "orchestrator";
const SELF_PATH = fileURLToPath(import.meta.url);
const TEST_DIR = path.dirname(SELF_PATH);
const REPO_ROOT = path.resolve(TEST_DIR, "..");

const CORE_MODES = [
    "real-prompt-then-shutdown-control",
    "real-cancel-no-followup-shutdown",
    "real-cancel-new-session-followup-shutdown",
    "real-cancel-same-session-followup-shutdown"
];

const RESET_PROBE_MODES = [
    "real-cancel-same-session-followup-reset-then-shutdown",
    "real-cancel-same-session-followup-reset-new-session-then-shutdown"
];

const RESET_NEW_SESSION_PRE_RESET_PROMPT_LABEL = "same-session followup before reset-new";
const RESET_NEW_SESSION_PROMPT_LABEL = "new-session prompt after reset";
const RESET_NEW_SESSION_SHORT_PROMPT = "Reply with exactly one word: OK";

const EXTENDED_RESET_NEW_SESSION_PROMPT_LABELS = new Set([
    RESET_NEW_SESSION_PRE_RESET_PROMPT_LABEL,
    RESET_NEW_SESSION_PROMPT_LABEL
]);

function logSection(title) {
    console.log(`\n=== ${title} ===`);
}

function logStep(message) {
    console.log(`[DIAG] ${message}`);
}

function readEnvInt(name, fallback) {
    const value = Number(process.env[name] ?? fallback);
    return Number.isInteger(value) && value > 0 ? value : fallback;
}

function readPromptDeadlineMs(label) {
    if (!EXTENDED_RESET_NEW_SESSION_PROMPT_LABELS.has(label)) {
        return readEnvInt("REAL_PROMPT_DEADLINE_MS", 300000);
    }

    if (process.env.REAL_RESET_NEW_PROMPT_DEADLINE_MS != null) {
        return readEnvInt("REAL_RESET_NEW_PROMPT_DEADLINE_MS", 600000);
    }

    return readEnvInt("REAL_PROMPT_DEADLINE_MS", 600000);
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

async function importRuntime() {
    return import(pathToFileURL(path.join(REPO_ROOT, "runtime.mjs")).href);
}

async function realInit(runtime) {
    const readyTimeoutMs = readEnvInt("REAL_READY_TIMEOUT_MS", 120000);

    logStep("initModel start");

    await withDeadline(
        runtime.initModel({
            attempts: 2,
            readyTimeoutMs,
            retryDelayMs: 100,
            configOverride: {
                context: {
                    contextSize: readEnvInt("REAL_SMOKE_CONTEXT_SIZE", 2048),
                    batchSize: readEnvInt("REAL_SMOKE_BATCH_SIZE", 128)
                }
            }
        }),
        readyTimeoutMs + 30000,
        "real initModel"
    );

    logStep("initModel resolved");
}

async function runShortPrompt(runtime, { sessionId, label, promptText = "Say OK briefly." }) {
    logStep(`${label}: prompt start (${sessionId})`);

    const req = await runtime.prompt(promptText, {
        sessionId,
        stream: false
    });

    const result = await withDeadline(
        readPromptResult(req),
        readPromptDeadlineMs(label),
        `${label}: prompt result`
    );

    console.log(`[OK] ${label}:`, String(result).slice(0, 160));
    return result;
}

async function cancelLongPrompt(runtime, { sessionId, label }) {
    logStep(`${label}: long prompt start (${sessionId})`);

    const req = await runtime.prompt("Write a long explanation of recursion.", {
        sessionId,
        stream: true
    });

    req.done.catch(() => {});

    setTimeout(() => {
        logStep(`${label}: cancelPrompt(${req.id})`);
        const canceled = runtime.cancelPrompt(req.id);
        logStep(`${label}: cancelPrompt returned ${canceled}`);
    }, readEnvInt("REAL_CONTEXT_CANCEL_DELAY_MS", 25));

    await withDeadline(
        expectReject(label, () => readPromptResult(req), "Prompt canceled"),
        readEnvInt("REAL_CONTEXT_BOUNDARY_DEADLINE_MS", 240000),
        `${label}: cancellation boundary`
    );
}

async function shutdown(runtime, label) {
    logStep(`${label}: shutdown start`);

    await withDeadline(
        runtime.shutdownRuntime({ mode: "abort" }),
        readEnvInt("REAL_SHUTDOWN_DEADLINE_MS", 240000),
        `${label}: shutdown`
    );

    console.log(`[OK] ${label}: shutdown resolved`);
}

async function resetSession(runtime, sessionId, label) {
    logStep(`${label}: resetSession(${sessionId}) start`);

    await withDeadline(
        runtime.resetSession(sessionId),
        readEnvInt("REAL_CONTEXT_BOUNDARY_DEADLINE_MS", 240000),
        `${label}: resetSession(${sessionId})`
    );

    console.log(`[OK] ${label}: resetSession(${sessionId}) resolved`);
}

async function withRuntime(label, fn) {
    logSection(label);

    const runtime = await importRuntime();
    await realInit(runtime);
    await fn(runtime);
}

async function modePromptThenShutdownControl() {
    await withRuntime("real prompt then shutdown control", async (runtime) => {
        const sessionId = `real-control-${Date.now()}`;

        await runShortPrompt(runtime, {
            sessionId,
            label: "control prompt",
            promptText: RESET_NEW_SESSION_SHORT_PROMPT
        });

        await shutdown(runtime, "control prompt then shutdown");
    });

    console.log("[OK] real prompt then shutdown control completed");
}

async function modeCancelNoFollowupShutdown() {
    await withRuntime("real cancel no-followup shutdown", async (runtime) => {
        const sessionId = `real-cancel-no-followup-${Date.now()}`;

        await cancelLongPrompt(runtime, {
            sessionId,
            label: "cancel no-followup request"
        });

        await shutdown(runtime, "cancel no-followup shutdown");
    });

    console.log("[OK] real cancel no-followup shutdown completed");
}

async function modeCancelNewSessionFollowupShutdown() {
    await withRuntime("real cancel new-session followup shutdown", async (runtime) => {
        const canceledSessionId = `real-cancel-new-followup-a-${Date.now()}`;
        const followupSessionId = `real-cancel-new-followup-b-${Date.now()}`;

        await cancelLongPrompt(runtime, {
            sessionId: canceledSessionId,
            label: "cancel new-session followup request"
        });

        await runShortPrompt(runtime, {
            sessionId: followupSessionId,
            label: "new-session followup prompt"
        });

        await shutdown(runtime, "cancel new-session followup shutdown");
    });

    console.log("[OK] real cancel new-session followup shutdown completed");
}

async function modeCancelSameSessionFollowupShutdown() {
    await withRuntime("real cancel same-session followup shutdown", async (runtime) => {
        const sessionId = `real-cancel-same-followup-${Date.now()}`;

        await cancelLongPrompt(runtime, {
            sessionId,
            label: "cancel same-session followup request"
        });

        await runShortPrompt(runtime, {
            sessionId,
            label: "same-session followup prompt"
        });

        await shutdown(runtime, "cancel same-session followup shutdown");
    });

    console.log("[OK] real cancel same-session followup shutdown completed");
}

async function modeCancelSameSessionFollowupResetThenShutdown() {
    await withRuntime("real cancel same-session followup reset then shutdown", async (runtime) => {
        const sessionId = `real-cancel-same-reset-${Date.now()}`;

        await cancelLongPrompt(runtime, {
            sessionId,
            label: "cancel same-session reset request"
        });

        await runShortPrompt(runtime, {
            sessionId,
            label: "same-session followup before reset"
        });

        await resetSession(runtime, sessionId, "same-session reset probe");
        await shutdown(runtime, "same-session reset probe shutdown");
    });

    console.log("[OK] real cancel same-session followup reset then shutdown completed");
}

async function modeCancelSameSessionFollowupResetNewSessionThenShutdown() {
    await withRuntime("real cancel same-session followup reset new-session then shutdown", async (runtime) => {
        const sessionId = `real-cancel-same-reset-new-a-${Date.now()}`;
        const newSessionId = `real-cancel-same-reset-new-b-${Date.now()}`;

        await cancelLongPrompt(runtime, {
            sessionId,
            label: "cancel same-session reset-new request"
        });

        await runShortPrompt(runtime, {
            sessionId,
            label: RESET_NEW_SESSION_PRE_RESET_PROMPT_LABEL,
            promptText: RESET_NEW_SESSION_SHORT_PROMPT
        });

        await resetSession(runtime, sessionId, "same-session reset-new probe");

        await runShortPrompt(runtime, {
            sessionId: newSessionId,
            label: RESET_NEW_SESSION_PROMPT_LABEL,
            promptText: RESET_NEW_SESSION_SHORT_PROMPT
        });

        await shutdown(runtime, "same-session reset-new probe shutdown");
    });

    console.log("[OK] real cancel same-session followup reset new-session then shutdown completed");
}

async function orchestrator() {
    const repeat = readEnvInt("REAL_DIAG_REPEAT", 1);
    const modes = [...CORE_MODES];

    if (process.env.REAL_DIAG_INCLUDE_RESET_PROBES === "1") {
        modes.push(...RESET_PROBE_MODES);
    }

    for (let pass = 1; pass <= repeat; pass++) {
        logSection(`diagnostic pass ${pass} of ${repeat}`);

        for (const mode of modes) {
            logSection(`child mode: ${mode}`);
            await runChild(mode);
        }
    }

    console.log("\nAll real-runtime context-cancel shutdown regression smoke tests finished.");
}

async function main() {
    console.log("[SMOKE] mode:", MODE);

    switch (MODE) {
        case "orchestrator":
            await orchestrator();
            break;
        case "real-prompt-then-shutdown-control":
        case "real-fresh-session-prompt-then-shutdown-control":
            await modePromptThenShutdownControl();
            break;
        case "real-cancel-no-followup-shutdown":
        case "real-fresh-session-cancel-no-followup-shutdown":
            await modeCancelNoFollowupShutdown();
            break;
        case "real-cancel-new-session-followup-shutdown":
        case "real-fresh-session-cancel-new-session-followup-shutdown":
            await modeCancelNewSessionFollowupShutdown();
            break;
        case "real-cancel-same-session-followup-shutdown":
        case "real-fresh-session-cancel-same-session-followup-shutdown":
            await modeCancelSameSessionFollowupShutdown();
            break;
        case "real-cancel-same-session-followup-reset-then-shutdown":
        case "real-fresh-session-cancel-same-session-followup-reset-then-shutdown":
            await modeCancelSameSessionFollowupResetThenShutdown();
            break;
        case "real-cancel-same-session-followup-reset-new-session-then-shutdown":
        case "real-fresh-session-cancel-same-session-followup-reset-new-session-then-shutdown":
            await modeCancelSameSessionFollowupResetNewSessionThenShutdown();
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
