// smokeTestActionStreamDeltaEvents.mjs
//
// Purpose:
// - Behavior smoke for live-only Runtime Dev action.stream.delta events.
// - Validates that stream deltas are opt-in live events mapped from parent-side
//   request stream observation without adding retention/replay/durable storage,
//   worker ownership, backend ownership, or stream-shaping changes.
//
// Run:
//   node ./tests/smokeTestActionStreamDeltaEvents.mjs

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

import { config } from "../runtime/config/config.mjs";
import {
    createActionStreamDeltaObserver
} from "../runtime/bus/actionStreamDeltaEvents.mjs";
import {
    createActionEventHistory,
    readActionEvents,
    recordActionEvent
} from "../runtime/bus/actionEventHistory.mjs";
import {
    createActionEventSubscriptionRegistry,
    publishActionEvent,
    subscribeActionEvents
} from "../runtime/bus/actionEventSubscriptionRegistry.mjs";
import {
    subscribeActionEventReplay
} from "../runtime/bus/actionEventReplay.mjs";
import {
    bindActionRequest,
    createActionRequestRegistry,
    releaseActionRequest,
    reserveActionRequest
} from "../runtime/bus/executeAction/actionRequestRegistry.mjs";
import {
    createWorkerProtocolRouter
} from "../runtime/lifecycle/workerProtocolRouter.mjs";

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

function createStartedEvent(overrides = {}) {
    return {
        eventId: "evt_stream_delta_started_1",
        actionId: "act_stream_delta_1",
        runId: "run_stream_delta_1",
        capability: "text.generate",
        type: "action.started",
        timestamp: 1,
        data: {
            source: "action-stream-delta-smoke"
        },
        ...overrides
    };
}

function createBoundActionRequests() {
    const actionRequests = createActionRequestRegistry();

    reserveActionRequest(actionRequests, {
        actionId: "act_stream_delta_1",
        runId: "run_stream_delta_1",
        capability: "text.generate",
        backend: {
            kind: "nativeWorkerBackend",
            adapterId: "native-worker.default"
        }
    });

    bindActionRequest(actionRequests, "act_stream_delta_1", 701, {
        backend: {
            kind: "nativeWorkerBackend",
            adapterId: "native-worker.default"
        }
    });

    return actionRequests;
}

function createDeltaHarness() {
    const actionRequests = createBoundActionRequests();
    const registry = createActionEventSubscriptionRegistry();
    const observer = createActionStreamDeltaObserver({
        actionRequests,
        publishActionEvent: (event) => publishActionEvent(registry, event)
    });

    return {
        actionRequests,
        registry,
        observer
    };
}

async function assertLiveDeltaOptInAndFiltering() {
    const { registry, observer } = createDeltaHarness();
    const defaultEvents = [];
    const noOptTypeEvents = [];
    const typeEvents = [];
    const capabilityEvents = [];

    subscribeActionEvents(registry, (event) => defaultEvents.push(event));
    subscribeActionEvents(registry, { type: "action.stream.delta" }, (event) => noOptTypeEvents.push(event));
    subscribeActionEvents(
        registry,
        { type: "action.stream.delta" },
        (event) => typeEvents.push(event),
        { includeStreamDeltas: true }
    );
    subscribeActionEvents(
        registry,
        { capability: "text.generate" },
        (event) => capabilityEvents.push(event),
        { includeStreamDeltas: true }
    );

    publishActionEvent(registry, createStartedEvent());
    assert(defaultEvents.length === 1, "default subscription should still receive non-delta events");
    assert(typeEvents.length === 0, "stream-delta type listener should not receive non-delta events");

    const first = observer(701, "Hel");
    const second = observer(701, "lo");

    assert(first?.type === "action.stream.delta", "observer should return first stream delta event");
    assert(second?.type === "action.stream.delta", "observer should return second stream delta event");
    assert(defaultEvents.length === 1, "default subscription should not receive stream deltas");
    assert(noOptTypeEvents.length === 0, "type-only listener must still opt in to stream deltas");
    assert(typeEvents.length === 2, "opt-in type listener should receive stream deltas");
    assert(capabilityEvents.length === 3, "capability listener should receive started plus opt-in deltas");

    assert(typeEvents[0].eventId === "evt_act_stream_delta_1_stream_delta_0", "first delta eventId should include index 0");
    assert(typeEvents[1].eventId === "evt_act_stream_delta_1_stream_delta_1", "second delta eventId should include index 1");
    assert(typeEvents[0].data.delta === "Hel", "first delta payload mismatch");
    assert(typeEvents[1].data.delta === "lo", "second delta payload mismatch");
    assert(typeEvents[0].data.index === 0, "first delta index should be zero");
    assert(typeEvents[1].data.index === 1, "second delta index should increment");
    assert(typeEvents[0].data.requestId === 701, "delta requestId should be included");
    assert(typeEvents[0].data.chunkKind === "text", "delta chunkKind should be text");
    assert(typeEvents[0].sequence === undefined, "live-only stream delta should not receive retained history sequence");

    ok("live stream deltas remain opt-in and filterable");
}

