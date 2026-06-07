// smokeTestWorkerOperationSerialization.mjs
//
// Purpose:
// - Branch-scoped deterministic smoke coverage for worker-operation-serialization-v1.
// - Verifies worker-side lifecycle command ordering with a fake node-llama-cpp package.
// - Keeps prompt execution outside global serialization and keeps cancel fast.
//
// Run:
//   node ./tests/smokeTestWorkerOperationSerialization.mjs
//
// Run one mock mode:
//   SMOKE_MODE=mock-reset-session-and-reset-model-ordered node ./tests/smokeTestWorkerOperationSerialization.mjs
//
// Run mock + branch-scoped real-worker smoke against local node-llama-cpp/model setup:
//   REAL_RUNTIME=1 node ./tests/smokeTestWorkerOperationSerialization.mjs
//
// Run real-worker smoke only:
//   SMOKE_MODE=real-orchestrator node ./tests/smokeTestWorkerOperationSerialization.mjs
//
// Useful real-runtime tuning env vars:
//   REAL_READY_TIMEOUT_MS=300000
//   REAL_PROMPT_DEADLINE_MS=300000
//   REAL_LIFECYCLE_DEADLINE_MS=300000
//   REAL_SMOKE_CHILD_DEADLINE_MS=900000

import assert from "node:assert/strict";
import { Worker } from "node:worker_threads";
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
    "llama_worker/llama.mjs",
    "llama_worker/cancellation/activeRequestRegistry.mjs",
    "llama_worker/cancellation/requestBoundaries.mjs",
    "llama_worker/lifecycle/modelDisposalPolicy.mjs",
    "llama_worker/session/sessionDisposal.mjs",
    "llama_worker/context/contextOptions.mjs",
    "llama_worker/prompt/chunkFactory.mjs",
    "llama_worker/state/workerState.mjs",
    "llama_worker/serialization/workerOperationQueue.mjs",
    "llama_worker/errors/promptAbort.mjs",
    "llama_worker/messages/outboundMessages.mjs"
];

function logSection(title) {
    console.log(`\n=== ${title} ===`);
}

