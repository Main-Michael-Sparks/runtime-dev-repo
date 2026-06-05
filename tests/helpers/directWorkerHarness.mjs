import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import { copyRuntimeFixture } from "./copyRuntimeFixture.mjs";
import { WORKER_ENTRYPOINT } from "./runtimeFixtureFiles.mjs";

export function createMockNodeLlamaCppModule({
    failGetLlama = false,
    promptThrows = false,
    moduleBody = null
} = {}) {
    if (moduleBody) return moduleBody;

    return `import { appendFileSync } from "node:fs";\n\nfunction log(event) {\n    const file = process.env.MOCK_WORKER_LOG;\n    if (!file) return;\n    appendFileSync(file, JSON.stringify(event) + "\\n");\n}\n\nfunction readJsonEnv(name, fallback) {\n    const raw = process.env[name];\n    if (!raw) return fallback;\n    return JSON.parse(raw);\n}\n\nexport async function getLlama() {\n    log({ type: "getLlama" });\n\n    if (${JSON.stringify(failGetLlama)}) {\n        throw new Error("mock getLlama failure");\n    }\n\n    return {\n        async loadModel(options) {\n            log({ type: "loadModel", options });\n\n            return {\n                disposed: false,\n                async createContext(options) {\n                    log({ type: "createContext", options });\n\n                    if (process.env.MOCK_CREATE_CONTEXT_FAIL === "1") {\n                        throw new Error("mock createContext failure");\n                    }\n\n                    return {\n                        disposed: false,\n                        getSequence() {\n                            return { id: "mock-sequence" };\n                        },\n                        async dispose() {\n                            this.disposed = true;\n                            log({ type: "context.dispose" });\n                        }\n                    };\n                },\n                detokenize(tokens) {\n                    if (Array.isArray(tokens)) return tokens.join("");\n                    return String(tokens);\n                },\n                async dispose() {\n                    this.disposed = true;\n                    log({ type: "model.dispose" });\n                }\n            };\n        }\n    };\n}\n\nexport class LlamaChatSession {\n    constructor({ contextSequence }) {\n        this.contextSequence = contextSequence;\n        this.disposed = false;\n        log({ type: "session.create", contextSequence });\n    }\n\n    async prompt(text, options = {}) {\n        log({ type: "prompt.start", text });\n\n        if (${JSON.stringify(promptThrows)} || String(text).includes("__THROW__")) {\n            throw new Error("mock prompt failure");\n        }\n\n        const sequences = readJsonEnv("MOCK_TOKEN_SEQUENCES", {});\n        const defaultTokens = readJsonEnv("MOCK_TOKENS", ["mock", "-", "response"]);\n        const tokens = sequences[String(text)] ?? defaultTokens;\n        const delayMs = Number.parseInt(process.env.MOCK_TOKEN_DELAY_MS || "0", 10);\n\n        if (typeof options.onToken === "function") {\n            for (const token of tokens) {\n                if (delayMs > 0) {\n                    await new Promise((resolve) => setTimeout(resolve, delayMs));\n                }\n\n                if (options.signal?.aborted) {\n                    throw options.signal.reason ?? new Error("mock prompt aborted");\n                }\n\n                options.onToken(token);\n            }\n        }\n\n        const result = process.env.MOCK_PROMPT_RESULT || tokens.join("");\n        log({ type: "prompt.done", text, result });\n        return result;\n    }\n\n    dispose() {\n        this.disposed = true;\n        log({ type: "session.dispose" });\n    }\n}\n`;
}

export async function installMockNodeLlamaCpp(tmpRoot, options = {}) {
    const packageRoot = path.join(tmpRoot, "node_modules", "node-llama-cpp");
    await mkdir(packageRoot, { recursive: true });
    await writeFile(
        path.join(packageRoot, "package.json"),
        JSON.stringify({ name: "node-llama-cpp", type: "module", main: "index.js" }, null, 2)
    );
    await writeFile(path.join(packageRoot, "index.js"), createMockNodeLlamaCppModule(options));
}

export async function createDirectWorkerHarness({
    repoRoot,
    env = {},
    mock = {}
} = {}) {
    const tmpRoot = await copyRuntimeFixture({ repoRoot, prefix: "direct-worker-fixture-" });
    await installMockNodeLlamaCpp(tmpRoot, mock);

    const workerUrl = pathToFileURL(path.join(tmpRoot, WORKER_ENTRYPOINT));
    const messages = [];

    const worker = new Worker(workerUrl, {
        env: {
            ...process.env,
            ...env
        }
    });

    worker.on("message", (msg) => {
        messages.push(msg);
    });

    function waitForMessage(predicate, timeoutMs = 3000, label = "worker message") {
        const existing = messages.find(predicate);
        if (existing) return Promise.resolve(existing);

        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                cleanup();
                reject(new Error(`[FAIL] timed out waiting for ${label}`));
            }, timeoutMs);

            function onMessage(msg) {
                if (!predicate(msg)) return;
                cleanup();
                resolve(msg);
            }

            function onError(err) {
                cleanup();
                reject(err);
            }

            function onExit(code) {
                if (code === 0) return;
                cleanup();
                reject(new Error(`Worker exited before ${label}: ${code}`));
            }

            function cleanup() {
                clearTimeout(timer);
                worker.off("message", onMessage);
                worker.off("error", onError);
                worker.off("exit", onExit);
            }

            worker.on("message", onMessage);
            worker.on("error", onError);
            worker.on("exit", onExit);
        });
    }

    async function cleanup() {
        try {
            await worker.terminate();
        } catch {
            // no-op: worker may already be terminated
        }

        await rm(tmpRoot, { recursive: true, force: true });
    }

    return {
        tmpRoot,
        worker,
        messages,
        postMessage(message, transferList) {
            worker.postMessage(message, transferList ?? []);
        },
        waitForMessage,
        cleanup
    };
}
