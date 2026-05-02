// smokeTestHardwareAwareInitRetry.mjs
//
// Purpose:
// - Local smoke/regression test for Hardware-Aware / Degraded Init Retry v1.
// - Run after applying the staged runtime files to your local branch.
//
// Recommended location:
//   tests/smokeTestHardwareAwareInitRetry.mjs
//
// Run all modes:
//   node ./tests/smokeTestHardwareAwareInitRetry.mjs
//
// Run pure/non-runtime checks only:
//   SKIP_RUNTIME=1 node ./tests/smokeTestHardwareAwareInitRetry.mjs
//
// Run one mode:
//   SMOKE_MODE=pure-config-override node ./tests/smokeTestHardwareAwareInitRetry.mjs
//
// Notes:
// - Runtime modes intentionally spawn isolated child processes so each mode gets
//   a fresh module/runtime state.
// - The pure modes do not import inference.mjs and should not start the worker.
// - Runtime modes require your local model/node-llama-cpp environment to be valid.
// - Shutdown remains last within any child mode that uses it.

import { spawn } from "child_process";
import process from "process";
import { fileURLToPath } from "url";

const MODE = process.env.SMOKE_MODE || "orchestrator";
const SELF_PATH = fileURLToPath(import.meta.url);
const SKIP_RUNTIME = process.env.SKIP_RUNTIME === "1";