function shouldRunRealRuntime() {
    const raw = String(process.env.REAL_RUNTIME ?? "").trim().toLowerCase();
    return raw === "1" || raw === "true" || raw === "yes";
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

function getRealReadyTimeoutMs() {
    return readPositiveIntEnv("REAL_READY_TIMEOUT_MS", 300000);
}

function getRealPromptDeadlineMs() {
    return readPositiveIntEnv("REAL_PROMPT_DEADLINE_MS", 300000);
}

function getRealLifecycleDeadlineMs() {
    return readPositiveIntEnv("REAL_LIFECYCLE_DEADLINE_MS", 300000);
}

function getChildDeadlineMs(mode) {
    if (process.env.SMOKE_CHILD_DEADLINE_MS) {
        return readPositiveIntEnv("SMOKE_CHILD_DEADLINE_MS", 30000);
    }

    if (mode.startsWith("real-")) {
        return readPositiveIntEnv("REAL_SMOKE_CHILD_DEADLINE_MS", 900000);
    }

    return 30000;
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

async function copyRuntimeFixture() {
    const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "runtime-worker-serialization-"));

    for (const rel of RUNTIME_FILES) {
        const src = path.join(REPO_ROOT, rel);
        const dest = path.join(tmpRoot, rel);
        await mkdir(path.dirname(dest), { recursive: true });
        await cp(src, dest);
    }

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
let contextDisposeFailuresRemaining = Number(process.env.MOCK_CONTEXT_DISPOSE_FAIL_ONCE ?? 0);

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function log(event, data = {}) {
    appendFileSync(
        process.env.MOCK_EVENT_LOG,
        JSON.stringify({ event, at: Date.now(), ...data }) + "\\n"
    );
}

class FakeContext {
    constructor() {
        this.id = ++nextContextId;
        this.disposed = false;
        log("context-created", { contextId: this.id });
    }

    getSequence() {
        return { contextId: this.id };
    }

    async dispose() {
        log("context-dispose-start", { contextId: this.id, disposed: this.disposed });
        await sleep(Number(process.env.MOCK_CONTEXT_DISPOSE_DELAY_MS ?? 120));

        if (contextDisposeFailuresRemaining > 0) {
            contextDisposeFailuresRemaining -= 1;
            log("context-dispose-error", { contextId: this.id });
            throw new Error("mock context dispose failure");
        }

        this.disposed = true;
        log("context-dispose-end", { contextId: this.id });
    }
}

class FakeModel {
    constructor() {
        this.id = ++nextModelId;
        this.disposed = false;
        log("model-created", { modelId: this.id });
    }

    async createContext() {
        log("create-context", { modelId: this.id });
        return new FakeContext();
    }

    detokenize(tokens) {
        return Array.isArray(tokens) ? tokens.join("") : String(tokens);
    }

    async dispose() {
        log("model-dispose-start", { modelId: this.id, disposed: this.disposed });
        await sleep(Number(process.env.MOCK_MODEL_DISPOSE_DELAY_MS ?? 10));
        this.disposed = true;
        log("model-dispose-end", { modelId: this.id });
    }
}

export class LlamaChatSession {
    constructor({ contextSequence }) {
        this.id = ++nextSessionId;
        this.contextSequence = contextSequence;
        this.disposed = false;
        log("session-created", { sessionId: this.id, contextId: contextSequence?.contextId ?? null });
    }

    dispose(options = {}) {
        log("session-dispose", {
            sessionId: this.id,
            contextId: this.contextSequence?.contextId ?? null,
            disposeSequence: options.disposeSequence === true,
            disposed: this.disposed
        });
        this.disposed = true;
    }

    async prompt(text, options = {}) {
        log("prompt-start", { sessionId: this.id, text });

        if (String(text).includes("block-until-abort")) {
            while (!options.signal?.aborted) {
                await sleep(20);
            }

            log("prompt-abort-observed", { sessionId: this.id });
            throw options.signal.reason ?? new Error("mock prompt aborted");
        }

        options.onToken?.(["O"]);
        options.onToken?.(["K"]);
        log("prompt-done", { sessionId: this.id, text });
        return "OK";
    }
}

export async function getLlama() {
    log("get-llama");

    return {
        async loadModel() {
            log("load-model");
            return new FakeModel();
        }
    };
}
`
    );

    return tmpRoot;
}

function createWorkerHarness(tmpRoot, eventLogPath, extraEnv = {}) {
    const messages = [];
    const worker = new Worker(pathToFileURL(path.join(tmpRoot, "llama_worker", "llama.mjs")), {
        env: {
            ...process.env,
            MOCK_EVENT_LOG: eventLogPath,
            ...extraEnv
        }
    });

    worker.on("message", (msg) => {
        messages.push(msg);
    });

    return {
        worker,
        messages,
        post(message, transferList = []) {
            worker.postMessage(message, transferList);
        },
        async waitForMessage(predicate, label, timeoutMs = 5000) {
            const startedAt = Date.now();

            while (Date.now() - startedAt < timeoutMs) {
                const found = messages.find(predicate);
                if (found) return found;
                await sleep(20);
            }

            throw new Error(`[FAIL] timed out waiting for ${label}`);
        },
        async stop() {
            await worker.terminate();
        }
    };
}

async function initWorker(harness) {
    harness.post({ type: "init", initAttemptId: "attempt-1", profileName: "base" });
    await harness.waitForMessage((msg) => msg.type === "ready", "worker ready");
}

async function createSessionWithPrompt(harness, sessionId, id) {
    harness.post({ type: "prompt", id, sessionId, text: `create session ${sessionId}`, stream: false });
    await harness.waitForMessage((msg) => msg.type === "done" && msg.id === id, `prompt done ${id}`);
}

async function modeResetSessionAndResetModelOrdered() {
    logSection("reset_session and reset_model are serialized");

    const tmpRoot = await copyRuntimeFixture();
    const eventLogPath = path.join(tmpRoot, "events.jsonl");
    const harness = createWorkerHarness(tmpRoot, eventLogPath);

    try {
        await initWorker(harness);
        await createSessionWithPrompt(harness, "alpha", 1);

        harness.post({ type: "reset_session", sessionId: "alpha" });
        harness.post({ type: "reset_model" });

        await harness.waitForMessage((msg) => msg.type === "reset_done" && msg.sessionId === "alpha", "reset_done alpha");
        await harness.waitForMessage((msg) => msg.type === "model_reset_done", "model_reset_done");

        const events = await readEvents(eventLogPath);
        const disposeStarts = events.filter((event) => event.event === "context-dispose-start");

        assert.equal(
            disposeStarts.length,
            1,
            "context should be disposed exactly once across serialized reset_session/reset_model"
        );

        assertEventOrder(
            events,
            (event) => event.event === "context-dispose-end",
            (event) => event.event === "model-dispose-start",
            "session context disposal should finish before model disposal"
        );

        console.log("[OK] reset_session/reset_model serialization preserved single disposal");
    } finally {
        await harness.stop().catch(() => {});
        await rm(tmpRoot, { recursive: true, force: true });
    }
}

async function modeSerializerContinuesAfterLifecycleError() {
    logSection("serializer continues after lifecycle error");

    const tmpRoot = await copyRuntimeFixture();
    const eventLogPath = path.join(tmpRoot, "events.jsonl");
    const harness = createWorkerHarness(tmpRoot, eventLogPath, {
        MOCK_CONTEXT_DISPOSE_FAIL_ONCE: "1"
    });

    try {
        await initWorker(harness);
        await createSessionWithPrompt(harness, "alpha", 1);

        harness.post({ type: "reset_session", sessionId: "alpha" });
        harness.post({ type: "reset_model" });

        const resetError = await harness.waitForMessage(
            (msg) => msg.type === "error" && msg.error?.message?.includes("mock context dispose failure"),
            "reset_session dispose error"
        );

        assert.equal(resetError.error.sessionId, "alpha");

        await harness.waitForMessage((msg) => msg.type === "model_reset_done", "model_reset_done after prior lifecycle error");

        const events = await readEvents(eventLogPath);
        assert(events.some((event) => event.event === "context-dispose-error"), "expected first dispose error event");
        assert(events.some((event) => event.event === "model-dispose-end"), "expected later model disposal to complete");

        console.log("[OK] lifecycle operation chain recovered after a rejected operation");
    } finally {
        await harness.stop().catch(() => {});
        await rm(tmpRoot, { recursive: true, force: true });
    }
}

async function modeShutdownAndResetModelOrdered() {
    logSection("shutdown and reset_model are serialized");

    const tmpRoot = await copyRuntimeFixture();
    const eventLogPath = path.join(tmpRoot, "events.jsonl");
    const harness = createWorkerHarness(tmpRoot, eventLogPath, {
        MOCK_MODEL_DISPOSE_DELAY_MS: "250"
    });

    try {
        await initWorker(harness);
        await createSessionWithPrompt(harness, "alpha", 1);

        harness.post({ type: "shutdown" });
        await waitForEvent(eventLogPath, (event) => event.event === "model-dispose-start", "model dispose start");

        harness.post({ type: "reset_model" });

        await harness.waitForMessage((msg) => msg.type === "shutdown_done", "shutdown_done");
        await harness.waitForMessage(
            (msg) => msg.type === "error" && msg.error?.message === "Model is resetting",
            "reset_model error after shutdown"
        );

        const shutdownDoneIndex = harness.messages.findIndex((msg) => msg.type === "shutdown_done");
        const resetModelErrorIndex = harness.messages.findIndex(
            (msg) => msg.type === "error" && msg.error?.message === "Model is resetting"
        );

        assert.notEqual(shutdownDoneIndex, -1, "shutdown_done should be observed");
        assert.notEqual(resetModelErrorIndex, -1, "reset_model error should be observed");
        assert(
            shutdownDoneIndex < resetModelErrorIndex,
            "reset_model error should be emitted only after prior shutdown lifecycle operation finishes"
        );

        console.log("[OK] shutdown/reset_model lifecycle messages were ordered deterministically");
    } finally {
        await harness.stop().catch(() => {});
        await rm(tmpRoot, { recursive: true, force: true });
    }
}

async function modeCancelBypassesLifecycleQueue() {
    logSection("cancel bypasses lifecycle serialization");

    const tmpRoot = await copyRuntimeFixture();
    const eventLogPath = path.join(tmpRoot, "events.jsonl");
    const harness = createWorkerHarness(tmpRoot, eventLogPath, {
        MOCK_CONTEXT_DISPOSE_DELAY_MS: "250"
    });

    try {
        await initWorker(harness);
        await createSessionWithPrompt(harness, "alpha", 1);

        harness.post({ type: "prompt", id: 2, sessionId: "beta", text: "block-until-abort", stream: false });
        await waitForEvent(eventLogPath, (event) => event.event === "prompt-start" && event.text === "block-until-abort", "blocking beta prompt start");

        harness.post({ type: "reset_session", sessionId: "alpha" });
        await waitForEvent(eventLogPath, (event) => event.event === "context-dispose-start", "alpha context dispose start");

        harness.post({ type: "cancel", id: 2, sessionId: "beta", reason: "test cancel" });
        await waitForEvent(eventLogPath, (event) => event.event === "prompt-abort-observed", "beta prompt abort observed", 1000);
        await harness.waitForMessage((msg) => msg.type === "reset_done" && msg.sessionId === "alpha", "reset_done alpha");

        console.log("[OK] cancel reached active prompt while lifecycle disposal was queued/running");
    } finally {
        await harness.stop().catch(() => {});
        await rm(tmpRoot, { recursive: true, force: true });
    }
}


function createDirectWorkerHarness(extraEnv = {}) {
    const messages = [];
    let workerError = null;
    let workerExitCode = null;
    const worker = new Worker(pathToFileURL(path.join(REPO_ROOT, "llama_worker", "llama.mjs")), {
        env: {
            ...process.env,
            ...extraEnv
        }
    });

    worker.on("message", (msg) => {
        messages.push({ ...msg, observedAt: Date.now() });
    });

    worker.on("error", (err) => {
        workerError = err;
    });

    worker.on("exit", (code) => {
        workerExitCode = code;
    });

    function describeRecentMessages() {
        if (messages.length === 0) return "no worker protocol messages observed";

        return JSON.stringify(messages.slice(-5), null, 2);
    }

    return {
        worker,
        messages,
        post(message, transferList = []) {
            worker.postMessage(message, transferList);
        },
        async waitForMessage(predicate, label, timeoutMs = 5000) {
            const startedAt = Date.now();

            while (Date.now() - startedAt < timeoutMs) {
                const found = messages.find(predicate);
                if (found) return found;

                if (workerError) {
                    throw new Error(`[FAIL] worker error while waiting for ${label}: ${workerError.message}`);
                }

                if (workerExitCode !== null) {
                    throw new Error(`[FAIL] worker exited with code ${workerExitCode} while waiting for ${label}. Recent messages: ${describeRecentMessages()}`);
                }

                await sleep(50);
            }

            throw new Error(`[FAIL] timed out waiting for ${label}. Recent messages: ${describeRecentMessages()}`);
        },
        async stop() {
            await worker.terminate();
        }
    };
}

async function initRealWorker(harness, label) {
    const initAttemptId = `${label}-${Date.now()}`;

    console.log(`[SMOKE] ${label}: direct worker init start`);
    harness.post({
        type: "init",
        initAttemptId,
        profileName: "real-worker-serialization"
    });

    const initResult = await harness.waitForMessage(
        (msg) => (
            msg.type === "ready" && msg.initAttemptId === initAttemptId
        ) || (
            msg.type === "error" && msg.initAttemptId === initAttemptId
        ),
        `${label} ready`,
        getRealReadyTimeoutMs()
    );

    if (initResult.type === "error") {
        throw new Error(`[FAIL] ${label} init failed: ${initResult.error?.message ?? "unknown worker init error"}`);
    }

    console.log(`[SMOKE] ${label}: direct worker init resolved`);
}

async function directPrompt(harness, { id, sessionId, text, deadlineMs = getRealPromptDeadlineMs() }) {
    harness.post({
        type: "prompt",
        id,
        sessionId,
        text,
        stream: false
    });

    const result = await harness.waitForMessage(
        (msg) => (msg.type === "done" || msg.type === "error") && msg.id === id,
        `prompt ${id}`,
        deadlineMs
    );

    if (result.type === "error") {
        throw new Error(`Direct worker prompt ${id} failed: ${result.error?.message ?? "unknown worker error"}`);
    }

    assert.equal(result.type, "done");
    assert.equal(result.id, id);
    assert.equal(typeof result.res, "string");
    assert(result.res.length > 0, "direct worker prompt should produce non-empty text");

    return result.res;
}

async function modeRealDirectResetSessionAndResetModelOrdered() {
    logSection("real direct worker reset_session and reset_model ordering");

    const harness = createDirectWorkerHarness();
    const sessionId = `real-worker-serialization-alpha-${Date.now()}`;

    try {
        await initRealWorker(harness, "real-reset-session-reset-model");
        const warmResult = await directPrompt(harness, {
            id: 1,
            sessionId,
            text: "Answer with exactly one short sentence."
        });
        console.log("[OK] real direct worker warm prompt result:", warmResult.slice(0, 160));

        harness.post({ type: "reset_session", sessionId });
        harness.post({ type: "reset_model" });

        await harness.waitForMessage(
            (msg) => msg.type === "reset_done" && msg.sessionId === sessionId,
            "real reset_done",
            getRealLifecycleDeadlineMs()
        );
        await harness.waitForMessage(
            (msg) => msg.type === "model_reset_done",
            "real model_reset_done",
            getRealLifecycleDeadlineMs()
        );

        const resetDoneIndex = harness.messages.findIndex(
            (msg) => msg.type === "reset_done" && msg.sessionId === sessionId
        );
        const modelResetDoneIndex = harness.messages.findIndex((msg) => msg.type === "model_reset_done");

        assert.notEqual(resetDoneIndex, -1, "real reset_done should be observed");
        assert.notEqual(modelResetDoneIndex, -1, "real model_reset_done should be observed");
        assert(
            resetDoneIndex < modelResetDoneIndex,
            "real model_reset_done should be observed after reset_done"
        );

        console.log("[OK] real direct worker reset_session/reset_model ordered safely");
    } finally {
        await harness.stop().catch(() => {});
    }
}

async function modeRealDirectShutdownAndResetModelOrdered() {
    logSection("real direct worker shutdown and reset_model ordering");

    const harness = createDirectWorkerHarness();
    const sessionId = `real-worker-serialization-shutdown-${Date.now()}`;

    try {
        await initRealWorker(harness, "real-shutdown-reset-model");
        const warmResult = await directPrompt(harness, {
            id: 1,
            sessionId,
            text: "Answer briefly for shutdown ordering smoke."
        });
        console.log("[OK] real direct worker warm prompt result:", warmResult.slice(0, 160));

        harness.post({ type: "shutdown" });
        harness.post({ type: "reset_model" });

        await harness.waitForMessage(
            (msg) => msg.type === "shutdown_done",
            "real shutdown_done",
            getRealLifecycleDeadlineMs()
        );
        await harness.waitForMessage(
            (msg) => msg.type === "error" && msg.error?.message === "Model is resetting",
            "real reset_model error after shutdown",
            getRealLifecycleDeadlineMs()
        );

        const shutdownDoneIndex = harness.messages.findIndex((msg) => msg.type === "shutdown_done");
        const resetModelErrorIndex = harness.messages.findIndex(
            (msg) => msg.type === "error" && msg.error?.message === "Model is resetting"
        );

        assert.notEqual(shutdownDoneIndex, -1, "real shutdown_done should be observed");
        assert.notEqual(resetModelErrorIndex, -1, "real reset_model error should be observed");
        assert(
            shutdownDoneIndex < resetModelErrorIndex,
            "real reset_model error should be emitted after shutdown_done"
        );

        console.log("[OK] real direct worker shutdown/reset_model ordered safely");
    } finally {
        await harness.stop().catch(() => {});
    }
}

async function realOrchestrator() {
    const modes = [
        "real-direct-reset-session-and-reset-model-ordered",
        "real-direct-shutdown-and-reset-model-ordered"
    ];

    for (const mode of modes) {
        logSection(`child mode: ${mode}`);
        await runChild(mode);
    }

    console.log("\nAll real worker-operation serialization smoke tests finished.");
}

async function orchestrator() {
    const modes = [
        "mock-reset-session-and-reset-model-ordered",
        "mock-serializer-continues-after-lifecycle-error",
        "mock-shutdown-and-reset-model-ordered",
        "mock-cancel-bypasses-lifecycle-queue"
    ];

    if (shouldRunRealRuntime()) {
        modes.push("real-direct-reset-session-and-reset-model-ordered");
        modes.push("real-direct-shutdown-and-reset-model-ordered");
    }

    for (const mode of modes) {
        logSection(`child mode: ${mode}`);
        await runChild(mode);
    }

    console.log("\nAll worker-operation serialization smoke tests finished.");
}

async function main() {
    console.log("[SMOKE] mode:", MODE);

    switch (MODE) {
        case "orchestrator":
            await orchestrator();
            break;
        case "mock-reset-session-and-reset-model-ordered":
            await modeResetSessionAndResetModelOrdered();
            break;
        case "mock-serializer-continues-after-lifecycle-error":
            await modeSerializerContinuesAfterLifecycleError();
            break;
        case "mock-shutdown-and-reset-model-ordered":
            await modeShutdownAndResetModelOrdered();
            break;
        case "mock-cancel-bypasses-lifecycle-queue":
            await modeCancelBypassesLifecycleQueue();
            break;
        case "real-orchestrator":
            await realOrchestrator();
            break;
        case "real-direct-reset-session-and-reset-model-ordered":
            await modeRealDirectResetSessionAndResetModelOrdered();
            break;
        case "real-direct-shutdown-and-reset-model-ordered":
            await modeRealDirectShutdownAndResetModelOrdered();
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
