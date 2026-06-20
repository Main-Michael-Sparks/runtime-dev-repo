// smokeTestActionEventHistory.mjs
//
// Purpose:
// - Behavior smoke for Runtime Dev bounded in-memory action-event history/readback.
// - Validates history/readback as a separate bus helper from live subscriptions,
//   without adding durable persistence, cross-process pub/sub, stream deltas,
//   worker, scheduler, lifecycle, or native backend ownership.
//
// Run:
//   node ./tests/smokeTestActionEventHistory.mjs

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

import {
    createActionEventHistory,
    getActionEventHistorySize,
    readActionEvents,
    recordActionEvent
} from "../runtime/bus/actionEventHistory.mjs";
import {
    createActionEventSubscriptionRegistry,
    publishActionEvent,
    subscribeActionEvents
} from "../runtime/bus/actionEventSubscriptionRegistry.mjs";

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
        eventId: "evt_history_1",
        actionId: "act_history_1",
        runId: "run_history_1",
        capability: "text.generate",
        type: "action.started",
        timestamp: 10,
        data: {
            source: "history-smoke",
            nested: {
                mutable: true
            }
        },
        ...overrides
    };
}

function recordSeries(history) {
    return [
        recordActionEvent(history, createActionEvent({
            eventId: "evt_history_1",
            actionId: "act_history_1",
            runId: "run_history_1",
            type: "action.started",
            timestamp: 10
        })),
        recordActionEvent(history, createActionEvent({
            eventId: "evt_history_2",
            actionId: "act_history_1",
            runId: "run_history_1",
            type: "action.completed",
            timestamp: 20
        })),
        recordActionEvent(history, createActionEvent({
            eventId: "evt_history_3",
            actionId: "act_history_2",
            runId: "run_history_1",
            type: "action.started",
            timestamp: 30
        })),
        recordActionEvent(history, createActionEvent({
            eventId: "evt_history_4",
            actionId: "act_history_3",
            runId: "run_history_2",
            type: "action.failed",
            timestamp: 40,
            data: {
                error: {
                    message: "failed intentionally",
                    code: "history_failed",
                    kind: "runtime"
                }
            }
        }))
    ];
}

async function assertRecordValidationAndMutationSafety() {
    const history = createActionEventHistory();
    const input = createActionEvent({ eventId: " evt_history_normalized_1 " });
    const recorded = recordActionEvent(history, input);

    assert(recorded.eventId === "evt_history_normalized_1", "recorded event should be normalized");
    assert(recorded.sequence === 1, "recorded event should receive sequence 1");
    assert(input.sequence === undefined, "recording should not mutate caller event");
    assert(Object.isFrozen(recorded), "recorded event should be frozen");
    assert(Object.isFrozen(recorded.data), "recorded event data should be frozen");
    assert(Object.isFrozen(recorded.data.nested), "nested event data should be frozen");

    const readback = readActionEvents(history);
    assert(readback.events.length === 1, "readback should return recorded event");
    assert(readback.events[0] !== recorded, "readback should return defensive event copies");
    assert(Object.isFrozen(readback.events[0]), "readback event should be frozen");

    await assertRejects(
        "invalid action event history record",
        () => Promise.resolve(recordActionEvent(history, { actionId: "act_missing_event_id" })),
        "Action event validation failed"
    );
    await assertRejects(
        "duplicate retained action event id",
        () => Promise.resolve(recordActionEvent(history, createActionEvent({ eventId: "evt_history_normalized_1" }))),
        "Duplicate retained action event id"
    );

    ok("history record validation and mutation safety passed");
}

async function assertFilteringOrderingAndCursors() {
    const history = createActionEventHistory();
    recordSeries(history);

    const all = readActionEvents(history);
    assert(all.events.map((event) => event.sequence).join(",") === "1,2,3,4", "all events should return in sequence order");
    assert(all.cursor.lastSequence === 4, "all-events cursor should point at last returned sequence");
    assert(all.truncated === false, "unlimited readback should not be truncated");

    const byAction = readActionEvents(history, { actionId: "act_history_1" });
    assert(byAction.events.length === 2, "actionId filter should match two events");
    assert(byAction.events.every((event) => event.actionId === "act_history_1"), "actionId filter should only return matching events");

    const byRun = readActionEvents(history, { runId: "run_history_1" });
    assert(byRun.events.length === 3, "runId filter should match three events");

    const byType = readActionEvents(history, { type: "action.completed" });
    assert(byType.events.length === 1 && byType.events[0].eventId === "evt_history_2", "type filter should match completed event");

    const byCapability = readActionEvents(history, { capability: "text.generate" });
    assert(byCapability.events.length === 4, "capability filter should match text.generate events");

    const byTime = readActionEvents(history, { sinceTimestamp: 20, untilTimestamp: 30 });
    assert(byTime.events.map((event) => event.eventId).join(",") === "evt_history_2,evt_history_3", "time filter should be inclusive");

    const afterSequence = readActionEvents(history, { afterSequence: 2 });
    assert(afterSequence.events.map((event) => event.sequence).join(",") === "3,4", "afterSequence filter should return later events");

    const limited = readActionEvents(history, {}, { limit: 2 });
    assert(limited.events.length === 2, "limited readback should return requested count");
    assert(limited.cursor.lastSequence === 2, "limited readback cursor should point at last returned event");
    assert(limited.truncated === true, "limited readback should report truncation when more matches exist");

    await assertRejects(
        "unknown readback filter field",
        () => Promise.resolve(readActionEvents(history, { backendKind: "nativeWorkerBackend" })),
        "Unknown action event history filter field"
    );
    await assertRejects(
        "unknown readback event type",
        () => Promise.resolve(readActionEvents(history, { type: "action.unknown" })),
        "Unknown action event history type"
    );
    await assertRejects(
        "invalid readback limit",
        () => Promise.resolve(readActionEvents(history, {}, { limit: 0 })),
        "must be a positive integer"
    );

    ok("history filtering, ordering, limits, and cursors passed");
}

