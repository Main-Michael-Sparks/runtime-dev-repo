// smokeTestContextCreationRetry.mjs
//
// Purpose:
// - Local smoke/regression test for Context Creation Retry v1.
// - Covers pure retry-profile planning, real runtime fallback behavior, and
//   runtime context retry using a controlled mock `node-llama-cpp` package.
//
// Recommended location:
//   tests/smokeTestContextCreationRetry.mjs
//
// Run all modes:
//   node ./tests/smokeTestContextCreationRetry.mjs
//
// Run one mode:
//   SMOKE_MODE=pure-context-profiles node ./tests/smokeTestContextCreationRetry.mjs
//   SMOKE_MODE=real-context-retry-fallback node ./tests/smokeTestContextCreationRetry.mjs
//
// Skip real model/runtime mode:
//   SKIP_REAL_RUNTIME=1 node ./tests/smokeTestContextCreationRetry.mjs
//
// Notes:
// - Real runtime mode uses your actual model/runtime and attempts to trigger
//   context retry with an oversized fixed context while keeping memory safety
//   checks enabled.
// - Mock runtime modes do not use your real model or real node-llama-cpp.
// - The test builds a temporary runtime fixture and injects a fake node-llama-cpp
//   package so createContext() failures can be forced deterministically.
// - Child processes isolate module/runtime state per scenario.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile, mkdir, cp } from "node:fs/promises";
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
    "runtime.mjs",
    "nativeOperationPolicy.mjs",
    "nativeBoundaryCoordinator.mjs",
    "runtimeRequestSettlement.mjs",
    "runtimeLifecycleState.mjs",
    "runtimeSessionResetCoordinator.mjs",
    "runtimeShutdownCoordinator.mjs",
    "runtimeInitCoordinator.mjs",
    "runtimeModelResetCoordinator.mjs",
    "workerProtocolRouter.mjs",
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

