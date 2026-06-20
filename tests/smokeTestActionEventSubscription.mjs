// smokeTestActionEventSubscription.mjs
//
// Purpose:
// - Behavior smoke for Runtime Dev action event subscriptions.
// - Validates that live in-process subscriptions observe existing execute-action
//   outcome events without adding storage, replay, worker, scheduler, or backend
//   ownership.
//
// Run:
//   node ./tests/smokeTestActionEventSubscription.mjs

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

import {
    createActionEventSubscriptionRegistry,
    getActionEventSubscriberCount,
    publishActionEvent,
    subscribeActionEvents
} from "../runtime/bus/actionEventSubscriptionRegistry.mjs";
import {
    runExecuteActionDispatch,
    validateCapabilityBusExecuteActionOutcomeDescriptor
} from "../runtime/bus/executeAction/capabilityBusExecuteActionContract.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

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

function createActionEnvelope(overrides = {}) {
    return {
        actionId: "act_event_subscription_1",
        runId: "run_event_subscription_1",
        source: {
            kind: "direct-api"
        },
        capability: "text.generate",
        intent: "execute_cognitive_node",
        input: {
            prompt: "Say hello briefly.",
            contextRefs: ["ctx_event_subscription_1"]
        },
        requirements: {
            modelClass: "reasoning-7b",
            contextNeed: "medium",
            stream: false,
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
            operator: "action-event-subscription-smoke"
        },
        ...overrides
    };
}

