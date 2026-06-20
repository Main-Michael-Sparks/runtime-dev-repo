// smokeTestNativeWorkerBackendExecutionIntegration.mjs
//
// Purpose:
// - Contract/behavior smoke for the first execute-action behavior seam.
// - Validates that an accepted execute-action orchestration descriptor can be
//   dispatched to nativeWorkerBackend execution through an injected runtime
//   substrate helper without importing workerBridge or llama_worker directly.
//
// Run:
//   node ./tests/smokeTestNativeWorkerBackendExecutionIntegration.mjs
//
// Real runtime mode:
//   REAL_RUNTIME=1 node ./tests/smokeTestNativeWorkerBackendExecutionIntegration.mjs

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

import {
    CAPABILITY_REGISTRY_SCHEMA_VERSION
} from "../runtime/bus/capabilityRegistryContract.mjs";
import {
    CAPABILITY_ROUTER_CONTRACT_VERSION
} from "../runtime/router/capabilityRouterContract.mjs";
import {
    CAPABILITY_SERVICE_CONTRACT_VERSION,
    CAPABILITY_SERVICE_REGISTRY_SCHEMA_VERSION
} from "../runtime/bus/capabilityServiceContract.mjs";
import {
    BACKEND_ADAPTER_REGISTRY_SCHEMA_VERSION
} from "../runtime/backends/backendAdapterContract.mjs";
import {
    assertCapabilityBusExecuteActionPlan,
    normalizeCapabilityBusExecuteActionOrchestrationDescriptor,
    runExecuteAction,
    validateCapabilityBusExecuteActionOutcomeDescriptor
} from "../runtime/bus/executeAction/capabilityBusExecuteActionContract.mjs";
import {
    runNativeWorkerAction
} from "../runtime/backends/nativeWorker/nativeWorkerBackendContract.mjs";

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

function assertRejects(label, fn, expectedFragment) {
    return fn()
        .then(() => fail(`${label} should reject`))
        .catch((err) => {
            if (String(err.message).startsWith("[FAIL]")) throw err;
            if (expectedFragment && !String(err.message).includes(expectedFragment)) {
                fail(`${label} rejected with unexpected message: ${err.message}`);
            }
            ok(`${label} rejected as expected`);
            return err;
        });
}

async function readSource(relativePath) {
    return fs.readFile(path.join(repoRoot, relativePath), "utf8");
}

function createActionEnvelope(overrides = {}) {
    return {
        actionId: "act_native_exec_1",
        runId: "run_native_exec_1",
        source: {
            kind: "direct-api"
        },
        capability: "text.generate",
        intent: "execute_cognitive_node",
        input: {
            prompt: "Say hello briefly.",
            contextRefs: ["ctx_native_exec_1"]
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
            operator: "native-worker-backend-execution-smoke"
        },
        ...overrides
    };
}

function createCapabilityDefinition({ capability = "text.generate", backendKind = "nativeWorkerBackend" } = {}) {
    return {
        capability,
        version: "v1",
        status: "contract-only",
        summary: `Capability definition for ${capability}.`,
        contracts: {
            action: "actionEnvelope.v1",
            result: "resultEnvelope.v1",
            event: "actionEvent.v1"
        },
        requirements: {
            streaming: "supported",
            cancellation: "supported",
            timeout: "supported",
            approval: "conditional"
        },
        policy: {
            maxTokens: true,
            approvalRequired: true,
            allowTools: false,
            budget: true
        },
        compatibility: {
            backendKinds: [backendKind],
            modelBundleRequired: true,
            contextRefs: true
        }
    };
}

function createCapabilityRegistry(options = {}) {
    return {
        schemaVersion: CAPABILITY_REGISTRY_SCHEMA_VERSION,
        capabilities: [createCapabilityDefinition(options)]
    };
}

function createRoute({ capability = "text.generate", serviceId = "text.generate.default", backendKind = "nativeWorkerBackend", backendId = "native-worker.default" } = {}) {
    return {
        routeId: `${capability}-route`,
        capability,
        status: "contract-only",
        serviceId,
        backendKind,
        backendId,
        modelBundleId: "mistral-text-local",
        hardwareProfileId: "laptopFallback",
        requirements: {
            streaming: "supported",
            cancellation: "supported",
            timeout: "supported"
        }
    };
}

function createRouterRegistry(options = {}) {
    return {
        schemaVersion: CAPABILITY_ROUTER_CONTRACT_VERSION,
        routes: [createRoute(options)]
    };
}

function createService({ capability = "text.generate", serviceId = "text.generate.default", backendKind = "nativeWorkerBackend" } = {}) {
    return {
        serviceId,
        capability,
        version: "v1",
        status: "contract-only",
        summary: `Service definition for ${capability}.`,
        contracts: {
            action: "actionEnvelope.v1",
            result: "resultEnvelope.v1",
            event: "actionEvent.v1"
        },
        input: {
            schema: `${capability}.input.v1`,
            requiredFields: ["prompt"],
            optionalFields: ["contextRefs"],
            contextRefs: "supported"
        },
        result: {
            schema: `${capability}.result.v1`,
            outputFields: ["text"],
            streamingDeltas: "supported"
        },
        requirements: {
            streaming: "supported",
            cancellation: "supported",
            timeout: "supported",
            approval: "conditional"
        },
        compatibility: {
            backendKinds: [backendKind],
            modelBundleRequired: true,
            hardwareProfileRequired: true
        }
    };
}

