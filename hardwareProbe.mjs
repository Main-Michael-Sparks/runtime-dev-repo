import os from "os";

function bytesToSafeInteger(value) {
    if (!Number.isFinite(value) || value < 0) return 0;
    return Math.floor(value);
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

export async function probeHardware(options = {}) {
    const warnings = [];

    let logicalThreads = 1;
    let totalBytes = 0;
    let freeBytes = 0;

    try {
        const cpus = os.cpus();
        logicalThreads = Array.isArray(cpus) && cpus.length > 0 ? cpus.length : 1;
    } catch (err) {
        warnings.push(`CPU probe failed: ${err?.message ?? String(err)}`);
    }

    try {
        totalBytes = bytesToSafeInteger(os.totalmem());
        freeBytes = bytesToSafeInteger(os.freemem());
    } catch (err) {
        warnings.push(`Memory probe failed: ${err?.message ?? String(err)}`);
    }

    const recommendedThreads = clamp(
        Math.max(1, logicalThreads - 1),
        1,
        Math.max(1, logicalThreads)
    );

    const safeBudgetBytes = totalBytes > 0
        ? bytesToSafeInteger(Math.min(freeBytes, totalBytes * 0.5))
        : 0;

    if (options?.gpu === true) {
        warnings.push("GPU probing is not implemented in hardwareProbe v1; assuming CPU/RAM-only profile data");
    }

    return {
        platform: process.platform,
        arch: process.arch,
        cpu: {
            logicalThreads,
            recommendedThreads
        },
        memory: {
            totalBytes,
            freeBytes,
            safeBudgetBytes
        },
        gpu: {
            available: false,
            vendor: null,
            vramBytes: null,
            source: "not-probed-v1",
            confidence: "none"
        },
        warnings
    };
}
