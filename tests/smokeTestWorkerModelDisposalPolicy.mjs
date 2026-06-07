// smokeTestWorkerModelDisposalPolicy.mjs
//
// Purpose:
// - Direct smoke coverage for the worker-side model disposal policy used by terminal shutdown.
// - Verifies terminal shutdown can abandon a non-settling model.dispose() without changing
//   reusable reset-model disposal semantics.

import assert from "node:assert/strict";
import {
    disposeModelWithPolicy,
    resolveModelDisposalPolicy,
    TERMINAL_SHUTDOWN_MODEL_DISPOSE_TIMEOUT_MS
} from "../llama_worker/lifecycle/modelDisposalPolicy.mjs";

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function modeMissingModelCompletesWithoutAttempt() {
    const policy = resolveModelDisposalPolicy({ operation: "shutdown" });
    const outcome = await disposeModelWithPolicy({ model: null, policy });

    assert.deepEqual(outcome, {
        attempted: false,
        completed: true,
        timedOut: false,
        abandoned: false,
        timeoutMs: null,
        reason: "model-already-disposed-or-missing"
    });

    console.log("[OK] missing model completed without dispose attempt");
}

async function modeReusablePolicyAwaitsDispose() {
    let disposed = false;

    const policy = resolveModelDisposalPolicy({ operation: "reset_model" });
    const outcome = await disposeModelWithPolicy({
        policy,
        model: {
            disposed: false,
            async dispose() {
                await sleep(10);
                disposed = true;
                this.disposed = true;
            }
        }
    });

    assert.equal(disposed, true);
    assert.equal(outcome.attempted, true);
    assert.equal(outcome.completed, true);
    assert.equal(outcome.timedOut, false);
    assert.equal(outcome.abandoned, false);
    assert.equal(outcome.reason, "model-dispose-completed");

    console.log("[OK] reusable policy awaited model.dispose()");
}

async function modeReusablePolicyPropagatesDisposeError() {
    const policy = resolveModelDisposalPolicy({ operation: "reset_model" });

    await assert.rejects(
        () => disposeModelWithPolicy({
            policy,
            model: {
                disposed: false,
                async dispose() {
                    throw new Error("mock dispose failure");
                }
            }
        }),
        /mock dispose failure/
    );

    console.log("[OK] reusable policy propagated model.dispose() error");
}

async function modeTerminalPolicyCompletesWhenDisposeSettles() {
    const policy = resolveModelDisposalPolicy({
        operation: "shutdown",
        terminalShutdownModelDisposeTimeoutMs: 100
    });

    let disposed = false;
    const outcome = await disposeModelWithPolicy({
        policy,
        model: {
            disposed: false,
            async dispose() {
                await sleep(5);
                disposed = true;
                this.disposed = true;
            }
        }
    });

    assert.equal(disposed, true);
    assert.equal(outcome.attempted, true);
    assert.equal(outcome.completed, true);
    assert.equal(outcome.timedOut, false);
    assert.equal(outcome.abandoned, false);
    assert.equal(outcome.reason, "model-dispose-completed");

    console.log("[OK] terminal policy completed when model.dispose() settled before bound");
}

async function modeTerminalPolicyAbandonsNonSettlingDispose() {
    const policy = resolveModelDisposalPolicy({
        operation: "shutdown",
        terminalShutdownModelDisposeTimeoutMs: 10
    });

    const model = {
        disposed: false,
        async dispose() {
            this.disposed = true;
            await new Promise(() => {});
        }
    };

    const outcome = await disposeModelWithPolicy({ model, policy });

    assert.equal(model.disposed, true);
    assert.deepEqual(outcome, {
        attempted: true,
        completed: false,
        timedOut: true,
        abandoned: true,
        timeoutMs: 10,
        reason: "terminal-shutdown-model-dispose-timeout"
    });

    console.log("[OK] terminal policy abandoned non-settling model.dispose() after bound");
}

async function modeProductionShutdownPolicyUsesInternalBound() {
    const policy = resolveModelDisposalPolicy({ operation: "shutdown" });

    assert.equal(policy.operation, "shutdown");
    assert.equal(policy.abandonOnTimeout, true);
    assert.equal(policy.timeoutMs, TERMINAL_SHUTDOWN_MODEL_DISPOSE_TIMEOUT_MS);
    assert.equal(policy.timeoutMs, 5000);

    console.log("[OK] production shutdown policy uses 5000ms internal bound");
}

async function main() {
    await modeMissingModelCompletesWithoutAttempt();
    await modeReusablePolicyAwaitsDispose();
    await modeReusablePolicyPropagatesDisposeError();
    await modeTerminalPolicyCompletesWhenDisposeSettles();
    await modeTerminalPolicyAbandonsNonSettlingDispose();
    await modeProductionShutdownPolicyUsesInternalBound();

    console.log("\nAll worker model disposal policy smoke tests passed.");
}

main().catch((err) => {
    console.error("\n[SMOKE TEST FAILURE]");
    console.error(err);
    process.exitCode = 1;
});
