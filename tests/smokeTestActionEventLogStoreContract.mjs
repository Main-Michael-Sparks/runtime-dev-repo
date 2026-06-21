// smokeTestActionEventLogStoreContract.mjs
//
// Purpose:
// - Contract-only smoke for future Runtime Dev action-event log stores.
// - Validates the durable-log adapter seam separately from live subscription,
//   bounded in-memory history, replay, stream-delta retention, worker,
//   scheduler, lifecycle, stream shaping, and backend execution.
//
// Run:
//   node ./tests/smokeTestActionEventLogStoreContract.mjs

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

import {
    ACTION_EVENT_LOG_DEFAULT_DURABLE_EVENT_TYPES,
    ACTION_EVENT_LOG_HIGH_VOLUME_EVENT_TYPES,
    ACTION_EVENT_LOG_STORE_CONTRACT_VERSION,
    assertActionEventLogAppendEntry,
    assertActionEventLogAppendResult,
    assertActionEventLogReadResult,
    assertActionEventLogStoreAdapter,
    copyActionEventLogEntry,
    isDefaultDurableActionEventLogType,
    isHighVolumeActionEventLogType,
    normalizeActionEventLogAppendEntry,
    normalizeActionEventLogReadFilter,
    normalizeActionEventLogReadOptions,
    validateActionEventLogAppendEntry,
    validateActionEventLogStoreAdapter
} from "../runtime/bus/actionEventLog/actionEventLogStoreContract.mjs";

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
        eventId: "evt_log_1",
        actionId: "act_log_1",
        runId: "run_log_1",
        capability: "text.generate",
        type: "action.started",
        timestamp: 10,
        data: {
            source: "event-log-contract-smoke",
            nested: {
                mutable: true
            }
        },
        ...overrides
    };
}

function createStreamDeltaEvent(overrides = {}) {
    return createActionEvent({
        eventId: "evt_log_stream_1",
        type: "action.stream.delta",
        data: {
            delta: "hello",
            index: 0,
            requestId: 123,
            chunkKind: "text",
            emittedAt: 12,
            backend: "nativeWorkerBackend"
        },
        ...overrides
    });
}

function createValidAdapter(overrides = {}) {
    return {
        contractVersion: ACTION_EVENT_LOG_STORE_CONTRACT_VERSION,
        adapterId: "event-log.fake",
        capabilities: {
            append: true,
            read: true,
            cursorRead: true,
            highVolumeEvents: false
        },
        appendEvent(entry) {
            return {
                accepted: true,
                eventId: entry.event.eventId,
                sequence: 1,
                logOffset: "offset-1",
                storedAt: 20
            };
        },
        readEvents() {
            return {
                events: [createActionEvent()],
                cursor: {
                    lastSequence: 1,
                    lastLogOffset: "offset-1"
                },
                truncated: false
            };
        },
        ...overrides
    };
}

async function assertConstantsAndPolicies() {
    assert(
        ACTION_EVENT_LOG_STORE_CONTRACT_VERSION === "runtime.actionEventLogStore.v1",
        "contract version should be v1"
    );
    assert(
        ACTION_EVENT_LOG_DEFAULT_DURABLE_EVENT_TYPES.includes("action.started"),
        "default durable events should include action.started"
    );
    assert(
        ACTION_EVENT_LOG_HIGH_VOLUME_EVENT_TYPES.join(",") === "action.stream.delta",
        "high-volume event list should identify stream deltas"
    );
    assert(
        isDefaultDurableActionEventLogType("action.completed"),
        "completed should be default durable eligible"
    );
    assert(
        isHighVolumeActionEventLogType("action.stream.delta"),
        "stream deltas should be high volume"
    );

    ok("event-log constants and default policy passed");
}

