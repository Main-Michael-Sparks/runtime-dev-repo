// smokeTestActionEventReplay.mjs
//
// Purpose:
// - Behavior smoke for Runtime Dev retained in-memory action-event replay.
// - Validates replay/live join orchestration as a separate bus helper from
//   bounded history and live subscriptions, without adding durable storage,
//   stream deltas, cross-process pub/sub, worker, scheduler, lifecycle, or
//   backend ownership.
//
// Run:
//   node ./tests/smokeTestActionEventReplay.mjs

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

import {
    createActionEventHistory,
    readActionEvents,
    recordActionEvent
} from "../runtime/bus/actionEventHistory.mjs";
import {
    createActionEventSubscriptionRegistry,
    getActionEventSubscriberCount,
    publishActionEvent,
    subscribeActionEvents
} from "../runtime/bus/actionEventSubscriptionRegistry.mjs";
import {
    subscribeActionEventReplay
} from "../runtime/bus/actionEventReplay.mjs";

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

function createActionEvent(overrides = {}) {
    return {
        eventId: "evt_replay_1",
        actionId: "act_replay_1",
        runId: "run_replay_1",
        capability: "text.generate",
        type: "action.started",
        timestamp: 1,
        data: {
            source: "action-event-replay-smoke"
        },
        ...overrides
    };
}

function createReplayHarness() {
    const history = createActionEventHistory();
    const registry = createActionEventSubscriptionRegistry();

    function publishWithHistory(event) {
        const recordedEvent = recordActionEvent(history, event);
        return publishActionEvent(registry, recordedEvent);
    }

    function subscribeReplay(filterOrListener, listener, options) {
        return subscribeActionEventReplay({
            subscribe: (filter, normalizedListener) => subscribeActionEvents(
                registry,
                filter,
                normalizedListener
            ),
            readEvents: (filter, readOptions) => readActionEvents(
                history,
                filter,
                readOptions
            )
        }, filterOrListener, listener, options);
    }

    return {
        history,
        registry,
        publishWithHistory,
        subscribeReplay
    };
}

async function assertLiveOnlyBehaviorRemainsUnchanged() {
    const { registry, publishWithHistory, subscribeReplay } = createReplayHarness();
    const received = [];

    const unsubscribe = subscribeReplay((event) => received.push(event));

    assert(getActionEventSubscriberCount(registry) === 1, "live-only subscription should register one listener");

    publishWithHistory(createActionEvent({ eventId: "evt_replay_live_only_1" }));

    assert(received.length === 1, "live-only subscription should receive future live event");
    assert(received[0].eventId === "evt_replay_live_only_1", "live-only event should match publication");
    assert(unsubscribe() === true, "live-only unsubscribe should return true once");
    assert(unsubscribe() === false, "live-only unsubscribe should be idempotent");

    ok("legacy live-only subscription behavior remains unchanged");
}

async function assertListenerFirstReplayShorthand() {
    const { publishWithHistory, subscribeReplay } = createReplayHarness();
    const received = [];

    publishWithHistory(createActionEvent({ eventId: "evt_replay_shorthand_1", timestamp: 1 }));
    publishWithHistory(createActionEvent({ eventId: "evt_replay_shorthand_2", type: "action.completed", timestamp: 2 }));

    const unsubscribe = subscribeReplay((event) => received.push(event), {
        replay: true
    });

    assert(received.map((event) => event.eventId).join(",") === "evt_replay_shorthand_1,evt_replay_shorthand_2", "listener-first shorthand should replay retained events in order");

    publishWithHistory(createActionEvent({ eventId: "evt_replay_shorthand_3", type: "action.completed", timestamp: 3 }));
    assert(received.map((event) => event.eventId).join(",") === "evt_replay_shorthand_1,evt_replay_shorthand_2,evt_replay_shorthand_3", "listener-first shorthand should continue with future live events");

    unsubscribe();
    ok("listener-first replay shorthand passed");
}

