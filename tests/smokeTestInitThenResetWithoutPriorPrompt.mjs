// smokeTestInitThenResetWithoutPriorPrompt.mjs
//
// Purpose:
// - Focused test-first investigation for real-init-then-reset-without-prior-prompt-v1.
// - Verifies initModel() -> resetModel() -> prompt() when no prompt/session/context
//   has existed before resetModel().
// - Includes deterministic fake-runtime coverage and branch-scoped real-runtime modes.
//
// Run deterministic/mock modes:
//   SKIP_REAL_RUNTIME=1 node ./tests/smokeTestInitThenResetWithoutPriorPrompt.mjs
//
// Run mock + real modes against local node-llama-cpp/model setup:
//   REAL_RUNTIME=1 node ./tests/smokeTestInitThenResetWithoutPriorPrompt.mjs
//
// Run real modes only:
//   SMOKE_MODE=real-orchestrator node ./tests/smokeTestInitThenResetWithoutPriorPrompt.mjs
//
// Useful real-runtime tuning env vars:
//   REAL_READY_TIMEOUT_MS=300000
//   REAL_PROMPT_DEADLINE_MS=300000
//   REAL_LIFECYCLE_DEADLINE_MS=300000
//   REAL_SMOKE_CHILD_DEADLINE_MS=900000

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

function shouldRunRealRuntime() {
    if (String(process.env.SKIP_REAL_RUNTIME ?? "").trim() === "1") return false;

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

async function readPromptResult(req, { logChunks = false, deadlineMs = 30000, label = "prompt result" } = {}) {
    return withDeadline(
        (async () => {
            await consumeStream(req, { logChunks });
            return req.done;
        })(),
        deadlineMs,
        label
    );
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

function firstEventIndex(events, eventName) {
    return events.findIndex((event) => event.event === eventName);
}

async function copyRuntimeFixture() {
    const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "runtime-init-reset-edge-"));

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
    constructor(modelId, options = {}) {
        this.id = ++nextContextId;
        this.modelId = modelId;
        this.options = options;
        this.disposed = false;
        log("context-created", { contextId: this.id, modelId, options });
    }

    getSequence() {
        return { contextId: this.id, modelId: this.modelId };
    }

    async dispose() {
        log("context-dispose-start", { contextId: this.id, modelId: this.modelId, disposed: this.disposed });
        await sleep(Number(process.env.MOCK_CONTEXT_DISPOSE_DELAY_MS ?? 5));
        this.disposed = true;
        log("context-dispose-end", { contextId: this.id, modelId: this.modelId });
    }
}

class FakeModel {
    constructor(options = {}) {
        this.id = ++nextModelId;
        this.options = options;
        this.disposed = false;
        log("model-created", { modelId: this.id, options });
    }

    async createContext(options = {}) {
        log("create-context", { modelId: this.id, options });
        return new FakeContext(this.id, options);
    }

    detokenize(tokens) {
        return Array.isArray(tokens) ? tokens.join("") : String(tokens);
    }

    async dispose() {
        log("model-dispose-start", { modelId: this.id, disposed: this.disposed });
        await sleep(Number(process.env.MOCK_MODEL_DISPOSE_DELAY_MS ?? 5));
        this.disposed = true;
        log("model-dispose-end", { modelId: this.id });
    }
}

export class LlamaChatSession {
    constructor({ contextSequence }) {
        this.id = ++nextSessionId;
        this.contextSequence = contextSequence;
        this.disposed = false;
        log("session-created", {
            sessionId: this.id,
            contextId: contextSequence?.contextId ?? null,
            modelId: contextSequence?.modelId ?? null
        });
    }

    dispose(options = {}) {
        log("session-dispose", {
            sessionId: this.id,
            contextId: this.contextSequence?.contextId ?? null,
            modelId: this.contextSequence?.modelId ?? null,
            disposeSequence: options.disposeSequence === true,
            disposed: this.disposed
        });
        this.disposed = true;
    }