async function assertAppendEntryValidationAndMutationSafety() {
    const input = {
        event: createActionEvent({ eventId: " evt_log_normalized_1 " }),
        receivedAt: 11,
        source: {
            kind: "smoke",
            nested: {
                mutable: true
            }
        },
        durability: "audit"
    };

    const entry = normalizeActionEventLogAppendEntry(input);
    assert(entry.event.eventId === "evt_log_normalized_1", "event should be normalized");
    assert(entry.receivedAt === 11, "receivedAt should be preserved");
    assert(entry.durability === "audit", "durability should be preserved");
    assert(Object.isFrozen(entry), "entry should be frozen");
    assert(Object.isFrozen(entry.event), "entry event should be frozen");
    assert(Object.isFrozen(entry.event.data.nested), "nested event data should be frozen");
    assert(Object.isFrozen(entry.source.nested), "nested source metadata should be frozen");
    assert(input.event.eventId === " evt_log_normalized_1 ", "entry normalization should not mutate caller event");

    const copied = copyActionEventLogEntry(entry);
    assert(copied !== entry, "copyActionEventLogEntry should return a defensive copy");
    assert(copied.event !== entry.event, "entry copy should not reuse event object");
    assert(Object.isFrozen(copied.event), "entry copy event should be frozen");

    const result = validateActionEventLogAppendEntry({ event: createActionEvent() });
    assert(result.ok === true, "validateActionEventLogAppendEntry should accept a valid entry");
    assert(result.value.durability === "default", "durability should default to default");

    await assertRejects(
        "unknown append entry field",
        () => Promise.resolve(assertActionEventLogAppendEntry({ event: createActionEvent(), backendKind: "nativeWorkerBackend" })),
        "Unknown action event log entry field"
    );
    await assertRejects(
        "forbidden event key",
        () => Promise.resolve(assertActionEventLogAppendEntry({ event: createActionEvent({ modelPath: "../model.gguf" }) })),
        "forbidden key"
    );
    await assertRejects(
        "forbidden source metadata key",
        () => Promise.resolve(assertActionEventLogAppendEntry({ event: createActionEvent(), source: { modelPath: "../model.gguf" } })),
        "forbidden key"
    );
    await assertRejects(
        "invalid append entry receivedAt",
        () => Promise.resolve(assertActionEventLogAppendEntry({ event: createActionEvent(), receivedAt: -1 })),
        "receivedAt"
    );
    await assertRejects(
        "invalid append entry durability",
        () => Promise.resolve(assertActionEventLogAppendEntry({ event: createActionEvent(), durability: "forever" })),
        "Unsupported action event log durability"
    );

    ok("append entry validation and mutation safety passed");
}

async function assertHighVolumePolicy() {
    await assertRejects(
        "stream delta append without explicit high-volume option",
        () => Promise.resolve(assertActionEventLogAppendEntry({ event: createStreamDeltaEvent() })),
        "exclude high-volume event type by default"
    );

    const entry = normalizeActionEventLogAppendEntry(
        { event: createStreamDeltaEvent() },
        { includeHighVolumeEvents: true }
    );
    assert(entry.event.type === "action.stream.delta", "explicit high-volume option should accept stream delta contract entry");

    const options = normalizeActionEventLogReadOptions({ includeHighVolumeEvents: true, limit: 10 });
    assert(options.includeHighVolumeEvents === true, "read options should preserve explicit high-volume policy");
    assert(options.limit === 10, "read options should preserve limit");

    await assertRejects(
        "unknown append option field",
        () => Promise.resolve(assertActionEventLogAppendEntry({ event: createActionEvent() }, { replay: true })),
        "Unknown action event log options field"
    );
    await assertRejects(
        "invalid high-volume option type",
        () => Promise.resolve(assertActionEventLogAppendEntry({ event: createActionEvent() }, { includeHighVolumeEvents: "yes" })),
        "includeHighVolumeEvents"
    );

    ok("high-volume stream-delta contract policy passed");
}