async function assertDeltaPublicationIsLiveOnlyAndNoThrow() {
    const { actionRequests, registry, observer } = createDeltaHarness();
    const history = createActionEventHistory();
    const received = [];

    subscribeActionEvents(
        registry,
        { actionId: "act_stream_delta_1" },
        () => {
            throw new Error("stream delta listener failed intentionally");
        },
        { includeStreamDeltas: true }
    );
    subscribeActionEvents(
        registry,
        { actionId: "act_stream_delta_1" },
        (event) => received.push(event),
        { includeStreamDeltas: true }
    );

    assert(observer(701, "safe")?.data.delta === "safe", "observer should publish despite throwing listener");
    assert(received.length === 1, "non-throwing stream listener should still receive delta");

    const retained = readActionEvents(history, { type: "action.stream.delta" });
    assert(retained.events.length === 0, "stream deltas should not be retained in actionEventHistory");

    recordActionEvent(history, createStartedEvent({ eventId: "evt_stream_delta_retained_started" }));
    assert(readActionEvents(history, { type: "action.started" }).events.length === 1, "non-delta retained event sanity check failed");

    releaseActionRequest(actionRequests, "act_stream_delta_1");
    assert(observer(701, "after release") === null, "released action should not publish later stream deltas");
    assert(received.length === 1, "released action should not deliver later stream deltas");

    ok("stream delta publication is live-only and no-throw");
}

async function assertReplayOptionPassesLiveDeltaOptInOnly() {
    const history = createActionEventHistory();
    const registry = createActionEventSubscriptionRegistry();
    const replayedAndLive = [];
    const liveDeltas = [];

    recordActionEvent(history, createStartedEvent({
        eventId: "evt_stream_delta_replay_started",
        timestamp: 1
    }));

    function subscribeReplay(filterOrListener, listener, options) {
        return subscribeActionEventReplay({
            subscribe: (filter, normalizedListener, subscribeOptions) => subscribeActionEvents(
                registry,
                filter,
                normalizedListener,
                subscribeOptions
            ),
            readEvents: (filter, readOptions) => readActionEvents(
                history,
                filter,
                readOptions
            )
        }, filterOrListener, listener, options);
    }

    subscribeReplay({ actionId: "act_stream_delta_1" }, (event) => replayedAndLive.push(event), {
        replay: true,
        includeStreamDeltas: true
    });
    subscribeReplay({ type: "action.stream.delta" }, (event) => liveDeltas.push(event), {
        replay: true,
        includeStreamDeltas: true
    });

    const { observer } = createDeltaHarness();
    observer(701, "live-only");

    assert(replayedAndLive.length === 1, "replay listener should receive retained started event from history");
    publishActionEvent(registry, createStartedEvent({
        eventId: "evt_stream_delta_future_started",
        timestamp: 2
    }));
    assert(replayedAndLive.length === 2, "replay listener should continue receiving live non-delta events");

    // Publish through the same live registry used by replay subscriptions.
    const actionRequests = createBoundActionRequests();
    const observerForReplayRegistry = createActionStreamDeltaObserver({
        actionRequests,
        publishActionEvent: (event) => publishActionEvent(registry, event)
    });
    observerForReplayRegistry(701, "delta-through-replay-live");

    assert(liveDeltas.length === 1, "replay helper should pass stream-delta opt-in to live subscription");
    assert(liveDeltas[0].sequence === undefined, "live delta delivered through replay helper should remain unsequenced");
    assert(readActionEvents(history, { type: "action.stream.delta" }).events.length === 0, "replay should not make stream deltas retained");

    ok("replay helper passes stream-delta opt-in to live subscription only");
}