function logSection(title) {
    console.log(`\n=== ${title} ===`);
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function assert(condition, message) {
    if (!condition) {
        throw new Error(`[FAIL] ${message}`);
    }
}

function assertEqual(actual, expected, message) {
    if (actual !== expected) {
        throw new Error(`[FAIL] ${message}; expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
}

function assertIncludes(text, expected, message) {
    if (!String(text).includes(expected)) {
        throw new Error(`[FAIL] ${message}; expected ${JSON.stringify(text)} to include ${JSON.stringify(expected)}`);
    }
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

async function modePureConfigOverride() {
    logSection("pure configOverride validation and patching");

    const { config } = await import("../config.mjs");
    const {
        applyConfigOverride,
        validateConfigOverride
    } = await import("../configOverride.mjs");

    const effective = applyConfigOverride(config, {
        modelLoad: {
            gpuLayers: 0,
            useMlock: false
        },
        context: {
            contextSize: "auto",
            batchSize: 256,
            failedCreationRemedy: {
                retries: 3
            }
        }
    });

    assertEqual(effective.context.batchSize, 256, "configOverride applied context.batchSize");
    assertEqual(effective.context.failedCreationRemedy.retries, 3, "deep partial patch applied");
    assert(config.context.batchSize !== 256 || Object.isFrozen(effective), "effective config is separate from base config");
    assert(Object.isFrozen(effective), "effective config is frozen");
    assert(Object.isFrozen(effective.context), "nested effective config is frozen");

    await expectReject(
        "disallowed modelLoad.baseModel override",
        () => validateConfigOverride({ modelLoad: { baseModel: "other.gguf" } }),
        "Unsupported configOverride path"
    );

    await expectReject(
        "disallowed runtime override",
        () => validateConfigOverride({ runtime: { maxInFlight: 1 } }),
        "Unsupported configOverride path"
    );

    await expectReject(
        "invalid batchSize value",
        () => validateConfigOverride({ context: { batchSize: -1 } }),
        "Expected integer"
    );

    await expectReject(
        "invalid threads value",
        () => validateConfigOverride({ context: { threads: "banana" } }),
        "Expected integer"
    );

    const protoJson = JSON.parse('{"__proto__":{"polluted":true}}');
    await expectReject(
        "prototype pollution key rejected",
        () => validateConfigOverride(protoJson),
        "Unsafe configOverride key"
    );

    console.log("[OK] pure configOverride checks passed");
}

async function modePureProfiles() {
    logSection("pure retry profile planning");

    const { config } = await import("../config.mjs");
    const {
        buildInitProfiles,
        buildInitAttemptPlan
    } = await import("../retryProfiles.mjs");

    const baseProfiles = buildInitProfiles({
        baseConfig: config,
        options: {
            strategy: "degraded-config-cold-worker",
            hardwareAware: {
                maxProfiles: 3
            }
        }
    });

    assertEqual(
        baseProfiles.map((profile) => profile.name).join(","),
        "base,hardware-safe,memory-safe",
        "degraded profile order without override"
    );

    const overrideProfiles = buildInitProfiles({
        baseConfig: config,
        configOverride: {
            context: {
                batchSize: 256
            }
        },
        options: {
            strategy: "hardware-aware-cold-worker",
            hardwareAware: {
                maxProfiles: 3,
                allowCpuModelLoadFallback: true,
                allowBatchReduction: true,
                allowContextAutoFallback: true
            }
        }
    });

    assertEqual(
        overrideProfiles.map((profile) => profile.name).join(","),
        "user-override,hardware-safe-from-override,memory-safe-from-override",
        "hardware-aware profile order with override"
    );

    const noCpuFallbackProfiles = buildInitProfiles({
        baseConfig: config,
        options: {
            strategy: "degraded-config-cold-worker",
            hardwareAware: {
                allowCpuModelLoadFallback: false,
                allowBatchReduction: true,
                allowContextAutoFallback: false
            }
        }
    });

    const memoryProfile = noCpuFallbackProfiles.find((profile) => profile.name === "memory-safe");
    assert(memoryProfile, "memory-safe profile exists when batch reduction is enabled");
    assertEqual(
        memoryProfile.effectiveConfig.modelLoad.gpuLayers,
        config.modelLoad.gpuLayers,
        "memory-safe profile does not force gpuLayers when allowCpuModelLoadFallback is false"
    );
    assertEqual(
        memoryProfile.effectiveConfig.modelLoad.useMlock,
        config.modelLoad.useMlock,
        "memory-safe profile does not force useMlock when allowCpuModelLoadFallback is false"
    );
    assertEqual(memoryProfile.effectiveConfig.context.batchSize, 256, "batch reduction applied independently");

    await expectReject(
        "old ambiguous allowGpuLayerFallback option rejected",
        () => buildInitProfiles({
            baseConfig: config,
            options: {
                strategy: "degraded-config-cold-worker",
                hardwareAware: {
                    allowGpuLayerFallback: true
                }
            }
        }),
        "Unsupported hardwareAware option"
    );

    const sameConfigProfiles = buildInitProfiles({
        baseConfig: config,
        configOverride: {
            context: {
                batchSize: 256
            }
        },
        options: {
            strategy: "same-config-cold-worker"
        }
    });

    assertEqual(sameConfigProfiles.length, 1, "configOverride alone does not generate degraded profiles");
    assertEqual(sameConfigProfiles[0].name, "user-override", "configOverride alone starts with user-override profile");

    let nextId = 0;
    const plan = buildInitAttemptPlan({
        strategy: "degraded-config-cold-worker",
        profiles: baseProfiles,
        attempts: 2,
        readyTimeoutMs: 0,
        retryDelayMs: 0,
        nextAttemptId() {
            nextId += 1;
            return nextId;
        }
    });

    assertEqual(plan.length, 2, "attempts caps degraded profile attempts");
    assertEqual(plan[0].profileName, "base", "first attempt uses base profile");
    assertEqual(plan[1].profileName, "hardware-safe", "second attempt uses hardware-safe profile");
    assertEqual(plan[0].readyTimeoutMs, 0, "readyTimeoutMs: 0 is accepted as no timeout");

    console.log("[OK] pure retry profile checks passed");
}

async function modePureHardwareProbe() {
    logSection("pure hardware probe shape");

    const { probeHardware } = await import("../hardwareProbe.mjs");
    const probe = await probeHardware({ gpu: true });

    assert(typeof probe.platform === "string", "probe.platform is string");
    assert(typeof probe.arch === "string", "probe.arch is string");
    assert(Number.isInteger(probe.cpu.logicalThreads), "cpu.logicalThreads is integer");
    assert(Number.isInteger(probe.cpu.recommendedThreads), "cpu.recommendedThreads is integer");
    assert(Number.isInteger(probe.memory.totalBytes), "memory.totalBytes is integer");
    assert(Number.isInteger(probe.memory.freeBytes), "memory.freeBytes is integer");
    assert(Array.isArray(probe.warnings), "probe.warnings is array");
    assertEqual(probe.gpu.available, false, "GPU probe is non-fatal/not implemented in v1");

    console.log("[OK] pure hardware probe checks passed");
}

async function modeRuntimeInvalidOptions() {
    logSection("runtime invalid options reject before model init");

    const { initModel, shutdownRuntime } = await import("../inference.mjs");

    await expectReject(
        "disallowed runtime configOverride",
        () => initModel({
            configOverride: {
                runtime: {
                    maxInFlight: 1
                }
            }
        }),
        "Unsupported configOverride path"
    );

    await expectReject(
        "old allowGpuLayerFallback option rejected at runtime",
        () => initModel({
            strategy: "degraded-config-cold-worker",
            hardwareAware: {
                allowGpuLayerFallback: true
            }
        }),
        "Unsupported hardwareAware option"
    );

    await shutdownRuntime({ mode: "abort" });
    console.log("[OK] shutdown after invalid-options test resolved");
}

async function modeRuntimeOverridePromptReset() {
    logSection("runtime valid configOverride, prompt, reset preservation");

    const {
        initModel,
        prompt,
        resetModel,
        shutdownRuntime
    } = await import("../inference.mjs");

    await initModel({
        enabled: true,
        attempts: 1,
        readyTimeoutMs: 120000,
        retryDelayMs: 0,
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

    console.log("[OK] explicit init with configOverride resolved");

    await initModel();
    console.log("[OK] initModel() after ready returns without changing config");

    await expectReject(
        "meaningful init options after ready",
        () => initModel({
            configOverride: {
                context: {
                    batchSize: 128
                }
            }
        }),
        "Model already initialized"
    );

    const first = await prompt("Say OK briefly.", { sessionId: "override-alpha" });
    const firstResult = await readPromptResult(first, { logChunks: false });
    assert(firstResult && typeof firstResult === "string", "first prompt produced string result");
    console.log("[OK] prompt after override init:", firstResult.slice(0, 160));

    await resetModel();
    console.log("[OK] resetModel resolved after override init");

    const second = await prompt("Say reset OK briefly.", { sessionId: "override-beta" });
    const secondResult = await readPromptResult(second, { logChunks: false });
    assert(secondResult && typeof secondResult === "string", "post-reset prompt produced string result");
    console.log("[OK] prompt after reset:", secondResult.slice(0, 160));

    await shutdownRuntime({ mode: "abort" });
    console.log("[OK] shutdown after override/reset test resolved");
}

async function modeRuntimeHardwareAwarePrompt() {
    logSection("runtime hardware-aware strategy with prompt");

    const { initModel, prompt, shutdownRuntime } = await import("../inference.mjs");

    await initModel({
        enabled: true,
        strategy: "hardware-aware-cold-worker",
        attempts: 3,
        readyTimeoutMs: 120000,
        retryDelayMs: 0,
        configOverride: {
            context: {
                batchSize: 256
            }
        },
        hardwareAware: {
            probe: true,
            maxProfiles: 3,
            allowCpuModelLoadFallback: true,
            allowBatchReduction: true,
            allowContextAutoFallback: true
        }
    });

    console.log("[OK] hardware-aware init resolved");

    const req = await prompt("Say hardware-aware OK briefly.", { sessionId: "hardware-aware" });
    const result = await readPromptResult(req, { logChunks: false });
    assert(result && typeof result === "string", "hardware-aware prompt produced string result");
    console.log("[OK] hardware-aware prompt result:", result.slice(0, 160));

    await shutdownRuntime({ mode: "abort" });
    console.log("[OK] shutdown after hardware-aware test resolved");
}

async function modeRuntimeTimeoutBlocksAutoInit() {
    logSection("runtime failed explicit custom init blocks silent default auto-init");

    const { initModel, prompt, shutdownRuntime } = await import("../inference.mjs");

    await expectReject(
        "forced custom/profile init timeout",
        () => initModel({
            enabled: true,
            attempts: 1,
            readyTimeoutMs: 1,
            retryDelayMs: 0,
            configOverride: {
                context: {
                    batchSize: 256
                }
            }
        }),
        "Model init failed"
    );

    await expectReject(
        "prompt after failed explicit custom init",
        () => prompt("This should not silently default auto-init."),
        "failed explicit init"
    );

    await shutdownRuntime({ mode: "abort" });
    console.log("[OK] shutdown after timeout-block test resolved");
}

async function orchestrator() {
    const pureModes = [
        "pure-config-override",
        "pure-profiles",
        "pure-hardware-probe"
    ];

    const runtimeModes = [
        "runtime-invalid-options",
        "runtime-override-prompt-reset",
        "runtime-hardware-aware-prompt",
        "runtime-timeout-blocks-auto-init"
    ];

    const modes = SKIP_RUNTIME
        ? pureModes
        : [...pureModes, ...runtimeModes];

    for (const mode of modes) {
        logSection(`child mode: ${mode}`);
        await runChild(mode);
    }

    console.log("\nAll hardware-aware/degraded init retry smoke tests finished.");
}

async function main() {
    console.log("[SMOKE] mode:", MODE);

    switch (MODE) {
        case "orchestrator":
            await orchestrator();
            break;
        case "pure-config-override":
            await modePureConfigOverride();
            break;
        case "pure-profiles":
            await modePureProfiles();
            break;
        case "pure-hardware-probe":
            await modePureHardwareProbe();
            break;
        case "runtime-invalid-options":
            await modeRuntimeInvalidOptions();
            break;
        case "runtime-override-prompt-reset":
            await modeRuntimeOverridePromptReset();
            break;
        case "runtime-hardware-aware-prompt":
            await modeRuntimeHardwareAwarePrompt();
            break;
        case "runtime-timeout-blocks-auto-init":
            await modeRuntimeTimeoutBlocksAutoInit();
            break;
        default:
            throw new Error(`Unknown SMOKE_MODE: ${MODE}`);
    }

    // Give worker shutdown messages a tiny amount of time to settle before child exit.
    await sleep(10);
}

main().catch((err) => {
    console.error("\n[SMOKE TEST FAILURE]");
    console.error(err);
    process.exitCode = 1;
});