function assertIncludes(text, expected, message) {
    assert(
        String(text).includes(expected),
        `${message}; expected ${JSON.stringify(text)} to include ${JSON.stringify(expected)}`
    );
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

async function modePureContextProfiles() {
    logSection("pure context retry profile planning");

    const {
        normalizeContextCreationRetryOptions,
        deriveBoundedContextSize,
        buildContextRetryProfiles
    } = await import("../contextRetryProfiles.mjs");

    const normalized = normalizeContextCreationRetryOptions({});
    assert.equal(normalized.enabled, true, "creationRetry defaults enabled");
    assert.equal(normalized.maxAttempts, 4, "creationRetry defaults maxAttempts 4");

    await expectReject(
        "unknown creationRetry key",
        () => normalizeContextCreationRetryOptions({ creationRetry: { typo: true } }),
        "Unsupported context.creationRetry option"
    );

    await expectReject(
        "unknown fallbackContextSize key",
        () => normalizeContextCreationRetryOptions({
            creationRetry: {
                fallbackContextSize: {
                    min: 1024,
                    max: 4096,
                    typo: true
                }
            }
        }),
        "Unsupported context.creationRetry.fallbackContextSize option"
    );

    await expectReject(
        "unknown fallbackThreads key",
        () => normalizeContextCreationRetryOptions({
            creationRetry: {
                fallbackThreads: {
                    ideal: 0,
                    min: 1,
                    typo: true
                }
            }
        }),
        "Unsupported context.creationRetry.fallbackThreads option"
    );

    const disabledProfiles = buildContextRetryProfiles({
        baseContextConfig: {
            contextSize: 4096,
            batchSize: 512,
            creationRetry: {
                enabled: false
            }
        }
    });

    assert.deepEqual(
        disabledProfiles.map((profile) => profile.name),
        ["base-context"],
        "disabled retry emits only base profile"
    );

    const highBatchProfiles = buildContextRetryProfiles({
        baseContextConfig: {
            contextSize: 8192,
            batchSize: 512,
            flashAttention: true,
            threads: {
                ideal: 8,
                min: 1
            },
            creationRetry: {
                fallbackBatchSize: 256,
                maxAttempts: 4
            }
        }
    });

    assert.deepEqual(
        highBatchProfiles.map((profile) => profile.name),
        ["base-context", "batch-safe-context", "bounded-context-safe", "conservative-context"],
        "full default ladder appears when each profile changes createContext options"
    );
    assert.equal(highBatchProfiles[1].context.batchSize, 256, "batch fallback lowers batch size");
    assert.equal(highBatchProfiles[3].context.flashAttention, false, "conservative profile disables flash attention");

    const lowBatchProfiles = buildContextRetryProfiles({
        baseContextConfig: {
            contextSize: 8192,
            batchSize: 128,
            flashAttention: true,
            threads: {
                ideal: 8,
                min: 1
            },
            creationRetry: {
                fallbackBatchSize: 256,
                maxAttempts: 4
            }
        }
    });

    assert.deepEqual(
        lowBatchProfiles.map((profile) => profile.name),
        ["base-context", "bounded-context-safe", "conservative-context"],
        "duplicate batch-safe profile is omitted when fallback would not lower batch size"
    );

    assert.equal(
        highBatchProfiles.some((profile) => Object.hasOwn(profile.context, "creationRetry")),
        false,
        "creationRetry is stripped from profile contexts"
    );

    const hardwareBound = deriveBoundedContextSize({
        baseContextSize: "auto",
        creationRetry: {
            allowHardwareDerivedBounds: true,
            minContextSize: 1024,
            maxContextSize: 4096,
            fallbackContextSize: {
                min: 1024,
                max: 2048
            }
        },
        hardwareProbe: {
            memory: {
                safeBudgetBytes: 12 * 1024 ** 3
            }
        }
    });

    assert.deepEqual(
        hardwareBound,
        { min: 1024, max: 4096 },
        "hardware-derived bound can win but is clamped by configured max"
    );

    const shrunkenBound = deriveBoundedContextSize({
        baseContextSize: {
            min: 4096,
            max: 8192
        },
        creationRetry: {
            allowHardwareDerivedBounds: false,
            fallbackContextSize: null,
            minContextSize: 1024,
            maxContextSize: 4096,
            contextSizeShrinkRatio: 0.5
        }
    });

    assert.deepEqual(
        shrunkenBound,
        { min: 2048, max: 4096 },
        "bounded context fallback shrinks min and max"
    );

    const fixedBaseCap = deriveBoundedContextSize({
        baseContextSize: 2048,
        creationRetry: {
            allowHardwareDerivedBounds: false,
            fallbackContextSize: {
                min: 1024,
                max: 4096
            },
            minContextSize: 1024,
            maxContextSize: 4096
        }
    });

    assert.deepEqual(
        fixedBaseCap,
        { min: 1024, max: 2048 },
        "fixed base contextSize caps fallback max so retry does not exceed failed base attempt"
    );

    const tinyFixedBaseCap = deriveBoundedContextSize({
        baseContextSize: 512,
        creationRetry: {
            allowHardwareDerivedBounds: false,
            fallbackContextSize: {
                min: 1024,
                max: 4096
            },
            minContextSize: 1024,
            maxContextSize: 4096
        }
    });

    assert.deepEqual(
        tinyFixedBaseCap,
        { min: 512, max: 512 },
        "tiny fixed base contextSize wins over configured minContextSize to avoid increasing memory pressure"
    );

    const boundedBaseCap = deriveBoundedContextSize({
        baseContextSize: {
            min: 512,
            max: 1024
        },
        creationRetry: {
            allowHardwareDerivedBounds: false,
            fallbackContextSize: {
                min: 1024,
                max: 4096
            },
            minContextSize: 1024,
            maxContextSize: 4096
        }
    });

    assert.deepEqual(
        boundedBaseCap,
        { min: 512, max: 1024 },
        "bounded base contextSize caps fallback min and max to avoid raising memory pressure"
    );

    const autoConfiguredFallback = deriveBoundedContextSize({
        baseContextSize: "auto",
        creationRetry: {
            allowHardwareDerivedBounds: false,
            fallbackContextSize: {
                min: 1024,
                max: 4096
            },
            minContextSize: 1024,
            maxContextSize: 4096
        }
    });

    assert.deepEqual(
        autoConfiguredFallback,
        { min: 1024, max: 4096 },
        "base contextSize auto still allows normal configured bounded fallback"
    );

    const hardwareFixedBaseCap = deriveBoundedContextSize({
        baseContextSize: 2048,
        creationRetry: {
            allowHardwareDerivedBounds: true,
            fallbackContextSize: {
                min: 1024,
                max: 4096
            },
            minContextSize: 1024,
            maxContextSize: 4096
        },
        hardwareProbe: {
            memory: {
                safeBudgetBytes: 12 * 1024 ** 3
            }
        }
    });

    assert.deepEqual(
        hardwareFixedBaseCap,
        { min: 1024, max: 2048 },
        "hardware-derived fallback is capped by fixed base contextSize"
    );

    console.log("[OK] pure context retry profile checks passed");
}

async function modeRealRuntimeContextRetryFallback() {
    logSection("real runtime context retry fallback");

    const oversizedContextSize = Number.parseInt(
        process.env.REAL_CONTEXT_RETRY_BASE_CONTEXT_SIZE || "1048576",
        10
    );

    assert(
        Number.isInteger(oversizedContextSize) && oversizedContextSize > 0,
        "REAL_CONTEXT_RETRY_BASE_CONTEXT_SIZE must be a positive integer"
    );

    const {
        initModel,
        prompt,
        shutdownRuntime
    } = await import("../runtime.mjs");

    try {
        await initModel({
            attempts: 1,
            readyTimeoutMs: 120000,
            configOverride: {
                context: {
                    contextSize: oversizedContextSize,
                    batchSize: 512,
                    ignoreMemorySafetyChecks: false
                }
            }
        });

        const req = await prompt("Say context retry real runtime ok briefly.", {
            stream: false,
            sessionId: `real-context-retry-${Date.now()}`
        });

        const result = await req.done;

        assert.equal(typeof result, "string", "real runtime prompt returns string result");

        if (result.length === 0) {
            console.warn(
                "[WARN] real runtime prompt returned an empty string after context retry fallback"
            );
        } else {
            console.log("[OK] real runtime prompt result:", result.slice(0, 160));
        }

        console.log("[OK] real runtime prompt completed after oversized base context config");
    } finally {
        await shutdownRuntime({ mode: "abort" }).catch((err) => {
            console.warn("[WARN] real runtime shutdown failed:", err.message);
        });
    }
}

async function createMockRuntimeFixture() {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "ctx-retry-smoke-"));

    for (const rel of RUNTIME_FILES) {
        const src = path.join(REPO_ROOT, rel);
        const dest = path.join(tempDir, rel);
        await mkdir(path.dirname(dest), { recursive: true });
        await cp(src, dest);
    }

    await writeFile(
        path.join(tempDir, "hardwareProbe.mjs"),
        `export async function probeHardware() {
    return {
        platform: "mock",
        arch: "mock",
        cpu: {
            logicalThreads: 8,
            recommendedThreads: 7
        },
        memory: {
            totalBytes: 16 * 1024 ** 3,
            freeBytes: 12 * 1024 ** 3,
            safeBudgetBytes: 12 * 1024 ** 3
        },
        gpu: {
            available: false,
            vendor: null,
            vramBytes: null,
            source: "mock",
            confidence: "none"
        },
        warnings: []
    };
}
`,
        "utf8"
    );

    const mockPackageDir = path.join(tempDir, "node_modules", "node-llama-cpp");
    await mkdir(mockPackageDir, { recursive: true });

    await writeFile(
        path.join(mockPackageDir, "package.json"),
        JSON.stringify({
            name: "node-llama-cpp",
            type: "module",
            exports: "./index.js"
        }, null, 2),
        "utf8"
    );

    await writeFile(
        path.join(mockPackageDir, "index.js"),
        `import { appendFileSync } from "node:fs";\n\nlet contextAttempts = 0;\n\nfunction log(event) {\n    const file = process.env.MOCK_CONTEXT_LOG;\n    if (!file) return;\n    appendFileSync(file, JSON.stringify(event) + "\\n");\n}\n\nexport async function getLlama() {\n    log({ type: "getLlama" });\n\n    return {\n        async loadModel(options) {\n            log({ type: "loadModel", options });\n\n            return {\n                disposed: false,\n                async createContext(options) {\n                    contextAttempts += 1;\n                    log({\n                        type: "createContext",\n                        attempt: contextAttempts,\n                        options\n                    });\n\n                    const failCount = Number.parseInt(process.env.MOCK_CONTEXT_FAILS || "0", 10);\n                    if (contextAttempts <= failCount) {\n                        throw new Error(\`mock createContext failure #\${contextAttempts}\`);\n                    }\n\n                    const badSequenceAt = Number.parseInt(process.env.MOCK_BAD_SEQUENCE_AT || "0", 10);\n                    const context = {\n                        disposed: false,\n                        async dispose() {\n                            this.disposed = true;\n                            log({ type: "context.dispose", attempt: contextAttempts });\n\n                            if (process.env.MOCK_CONTEXT_DISPOSE_FAIL === "1") {\n                                throw new Error("mock context dispose failure");\n                            }\n                        }\n                    };\n\n                    if (contextAttempts !== badSequenceAt) {\n                        context.getSequence = function getSequence() {\n                            return { id: contextAttempts };\n                        };\n                    }\n\n                    return context;\n                },\n                detokenize(tokens) {\n                    return Array.isArray(tokens) ? tokens.join("") : String(tokens);\n                },\n                async dispose() {\n                    this.disposed = true;\n                    log({ type: "model.dispose" });\n                }\n            };\n        }\n    };\n}\n\nexport class LlamaChatSession {\n    constructor({ contextSequence }) {\n        this.contextSequence = contextSequence;\n        this.disposed = false;\n        log({ type: "session.create", sequence: contextSequence });\n    }\n\n    async prompt(text, options = {}) {\n        const output = \`mock-response: \${text}\`;\n\n        if (typeof options.onToken === "function") {\n            for (const token of ["mock", "-", "response"]) {\n                options.onToken(token);\n            }\n        }\n\n        return output;\n    }\n\n    dispose() {\n        this.disposed = true;\n        log({ type: "session.dispose" });\n    }\n}\n`,
        "utf8"
    );

    return tempDir;
}