async function assertBoundedRetentionAndDuplicateWindow() {
    const history = createActionEventHistory({ maxEvents: 2 });

    recordActionEvent(history, createActionEvent({ eventId: "evt_history_retention_1", timestamp: 1 }));
    recordActionEvent(history, createActionEvent({ eventId: "evt_history_retention_2", timestamp: 2 }));
    recordActionEvent(history, createActionEvent({ eventId: "evt_history_retention_3", timestamp: 3 }));

    const retained = readActionEvents(history);
    assert(getActionEventHistorySize(history) === 2, "history should retain maxEvents entries");
    assert(retained.events.map((event) => event.eventId).join(",") === "evt_history_retention_2,evt_history_retention_3", "history should evict oldest event first");

    recordActionEvent(history, createActionEvent({ eventId: "evt_history_retention_1", timestamp: 4 }));
    assert(getActionEventHistorySize(history) === 2, "reusing an evicted eventId should keep retention bounded");
    assert(readActionEvents(history).events.map((event) => event.eventId).join(",") === "evt_history_retention_3,evt_history_retention_1", "evicted duplicate id may be reused after leaving retained window");

    await assertRejects(
        "invalid history maxEvents",
        () => Promise.resolve(createActionEventHistory({ maxEvents: 0 })),
        "must be a positive integer"
    );

    ok("bounded retention and retained duplicate window passed");
}

async function assertRecordBeforeLivePublishComposition() {
    const history = createActionEventHistory();
    const registry = createActionEventSubscriptionRegistry();
    const observed = [];
    const readDuringPublish = [];

    subscribeActionEvents(registry, { actionId: "act_history_live_1" }, (event) => {
        observed.push(event);
        readDuringPublish.push(readActionEvents(history, { actionId: event.actionId }).events.length);
    });

    function publishWithHistory(event) {
        const recordedEvent = recordActionEvent(history, event);
        return publishActionEvent(registry, recordedEvent);
    }

    const published = publishWithHistory(createActionEvent({
        eventId: "evt_history_live_1",
        actionId: "act_history_live_1",
        runId: "run_history_live_1"
    }));

    assert(observed.length === 1, "live subscriber should observe published event");
    assert(readDuringPublish[0] === 1, "event should be readable from history during live callback");
    assert(published.sequence === 1, "live publication should receive recorded sequence");

    ok("record-before-live-publish composition passed");
}

async function assertSourceBoundaries() {
    const runtimeSource = await readSource("runtime.mjs");
    const historySource = await readSource("runtime/bus/actionEventHistory.mjs");
    const subscriptionSource = await readSource("runtime/bus/actionEventSubscriptionRegistry.mjs");

    const runtimeMarkers = [
        "./runtime/bus/actionEventHistory.mjs",
        "const actionEventHistory = createActionEventHistory();",
        "function publishRuntimeActionEvent(event)",
        "recordActionEvent(actionEventHistory, event)",
        "publishActionEvent(actionEvents, recordedEvent)",
        "export function readActionEvents(filter = {}, options = {})"
    ];

    for (const marker of runtimeMarkers) {
        assert(runtimeSource.includes(marker), `runtime.mjs should include marker: ${marker}`);
    }

    const forbiddenHistoryMarkers = [
        "actionEventSubscriptionRegistry",
        "runtime.mjs",
        "workerBridge",
        "llama_worker",
        "runtime/request",
        "runtime/lifecycle",
        "runtime/stream",
        "node-llama-cpp"
    ];

    for (const marker of forbiddenHistoryMarkers) {
        assert(!historySource.includes(marker), `actionEventHistory.mjs should not include forbidden marker: ${marker}`);
    }

    assert(!subscriptionSource.includes("actionEventHistory"), "subscription registry should not import or own history");
    ok("history source-boundary guards passed");
}

async function main() {
    console.log("[SMOKE] action event history/readback");

    await assertRecordValidationAndMutationSafety();
    await assertFilteringOrderingAndCursors();
    await assertBoundedRetentionAndDuplicateWindow();
    await assertRecordBeforeLivePublishComposition();
    await assertSourceBoundaries();

    console.log("\nAll action event history/readback smoke tests finished.");
}

main().catch((err) => {
    console.error(err.message || err);
    process.exitCode = 1;
});