async function assertSubscriptionValidation() {
    const registry = createActionEventSubscriptionRegistry();

    await assertRejects(
        "invalid stream delta subscription option",
        () => Promise.resolve(subscribeActionEvents(registry, () => {}, { includeStreamDeltas: true })),
        "listener must be a function"
    );
    await assertRejects(
        "invalid stream delta option type",
        () => Promise.resolve(subscribeActionEvents(registry, {}, () => {}, { includeStreamDeltas: "yes" })),
        "includeStreamDeltas"
    );
    await assertRejects(
        "unknown stream delta subscription option",
        () => Promise.resolve(subscribeActionEvents(registry, {}, () => {}, { streamDeltas: true })),
        "Unknown action event subscription option field"
    );
    await assertRejects(
        "unknown subscription capability filter",
        () => Promise.resolve(subscribeActionEvents(registry, { capability: "unknown.capability" }, () => {})),
        "Unknown action event subscription capability"
    );

    ok("stream-delta subscription validation passed");
}

async function assertWorkerProtocolRouterObserverInjection() {
    const req = {
        id: 900,
        status: "running",
        finalText: ""
    };
    const observed = [];
    const pushed = [];
    const router = createWorkerProtocolRouter({
        config,
        lifecycle: {},
        scheduler: {
            getRequest(id) {
                return id === req.id ? req : null;
            }
        },
        normalizeToken(token) {
            return String(token).toUpperCase();
        },
        pushStream(streamReq, token) {
            pushed.push({
                requestId: streamReq.id,
                token,
                finalText: streamReq.finalText
            });
        },
        closeStream() {},
        errorStream() {},
        traceDone() {},
        traceError() {},
        traceDelete() {},
        settleCompletedRequest() {},
        settleFailedRequest() {},
        observeStreamDelta(requestId, token, streamReq) {
            observed.push({
                requestId,
                token,
                finalText: streamReq.finalText
            });

            if (token === "B") {
                throw new Error("observer failure should be isolated");
            }
        }
    });

    router({ type: "stream", id: 900, token: "a" });
    router({ type: "stream", id: 900, token: "b" });

    assert(req.finalText === "AB", "router should preserve finalText accumulation");
    assert(observed.length === 2, "router should notify observer for each normalized stream chunk");
    assert(observed[0].finalText === "A", "observer should see finalText after accumulation");
    assert(pushed.length === 2, "observer failure should not block pushStream");
    assert(pushed[1].token === "B", "pushStream should receive normalized chunk after observer failure");

    ok("workerProtocolRouter stream observer injection preserves stream behavior");
}

async function assertSourceBoundaries() {
    const runtimeSource = await readSource("runtime.mjs");
    const helperSource = await readSource("runtime/bus/actionStreamDeltaEvents.mjs");
    const routerSource = await readSource("runtime/lifecycle/workerProtocolRouter.mjs");
    const subscriptionSource = await readSource("runtime/bus/actionEventSubscriptionRegistry.mjs");

    assert(runtimeSource.includes("createActionStreamDeltaObserver"), "runtime.mjs should create stream delta observer at composition root");
    assert(runtimeSource.includes("publishRuntimeLiveActionEvent"), "runtime.mjs should keep stream deltas live-only");
    assert(runtimeSource.includes("observeStreamDelta"), "runtime.mjs should inject observer into workerProtocolRouter");
    assert(routerSource.includes("observeStreamDelta(req.id, token, req)"), "workerProtocolRouter should call injected stream observer");
    assert(subscriptionSource.includes("includeStreamDeltas"), "subscription registry should gate stream deltas behind explicit opt-in");

    for (const marker of [
        "workerBridge",
        "llama_worker",
        "node-llama-cpp",
        "createScheduler(",
        "streamController",
        "recordActionEvent("
    ]) {
        assert(!helperSource.includes(marker), `action stream delta helper should not include ${marker}`);
    }

    ok("action stream delta source-boundary guards passed");
}

async function main() {
    console.log("[SMOKE] action stream delta events");

    await assertLiveDeltaOptInAndFiltering();
    await assertDeltaPublicationIsLiveOnlyAndNoThrow();
    await assertReplayOptionPassesLiveDeltaOptInOnly();
    await assertSubscriptionValidation();
    await assertWorkerProtocolRouterObserverInjection();
    await assertSourceBoundaries();

    console.log("\nAll action stream delta event smoke tests finished.");
}

main().catch((err) => {
    console.error(err.message || err);
    process.exitCode = 1;
});