function createActionEvent(overrides = {}) {
    return {
        eventId: "evt_subscription_1",
        actionId: "act_event_subscription_1",
        runId: "run_event_subscription_1",
        capability: "text.generate",
        type: "action.started",
        timestamp: 1,
        data: {
            source: "smoke-test"
        },
        ...overrides
    };
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

function assertValidOutcome(outcome, expectedStatus) {
    const validation = validateCapabilityBusExecuteActionOutcomeDescriptor(outcome);
    assert(validation.ok, `outcome should validate: ${JSON.stringify(validation.errors)}`);
    assert(outcome.resultEnvelope.status === expectedStatus, `expected outcome status ${expectedStatus}, got ${outcome.resultEnvelope.status}`);
}

async function assertRegistryFilteringAndUnsubscribe() {
    const registry = createActionEventSubscriptionRegistry();
    const allEvents = [];
    const actionEvents = [];
    const runEvents = [];
    const typeEvents = [];

    const unsubscribeAll = subscribeActionEvents(registry, (event) => allEvents.push(event));
    const unsubscribeAction = subscribeActionEvents(registry, { actionId: "act_event_subscription_1" }, (event) => actionEvents.push(event));
    const unsubscribeRun = subscribeActionEvents(registry, { runId: "run_event_subscription_1" }, (event) => runEvents.push(event));
    const unsubscribeType = subscribeActionEvents(registry, { type: "action.completed" }, (event) => typeEvents.push(event));

    assert(getActionEventSubscriberCount(registry) === 4, "subscriber count should include active subscriptions");

    publishActionEvent(registry, createActionEvent({ type: "action.started" }));
    publishActionEvent(registry, createActionEvent({
        eventId: "evt_subscription_2",
        type: "action.completed"
    }));
    publishActionEvent(registry, createActionEvent({
        eventId: "evt_subscription_3",
        actionId: "act_other",
        runId: "run_other",
        type: "action.completed"
    }));

    assert(allEvents.length === 3, "all-action subscription should receive all live events");
    assert(actionEvents.length === 2, "actionId filter should receive matching action events only");
    assert(runEvents.length === 2, "runId filter should receive matching run events only");
    assert(typeEvents.length === 2, "type filter should receive matching type events only");

    assert(unsubscribeAction() === true, "unsubscribe should return true for active subscription");
    assert(unsubscribeAction() === false, "unsubscribe should be idempotent");
    assert(getActionEventSubscriberCount(registry) === 3, "subscriber count should decrease after unsubscribe");

    publishActionEvent(registry, createActionEvent({
        eventId: "evt_subscription_4",
        type: "action.started"
    }));

    assert(actionEvents.length === 2, "unsubscribed action listener should not receive later events");

    unsubscribeAll();
    unsubscribeRun();
    unsubscribeType();
    assert(getActionEventSubscriberCount(registry) === 0, "all subscriptions should be removed");
    ok("subscription registry filters and unsubscribe behavior passed");
}

async function assertRegistryValidationAndListenerIsolation() {
    const registry = createActionEventSubscriptionRegistry();
    const errors = [];
    const received = [];

    subscribeActionEvents(registry, () => {
        throw new Error("listener failed intentionally");
    });
    subscribeActionEvents(registry, (event) => received.push(event));

    const normalizedEvent = publishActionEvent(
        registry,
        createActionEvent({ eventId: " evt_subscription_validation_1 " }),
        {
            onListenerError(err, details) {
                errors.push({ err, details });
            }
        }
    );

    assert(normalizedEvent.eventId === "evt_subscription_validation_1", "published event should be normalized");
    assert(received.length === 1, "throwing listener should not block other listeners");
    assert(errors.length === 1, "listener errors should be reported to optional observer");

    await assertRejects(
        "missing subscription listener",
        () => Promise.resolve(subscribeActionEvents(registry, { actionId: "act_1" })),
        "listener must be a function"
    );
    await assertRejects(
        "invalid subscription filter",
        () => Promise.resolve(subscribeActionEvents(registry, "act_1", () => {})),
        "filter must be a plain object"
    );
    await assertRejects(
        "unknown subscription filter field",
        () => Promise.resolve(subscribeActionEvents(registry, { backendKind: "nativeWorkerBackend" }, () => {})),
        "Unknown action event subscription filter field"
    );
    await assertRejects(
        "unknown subscription event type",
        () => Promise.resolve(subscribeActionEvents(registry, { type: "action.unknown" }, () => {})),
        "Unknown action event subscription type"
    );
    await assertRejects(
        "invalid published action event",
        () => Promise.resolve(publishActionEvent(registry, { actionId: "act_missing_event_id" })),
        "Action event validation failed"
    );

    ok("subscription registry validation and listener isolation passed");
}

async function assertExecuteActionPublishesStartedAndCompletedEvents() {
    const registry = createActionEventSubscriptionRegistry();
    const events = [];
    const controlled = createControlledDone();

    subscribeActionEvents(registry, { actionId: "act_event_subscription_complete_1" }, (event) => events.push(event));

    const handle = await runExecuteActionDispatch(createActionEnvelope({
        actionId: "act_event_subscription_complete_1",
        runId: "run_event_subscription_complete_1"
    }), {
        publishActionEvent: (event) => publishActionEvent(registry, event),
        async runNativeTextRequest() {
            return {
                id: 901,
                stream: null,
                done: controlled.done
            };
        }
    });

    assert(events.length === 1, "started event should publish before executeAction handle returns");
    assert(events[0].type === "action.started", "first event should be action.started");
    assert(events[0].actionId === handle.actionId, "started event actionId should match handle");

    controlled.resolveDone("completed via action event subscription smoke");
    const outcome = await handle.done;

    assertValidOutcome(outcome, "completed");
    assert(events.length === 2, "completed event should publish after done settlement");
    assert(events[1].type === "action.completed", "second event should be action.completed");
    assert(events[1].eventId === outcome.actionEvent.eventId, "published terminal event should match outcome actionEvent eventId");
    assert(events[1].type === outcome.actionEvent.type, "published terminal event should match outcome actionEvent type");
    ok("executeAction publishes started and completed action events");
}

async function assertExecuteActionPublishesCancelledEvents() {
    const registry = createActionEventSubscriptionRegistry();
    const events = [];
    const controlled = createControlledDone();

    subscribeActionEvents(registry, { runId: "run_event_subscription_cancelled_1" }, (event) => events.push(event));

    const handle = await runExecuteActionDispatch(createActionEnvelope({
        actionId: "act_event_subscription_cancelled_1",
        runId: "run_event_subscription_cancelled_1"
    }), {
        publishActionEvent: (event) => publishActionEvent(registry, event),
        async runNativeTextRequest() {
            return {
                id: 902,
                stream: null,
                done: controlled.done
            };
        }
    });

    controlled.rejectDone(new Error("Prompt canceled"));
    const outcome = await handle.done;

    assertValidOutcome(outcome, "cancelled");
    assert(events.map((event) => event.type).join(",") === "action.started,action.cancelled", "cancelled action should publish started then cancelled events");
    ok("executeAction publishes cancelled action events");
}

async function assertUnsubscribeBeforeTerminalEvent() {
    const registry = createActionEventSubscriptionRegistry();
    const events = [];
    const controlled = createControlledDone();

    const unsubscribe = subscribeActionEvents(registry, { actionId: "act_event_subscription_unsub_1" }, (event) => events.push(event));

    const handle = await runExecuteActionDispatch(createActionEnvelope({
        actionId: "act_event_subscription_unsub_1",
        runId: "run_event_subscription_unsub_1"
    }), {
        publishActionEvent: (event) => publishActionEvent(registry, event),
        async runNativeTextRequest() {
            return {
                id: 903,
                stream: null,
                done: controlled.done
            };
        }
    });

    assert(events.length === 1 && events[0].type === "action.started", "started event should publish before unsubscribe");
    unsubscribe();
    controlled.resolveDone("terminal event should not be delivered after unsubscribe");
    const outcome = await handle.done;

    assertValidOutcome(outcome, "completed");
    assert(events.length === 1, "unsubscribed listener should not receive terminal event");
    ok("unsubscribe before terminal event prevents later event delivery");
}

async function assertListenerErrorsDoNotAffectExecuteAction() {
    const registry = createActionEventSubscriptionRegistry();
    const events = [];
    const listenerErrors = [];
    const controlled = createControlledDone();

    subscribeActionEvents(registry, () => {
        throw new Error("subscriber failed intentionally");
    });
    subscribeActionEvents(registry, (event) => events.push(event));

    const handle = await runExecuteActionDispatch(createActionEnvelope({
        actionId: "act_event_subscription_throw_1",
        runId: "run_event_subscription_throw_1"
    }), {
        publishActionEvent: (event) => publishActionEvent(registry, event, {
            onListenerError(err) {
                listenerErrors.push(err);
            }
        }),
        async runNativeTextRequest() {
            return {
                id: 904,
                stream: null,
                done: controlled.done
            };
        }
    });

    controlled.resolveDone("listener failure should not affect outcome");
    const outcome = await handle.done;

    assertValidOutcome(outcome, "completed");
    assert(events.map((event) => event.type).join(",") === "action.started,action.completed", "non-throwing listener should receive both events");
    assert(listenerErrors.length === 2, "throwing listener should be isolated for each publication");
    ok("listener errors do not affect executeAction outcome or other listeners");
}

async function assertAdapterFailureDoesNotPublishStartedEvent() {
    const registry = createActionEventSubscriptionRegistry();
    const events = [];

    subscribeActionEvents(registry, (event) => events.push(event));

    await assertRejects(
        "backend request creation failure",
        () => runExecuteActionDispatch(createActionEnvelope({
            actionId: "act_event_subscription_adapter_fail_1"
        }), {
            publishActionEvent: (event) => publishActionEvent(registry, event),
            async runNativeTextRequest() {
                throw new Error("mock adapter failed before backend handle");
            }
        }),
        "mock adapter failed before backend handle"
    );

    assert(events.length === 0, "adapter failure before handle should not publish started or terminal events in v1");
    ok("adapter failure before backend handle does not publish misleading started event");
}

async function assertSourceBoundaries() {
    const runtimeSource = await readSource("runtime.mjs");
    const registrySource = await readSource("runtime/bus/actionEventSubscriptionRegistry.mjs");
    const executionSource = await readSource("runtime/bus/executeAction/capabilityBusExecuteActionExecution.mjs");

    assert(runtimeSource.includes("const actionEvents = createActionEventSubscriptionRegistry();"), "runtime.mjs should own action event registry composition");
    assert(runtimeSource.includes("export function subscribeActionEvents"), "runtime.mjs should expose subscribeActionEvents wrapper");
    assert(runtimeSource.includes("publishActionEvent: (event) => publishActionEvent(actionEvents, event)"), "runtime.mjs should inject action event publisher into executeAction dispatch");

    for (const marker of [
        "runtime.mjs",
        "workerBridge",
        "llama_worker",
        "node-llama-cpp",
        "createScheduler(",
        "sendToWorker",
        "../lifecycle/",
        "../request/",
        "../stream/",
        "../backends/",
        "executeAction"
    ]) {
        assert(!registrySource.includes(marker), `subscription registry should not include ${marker}`);
    }

    assert(executionSource.includes("function publishOutcomeEvent"), "execute-action execution should publish through an injected helper");
    assert(executionSource.includes("deps.publishActionEvent"), "execute-action execution should use injected event publisher");
    assert(!executionSource.includes("actionEventSubscriptionRegistry"), "execute-action execution should not import the subscription registry directly");
    ok("action event subscription source-boundary guards passed");
}

async function main() {
    console.log("[SMOKE] action event subscription");

    await assertRegistryFilteringAndUnsubscribe();
    await assertRegistryValidationAndListenerIsolation();
    await assertExecuteActionPublishesStartedAndCompletedEvents();
    await assertExecuteActionPublishesCancelledEvents();
    await assertUnsubscribeBeforeTerminalEvent();
    await assertListenerErrorsDoNotAffectExecuteAction();
    await assertAdapterFailureDoesNotPublishStartedEvent();
    await assertSourceBoundaries();

    console.log("All action event subscription smoke tests finished.");
}

await main();
