// smokeTestExecuteActionPublicEnvelopeDispatch.mjs
//
// Purpose:
// - Behavior smoke for public executeAction raw action-envelope dispatch.
// - Validates that raw envelopes compose through the existing
//   action/bus/router/service/backend/execution/orchestration chain and then
//   use the existing execute-action runtime seam.
//
// Run:
//   node ./tests/smokeTestExecuteActionPublicEnvelopeDispatch.mjs
//
// Real runtime mode:
//   REAL_RUNTIME=1 node ./tests/smokeTestExecuteActionPublicEnvelopeDispatch.mjs

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

import {
    assertCapabilityBusExecuteActionPlan,
    createDefaultExecuteActionRegistries,
    looksLikeRawActionEnvelope,
    normalizeCapabilityBusExecuteActionOrchestrationDescriptor,
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
        actionId: "act_public_dispatch_1",
        runId: "run_public_dispatch_1",
        source: {
            kind: "direct-api"
        },
        capability: "text.generate",
        intent: "execute_cognitive_node",
        input: {
            prompt: "Say hello briefly.",
            contextRefs: ["ctx_public_dispatch_1"]
        },
        requirements: {
            modelClass: "reasoning-7b",
            contextNeed: "medium",
            stream: true,
            timeoutMs: 60000
        },
        policy: {
            maxTokens: 128,
            approvalRequired: false,
            allowTools: false,
            budget: {
                tokens: 128
            }
        },
        trace: {
            operator: "public-envelope-dispatch-smoke"
        },
        ...overrides
    };
}

function assertValidOutcome(outcome, expectedStatus) {
    const validation = validateCapabilityBusExecuteActionOutcomeDescriptor(outcome);
    assert(validation.ok, `outcome should validate: ${JSON.stringify(validation.errors)}`);
    assert(outcome.resultEnvelope.status === expectedStatus, `expected outcome status ${expectedStatus}, got ${outcome.resultEnvelope.status}`);
}

async function assertRawEnvelopeDispatchCompletes() {
    const calls = [];
    const handle = await runExecuteActionDispatch(createActionEnvelope(), {
        async runNativeTextRequest(text, options) {
            calls.push({ text, options });
            return {
                id: 107,
                stream: options.stream ? { mockStream: true } : null,
                done: Promise.resolve("hello from public envelope dispatch")
            };
        }
    }, {
        sessionId: "public-dispatch-session"
    });

    assert(handle.actionId === "act_public_dispatch_1", "handle actionId mismatch");
    assert(handle.runId === "run_public_dispatch_1", "handle runId mismatch");
    assert(handle.capability === "text.generate", "handle capability mismatch");
    assert(handle.requestId === 107, "handle requestId mismatch");
    assert(handle.backend.kind === "nativeWorkerBackend", "backend kind mismatch");
    assert(handle.backend.adapterId === "native-worker.default", "backend adapter mismatch");
    assert(handle.backend.modelBundleId === "mistral-text-local", "model bundle mismatch");
    assert(handle.backend.hardwareProfileId === "laptopFallback", "hardware profile mismatch");
    assert(handle.stream?.mockStream === true, "mock stream mismatch");
    assertValidOutcome(handle.startedOutcome, "running");
    assert(calls.length === 1, "runNativeTextRequest should be called once");
    assert(calls[0].text === "Say hello briefly.", "prompt extraction mismatch");
    assert(calls[0].options.sessionId === "public-dispatch-session", "session option should pass through");
    assert(calls[0].options.stream === true, "stream option should come from action requirements");
    assert(calls[0].options.timeoutMs === 60000, "timeout option should come from action requirements");

    const completed = await handle.done;
    assertValidOutcome(completed, "completed");
    assert(completed.resultEnvelope.result.text === "hello from public envelope dispatch", "completed text mismatch");
    ok("raw action envelope dispatched through default registries to mock native execution");
}

async function assertAcceptedOrchestrationPathStillWorks() {
    const registries = createDefaultExecuteActionRegistries();
    const plan = assertCapabilityBusExecuteActionPlan(createActionEnvelope({
        actionId: "act_existing_orchestration_1",
        runId: "run_existing_orchestration_1"
    }), registries);
    const orchestration = normalizeCapabilityBusExecuteActionOrchestrationDescriptor(plan);
    const calls = [];
    const handle = await runExecuteActionDispatch(orchestration, {
        async runNativeTextRequest(text, options) {
            calls.push({ text, options });
            return {
                id: 108,
                stream: null,
                done: Promise.resolve("hello from existing orchestration")
            };
        }
    }, {
        stream: false
    });

    assert(handle.actionId === "act_existing_orchestration_1", "existing orchestration actionId mismatch");
    assert(calls.length === 1, "existing orchestration should call runNativeTextRequest once");

    const completed = await handle.done;
    assertValidOutcome(completed, "completed");
    assert(completed.resultEnvelope.result.text === "hello from existing orchestration", "existing orchestration result mismatch");
    ok("accepted orchestration descriptor path still delegates to existing execution seam");
}

