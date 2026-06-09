// smokeTestWorkerModelPathImmutability.mjs
//
// Purpose:
// - Preflight guard for worker-side model-path immutability before Option C worker splitting.
// - Proves configSnapshot.modelLoad.baseModel does not affect loadModel({ modelPath }).

import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../runtime/config/config.mjs";
import { validateConfigOverride } from "../runtime/config/configOverride.mjs";
import { createDirectWorkerHarness } from "./helpers/directWorkerHarness.mjs";

const SELF_PATH = fileURLToPath(import.meta.url);
const TEST_DIR = path.dirname(SELF_PATH);
const REPO_ROOT = path.resolve(TEST_DIR, "..");

function cloneConfigWithMutatedModelPath() {
    return {
        ...config,
        modelLoad: {
            ...config.modelLoad,
            baseModel: "./evil/changed-model.gguf"
        },
        context: {
            ...config.context
        },
        model: {
            ...config.model
        },
        runtime: {
            ...config.runtime,
            initRetry: {
                ...config.runtime.initRetry
            },
            nativeOperationHardStop: {
                ...config.runtime.nativeOperationHardStop
            }
        },
        sessions: {
            ...config.sessions
        },
        stream: {
            ...config.stream
        }
    };
}

async function readJsonLines(file) {
    const raw = await readFile(file, "utf8");
    return raw.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

async function testConfigOverrideStillRejectsBaseModel() {
    assert.throws(
        () => validateConfigOverride({ modelLoad: { baseModel: "./evil.gguf" } }),
        /Unsupported configOverride path: modelLoad\.baseModel/
    );
}

async function testWorkerIgnoresConfigSnapshotBaseModel() {
    const logFile = path.join(os.tmpdir(), `model-path-immutability-${process.pid}-${Date.now()}.jsonl`);
    await writeFile(logFile, "");

    const harness = await createDirectWorkerHarness({
        repoRoot: REPO_ROOT,
        env: {
            MOCK_WORKER_LOG: logFile
        }
    });

    try {
        harness.postMessage({
            type: "init",
            initAttemptId: 301,
            profileName: "evil-path-profile",
            configSnapshot: cloneConfigWithMutatedModelPath()
        });

        await harness.waitForMessage((msg) => msg.type === "ready", 3000, "ready");

        const events = await readJsonLines(logFile);
        const loadModel = events.find((event) => event.type === "loadModel");
        assert.ok(loadModel, "expected fake loadModel to be called");

        const modelPath = String(loadModel.options.modelPath);
        assert.ok(modelPath.endsWith(path.basename(config.modelLoad.baseModel)), modelPath);
        assert.ok(!modelPath.includes("changed-model"), modelPath);
        assert.ok(!modelPath.includes("evil"), modelPath);
    } finally {
        await harness.cleanup();
    }
}

async function testResetReinitKeepsStaticModelPath() {
    const logFile = path.join(os.tmpdir(), `model-path-reset-${process.pid}-${Date.now()}.jsonl`);
    await writeFile(logFile, "");

    const harness = await createDirectWorkerHarness({
        repoRoot: REPO_ROOT,
        env: {
            MOCK_WORKER_LOG: logFile
        }
    });

    try {
        harness.postMessage({
            type: "init",
            initAttemptId: 302,
            profileName: "evil-path-profile",
            configSnapshot: cloneConfigWithMutatedModelPath()
        });
        await harness.waitForMessage((msg) => msg.type === "ready", 3000, "ready");

        harness.postMessage({ type: "reset_model" });
        await harness.waitForMessage((msg) => msg.type === "model_reset_done", 3000, "model_reset_done");

        harness.postMessage({
            type: "init",
            initAttemptId: 303,
            profileName: "evil-path-profile-after-reset",
            configSnapshot: cloneConfigWithMutatedModelPath()
        });
        await harness.waitForMessage(
            (msg) => msg.type === "ready" && msg.initAttemptId === 303,
            3000,
            "ready after reset"
        );

        const loadEvents = (await readJsonLines(logFile)).filter((event) => event.type === "loadModel");
        assert.equal(loadEvents.length, 2);

        for (const event of loadEvents) {
            const modelPath = String(event.options.modelPath);
            assert.ok(modelPath.endsWith(path.basename(config.modelLoad.baseModel)), modelPath);
            assert.ok(!modelPath.includes("changed-model"), modelPath);
            assert.ok(!modelPath.includes("evil"), modelPath);
        }
    } finally {
        await harness.cleanup();
    }
}

async function main() {
    await testConfigOverrideStillRejectsBaseModel();
    await testWorkerIgnoresConfigSnapshotBaseModel();
    await testResetReinitKeepsStaticModelPath();
    console.log("All worker model-path immutability smoke tests finished.");
}

await main();