async function readJsonLines(file) {
    const raw = await readFile(file, "utf8").catch((err) => {
        if (err.code === "ENOENT") return "";
        throw err;
    });

    return raw
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => JSON.parse(line));
}

async function modeMockContextRetrySuccess() {
    logSection("mock runtime context retry succeeds after fallback");

    const fixtureDir = await createMockRuntimeFixture();
    const logFile = path.join(fixtureDir, "mock-context.log");

    process.env.MOCK_CONTEXT_FAILS = "2";
    process.env.MOCK_CONTEXT_LOG = logFile;

    try {
        const { prompt, shutdownRuntime } = await import(
            `${pathToFileURL(path.join(fixtureDir, "runtime.mjs")).href}?mode=retry-success-${Date.now()}`
        );

        const req = await prompt("context retry success", { stream: false });
        const result = await req.done;

        assertIncludes(result, "context retry success", "mock prompt result includes prompt text");

        await shutdownRuntime({ mode: "abort" });

        const events = await readJsonLines(logFile);
        const attempts = events.filter((event) => event.type === "createContext");

        assert.equal(attempts.length, 3, "createContext retried until third attempt succeeded");
        assert.equal(Object.hasOwn(attempts[0].options, "creationRetry"), false, "creationRetry not passed to createContext");
        assert.equal(Object.hasOwn(attempts[0].options, "hardwareProbe"), false, "hardwareProbe not passed to createContext");
        assert.equal(attempts[1].options.batchSize, 256, "second attempt uses batch-safe fallback");
        assert.deepEqual(attempts[2].options.contextSize, { min: 1024, max: 4096 }, "third attempt uses bounded context fallback");

        console.log("[OK] mock context retry succeeded after fallback");
    } finally {
        delete process.env.MOCK_CONTEXT_FAILS;
        delete process.env.MOCK_CONTEXT_LOG;
        await rm(fixtureDir, { recursive: true, force: true });
    }
}

