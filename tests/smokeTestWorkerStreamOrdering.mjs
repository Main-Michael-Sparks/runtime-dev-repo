// smokeTestWorkerStreamOrdering.mjs
//
// Purpose:
// - Preflight stream-ordering and parent final-result behavior coverage before Option C worker splitting.
// - Uses deterministic fake node-llama-cpp output; no real model is required.

import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { rm } from "node:fs/promises";
import { createDirectWorkerHarness, installMockNodeLlamaCpp } from "./helpers/directWorkerHarness.mjs";
import { copyRuntimeFixture } from "./helpers/copyRuntimeFixture.mjs";

const SELF_PATH = fileURLToPath(import.meta.url);
const TEST_DIR = path.dirname(SELF_PATH);
const REPO_ROOT = path.resolve(TEST_DIR, "..");

async function testDirectWorkerTokenOrderByRequestId() {
    const sequences = {
        "stream-A": ["A1", "A2", "A3"],
        "stream-B": ["B1", "B2", "B3"]
    };

    const harness = await createDirectWorkerHarness({
        repoRoot: REPO_ROOT,
        env: {
            MOCK_TOKEN_SEQUENCES: JSON.stringify(sequences),
            MOCK_TOKEN_DELAY_MS: "1"
        }
    });

    try {
        harness.postMessage({ type: "init", initAttemptId: 201, profileName: "stream-order" });
        await harness.waitForMessage((msg) => msg.type === "ready", 3000, "ready");

        harness.postMessage({ type: "prompt", id: 21, text: "stream-A", sessionId: "a", stream: true });
        harness.postMessage({ type: "prompt", id: 22, text: "stream-B", sessionId: "b", stream: true });

        await harness.waitForMessage((msg) => msg.type === "done" && msg.id === 21, 3000, "done A");
        await harness.waitForMessage((msg) => msg.type === "done" && msg.id === 22, 3000, "done B");

        const streamsById = new Map();
        for (const msg of harness.messages) {
            if (msg.type !== "stream") continue;
            if (!streamsById.has(msg.id)) streamsById.set(msg.id, []);
            streamsById.get(msg.id).push(msg.token);
        }

        assert.deepEqual(streamsById.get(21), sequences["stream-A"]);
        assert.deepEqual(streamsById.get(22), sequences["stream-B"]);
    } finally {
        await harness.cleanup();
    }
}

async function consumeStream(req) {
    if (!req.stream) return "";

    const reader = req.stream.getReader();
    let text = "";

    while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        text += value;
    }

    return text;
}

async function withMockRuntime(env, fn) {
    const tmpRoot = await copyRuntimeFixture({ repoRoot: REPO_ROOT, prefix: "stream-runtime-fixture-" });
    await installMockNodeLlamaCpp(tmpRoot);

    const oldEnv = new Map();
    for (const [key, value] of Object.entries(env)) {
        oldEnv.set(key, process.env[key]);
        process.env[key] = value;
    }

    try {
        const runtimeUrl = pathToFileURL(path.join(tmpRoot, "runtime.mjs")).href + `?case=${Date.now()}-${Math.random()}`;
        const runtime = await import(runtimeUrl);
        await fn(runtime);
    } finally {
        for (const [key, value] of oldEnv.entries()) {
            if (value === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = value;
            }
        }

        await rm(tmpRoot, { recursive: true, force: true });
    }
}

async function testParentStreamingDoneUsesAccumulatedFinalText() {
    await withMockRuntime({
        MOCK_TOKENS: JSON.stringify(["S", "T", "R"]),
        MOCK_PROMPT_RESULT: "worker-result-should-not-win-when-streamed"
    }, async ({ prompt, shutdownRuntime }) => {
        try {
            const req = await prompt("parent streaming final text", { stream: true });
            const streamed = await consumeStream(req);
            const result = await req.done;

            assert.equal(streamed, "STR");
            assert.equal(result, "STR");
        } finally {
            await shutdownRuntime({ mode: "abort" });
        }
    });
}

async function testParentNonStreamingDoneUsesWorkerResult() {
    await withMockRuntime({
        MOCK_TOKENS: JSON.stringify(["N", "S"]),
        MOCK_PROMPT_RESULT: "non-stream-worker-result"
    }, async ({ prompt, shutdownRuntime }) => {
        try {
            const req = await prompt("parent non-streaming final text", { stream: false });
            const streamed = await consumeStream(req);
            const result = await req.done;

            assert.equal(streamed, "");
            assert.equal(result, "non-stream-worker-result");
        } finally {
            await shutdownRuntime({ mode: "abort" });
        }
    });
}

async function main() {
    await testDirectWorkerTokenOrderByRequestId();
    await testParentStreamingDoneUsesAccumulatedFinalText();
    await testParentNonStreamingDoneUsesWorkerResult();
    console.log("All worker stream ordering smoke tests finished.");
}

await main();