async function assertFilterReplayCursorsAndLimits() {
    const { publishWithHistory, subscribeReplay } = createReplayHarness();
    const received = [];

    publishWithHistory(createActionEvent({
        eventId: "evt_replay_filter_1",
        actionId: "act_replay_filter_1",
        runId: "run_replay_filter_1",
        timestamp: 1
    }));
    publishWithHistory(createActionEvent({
        eventId: "evt_replay_filter_2",
        actionId: "act_replay_filter_1",
        runId: "run_replay_filter_1",
        type: "action.completed",
        timestamp: 2
    }));
    publishWithHistory(createActionEvent({
        eventId: "evt_replay_filter_3",
        actionId: "act_replay_filter_1",
        runId: "run_replay_filter_1",
        type: "action.cancelled",
        data: {
            cancellationReason: "mock cancellation"
        },
        timestamp: 3
    }));
    publishWithHistory(createActionEvent({
        eventId: "evt_replay_filter_other",
        actionId: "act_replay_other",
        runId: "run_replay_other",
        timestamp: 4
    }));

    const unsubscribe = subscribeReplay(
        { actionId: "act_replay_filter_1" },
        (event) => received.push(event),
        {
            replay: true,
            afterSequence: 1,
            limit: 1
        }
    );

    assert(received.length === 1, "replay limit should cap retained delivery");
    assert(received[0].eventId === "evt_replay_filter_2", "afterSequence should skip already-seen retained events");

    publishWithHistory(createActionEvent({
        eventId: "evt_replay_filter_4",
        actionId: "act_replay_filter_1",
        runId: "run_replay_filter_1",
        type: "action.timeout",
        data: {
            error: {
                message: "mock timeout",
                code: "mock_timeout",
                kind: "runtime"
            }
        },
        timestamp: 5
    }));

    assert(received.map((event) => event.eventId).join(",") === "evt_replay_filter_2,evt_replay_filter_4", "future matching live events should continue after limited replay");

    unsubscribe();
    ok("filter replay cursors and limits passed");
}

async function assertJoinBufferDedupe() {
    const history = createActionEventHistory();
    const registry = createActionEventSubscriptionRegistry();
    const received = [];

    const retained = recordActionEvent(history, createActionEvent({
        eventId: "evt_replay_join_1",
        actionId: "act_replay_join_1",
        runId: "run_replay_join_1",
        timestamp: 1
    }));

    assert(retained.sequence === 1, "first retained event should receive sequence 1");

    function publishWithHistory(event) {
        const recordedEvent = recordActionEvent(history, event);
        return publishActionEvent(registry, recordedEvent);
    }

    const unsubscribe = subscribeActionEventReplay({
        subscribe: (filter, normalizedListener) => subscribeActionEvents(
            registry,
            filter,
            normalizedListener
        ),
        readEvents: (filter, readOptions) => {
            publishWithHistory(createActionEvent({
                eventId: "evt_replay_join_2",
                actionId: "act_replay_join_1",
                runId: "run_replay_join_1",
                type: "action.completed",
                timestamp: 2
            }));

            return readActionEvents(history, filter, readOptions);
        }
    }, { actionId: "act_replay_join_1" }, (event) => received.push(event), {
        replay: true
    });

    assert(received.map((event) => event.eventId).join(",") === "evt_replay_join_1,evt_replay_join_2", "live event buffered during replay read should not duplicate retained replay event");

    unsubscribe();
    ok("replay/live join buffer sequence dedupe passed");
}

async function assertLiveDuringReplayDeliveryFlushesAfterRetainedEvents() {
    const { publishWithHistory, subscribeReplay } = createReplayHarness();
    const received = [];

    publishWithHistory(createActionEvent({
        eventId: "evt_replay_reentrant_1",
        actionId: "act_replay_reentrant_1",
        runId: "run_replay_reentrant_1",
        timestamp: 1
    }));

    const unsubscribe = subscribeReplay(
        { actionId: "act_replay_reentrant_1" },
        (event) => {
            received.push(event);

            if (event.eventId === "evt_replay_reentrant_1") {
                publishWithHistory(createActionEvent({
                    eventId: "evt_replay_reentrant_2",
                    actionId: "act_replay_reentrant_1",
                    runId: "run_replay_reentrant_1",
                    type: "action.completed",
                    timestamp: 2
                }));
            }
        },
        { replay: true }
    );

    assert(received.map((event) => event.eventId).join(",") === "evt_replay_reentrant_1,evt_replay_reentrant_2", "live event published during replay delivery should flush after retained replay");

    unsubscribe();
    ok("live events published during replay delivery flush after retained events");
}

async function assertUnsubscribePreventsFutureLiveAfterReplay() {
    const { publishWithHistory, subscribeReplay } = createReplayHarness();
    const received = [];

    publishWithHistory(createActionEvent({ eventId: "evt_replay_unsub_1" }));

    const unsubscribe = subscribeReplay((event) => received.push(event), {
        replay: true
    });

    assert(received.length === 1, "initial replay should deliver retained event before unsubscribe");
    assert(unsubscribe() === true, "replay unsubscribe should return true once");
    assert(unsubscribe() === false, "replay unsubscribe should be idempotent");

    publishWithHistory(createActionEvent({ eventId: "evt_replay_unsub_2", timestamp: 2 }));

    assert(received.length === 1, "unsubscribed replay listener should not receive future live event");
    ok("unsubscribe prevents future live delivery after replay");
}