async function modeMockContextRetryFailure() {
    logSection("mock runtime context retry final failure is request-scoped");

    const fixtureDir = await createMockRuntimeFixture();
    const logFile = path.join(fixtureDir, "mock-context.log");

    process.env.MOCK_CONTEXT_FAILS = "10";
    process.env.MOCK_CONTEXT_LOG = logFile;

    try {
        const { prompt, shutdownRuntime } = await import(
            `${pathToFileURL(path.join(fixtureDir, "runtime.mjs")).href}?mode=retry-failure-${Date.now()}`
        );

        const req = await prompt("context retry failure", { stream: false });

        const err = await expectReject(
            "prompt fails after context retry exhaustion",
            () => req.done,
            "Context creation failed after"
        );

        assertIncludes(err.message, "base-context", "error includes base profile");
        assertIncludes(err.message, "bounded-context-safe", "error includes bounded fallback profile");

        await shutdownRuntime({ mode: "abort" });

        const events = await readJsonLines(logFile);
        const attempts = events.filter((event) => event.type === "createContext");

        assert.equal(attempts.length, 3, "three distinct default context profiles attempted after duplicate removal");

        console.log("[OK] mock context retry failure surfaced as prompt request error");
    } finally {
        delete process.env.MOCK_CONTEXT_FAILS;
        delete process.env.MOCK_CONTEXT_LOG;
        await rm(fixtureDir, { recursive: true, force: true });
    }
}

