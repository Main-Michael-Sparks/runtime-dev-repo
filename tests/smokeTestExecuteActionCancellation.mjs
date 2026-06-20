// smokeTestExecuteActionCancellation.mjs
//
// Purpose:
// - Behavior smoke for action-level executeAction cancellation.
// - Validates that cancelAction(actionId) remains a thin mapping over the
//   existing request cancellation path instead of adding a second worker path.
//
// Run:
//   node ./tests/smokeTestExecuteActionCancellation.mjs
//
// Real runtime mode:
//   REAL_RUNTIME=1 node ./tests/smokeTestExecuteActionCancellation.mjs

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

import {
    assertCapabilityBusExecuteActionPlan,
    cancelActionRequest,
    createActionRequestRegistry,
    createDefaultExecuteActionRegistries,
    getActionRequest,
    normalizeCapabilityBusExecuteActionOrchestrationDescriptor,
    releaseActionRequest,
    runExecuteActionDispatch,
    validateCapabilityBusExecuteActionOutcomeDescriptor
} from "../runtime/bus/executeAction/capabilityBusExecuteActionContract.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const REAL_RUNTIME = process.env.REAL_RUNTIME === "1";

function fail(message) {
    throw new Error(`[FAIL] ${message}`);
}

function ok(message) {
    console.log(`[OK] ${message}`);
}

function assert(condition, message) {
    if (!condition) fail(message);
}

async function readSource(relativePath) {
    return fs.readFile(path.join(repoRoot, relativePath), "utf8");
}

async function assertRejects(label, fn, expectedFragment = null) {
    try {
        await fn();
        fail(`${label} should reject`);
    } catch (err) {
        if (String(err.message).startsWith("[FAIL]")) throw err;

        if (expectedFragment && !String(err.message).includes(expectedFragment)) {
            fail(`${label} rejected with unexpected message: ${err.message}`);
        }

        ok(`${label} rejected as expected`);
        return err;
    }
}

function createActionEnvelope(overrides = {}) {
    return {
        actionId: "act_cancel_action_1",
        runId: "run_cancel_action_1",
        source: {
            kind: "direct-api"
        },
        capability: "text.generate",
        intent: "execute_cognitive_node",
        input: {
            prompt: "Write a long explanation of recursion.",
            contextRefs: ["ctx_cancel_action_1"]
        },
        requirements: {
            modelClass: "reasoning-7b",
            contextNeed: "medium",
            stream: true,
            timeoutMs: 60000
        },
        policy: {
            maxTokens: 256,
            approvalRequired: false,
            allowTools: false,
            budget: {
                tokens: 256
            }
        },
        trace: {
            operator: "execute-action-cancellation-smoke"
        },
        ...overrides
    };
}

function createOrchestration(overrides = {}) {
    const registries = createDefaultExecuteActionRegistries();
    const plan = assertCapabilityBusExecuteActionPlan(createActionEnvelope(overrides), registries);
    return normalizeCapabilityBusExecuteActionOrchestrationDescriptor(plan);
}

function assertValidOutcome(outcome, expectedStatus) {
    const validation = validateCapabilityBusExecuteActionOutcomeDescriptor(outcome);
    assert(validation.ok, `outcome should validate: ${JSON.stringify(validation.errors)}`);
    assert(outcome.resultEnvelope.status === expectedStatus, `expected outcome status ${expectedStatus}, got ${outcome.resultEnvelope.status}`);
}

function createControlledDone() {
    let resolveDone;
    let rejectDone;
    const done = new Promise((resolve, reject) => {
        resolveDone = resolve;
        rejectDone = reject;
    });

    done.catch(() => {});

    return {
        done,
        resolveDone,
        rejectDone
    };
}

async function assertRegistryBasics() {
    const registry = createActionRequestRegistry();

    assert(getActionRequest(registry, "missing") === null, "missing action should not have a record");
    assert(cancelActionRequest(registry, "", () => true) === false, "empty actionId should not cancel");
    assert(cancelActionRequest(registry, "   ", () => true) === false, "whitespace actionId should not cancel");
    assert(cancelActionRequest(registry, null, () => true) === false, "non-string actionId should not cancel");
    assert(cancelActionRequest(registry, "missing", () => true) === false, "unknown action should not cancel");
    ok("registry returns false for invalid or unknown action IDs");
}

