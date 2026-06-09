import { cp, mkdir, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { RUNTIME_FIXTURE_FILES } from "./runtimeFixtureFiles.mjs";

function assertSafeRelativePath(rel) {
    if (typeof rel !== "string" || rel.length === 0) {
        throw new Error(`Invalid fixture path: ${String(rel)}`);
    }

    if (path.isAbsolute(rel) || rel.split(/[\\/]+/).includes("..")) {
        throw new Error(`Unsafe fixture path: ${rel}`);
    }
}

export async function copyRuntimeFixture({
    repoRoot,
    prefix = "runtime-fixture-",
    files = RUNTIME_FIXTURE_FILES,
    extraFiles = []
} = {}) {
    if (!repoRoot) {
        throw new Error("copyRuntimeFixture requires repoRoot");
    }

    const tmpRoot = await mkdtemp(path.join(os.tmpdir(), prefix));
    const allFiles = [...files, ...extraFiles];

    for (const rel of allFiles) {
        assertSafeRelativePath(rel);

        const src = path.join(repoRoot, rel);
        const dst = path.join(tmpRoot, rel);
        await mkdir(path.dirname(dst), { recursive: true });

        try {
            await cp(src, dst, { recursive: true });
        } catch (err) {
            err.message = `Failed to copy runtime fixture file ${rel}: ${err.message}`;
            throw err;
        }
    }

    return tmpRoot;
}