    async prompt(text, options = {}) {
        log("prompt-start", {
            sessionId: this.id,
            contextId: this.contextSequence?.contextId ?? null,
            modelId: this.contextSequence?.modelId ?? null,
            text
        });

        await sleep(Number(process.env.MOCK_PROMPT_DELAY_MS ?? 5));

        if (options.signal?.aborted) {
            log("prompt-abort-observed", { sessionId: this.id });
            throw options.signal.reason ?? new Error("mock prompt aborted");
        }

        options.onToken?.(["O"]);
        options.onToken?.(["K"]);

        log("prompt-done", {
            sessionId: this.id,
            contextId: this.contextSequence?.contextId ?? null,
            modelId: this.contextSequence?.modelId ?? null,
            text
        });

        return "OK";
    }
}

export async function getLlama() {
    log("get-llama");

    return {
        async loadModel(options = {}) {
            log("load-model", { options });
            return new FakeModel(options);
        }
    };
}
`
    );

    return tmpRoot;
}

async function importFixtureRuntime(tmpRoot, eventLogPath, label) {
    process.env.MOCK_EVENT_LOG = eventLogPath;
    const url = pathToFileURL(path.join(tmpRoot, "inference.mjs"));
    return import(`${url.href}?${encodeURIComponent(label)}=${Date.now()}`);
}

async function withMockRuntime(label, fn) {
    const tmpRoot = await copyRuntimeFixture();
    const eventLogPath = path.join(tmpRoot, "events.jsonl");
    const priorEventLog = process.env.MOCK_EVENT_LOG;

    try {
        const runtime = await importFixtureRuntime(tmpRoot, eventLogPath, label);
        await fn(runtime, eventLogPath);
    } finally {
        if (priorEventLog === undefined) {
            delete process.env.MOCK_EVENT_LOG;
        } else {
            process.env.MOCK_EVENT_LOG = priorEventLog;
        }

        await rm(tmpRoot, { recursive: true, force: true });
    }
}

function assertTextResult(result, label) {
    assert.equal(typeof result, "string", `${label} should return a string`);
    assert.notEqual(result.length, 0, `${label} should not be empty`);
}

function assertNoContextBeforeFirstModelDispose(events) {
    const firstDisposeStart = firstEventIndex(events, "model-dispose-start");
    const firstCreateContext = firstEventIndex(events, "create-context");

    assert.notEqual(firstDisposeStart, -1, "model should be disposed during resetModel()");
    assert.notEqual(firstCreateContext, -1, "prompt after reset should create a context");
    assert(
        firstDisposeStart < firstCreateContext,
        "init -> resetModel() should dispose the first model before any context is created"
    );
}

function assertPromptStartsAfterFirstModelDispose(events) {
    const firstDisposeEnd = firstEventIndex(events, "model-dispose-end");
    const firstPromptStart = firstEventIndex(events, "prompt-start");

    assert.notEqual(firstDisposeEnd, -1, "model should finish disposal during resetModel()");
    assert.notEqual(firstPromptStart, -1, "prompt-start event should exist");
    assert(
        firstDisposeEnd < firstPromptStart,
        "prompt after init/reset should start only after resetModel() disposal completes"
    );
}

async function modeMockInitResetPrompt() {
    logSection("mock initModel -> resetModel -> prompt without prior prompt");

    await withMockRuntime("mock-init-reset-prompt", async (runtime, eventLogPath) => {
        const { initModel, prompt, resetModel, shutdownRuntime } = runtime;

        await initModel({ attempts: 1, readyTimeoutMs: 5000, retryDelayMs: 0 });
        await resetModel();

        const req = await prompt("mock init reset prompt");
        const result = await readPromptResult(req, {
            deadlineMs: 5000,
            label: "mock init/reset prompt result"
        });

        assertTextResult(result, "mock init/reset prompt");
        assert.equal(result, "OK", "fake runtime should return deterministic OK text");

        await shutdownRuntime({ mode: "abort" });

        const events = await readEvents(eventLogPath);
        assert.equal(events.filter((event) => event.event === "load-model").length, 2, "model should load before and after resetModel()");
        assertNoContextBeforeFirstModelDispose(events);
        assertPromptStartsAfterFirstModelDispose(events);

        console.log("[OK] mock init/reset prompt result:", result);
    });
}

async function modeMockControlInitPromptResetPrompt() {
    logSection("mock control initModel -> prompt -> resetModel -> prompt");

    await withMockRuntime("mock-control-init-prompt-reset-prompt", async (runtime, eventLogPath) => {
        const { initModel, prompt, resetModel, shutdownRuntime } = runtime;

        await initModel({ attempts: 1, readyTimeoutMs: 5000, retryDelayMs: 0 });

        const before = await prompt("mock before reset");
        const beforeResult = await readPromptResult(before, {
            deadlineMs: 5000,
            label: "mock control before-reset prompt result"
        });
        assert.equal(beforeResult, "OK", "fake runtime should return OK before reset");

        await resetModel();

        const after = await prompt("mock after reset");
        const afterResult = await readPromptResult(after, {
            deadlineMs: 5000,
            label: "mock control after-reset prompt result"
        });
        assert.equal(afterResult, "OK", "fake runtime should return OK after reset");

        await shutdownRuntime({ mode: "abort" });

        const events = await readEvents(eventLogPath);
        assert.equal(events.filter((event) => event.event === "load-model").length, 2, "control path should load before and after resetModel()");
        assert.equal(events.filter((event) => event.event === "prompt-start").length, 2, "control path should complete two prompts");

        console.log("[OK] mock control results:", [beforeResult, afterResult]);
    });
}

async function modeMockInitResetPromptAfterConfigOverride() {
    logSection("mock init/reset prompt after configOverride init");

    await withMockRuntime("mock-init-reset-prompt-after-config-override", async (runtime, eventLogPath) => {
        const { initModel, prompt, resetModel, shutdownRuntime } = runtime;

        await initModel({
            attempts: 1,
            readyTimeoutMs: 5000,
            retryDelayMs: 0,
            configOverride: {
                modelLoad: {
                    gpuLayers: 0,
                    useMlock: false
                },
                context: {
                    contextSize: "auto",
                    batchSize: 128
                }
            }
        });

        await resetModel();

        const req = await prompt("mock init reset prompt after config override");
        const result = await readPromptResult(req, {
            deadlineMs: 5000,
            label: "mock config override init/reset prompt result"
        });

        assert.equal(result, "OK", "fake runtime should return OK after configOverride reset");

        await shutdownRuntime({ mode: "abort" });

        const events = await readEvents(eventLogPath);
        const contextCreated = events.find((event) => event.event === "context-created");

        assert(contextCreated, "prompt after reset should create a context");
        assert.equal(
            contextCreated.options.batchSize,
            128,
            "resetModel() re-init should preserve last successful configOverride context batchSize"
        );
        assertPromptStartsAfterFirstModelDispose(events);

        console.log("[OK] mock configOverride init/reset prompt result:", result);
    });
}

async function runRealInitResetPrompt({ configOverride = null } = {}) {
    const { initModel, prompt, resetModel, shutdownRuntime } = await import("../inference.mjs");

    const initOptions = {
        attempts: 2,
        readyTimeoutMs: getRealReadyTimeoutMs(),
        retryDelayMs: 100
    };

    if (configOverride) {
        initOptions.configOverride = configOverride;
    }

    await withDeadline(initModel(initOptions), getRealReadyTimeoutMs(), "real initModel");
    console.log("[OK] real initModel resolved");

    await withDeadline(resetModel(), getRealLifecycleDeadlineMs(), "real resetModel without prior prompt");
    console.log("[OK] real resetModel resolved without prior prompt");

    const req = await prompt("Say hello after init reset without prior prompt.");
    const result = await readPromptResult(req, {
        deadlineMs: getRealPromptDeadlineMs(),
        label: "real init/reset prompt result"
    });

    assertTextResult(result, "real init/reset prompt");
    console.log("[OK] real post-init-reset prompt result:", result.slice(0, 160));

    await withDeadline(shutdownRuntime({ mode: "abort" }), getRealLifecycleDeadlineMs(), "real shutdown");
    console.log("[OK] real shutdown resolved");
}

async function modeRealInitResetPrompt() {
    logSection("real initModel -> resetModel -> prompt without prior prompt");
    await runRealInitResetPrompt();
}

async function modeRealInitPromptResetPromptControl() {
    logSection("real control initModel -> prompt -> resetModel -> prompt");

    const { initModel, prompt, resetModel, shutdownRuntime } = await import("../inference.mjs");

    await withDeadline(
        initModel({
            attempts: 2,
            readyTimeoutMs: getRealReadyTimeoutMs(),
            retryDelayMs: 100
        }),
        getRealReadyTimeoutMs(),
        "real control initModel"
    );
    console.log("[OK] real control initModel resolved");

    const before = await prompt("Say hello before reset.");
    const beforeResult = await readPromptResult(before, {
        deadlineMs: getRealPromptDeadlineMs(),
        label: "real control before-reset prompt result"
    });
    assertTextResult(beforeResult, "real control before-reset prompt");
    console.log("[OK] real control before-reset prompt result:", beforeResult.slice(0, 160));

    await withDeadline(resetModel(), getRealLifecycleDeadlineMs(), "real control resetModel");
    console.log("[OK] real control resetModel resolved");

    const after = await prompt("Say hello after reset.");
    const afterResult = await readPromptResult(after, {
        deadlineMs: getRealPromptDeadlineMs(),
        label: "real control after-reset prompt result"
    });
    assertTextResult(afterResult, "real control after-reset prompt");
    console.log("[OK] real control after-reset prompt result:", afterResult.slice(0, 160));

    await withDeadline(shutdownRuntime({ mode: "abort" }), getRealLifecycleDeadlineMs(), "real control shutdown");
    console.log("[OK] real control shutdown resolved");
}

async function modeRealInitResetPromptAfterConfigOverride() {
    logSection("real init/reset prompt after configOverride init");

    await runRealInitResetPrompt({
        configOverride: {
            modelLoad: {
                gpuLayers: 0,
                useMlock: false
            },
            context: {
                contextSize: "auto",
                batchSize: 256
            }
        }
    });
}

async function orchestrator() {
    const mockModes = [
        "mock-init-reset-prompt",
        "mock-control-init-prompt-reset-prompt",
        "mock-init-reset-prompt-after-config-override"
    ];

    for (const mode of mockModes) {
        logSection(`child mode: ${mode}`);
        await runChild(mode);
    }

    if (shouldRunRealRuntime()) {
        logSection("child mode: real-orchestrator");
        await runChild("real-orchestrator");
    } else {
        console.log("\n[SMOKE] real runtime modes skipped. Set REAL_RUNTIME=1 or SMOKE_MODE=real-orchestrator to run them.");
    }

    console.log("\nAll init-then-reset-without-prior-prompt mock smoke tests finished.");
}

async function realOrchestrator() {
    if (String(process.env.SKIP_REAL_RUNTIME ?? "").trim() === "1") {
        console.log("[SMOKE] real runtime modes skipped by SKIP_REAL_RUNTIME=1");
        return;
    }

    const realModes = [
        "real-init-reset-prompt",
        "real-init-prompt-reset-prompt-control"
    ];

    if (String(process.env.REAL_CONFIG_OVERRIDE_SMOKE ?? "").trim() === "1") {
        realModes.push("real-init-reset-prompt-after-config-override");
    }

    for (const mode of realModes) {
        logSection(`child mode: ${mode}`);
        await runChild(mode);
    }

    console.log("\nAll real init-then-reset-without-prior-prompt smoke tests finished.");
}

async function main() {
    console.log("[SMOKE] mode:", MODE);

    switch (MODE) {
        case "orchestrator":
            await orchestrator();
            break;
        case "real-orchestrator":
            await realOrchestrator();
            break;
        case "mock-init-reset-prompt":
            await modeMockInitResetPrompt();
            break;
        case "mock-control-init-prompt-reset-prompt":
            await modeMockControlInitPromptResetPrompt();
            break;
        case "mock-init-reset-prompt-after-config-override":
            await modeMockInitResetPromptAfterConfigOverride();
            break;
        case "real-init-reset-prompt":
            await modeRealInitResetPrompt();
            break;
        case "real-init-prompt-reset-prompt-control":
            await modeRealInitPromptResetPromptControl();
            break;
        case "real-init-reset-prompt-after-config-override":
            await modeRealInitResetPromptAfterConfigOverride();
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