async function modeMockCleanupFailureAbort() {
    logSection("mock runtime cleanup failure aborts context retry");

    const fixtureDir = await createMockRuntimeFixture();
    const logFile = path.join(fixtureDir, "mock-context.log");

    process.env.MOCK_CONTEXT_FAILS = "0";
    process.env.MOCK_BAD_SEQUENCE_AT = "1";
    process.env.MOCK_CONTEXT_DISPOSE_FAIL = "1";
    process.env.MOCK_CONTEXT_LOG = logFile;

    try {
        const { prompt, shutdownRuntime } = await import(
            `${pathToFileURL(path.join(fixtureDir, "runtime.mjs")).href}?mode=cleanup-failure-${Date.now()}`
        );

        const req = await prompt("context cleanup failure", { stream: false });

        await expectReject(
            "cleanup failure aborts context retry",
            () => req.done,
            "mock context dispose failure"
        );

        await shutdownRuntime({ mode: "abort" });

        const events = await readJsonLines(logFile);
        const attempts = events.filter((event) => event.type === "createContext");
        const disposals = events.filter((event) => event.type === "context.dispose");

        assert.equal(attempts.length, 1, "cleanup failure aborts retry after first partial context");
        assert.equal(disposals.length, 1, "partial context disposal was attempted");

        console.log("[OK] mock cleanup failure aborted context retry");
    } finally {
        delete process.env.MOCK_CONTEXT_FAILS;
        delete process.env.MOCK_BAD_SEQUENCE_AT;
        delete process.env.MOCK_CONTEXT_DISPOSE_FAIL;
        delete process.env.MOCK_CONTEXT_LOG;
        await rm(fixtureDir, { recursive: true, force: true });
    }
}

async function orchestrator() {
    const modes = ["pure-context-profiles"];

    if (process.env.SKIP_REAL_RUNTIME !== "1") {
        modes.push("real-context-retry-fallback");
    }

    modes.push(
        "mock-context-retry-success",
        "mock-context-retry-failure",
        "mock-cleanup-failure-abort"
    );

    for (const mode of modes) {
        logSection(`child mode: ${mode}`);
        await runChild(mode);
    }

    console.log("\nAll context creation retry smoke tests finished.");
}

async function main() {
    console.log("[SMOKE] mode:", MODE);

    switch (MODE) {
        case "orchestrator":
            await orchestrator();
            break;
        case "pure-context-profiles":
            await modePureContextProfiles();
            break;
        case "real-context-retry-fallback":
            await modeRealRuntimeContextRetryFallback();
            break;
        case "mock-context-retry-success":
            await modeMockContextRetrySuccess();
            break;
        case "mock-context-retry-failure":
            await modeMockContextRetryFailure();
            break;
        case "mock-cleanup-failure-abort":
            await modeMockCleanupFailureAbort();
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