async function assertCancelDelegatesToRequestCancellation() {
    const registry = createActionRequestRegistry();
    const controlled = createControlledDone();
    let cancelRequestId = null;
    let cancelOptions = null;

    const handle = await runExecuteActionDispatch(createActionEnvelope(), {
        actionRequests: registry,
        async runNativeTextRequest(text, options) {
            assert(text.includes("recursion"), "prompt text should reach native request seam");
            assert(options.stream === true, "stream option should pass through");

            return {
                id: 701,
                stream: { mockStream: true },
                done: controlled.done
            };
        }
    });

    const record = getActionRequest(registry, handle.actionId);
    assert(record?.state === "bound", "action should be bound after backend handle creation");
    assert(record.requestId === 701, "bound action requestId mismatch");

    const cancelled = cancelActionRequest(registry, handle.actionId, (requestId, options) => {
        cancelRequestId = requestId;
        cancelOptions = options;
        controlled.rejectDone(new Error("Prompt canceled"));
        return true;
    }, {
        reason: "Action canceled"
    });

    assert(cancelled === true, "cancelActionRequest should return true for active bound action");
    assert(cancelRequestId === 701, "cancelActionRequest should delegate by requestId");
    assert(cancelOptions.actionId === handle.actionId, "cancel delegate should receive actionId metadata");
    assert(cancelOptions.reason === "Action canceled", "cancel delegate should receive cancellation reason");

    const outcome = await handle.done;
    assertValidOutcome(outcome, "cancelled");
    assert(getActionRequest(registry, handle.actionId) === null, "registry should release cancelled action after done settles");
    ok("cancelActionRequest delegates to existing request cancellation and maps done to cancelled outcome");
}

async function assertCompletedActionReleasesRegistryEntry() {
    const registry = createActionRequestRegistry();
    const controlled = createControlledDone();
    const handle = await runExecuteActionDispatch(createActionEnvelope({
        actionId: "act_cancel_action_complete_1"
    }), {
        actionRequests: registry,
        async runNativeTextRequest() {
            return {
                id: 702,
                stream: null,
                done: controlled.done
            };
        }
    });

    assert(getActionRequest(registry, handle.actionId)?.requestId === 702, "completed test should bind requestId");
    controlled.resolveDone("completed after action registry bind");

    const outcome = await handle.done;
    assertValidOutcome(outcome, "completed");
    assert(getActionRequest(registry, handle.actionId) === null, "registry should release completed action after done settles");
    ok("registry releases completed actions after outcome settlement");
}

async function assertFailedAdapterReleasesReservation() {
    const registry = createActionRequestRegistry();
    const actionId = "act_cancel_action_adapter_fail_1";

    await assertRejects(
        "adapter failure after reservation",
        () => runExecuteActionDispatch(createActionEnvelope({ actionId }), {
            actionRequests: registry,
            async runNativeTextRequest() {
                throw new Error("mock adapter request failed");
            }
        }),
        "mock adapter request failed"
    );

    assert(getActionRequest(registry, actionId) === null, "reservation should release when adapter creation fails");
    ok("registry releases reservations after adapter creation failure");
}

async function assertDuplicateActiveActionRejectsBeforeBackendRequestCreation() {
    const registry = createActionRequestRegistry();
    const controlled = createControlledDone();
    const actionId = "act_cancel_action_duplicate_1";
    let requestCount = 0;

    const firstHandle = await runExecuteActionDispatch(createActionEnvelope({ actionId }), {
        actionRequests: registry,
        async runNativeTextRequest() {
            requestCount++;
            return {
                id: 703,
                stream: null,
                done: controlled.done
            };
        }
    });

    const err = await assertRejects(
        "duplicate active actionId",
        () => runExecuteActionDispatch(createActionEnvelope({ actionId }), {
            actionRequests: registry,
            async runNativeTextRequest() {
                requestCount++;
                fail("duplicate active action should not create a backend request");
            }
        }),
        `Active action already registered: ${actionId}`
    );

    assert(err.code === "duplicate_active_action_id", "duplicate error code mismatch");
    assert(requestCount === 1, "duplicate active action should reject before backend request creation");

    controlled.resolveDone("first duplicate action completed");
    await firstHandle.done;
    assert(getActionRequest(registry, actionId) === null, "first duplicate action should release after completion");
    ok("duplicate active actionId rejects before backend request creation");
}

async function assertAcceptedOrchestrationPathStillSupportsRegistry() {
    const registry = createActionRequestRegistry();
    const controlled = createControlledDone();
    const orchestration = createOrchestration({
        actionId: "act_cancel_action_orchestration_1",
        runId: "run_cancel_action_orchestration_1"
    });

    const handle = await runExecuteActionDispatch(orchestration, {
        actionRequests: registry,
        async runNativeTextRequest() {
            return {
                id: 704,
                stream: null,
                done: controlled.done
            };
        }
    });

    assert(getActionRequest(registry, handle.actionId)?.requestId === 704, "orchestration path should bind registry entry");
    controlled.resolveDone("accepted orchestration cancellation registry path completed");

    const outcome = await handle.done;
    assertValidOutcome(outcome, "completed");
    ok("accepted orchestration descriptor path supports action request registry");
}

