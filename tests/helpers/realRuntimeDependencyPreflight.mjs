import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_WORKER_RELATIVE_PATH = "llama_worker/llama.mjs";
const NODE_LLAMA_CPP_PACKAGE = "node-llama-cpp";
const SETUP_FAILURE_CODE = "SMOKE_REAL_RUNTIME_DEPENDENCY_NOT_RESOLVED";

export function resolveRealRuntimeNodeLlamaCpp({
    repoRoot,
    workerRelativePath = DEFAULT_WORKER_RELATIVE_PATH
} = {}) {
    if (!repoRoot) {
        throw new Error("repoRoot is required for real-runtime dependency preflight");
    }

    const workerPath = path.resolve(repoRoot, workerRelativePath);
    const requireFromWorker = createRequire(pathToFileURL(workerPath));
    return requireFromWorker.resolve(NODE_LLAMA_CPP_PACKAGE);
}

export function assertRealRuntimeDependencyPreflight({
    repoRoot,
    smokeName = "real-runtime smoke",
    workerRelativePath = DEFAULT_WORKER_RELATIVE_PATH
} = {}) {
    const workerPath = path.resolve(repoRoot ?? process.cwd(), workerRelativePath);

    try {
        const resolvedPath = resolveRealRuntimeNodeLlamaCpp({ repoRoot, workerRelativePath });
        console.log(
            `[SMOKE] real-runtime dependency ${NODE_LLAMA_CPP_PACKAGE} resolved from ${workerRelativePath}: ${resolvedPath}`
        );
        return resolvedPath;
    } catch (err) {
        const resolutionError = err?.code ? `${err.code}: ${err.message}` : err?.message ?? String(err);
        const setupError = new Error([
            `[SMOKE SETUP FAILURE] Real-runtime smoke requires ${NODE_LLAMA_CPP_PACKAGE} to be resolvable from ${workerRelativePath}.`,
            `Smoke: ${smokeName}`,
            `Repo root: ${repoRoot ?? "<unknown>"}`,
            `Worker entry: ${workerPath}`,
            `Resolution error: ${resolutionError}`,
            "",
            "This is a smoke-test setup failure, not a runtime behavior result.",
            "Fix: run the real-runtime smoke from a working package root, install dependencies in this checkout, or link the working node_modules folder into this formatted repo copy.",
            "Windows cmd.exe example: mklink /J node_modules \"C:\\path\\to\\working\\node_modules\""
        ].join("\n"));

        setupError.code = SETUP_FAILURE_CODE;
        setupError.cause = err;
        throw setupError;
    }
}

export function reportSmokeTestFailure(err) {
    console.error("\n[SMOKE TEST FAILURE]");

    if (typeof err?.code === "string" && err.code.startsWith("SMOKE_REAL_RUNTIME_")) {
        console.error(err.message);
        return;
    }

    console.error(err);
}
