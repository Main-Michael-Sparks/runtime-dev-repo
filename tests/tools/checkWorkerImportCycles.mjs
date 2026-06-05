// checkWorkerImportCycles.mjs
//
// Purpose:
// - Static preflight guard for future llama_worker/** modularization branches.
// - Ensures worker internals do not import the worker composition root or parent bridge.

import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SELF_PATH = fileURLToPath(import.meta.url);
const TEST_DIR = path.dirname(SELF_PATH);
const REPO_ROOT = path.resolve(TEST_DIR, "../..");

async function listMjsFiles(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    const out = [];

    for (const entry of entries) {
        const full = path.join(dir, entry.name);

        if (entry.isDirectory()) {
            out.push(...await listMjsFiles(full));
        } else if (entry.isFile() && entry.name.endsWith(".mjs")) {
            out.push(full);
        }
    }

    return out;
}

function normalizeRel(fullPath) {
    return path.relative(REPO_ROOT, fullPath).replaceAll(path.sep, "/");
}

function extractStaticImports(source) {
    const imports = [];
    const patterns = [
        /import\s+(?:[^'";]+?\s+from\s+)?["']([^"']+)["']/g,
        /import\s*\(\s*["']([^"']+)["']\s*\)/g,
        /export\s+[^'";]+?\s+from\s+["']([^"']+)["']/g
    ];

    for (const pattern of patterns) {
        for (const match of source.matchAll(pattern)) {
            imports.push(match[1]);
        }
    }

    return imports;
}

function resolveRelativeImport(fromRel, specifier) {
    if (!specifier.startsWith(".")) return null;

    const resolved = path.normalize(path.join(path.dirname(fromRel), specifier));
    const withExt = resolved.endsWith(".mjs") ? resolved : `${resolved}.mjs`;
    return withExt.replaceAll(path.sep, "/");
}

function detectCycles(graph) {
    const cycles = [];
    const visiting = new Set();
    const visited = new Set();
    const stack = [];

    function visit(node) {
        if (visiting.has(node)) {
            const start = stack.indexOf(node);
            cycles.push([...stack.slice(start), node]);
            return;
        }

        if (visited.has(node)) return;

        visiting.add(node);
        stack.push(node);

        for (const next of graph.get(node) ?? []) {
            visit(next);
        }

        stack.pop();
        visiting.delete(node);
        visited.add(node);
    }

    for (const node of graph.keys()) {
        visit(node);
    }

    return cycles;
}

async function main() {
    const workerRoot = path.join(REPO_ROOT, "llama_worker");
    const workerFiles = (await listMjsFiles(workerRoot)).map(normalizeRel);
    const workerFileSet = new Set(workerFiles);
    const graph = new Map();

    for (const rel of workerFiles) {
        const source = await readFile(path.join(REPO_ROOT, rel), "utf8");
        const imports = extractStaticImports(source);
        const resolvedWorkerImports = [];

        for (const specifier of imports) {
            const resolved = resolveRelativeImport(rel, specifier);
            if (!resolved) continue;

            assert.notEqual(
                resolved,
                "workerBridge.mjs",
                `${rel} must not import workerBridge.mjs`
            );

            if (rel !== "llama_worker/llama.mjs") {
                assert.notEqual(
                    resolved,
                    "llama_worker/llama.mjs",
                    `${rel} must not import llama_worker/llama.mjs`
                );
            }

            if (workerFileSet.has(resolved)) {
                resolvedWorkerImports.push(resolved);
            }
        }

        graph.set(rel, resolvedWorkerImports);
    }

    const bridgeSource = await readFile(path.join(REPO_ROOT, "workerBridge.mjs"), "utf8");
    assert.match(
        bridgeSource,
        /new Worker\(new URL\("\.\/llama_worker\/llama\.mjs", import\.meta\.url\)\)/,
        "workerBridge.mjs must continue targeting ./llama_worker/llama.mjs"
    );

    const cycles = detectCycles(graph);
    assert.deepEqual(cycles, [], `Worker import cycles found: ${JSON.stringify(cycles)}`);

    console.log(`[OK] worker import hygiene passed for ${workerFiles.length} worker file(s).`);
}

await main();