async function assertReadFilterAndOptionsValidation() {
    const filter = normalizeActionEventLogReadFilter({
        actionId: " act_log_1 ",
        runId: " run_log_1 ",
        type: " action.completed ",
        capability: " text.generate ",
        sinceTimestamp: 1,
        untilTimestamp: 5,
        afterSequence: 2,
        afterLogOffset: " offset-1 "
    });

    assert(filter.actionId === "act_log_1", "actionId should be trimmed");
    assert(filter.type === "action.completed", "type should be trimmed");
    assert(filter.capability === "text.generate", "capability should be trimmed");
    assert(filter.afterLogOffset === "offset-1", "afterLogOffset should be trimmed");
    assert(Object.isFrozen(filter), "filter should be frozen");

    const defaults = normalizeActionEventLogReadOptions();
    assert(defaults.includeHighVolumeEvents === false, "includeHighVolumeEvents should default false");

    await assertRejects(
        "unknown read filter field",
        () => Promise.resolve(normalizeActionEventLogReadFilter({ backendKind: "nativeWorkerBackend" })),
        "Unknown action event log filter field"
    );
    await assertRejects(
        "unknown read option field",
        () => Promise.resolve(normalizeActionEventLogReadOptions({ replay: true })),
        "Unknown action event log options field"
    );
    await assertRejects(
        "unknown read filter type",
        () => Promise.resolve(normalizeActionEventLogReadFilter({ type: "action.unknown" })),
        "Unknown action event log type"
    );
    await assertRejects(
        "unknown read filter capability",
        () => Promise.resolve(normalizeActionEventLogReadFilter({ capability: "text.paint" })),
        "Unknown action event log capability"
    );
    await assertRejects(
        "invalid read filter timestamp range",
        () => Promise.resolve(normalizeActionEventLogReadFilter({ sinceTimestamp: 5, untilTimestamp: 1 })),
        "sinceTimestamp must be less than or equal to untilTimestamp"
    );
    await assertRejects(
        "invalid read limit",
        () => Promise.resolve(normalizeActionEventLogReadOptions({ limit: 0 })),
        "must be a positive integer"
    );

    ok("read filter and options validation passed");
}

async function assertAdapterAndReturnShapeValidation() {
    const adapter = assertActionEventLogStoreAdapter(createValidAdapter());
    assert(adapter.adapterId === "event-log.fake", "adapter id should normalize");
    assert(adapter.capabilities.append === true, "adapter append capability should be true");
    assert(typeof adapter.appendEvent === "function", "adapter should expose appendEvent");

    const adapterResult = validateActionEventLogStoreAdapter(createValidAdapter());
    assert(adapterResult.ok === true, "validateActionEventLogStoreAdapter should accept valid adapter");

    await assertRejects(
        "wrong adapter contract version",
        () => Promise.resolve(assertActionEventLogStoreAdapter(createValidAdapter({ contractVersion: "runtime.actionEventLogStore.v0" }))),
        "contractVersion"
    );
    await assertRejects(
        "adapter missing appendEvent",
        () => Promise.resolve(assertActionEventLogStoreAdapter({
            ...createValidAdapter(),
            appendEvent: undefined
        })),
        "appendEvent"
    );
    await assertRejects(
        "adapter missing readEvents",
        () => Promise.resolve(assertActionEventLogStoreAdapter({
            ...createValidAdapter(),
            readEvents: undefined
        })),
        "readEvents"
    );
    await assertRejects(
        "adapter missing required capability",
        () => Promise.resolve(assertActionEventLogStoreAdapter(createValidAdapter({
            capabilities: {
                append: true,
                read: false
            }
        }))),
        "capability read must be true"
    );

    const appendResult = assertActionEventLogAppendResult({
        accepted: true,
        eventId: " evt_log_1 ",
        sequence: 1,
        logOffset: " offset-1 ",
        storedAt: 20
    });
    assert(appendResult.eventId === "evt_log_1", "append result eventId should be trimmed");
    assert(appendResult.logOffset === "offset-1", "append result logOffset should be trimmed");
    assert(Object.isFrozen(appendResult), "append result should be frozen");

    const readResult = assertActionEventLogReadResult({
        events: [createActionEvent({ eventId: " evt_log_read_1 " })],
        cursor: {
            lastSequence: 1,
            lastLogOffset: " offset-1 "
        },
        truncated: false
    });
    assert(readResult.events[0].eventId === "evt_log_read_1", "read result event should be normalized");
    assert(readResult.cursor.lastLogOffset === "offset-1", "read result cursor log offset should be trimmed");
    assert(Object.isFrozen(readResult.events[0]), "read result event should be frozen");

    await assertRejects(
        "invalid append result accepted flag",
        () => Promise.resolve(assertActionEventLogAppendResult({ accepted: false, eventId: "evt_log_1", storedAt: 20 })),
        "accepted must be true"
    );
    await assertRejects(
        "invalid read result cursor",
        () => Promise.resolve(assertActionEventLogReadResult({ events: [], cursor: { lastSequence: -1, lastLogOffset: null }, truncated: false })),
        "cursor.lastSequence"
    );
    await assertRejects(
        "stream delta read result without explicit high-volume option",
        () => Promise.resolve(assertActionEventLogReadResult({
            events: [createStreamDeltaEvent()],
            cursor: {
                lastSequence: 1,
                lastLogOffset: null
            },
            truncated: false
        })),
        "excludes high-volume event type by default"
    );

    const highVolumeRead = assertActionEventLogReadResult({
        events: [createStreamDeltaEvent()],
        cursor: {
            lastSequence: 1,
            lastLogOffset: null
        },
        truncated: false
    }, { includeHighVolumeEvents: true });
    assert(highVolumeRead.events[0].type === "action.stream.delta", "explicit high-volume read policy should accept stream delta events");

    ok("adapter and return shape validation passed");
}