function createServiceRegistry(options = {}) {
    return {
        schemaVersion: CAPABILITY_SERVICE_REGISTRY_SCHEMA_VERSION,
        services: [createService(options)]
    };
}

function createAdapter({ capability = "text.generate", serviceId = "text.generate.default", backendKind = "nativeWorkerBackend", adapterId = "native-worker.default" } = {}) {
    return {
        adapterId,
        backendKind,
        version: "v1",
        status: "contract-only",
        summary: `Backend adapter descriptor for ${backendKind}.`,
        capabilities: [capability],
        services: [serviceId],
        contracts: {
            servicePlan: CAPABILITY_SERVICE_CONTRACT_VERSION,
            result: "resultEnvelope.v1",
            event: "actionEvent.v1"
        },
        result: {
            schema: `${capability}.result.v1`,
            outputFields: ["text"],
            streamingDeltas: "supported",
            errorNormalization: "supported"
        },
        requirements: {
            streaming: "supported",
            cancellation: "supported",
            timeout: "supported"
        },
        compatibility: {
            backendKind,
            modelBundleRequired: true,
            hardwareProfileRequired: true
        }
    };
}

function createBackendAdapterRegistry(options = {}) {
    return {
        schemaVersion: BACKEND_ADAPTER_REGISTRY_SCHEMA_VERSION,
        adapters: [createAdapter(options)]
    };
}

function createOrchestrationDescriptor(options = {}) {
    const capability = options.capability ?? "text.generate";
    const serviceId = options.serviceId ?? `${capability}.default`;
    const backendKind = options.backendKind ?? "nativeWorkerBackend";
    const adapterId = options.adapterId ?? "native-worker.default";
    const actionEnvelope = createActionEnvelope({
        capability,
        input: {
            prompt: options.prompt ?? "Say hello briefly.",
            contextRefs: ["ctx_native_exec_1"]
        },
        requirements: {
            modelClass: "reasoning-7b",
            contextNeed: "medium",
            stream: options.stream ?? true,
            timeoutMs: 60000
        }
    });
    const executeActionPlan = assertCapabilityBusExecuteActionPlan(actionEnvelope, {
        capabilityRegistry: createCapabilityRegistry({ capability, backendKind }),
        routerRegistry: createRouterRegistry({ capability, serviceId, backendKind, backendId: adapterId }),
        serviceRegistry: createServiceRegistry({ capability, serviceId, backendKind }),
        backendAdapterRegistry: createBackendAdapterRegistry({ capability, serviceId, backendKind, adapterId })
    });

    return normalizeCapabilityBusExecuteActionOrchestrationDescriptor(executeActionPlan);
}

function assertValidOutcome(outcome, expectedStatus) {
    const validation = validateCapabilityBusExecuteActionOutcomeDescriptor(outcome);
    assert(validation.ok, `outcome should validate: ${JSON.stringify(validation.errors)}`);
    assert(outcome.resultEnvelope.status === expectedStatus, `expected outcome status ${expectedStatus}, got ${outcome.resultEnvelope.status}`);
}

async function assertMockCompletedExecution() {
    const descriptor = createOrchestrationDescriptor();
    const calls = [];
    const handle = await runExecuteAction(descriptor, {
        async runNativeTextRequest(text, options) {
            calls.push({ text, options });
            return {
                id: 77,
                stream: options.stream ? { mockStream: true } : null,
                done: Promise.resolve("hello from mock runtime")
            };
        }
    }, {
        sessionId: "mock-session"
    });

    assert(handle.actionId === "act_native_exec_1", "handle actionId mismatch");
    assert(handle.requestId === 77, "handle requestId mismatch");
    assert(handle.backend.kind === "nativeWorkerBackend", "handle backend kind mismatch");
    assert(handle.stream?.mockStream === true, "handle stream mismatch");
    assertValidOutcome(handle.startedOutcome, "running");
    assert(calls.length === 1, "runNativeTextRequest should be called once");
    assert(calls[0].text === "Say hello briefly.", "prompt extraction mismatch");
    assert(calls[0].options.sessionId === "mock-session", "sessionId injection mismatch");
    assert(calls[0].options.stream === true, "stream option should come from invocation");

    const completed = await handle.done;
    assertValidOutcome(completed, "completed");
    assert(completed.resultEnvelope.result.text === "hello from mock runtime", "completed text mismatch");
    ok("accepted orchestration dispatched to mock nativeWorkerBackend completion");
}

async function assertMockFailedExecution() {
    const descriptor = createOrchestrationDescriptor();
    const handle = await runExecuteAction(descriptor, {
        async runNativeTextRequest() {
            return {
                id: 78,
                stream: null,
                done: Promise.reject(new Error("mock runtime failure"))
            };
        }
    });

    const failed = await handle.done;
    assertValidOutcome(failed, "failed");
    assert(failed.resultEnvelope.error.message === "mock runtime failure", "failed error mismatch");
    ok("runtime rejection maps to failed outcome");
}