async function assertRawValidationRejectsBeforeNativeRequest() {
    let callCount = 0;

    const err = await assertRejects(
        "forbidden raw action envelope",
        () => runExecuteActionDispatch(createActionEnvelope({
            backendOptions: {
                raw: true
            }
        }), {
            async runNativeTextRequest() {
                callCount++;
                fail("invalid raw envelope should not reach native request helper");
            }
        }),
        "Capability Bus execute-action contract validation failed"
    );

    assert(Array.isArray(err.validationErrors), "validation rejection should expose validationErrors");
    assert(
        err.validationErrors.some((entry) => entry.code.includes("forbidden_action_envelope_key")),
        `forbidden validation error missing: ${JSON.stringify(err.validationErrors)}`
    );
    assert(callCount === 0, "runNativeTextRequest should not be called for invalid raw envelope");
    ok("invalid raw envelope rejects before native request creation");
}

async function assertMissingPromptRejectsBeforeNativeRequest() {
    let callCount = 0;

    await assertRejects(
        "missing raw text prompt",
        () => runExecuteActionDispatch(createActionEnvelope({
            input: {
                prompt: "",
                contextRefs: ["ctx_public_dispatch_1"]
            }
        }), {
            async runNativeTextRequest() {
                callCount++;
                fail("missing prompt should not reach native request helper");
            }
        }),
        "requires input.prompt"
    );

    assert(callCount === 0, "runNativeTextRequest should not be called for missing prompt");
    ok("missing prompt rejects before native request creation");
}

function assertShapeDetection() {
    assert(looksLikeRawActionEnvelope(createActionEnvelope()), "valid raw action should be detected as raw envelope");
    assert(!looksLikeRawActionEnvelope({
        contractVersion: "capability-bus-execute-action-orchestration.v1",
        orchestration: {},
        boundary: {}
    }), "orchestration descriptor should not be detected as raw envelope");
    assert(!looksLikeRawActionEnvelope({
        contractVersion: "capability-bus-execute-action.v1",
        busAction: {},
        routePlan: {},
        executionPlan: {}
    }), "accepted execute-action plan should not be detected as raw envelope");
    ok("public dispatch shape detection stayed conservative");
}

async function assertSourceBoundaries() {
    const runtimeSource = await readSource("runtime.mjs");
    const dispatchSource = await readSource("runtime/bus/executeAction/capabilityBusExecuteActionDispatch.mjs");
    const defaultRegistrySource = await readSource("runtime/bus/executeAction/defaultExecuteActionRegistries.mjs");

    assert(runtimeSource.includes("runExecuteActionDispatch(actionInput"), "runtime.mjs should route executeAction through dispatch helper");
    assert(!runtimeSource.includes("runExecuteAction(orchestrationDescriptor"), "runtime.mjs should no longer hard-code orchestration-only dispatch");

    for (const marker of ["workerBridge", "llama_worker", "node-llama-cpp", "createScheduler(", "sendToWorker"]) {
        assert(!dispatchSource.includes(marker), `dispatch helper should not include ${marker}`);
        assert(!defaultRegistrySource.includes(marker), `default registry helper should not include ${marker}`);
    }

    assert(dispatchSource.includes("assertCapabilityBusExecuteActionPlan"), "dispatch helper should use execute-action plan validator");
    assert(dispatchSource.includes("normalizeCapabilityBusExecuteActionOrchestrationDescriptor"), "dispatch helper should normalize orchestration descriptor");
    assert(defaultRegistrySource.includes("createNativeWorkerBackendAdapterDefinition"), "default registry should use nativeWorkerBackend adapter definition");
    ok("public envelope dispatch source-boundary guards passed");
}

async function assertRealRuntimeRawEnvelopeDispatch() {
    if (!REAL_RUNTIME) {
        console.log("[SKIP] REAL_RUNTIME=1 not set; skipping public raw-envelope native model execution smoke");
        return;
    }

    const runtime = await import("../runtime.mjs");
    const handle = await runtime.executeAction(createActionEnvelope({
        requirements: {
            modelClass: "reasoning-7b",
            contextNeed: "medium",
            stream: false,
            timeoutMs: 60000
        }
    }), {
        stream: false
    });
    const outcome = await handle.done;

    assertValidOutcome(outcome, "completed");
    assert(typeof outcome.resultEnvelope.result.text === "string", "real runtime text result should be a string");
    assert(outcome.resultEnvelope.result.text.length > 0, "real runtime text result should not be empty");
    await runtime.shutdownRuntime({ mode: "abort" });
    ok("REAL_RUNTIME executeAction raw action envelope text.generate completed");
}

async function main() {
    console.log("[SMOKE] executeAction public envelope dispatch");

    assertShapeDetection();
    await assertRawEnvelopeDispatchCompletes();
    await assertAcceptedOrchestrationPathStillWorks();
    await assertRawValidationRejectsBeforeNativeRequest();
    await assertMissingPromptRejectsBeforeNativeRequest();
    await assertSourceBoundaries();
    await assertRealRuntimeRawEnvelopeDispatch();

    console.log("\nAll executeAction public envelope dispatch smoke tests finished.");
}

main().catch((err) => {
    console.error(err.stack || err.message || err);
    process.exitCode = 1;
});