async function assertSourceBoundaryGuards() {
    const runtimeSource = await readSource("runtime.mjs");
    const bridgeSource = await readSource("workerBridge.mjs");
    const workerSource = await readSource("llama_worker/llama.mjs");
    const commonSource = await readSource("runtime/bus/actionEventLog/actionEventLogCommon.mjs");
    const entrySource = await readSource("runtime/bus/actionEventLog/actionEventLogEntry.mjs");
    const contractSource = await readSource("runtime/bus/actionEventLog/actionEventLogStoreContract.mjs");

    assert(!runtimeSource.includes("actionEventLog"), "runtime.mjs should not import or wire action event log contract in v1");
    assert(!bridgeSource.includes("actionEventLog"), "workerBridge should not know about action event log contract");
    assert(!workerSource.includes("actionEventLog"), "llama_worker should not know about action event log contract");

    const combinedContractSource = [commonSource, entrySource, contractSource].join("\n");
    assert(!combinedContractSource.includes("workerBridge"), "event-log contract must not import workerBridge");
    assert(!combinedContractSource.includes("llama_worker"), "event-log contract must not import llama_worker");
    assert(!combinedContractSource.includes("actionEventHistory"), "event-log contract must not import bounded in-memory history");
    assert(!combinedContractSource.includes("actionEventReplay"), "event-log contract must not import replay helper");
    assert(!combinedContractSource.includes("actionEventSubscriptionRegistry"), "event-log contract must not import live subscription registry");
    assert(!combinedContractSource.includes("actionStreamDeltaEvents"), "event-log contract must not import stream delta observer");

    ok("event-log contract source-boundary guards passed");
}

async function main() {
    console.log("[SMOKE] action event log store contract");

    await assertConstantsAndPolicies();
    await assertAppendEntryValidationAndMutationSafety();
    await assertHighVolumePolicy();
    await assertReadFilterAndOptionsValidation();
    await assertAdapterAndReturnShapeValidation();
    await assertSourceBoundaryGuards();

    console.log("[OK] action event log store contract smoke passed");
}

main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
});
