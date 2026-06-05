// smokeTestWorkerProtocolContract.mjs
//
// Purpose:
// - Preflight contract coverage for the worker wire protocol before Option C worker splitting.
// - Uses a fake node-llama-cpp package and direct worker messages; no real model is required.

import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDirectWorkerHarness } from "./helpers/directWorkerHarness.mjs";

const SELF_PATH = fileURLToPath(import.meta.url);
const TEST_DIR = path.dirname(SELF_PATH);
const REPO_ROOT = path.resolve(TEST_DIR, "..");

async function withHarness(options, fn) {
    const harness = await createDirectWorkerHarness({ repoRoot: REPO_ROOT, ...options });

    try {
        await fn(harness);
    } finally {
        await harness.cleanup();
    }
}

function assertWorkerErrorShape(msg, { id = undefined, sessionId = undefined } = {}) {
    assert.equal(msg.type, "error");

    if (id !== undefined) {
        assert.equal(msg.id, id);
    }

    assert.equal(typeof msg.error?.message, "string");
    assert.equal(typeof msg.error?.stack, "string");
    assert.equal(msg.error.phase, "worker");

    if (sessionId !== undefined) {
        assert.equal(msg.error.sessionId, sessionId);
    }
}

async function testInitReadyShape() {
    await withHarness({}, async ({ postMessage, waitForMessage }) => {
        postMessage({
            type: "init",
            initAttemptId: 101,
            profileName: "protocol-ready"
        });

        const ready = await waitForMessage((msg) => msg.type === "ready", 3000, "ready");
        assert.deepEqual(Object.keys(ready).sort(), ["initAttemptId", "profileName", "type"]);
        assert.equal(ready.initAttemptId, 101);
        assert.equal(ready.profileName, "protocol-ready");
    });
}

async function testInitErrorShape() {
    await withHarness({ mock: { failGetLlama: true } }, async ({ postMessage, waitForMessage }) => {
        postMessage({
            type: "init",
            initAttemptId: 102,
            profileName: "protocol-init-error"
        });

        const err = await waitForMessage((msg) => msg.type === "error", 3000, "init error");
        assert.equal(err.initAttemptId, 102);
        assert.equal(err.profileName, "protocol-init-error");
        assertWorkerErrorShape(err);
        assert.match(err.error.message, /mock getLlama failure/);
    });
}

async function testPromptStreamDoneAndErrorShapes() {
    await withHarness({}, async ({ postMessage, waitForMessage }) => {
        postMessage({ type: "init", initAttemptId: 103, profileName: "protocol-prompt" });
        await waitForMessage((msg) => msg.type === "ready", 3000, "ready");

        postMessage({
            type: "prompt",
            id: 7,
            text: "protocol stream prompt",
            sessionId: "alpha",
            stream: true
        });

        const stream = await waitForMessage(
            (msg) => msg.type === "stream" && msg.id === 7,
            3000,
            "prompt stream"
        );
        assert.deepEqual(Object.keys(stream).sort(), ["id", "token", "type"]);
        assert.equal(typeof stream.token, "string");

        const done = await waitForMessage(
            (msg) => msg.type === "done" && msg.id === 7,
            3000,
            "prompt done"
        );
        assert.deepEqual(Object.keys(done).sort(), ["id", "res", "type"]);
        assert.equal(done.res, "mock-response");

        postMessage({
            type: "prompt",
            id: 8,
            text: "__THROW__ protocol error prompt",
            sessionId: "beta",
            stream: true
        });

        const err = await waitForMessage(
            (msg) => msg.type === "error" && msg.id === 8,
            3000,
            "prompt error"
        );
        assertWorkerErrorShape(err, { id: 8, sessionId: "beta" });
        assert.match(err.error.message, /mock prompt failure/);
    });
}

async function testLifecycleMessageShapes() {
    await withHarness({}, async ({ postMessage, waitForMessage }) => {
        postMessage({ type: "init", initAttemptId: 104, profileName: "protocol-reset-session" });
        await waitForMessage((msg) => msg.type === "ready", 3000, "ready");

        postMessage({ type: "reset_session", sessionId: "gamma" });
        const resetDone = await waitForMessage(
            (msg) => msg.type === "reset_done",
            3000,
            "reset_done"
        );
        assert.deepEqual(resetDone, { type: "reset_done", sessionId: "gamma" });
    });

    await withHarness({}, async ({ postMessage, waitForMessage }) => {
        postMessage({ type: "reset_session", sessionId: "delta" });
        const err = await waitForMessage((msg) => msg.type === "error", 3000, "reset_session error");
        assertWorkerErrorShape(err, { sessionId: "delta" });
        assert.match(err.error.message, /Worker not ready|Model is resetting/);
    });

    await withHarness({}, async ({ postMessage, waitForMessage }) => {
        postMessage({ type: "init", initAttemptId: 105, profileName: "protocol-reset-model" });
        await waitForMessage((msg) => msg.type === "ready", 3000, "ready");
        postMessage({ type: "reset_model" });
        assert.deepEqual(
            await waitForMessage((msg) => msg.type === "model_reset_done", 3000, "model_reset_done"),
            { type: "model_reset_done" }
        );
    });

    await withHarness({}, async ({ postMessage, waitForMessage }) => {
        postMessage({ type: "init", initAttemptId: 106, profileName: "protocol-shutdown" });
        await waitForMessage((msg) => msg.type === "ready", 3000, "ready");
        postMessage({ type: "shutdown" });
        assert.deepEqual(
            await waitForMessage((msg) => msg.type === "shutdown_done", 3000, "shutdown_done"),
            { type: "shutdown_done" }
        );
    });
}

async function main() {
    await testInitReadyShape();
    await testInitErrorShape();
    await testPromptStreamDoneAndErrorShapes();
    await testLifecycleMessageShapes();
    console.log("All worker protocol contract smoke tests finished.");
}

await main();
