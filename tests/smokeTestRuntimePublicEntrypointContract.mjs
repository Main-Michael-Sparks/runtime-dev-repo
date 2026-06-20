// smokeTestRuntimePublicEntrypointContract.mjs
//
// Purpose:
// - Static guard for the public runtime entrypoint contract.
// - Ensures runtime.mjs remains a thin public API/composition root.
// - Does not import runtime.mjs because importing it wires workerBridge and can
//   create the worker at module load.
//
// Run:
//   node ./tests/smokeTestRuntimePublicEntrypointContract.mjs

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const runtimePath = path.join(repoRoot, "runtime.mjs");
const workerBridgePath = path.join(repoRoot, "workerBridge.mjs");
const selfPath = fileURLToPath(import.meta.url);

function fail(message) {
    throw new Error(`[FAIL] ${message}`);
}

function ok(message) {
    console.log(`[OK] ${message}`);
}

function normalizeWhitespace(text) {
    return text.replace(/\s+/g, " ").trim();
}

function assertIncludes(source, marker, label) {
    if (!source.includes(marker)) {
        fail(`${label} missing marker: ${marker}`);
    }
}

function assertNormalizedIncludes(source, marker, label) {
    const normalizedSource = normalizeWhitespace(source);
    const normalizedMarker = normalizeWhitespace(marker);

    if (!normalizedSource.includes(normalizedMarker)) {
        fail(`${label} missing marker: ${marker}`);
    }
}

function assertNotIncludes(source, marker, label) {
    if (source.includes(marker)) {
        fail(`${label} includes forbidden marker: ${marker}`);
    }
}

function assertSameSet(actual, expected, label) {
    const actualSorted = [...actual].sort();
    const expectedSorted = [...expected].sort();

    if (actualSorted.length !== expectedSorted.length) {
        fail(`${label} mismatch. expected=${expectedSorted.join(", ")} actual=${actualSorted.join(", ")}`);
    }

    for (let i = 0; i < expectedSorted.length; i++) {
        if (actualSorted[i] !== expectedSorted[i]) {
            fail(`${label} mismatch. expected=${expectedSorted.join(", ")} actual=${actualSorted.join(", ")}`);
        }
    }
}

function extractExportedFunctionNames(source) {
    const names = [];
    const pattern = /export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g;

    for (const match of source.matchAll(pattern)) {
        names.push(match[1]);
    }

    return names;
}

async function readText(filePath) {
    return fs.readFile(filePath, "utf8");
}

async function* walkMjsFiles(rootPath) {
    const entries = await fs.readdir(rootPath, { withFileTypes: true });

    for (const entry of entries) {
        const entryPath = path.join(rootPath, entry.name);

        if (entry.isDirectory()) {
            yield* walkMjsFiles(entryPath);
            continue;
        }

        if (entry.isFile() && entry.name.endsWith(".mjs")) {
            yield entryPath;
        }
    }
}

async function assertNoExecutableInferenceImports() {
    const scanRoots = [
        runtimePath,
        workerBridgePath,
        path.join(repoRoot, "runtime"),
        path.join(repoRoot, "llama_worker"),
        path.join(repoRoot, "tests")
    ];

    const forbidden = "inference.mjs";
    const offenders = [];

    for (const scanRoot of scanRoots) {
        const stat = await fs.stat(scanRoot);
        const files = stat.isDirectory()
            ? walkMjsFiles(scanRoot)
            : [scanRoot];

        for await (const filePath of files) {
            const relativePath = path.relative(repoRoot, filePath).replaceAll(path.sep, "/");

            if (relativePath.startsWith("tests/legacy/")) continue;
            if (path.resolve(filePath) === path.resolve(selfPath)) continue;

            const text = await readText(filePath);
            if (text.includes(forbidden)) {
                offenders.push(relativePath);
            }
        }
    }

    if (offenders.length > 0) {
        fail(`executable source references ${forbidden}: ${offenders.join(", ")}`);
    }

    ok("executable source has no non-legacy inference.mjs references");
}

