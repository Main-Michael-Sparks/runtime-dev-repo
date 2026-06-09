// checkRuntimeFixtureCoverage.mjs
//
// Purpose:
// - Static preflight guard for runtime fixture drift.
// - Verifies the shared fixture manifest includes production files reachable from runtime.mjs and llama_worker/llama.mjs.
// - Flags reintroduced local RUNTIME_FILES arrays so fixture-copy smoke tests keep using the shared manifest.

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RUNTIME_FIXTURE_FILES } from "../helpers/runtimeFixtureFiles.mjs";

const SELF_PATH = fileURLToPath(import.meta.url);
const TEST_DIR = path.dirname(SELF_PATH);
const REPO_ROOT = path.resolve(TEST_DIR, "../..");
const MANIFEST = new Set(RUNTIME_FIXTURE_FILES);

// Keep this empty unless a future test has a documented reason to carry a local
// fixture list. Prefer tests/helpers/runtimeFixtureFiles.mjs for all runtime fixtures.
const ALLOWED_LOCAL_RUNTIME_FILE_ARRAYS = new Set();

function extractStaticImports(source) {
    const imports = [];
    const patterns = [
        /import\s+(?:[^'";]+?\s+from\s+)?["']([^"']+)["']/g,
        /export\s+[^'";]+?\s+from\s+["']([^"']+)["']/g
    ];

    for (const pattern of patterns) {
        for (const match of source.matchAll(pattern)) {
            imports.push(match[1]);
        }
    }

    return imports;
}

function normalizeRel(fullPath) {
    return path.relative(REPO_ROOT, fullPath).replaceAll(path.sep, "/");
}

function resolveRelativeImport(fromRel, specifier) {
    if (!specifier.startsWith(".")) return null;

    const resolved = path.normalize(path.join(path.dirname(fromRel), specifier));
    const withExt = resolved.endsWith(".mjs") ? resolved : `${resolved}.mjs`;
    return withExt.replaceAll(path.sep, "/");
}

async function collectReachableProductionFiles(entryRel, out = new Set()) {
    if (out.has(entryRel)) return out;
    out.add(entryRel);

    const source = await readFile(path.join(REPO_ROOT, entryRel), "utf8");

    for (const specifier of extractStaticImports(source)) {
        const resolved = resolveRelativeImport(entryRel, specifier);
        if (!resolved) continue;
        if (!existsSync(path.join(REPO_ROOT, resolved))) continue;
        if (resolved.startsWith("tests/")) continue;

        await collectReachableProductionFiles(resolved, out);
    }

    return out;
}

async function listTestFiles(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    const out = [];

    for (const entry of entries) {
        const full = path.join(dir, entry.name);

        if (entry.isDirectory()) {
            if (entry.name === "helpers" || entry.name === "tools" || entry.name === "legacy") continue;
            out.push(...await listTestFiles(full));
        } else if (entry.isFile() && entry.name.endsWith(".mjs")) {
            out.push(full);
        }
    }

    return out;
}

function parseRuntimeFilesArray(source) {
    const match = source.match(/const\s+RUNTIME_FILES\s*=\s*\[([\s\S]*?)\];/);
    if (!match) return null;

    const values = [];
    for (const item of match[1].matchAll(/["']([^"']+\.mjs)["']/g)) {
        values.push(item[1]);
    }

    return values;
}

async function main() {
    assert.equal(
        RUNTIME_FIXTURE_FILES.length,
        MANIFEST.size,
        "RUNTIME_FIXTURE_FILES must not contain duplicates"
    );

    for (const rel of RUNTIME_FIXTURE_FILES) {
        assert.ok(existsSync(path.join(REPO_ROOT, rel)), `fixture file does not exist: ${rel}`);
    }

    const reachable = new Set([
        ...await collectReachableProductionFiles("runtime.mjs"),
        ...await collectReachableProductionFiles("llama_worker/llama.mjs")
    ]);

    for (const rel of reachable) {
        assert.ok(MANIFEST.has(rel), `RUNTIME_FIXTURE_FILES missing reachable production file: ${rel}`);
    }

    let localArrayCount = 0;

    for (const full of await listTestFiles(path.join(REPO_ROOT, "tests"))) {
        const rel = normalizeRel(full);
        const source = await readFile(full, "utf8");
        const localArray = parseRuntimeFilesArray(source);
        if (!localArray) continue;

        localArrayCount += 1;
        assert.ok(
            ALLOWED_LOCAL_RUNTIME_FILE_ARRAYS.has(rel),
            `${rel} defines a local RUNTIME_FILES array; use tests/helpers/runtimeFixtureFiles.mjs instead`
        );

        assert.deepEqual(
            [...localArray].sort(),
            [...RUNTIME_FIXTURE_FILES].sort(),
            `${rel} local RUNTIME_FILES array differs from tests/helpers/runtimeFixtureFiles.mjs`
        );
    }

    console.log(`[OK] runtime fixture coverage passed for ${RUNTIME_FIXTURE_FILES.length} file(s); local arrays: ${localArrayCount}.`);
}

await main();