async function assertUnknownBoundActionCannotCancelAfterRelease() {
    const registry = createActionRequestRegistry();
    const actionId = "act_cancel_action_release_1";

    releaseActionRequest(registry, actionId);
    assert(cancelActionRequest(registry, actionId, () => true) === false, "released action should not cancel");
    ok("released or unknown action IDs return false from cancellation helper");
}

async function assertRuntimePublicSurfaceMarkers() {
    const runtimeSource = await readSource("runtime.mjs");

    assert(runtimeSource.includes("export function cancelAction(actionId)"), "runtime.mjs should export cancelAction(actionId)");
    assert(runtimeSource.includes("createActionRequestRegistry"), "runtime.mjs should create action request registry");
    assert(runtimeSource.includes("cancelActionRequest(actionRequests, actionId, cancelPrompt"), "cancelAction should delegate through cancelPrompt");
    assert(runtimeSource.includes("runNativeTextRequest,\n        actionRequests"), "executeAction should inject actionRequests with runNativeTextRequest");
    ok("runtime public cancelAction source markers are present");
}

async function assertSourceBoundaries() {
    const registrySource = await readSource("runtime/bus/executeAction/actionRequestRegistry.mjs");
    const seamSource = await readSource("runtime/bus/executeAction/capabilityBusExecuteActionExecution.mjs");
    const runtimeSource = await readSource("runtime.mjs");
    const nativeBackendSource = await readSource("runtime/backends/nativeWorker/nativeWorkerBackendExecution.mjs");

    for (const marker of ["runtime.mjs", "workerBridge", "llama_worker", "scheduler.mjs", "streamController", "node-llama-cpp"]) {
        assert(!registrySource.includes(marker), `actionRequestRegistry should not include ${marker}`);
    }

    for (const marker of ["workerBridge", "llama_worker", "createScheduler(", "sendToWorker({"] ) {
        assert(!seamSource.includes(marker), `execute-action execution seam should not include ${marker}`);
    }

    for (const marker of ["./llama_worker/", "../llama_worker/", "node-llama-cpp"]) {
        assert(!runtimeSource.includes(marker), `runtime.mjs should not include ${marker}`);
    }

    for (const marker of ["runtime.mjs", "workerBridge", "llama_worker"]) {
        assert(!nativeBackendSource.includes(marker), `nativeWorkerBackendExecution should not include ${marker}`);
    }

    ok("action cancellation source-boundary guards passed");
}

async function assertRealRuntimeCancelAction() {
    if (!REAL_RUNTIME) {
        console.log("[SKIP] REAL_RUNTIME=1 not set; skipping action-level real runtime cancellation smoke");
        return;
    }

    const runtime = await import("../runtime.mjs");
    const handle = await runtime.executeAction(createActionEnvelope({
        actionId: "act_cancel_action_real_1",
        input: {
            prompt: "Write a very long explanation of recursion, cancellation, queues, workers, and streaming.",
            contextRefs: ["ctx_cancel_action_real_1"]
        },
        policy: {
            maxTokens: 512,
            approvalRequired: false,
            allowTools: false,
            budget: {
                tokens: 512
            }
        }
    }));

    const cancelled = runtime.cancelAction(handle.actionId);
    assert(cancelled === true, "REAL_RUNTIME cancelAction should return true for active action");

    const outcome = await handle.done;
    assertValidOutcome(outcome, "cancelled");
    await runtime.shutdownRuntime({ mode: "abort" });
    ok("REAL_RUNTIME cancelAction text.generate completed with cancelled outcome");
}

async function main() {
    console.log("[SMOKE] executeAction action-level cancellation");

    await assertRegistryBasics();
    await assertCancelDelegatesToRequestCancellation();
    await assertCompletedActionReleasesRegistryEntry();
    await assertFailedAdapterReleasesReservation();
    await assertDuplicateActiveActionRejectsBeforeBackendRequestCreation();
    await assertAcceptedOrchestrationPathStillSupportsRegistry();
    await assertUnknownBoundActionCannotCancelAfterRelease();
    await assertRuntimePublicSurfaceMarkers();
    await assertSourceBoundaries();
    await assertRealRuntimeCancelAction();

    console.log("\nAll executeAction action-level cancellation smoke tests finished.");
}

main().catch((err) => {
    console.error(err.message || err);
    process.exitCode = 1;
});