async function main() {
    console.log("[SMOKE] runtime public entrypoint contract");

    const runtimeSource = await readText(runtimePath);
    const workerBridgeSource = await readText(workerBridgePath);

    const expectedExports = [
        "cancelPrompt",
        "executeAction",
        "initModel",
        "prompt",
        "resetModel",
        "resetSession",
        "shutdownRuntime"
    ];

    assertSameSet(
        extractExportedFunctionNames(runtimeSource),
        expectedExports,
        "runtime.mjs public function exports"
    );
    ok("runtime.mjs exposes expected public function export set");

    const requiredRuntimeMarkers = [
        "./runtime/config/config.mjs",
        "./runtime/lifecycle/nativeOperationPolicy.mjs",
        "./runtime/lifecycle/nativeBoundaryCoordinator.mjs",
        "./runtime/lifecycle/runtimeSessionResetCoordinator.mjs",
        "./runtime/lifecycle/runtimeShutdownCoordinator.mjs",
        "./runtime/lifecycle/runtimeModelResetCoordinator.mjs",
        "./runtime/lifecycle/workerProtocolRouter.mjs",
        "./runtime/request/runtimeRequestSettlement.mjs",
        "./runtime/lifecycle/runtimeLifecycleState.mjs",
        "./runtime/lifecycle/runtimeInitCoordinator.mjs",
        "./runtime/stream/normalizer.mjs",
        "./runtime/observability/observer.mjs",
        "./runtime/request/request.mjs",
        "./runtime/stream/streamController.mjs",
        "./workerBridge.mjs",
        "./runtime/request/scheduler.mjs",
        "./runtime/bus/executeAction/capabilityBusExecuteActionDispatch.mjs"
    ];

    for (const marker of requiredRuntimeMarkers) {
        assertIncludes(runtimeSource, marker, "runtime.mjs composition imports");
    }
    ok("runtime.mjs includes expected composition-root imports");

    const forbiddenRuntimeMarkers = [
        "inference.mjs",
        "node-llama-cpp",
        "./llama_worker/",
        "../llama_worker/"
    ];

    for (const marker of forbiddenRuntimeMarkers) {
        assertNotIncludes(runtimeSource, marker, "runtime.mjs");
    }
    ok("runtime.mjs avoids forbidden direct runtime/worker/native references");

    const requiredWrapperMarkers = [
        "export async function initModel",
        "export async function prompt",
        "export async function executeAction",
        "export function cancelPrompt",
        "export async function resetSession",
        "export async function resetModel",
        "export async function shutdownRuntime"
    ];

    for (const marker of requiredWrapperMarkers) {
        assertIncludes(runtimeSource, marker, "runtime.mjs public wrappers");
    }
    ok("runtime.mjs includes expected public wrapper declarations");

    const promptAdmissionMarkers = [
        "function assertPromptAdmissionAllowed",
        "async function runNativeTextRequest",
        "return runNativeTextRequest(text, options);",
        "assertPromptAdmissionAllowed(sessionId)",
        "ensureModelReadyCoordinator",
        "scheduler.queuedCount()",
        "createRequest(text, options)",
        "traceQueued(req)",
        "scheduler.enqueue(req)"
    ];

    for (const marker of promptAdmissionMarkers) {
        assertIncludes(runtimeSource, marker, "runtime.mjs prompt admission path");
    }
    ok("runtime.mjs prompt admission markers remain present");

    const executeActionMarkers = [
        "export async function executeAction(actionInput, options = {})",
        "runExecuteActionDispatch(actionInput",
        "runNativeTextRequest"
    ];

    for (const marker of executeActionMarkers) {
        assertIncludes(runtimeSource, marker, "runtime.mjs executeAction injection path");
    }
    ok("runtime.mjs executeAction public-dispatch dependency-injection markers remain present");

    const fastCancelMarkers = [
        "export function cancelPrompt",
        "notifyRequestCancellationRequested",
        "sendToWorker({\n        type: \"cancel\"",
        "scheduler.cancel(promptId)",
        "cancelStream(req)",
        "traceCanceled(req)",
        "req.rejectDone(new Error(\"Prompt canceled\"))",
        "traceDelete(req.id)"
    ];

    for (const marker of fastCancelMarkers) {
        assertNormalizedIncludes(runtimeSource, marker, "runtime.mjs cancelPrompt fast path");
    }
    ok("runtime.mjs cancelPrompt fast-path markers remain present");

    assertIncludes(
        workerBridgeSource,
        "./llama_worker/llama.mjs",
        "workerBridge.mjs worker target"
    );

    const deeperWorkerTargetPattern = /new\s+URL\(\s*["']\.\/llama_worker\/(?!llama\.mjs["'])/;
    if (deeperWorkerTargetPattern.test(workerBridgeSource)) {
        fail("workerBridge.mjs targets a deeper worker module instead of ./llama_worker/llama.mjs");
    }

    assertNotIncludes(workerBridgeSource, "../llama_worker/", "workerBridge.mjs");
    ok("workerBridge.mjs targets the stable worker entrypoint");

    await assertNoExecutableInferenceImports();

    console.log("\nAll runtime public entrypoint contract checks finished.");
}

main().catch((err) => {
    console.error(err.message || err);
    process.exitCode = 1;
});