async function assertListenerErrorsDuringReplayAreIsolated() {
    const { publishWithHistory, subscribeReplay } = createReplayHarness();
    const received = [];

    publishWithHistory(createActionEvent({ eventId: "evt_replay_error_1" }));

    const unsubscribe = subscribeReplay((event) => {
        received.push(event);
        if (event.eventId === "evt_replay_error_1") {
            throw new Error("listener failed during replay");
        }
    }, {
        replay: true
    });

    publishWithHistory(createActionEvent({ eventId: "evt_replay_error_2", timestamp: 2 }));

    assert(received.map((event) => event.eventId).join(",") === "evt_replay_error_1,evt_replay_error_2", "listener error during replay should not abort subscription");

    unsubscribe();
    ok("listener errors during replay are isolated");
}

async function assertReplayValidation() {
    const { registry, subscribeReplay } = createReplayHarness();

    await assertRejects(
        "unknown replay option",
        () => Promise.resolve(subscribeReplay(() => {}, { replay: true, durable: true })),
        "Unknown action event replay option field"
    );
    assert(getActionEventSubscriberCount(registry) === 0, "unknown replay option should reject before live registration");

    await assertRejects(
        "invalid replay flag",
        () => Promise.resolve(subscribeReplay(() => {}, { replay: "yes" })),
        "must be a boolean"
    );
    await assertRejects(
        "invalid replay afterSequence",
        () => Promise.resolve(subscribeReplay(() => {}, { replay: true, afterSequence: -1 })),
        "finite non-negative number"
    );
    await assertRejects(
        "invalid replay limit",
        () => Promise.resolve(subscribeReplay(() => {}, { replay: true, limit: 0 })),
        "positive integer"
    );
    await assertRejects(
        "unknown live filter key",
        () => Promise.resolve(subscribeReplay({ backendKind: "nativeWorkerBackend" }, () => {}, { replay: true })),
        "Unknown action event subscription filter field"
    );
    await assertRejects(
        "invalid listener-first shorthand options",
        () => Promise.resolve(subscribeReplay(() => {}, "not options")),
        "listener-first replay shorthand"
    );

    assert(getActionEventSubscriberCount(registry) === 0, "invalid replay subscriptions should not leak live subscribers");
    ok("replay validation passed");
}

async function assertSourceBoundaries() {
    const runtimeSource = await readSource("runtime.mjs");
    const replaySource = await readSource("runtime/bus/actionEventReplay.mjs");
    const historySource = await readSource("runtime/bus/actionEventHistory.mjs");
    const subscriptionSource = await readSource("runtime/bus/actionEventSubscriptionRegistry.mjs");

    const runtimeMarkers = [
        "./runtime/bus/actionEventReplay.mjs",
        "subscribeActionEventReplay({",
        "subscribe: (filter, normalizedListener, subscribeOptions) => subscribeActionEventRegistry(",
        "readEvents: (filter, readOptions) => readActionEventHistory(",
        "export function subscribeActionEvents(filterOrListener, listener, options = {})"
    ];

    for (const marker of runtimeMarkers) {
        assert(runtimeSource.includes(marker), `runtime.mjs should include replay marker: ${marker}`);
    }

    const replayMarkers = [
        "normalizeActionEventSubscribeArgs",
        "replayComplete",
        "liveBuffer",
        "shouldDeliverBufferedEvent",
        "sequence > replayBoundary"
    ];

    for (const marker of replayMarkers) {
        assert(replaySource.includes(marker), `actionEventReplay.mjs should include marker: ${marker}`);
    }

    const forbiddenReplayMarkers = [
        "runtime.mjs",
        "workerBridge",
        "llama_worker",
        "node-llama-cpp",
        "createScheduler(",
        "sendToWorker",
        "runtime/lifecycle",
        "runtime/request",
        "runtime/stream",
        "runtime/backends",
        "executeAction"
    ];

    for (const marker of forbiddenReplayMarkers) {
        assert(!replaySource.includes(marker), `actionEventReplay.mjs should not include forbidden marker: ${marker}`);
    }

    assert(!historySource.includes("actionEventReplay"), "history should not import or own replay");
    assert(!subscriptionSource.includes("actionEventReplay"), "subscription registry should not import or own replay");
    ok("action event replay source-boundary guards passed");
}

async function main() {
    console.log("[SMOKE] action event replay");

    await assertLiveOnlyBehaviorRemainsUnchanged();
    await assertListenerFirstReplayShorthand();
    await assertFilterReplayCursorsAndLimits();
    await assertJoinBufferDedupe();
    await assertLiveDuringReplayDeliveryFlushesAfterRetainedEvents();
    await assertUnsubscribePreventsFutureLiveAfterReplay();
    await assertListenerErrorsDuringReplayAreIsolated();
    await assertReplayValidation();
    await assertSourceBoundaries();

    console.log("\nAll action event replay smoke tests finished.");
}

main().catch((err) => {
    console.error(err.message || err);
    process.exitCode = 1;
});