async function assertMockCancelledExecution() {
    const descriptor = createOrchestrationDescriptor();
    const handle = await runExecuteAction(descriptor, {
        async runNativeTextRequest() {
            return {
                id: 79,
                stream: null,
                done: Promise.reject(new Error("Prompt canceled"))
            };
        }
    });

    const cancelled = await handle.done;
    assertValidOutcome(cancelled, "cancelled");
    assert(cancelled.resultEnvelope.cancellationReason === "Prompt canceled", "cancel reason mismatch");
    ok("prompt cancellation-like rejection maps to cancelled outcome");
}

async function assertUnsupportedBackendRejects() {
    const descriptor = createOrchestrationDescriptor({
        backendKind: "mockBackend",
        adapterId: "mock.default"
    });

    await assertRejects(
        "unsupported backendKind",
        () => runExecuteAction(descriptor, {
            async runNativeTextRequest() {
                fail("unsupported backend should not call runNativeTextRequest");
            }
        }),
        "Unsupported execute-action backendKind"
    );
}

async function assertUnsupportedCapabilityRejects() {
    const descriptor = createOrchestrationDescriptor({
        capability: "text.embed",
        serviceId: "text.embed.default",
        backendKind: "nativeWorkerBackend",
        adapterId: "native-worker.default"
    });

    await assertRejects(
        "unsupported nativeWorkerBackend capability",
        () => runNativeWorkerAction(descriptor, {
            async runNativeTextRequest() {
                fail("unsupported capability should not call runNativeTextRequest");
            }
        }),
        "nativeWorkerBackend execution supports text.generate only"
    );
}

async function assertMissingPromptRejects() {
    const descriptor = createOrchestrationDescriptor({ prompt: "" });

    await assertRejects(
        "missing prompt",
        () => runNativeWorkerAction(descriptor, {
            async runNativeTextRequest() {
                fail("missing prompt should not call runNativeTextRequest");
            }
        }),
        "requires input.prompt"
    );
}

async function assertSourceGuards() {
    const backendSource = await readSource("runtime/backends/nativeWorker/nativeWorkerBackendExecution.mjs");
    const seamSource = await readSource("runtime/bus/executeAction/capabilityBusExecuteActionExecution.mjs");
    const runtimeSource = await readSource("runtime.mjs");

    const forbiddenBackendMarkers = [
        "runtime.mjs",
        "workerBridge",
        "llama_worker",
        "createScheduler",
        "streamController"
    ];
    for (const marker of forbiddenBackendMarkers) {
        assert(!backendSource.includes(marker), `nativeWorkerBackendExecution should not include ${marker}`);
    }

    for (const marker of ["workerBridge", "llama_worker", "createScheduler("]) {
        assert(!seamSource.includes(marker), `execute-action seam should not include ${marker}`);
    }

    assert(runtimeSource.includes("async function runNativeTextRequest"), "runtime.mjs should define runNativeTextRequest");
    assert(runtimeSource.includes("return runNativeTextRequest(text, options);"), "prompt should delegate to runNativeTextRequest");
    assert(runtimeSource.includes("export async function executeAction"), "runtime.mjs should expose executeAction");
    assert(runtimeSource.includes("runExecuteActionDispatch(actionInput"), "executeAction should route through dispatch explicitly");
    assert(runtimeSource.includes("runNativeTextRequest,\n        actionRequests"), "executeAction should inject runNativeTextRequest and actionRequests through dispatch explicitly");
    ok("source guards for modular import direction passed");
}

async function assertRealRuntimeExecution() {
    if (!REAL_RUNTIME) {
        console.log("[SKIP] REAL_RUNTIME=1 not set; skipping native model execution smoke");
        return;
    }

    const runtime = await import("../runtime.mjs");
    const descriptor = createOrchestrationDescriptor({ stream: false });
    const handle = await runtime.executeAction(descriptor, {
        stream: false
    });
    const outcome = await handle.done;

    assertValidOutcome(outcome, "completed");
    assert(typeof outcome.resultEnvelope.result.text === "string", "real runtime text result should be a string");
    assert(outcome.resultEnvelope.result.text.length > 0, "real runtime text result should not be empty");
    await runtime.shutdownRuntime({ mode: "abort" });
    ok("REAL_RUNTIME executeAction text.generate completed");
}

async function main() {
    console.log("[SMOKE] nativeWorkerBackend execution integration");

    await assertMockCompletedExecution();
    await assertMockFailedExecution();
    await assertMockCancelledExecution();
    await assertUnsupportedBackendRejects();
    await assertUnsupportedCapabilityRejects();
    await assertMissingPromptRejects();
    await assertSourceGuards();
    await assertRealRuntimeExecution();

    console.log("\nAll nativeWorkerBackend execution integration smoke tests finished.");
}

main().catch((err) => {
    console.error(err.stack || err.message || err);
    process.exitCode = 1;
});
