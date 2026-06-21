// smokeTestActionEventLogIntegration.mjs
//
// Purpose:
// - Narrow smoke for the Runtime Dev event-log integration seam.
// - Validates modular no-op runtime composition, non-fatal append behavior,
//   async adapter observation, high-volume exclusion defaults, and source
//   boundary guards without adding a DB/file/backend implementation.
//
// Run:
//   node ./tests/smokeTestActionEventLogIntegration.mjs

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

import {
    ACTION_EVENT_LOG_STORE_CONTRACT_VERSION
} from "../runtime/bus/actionEventLog/actionEventLogStoreContract.mjs";
import {
    appendRuntimeActionEventLog,
    createActionEventLogIntegration
} from "../runtime/bus/actionEventLog/actionEventLogIntegration.mjs";

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

function createActionEvent(overrides = {}) {
    return {
        eventId: "evt_event_log_integration_1",
        actionId: "act_event_log_integration_1",
        runId: "run_event_log_integration_1",
        capability: "text.generate",
        type: "action.completed",
        timestamp: 20,
        data: {
            source: "event-log-integration-smoke"
        },
        ...overrides
    };
}

function createStreamDeltaEvent(overrides = {}) {
    return createActionEvent({
        eventId: "evt_event_log_integration_stream_1",
        type: "action.stream.delta",
        data: {
            delta: "hello",
            index: 0,
            requestId: 1,
            chunkKind: "text",
            emittedAt: 20
        },
        ...overrides
    });
}

function createAdapter(overrides = {}) {
    return {
        contractVersion: ACTION_EVENT_LOG_STORE_CONTRACT_VERSION,
        adapterId: "event-log.integration-smoke",
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
                logOffset: "offset-integration-1",
                storedAt: Date.now()
            };
        },
        readEvents() {
            return {
                events: [],
                cursor: {
                    lastSequence: null,
                    lastLogOffset: null
                },
                truncated: false
            };
        },
        ...overrides
    };
}

function assertNoAdapterNoops() {
    const integration = createActionEventLogIntegration();
    const observation = appendRuntimeActionEventLog(integration, createActionEvent());

    assert(observation.skipped === true, "no-adapter integration should skip append");
    assert(observation.reason === "no_adapter", "no-adapter skip reason should be no_adapter");
    assert(observation.attempted === false, "no-adapter integration should not attempt append");

    ok("no-adapter integration no-op passed");
}

function assertSyncAdapterAppend() {
    const entries = [];
    const integration = createActionEventLogIntegration({
        adapter: createAdapter({
            appendEvent(entry) {
                entries.push(entry);
                return {
                    accepted: true,
                    eventId: entry.event.eventId,
                    sequence: 2,
                    logOffset: "offset-sync-1",
                    storedAt: Date.now()
                };
            }
        }),
        source: {
            kind: "runtime-action-event-test"
        },
        durability: "audit"
    });

    const observation = appendRuntimeActionEventLog(integration, createActionEvent());

    assert(observation.attempted === true, "sync adapter append should be attempted");
    assert(observation.accepted === true, "sync adapter append should be accepted");
    assert(observation.pending === false, "sync adapter append should not be pending");
    assert(entries.length === 1, "sync adapter should receive one append entry");
    assert(entries[0].source.kind === "runtime-action-event-test", "append entry should carry integration source metadata");
    assert(entries[0].durability === "audit", "append entry should carry integration durability");
    assert(Object.isFrozen(entries[0]), "append entry should be frozen by contract validation");

    ok("sync adapter append integration passed");
}

async function assertAsyncAdapterAppend() {
    const integration = createActionEventLogIntegration({
        adapter: createAdapter({
            appendEvent(entry) {
                return Promise.resolve({
                    accepted: true,
                    eventId: entry.event.eventId,
                    sequence: 3,
                    logOffset: "offset-async-1",
                    storedAt: Date.now()
                });
            }
        })
    });

    const observation = appendRuntimeActionEventLog(integration, createActionEvent({
        eventId: "evt_event_log_integration_async_1"
    }));

    assert(observation.attempted === true, "async adapter append should be attempted");
    assert(observation.pending === true, "async adapter append should be pending immediately");
    assert(observation.promise && typeof observation.promise.then === "function", "async adapter append should expose settlement promise");

    const settled = await observation.promise;
    assert(settled.accepted === true, "async adapter append should settle as accepted");
    assert(settled.result.logOffset === "offset-async-1", "async adapter append result should be normalized");

    ok("async adapter append observation passed");
}

async function assertAppendFailuresAreNonFatal() {
    const failures = [];
    const throwingIntegration = createActionEventLogIntegration({
        adapter: createAdapter({
            appendEvent() {
                throw new Error("append exploded");
            }
        }),
        onAppendError(err, context) {
            failures.push({ err, context });
        }
    });

    const thrownObservation = appendRuntimeActionEventLog(throwingIntegration, createActionEvent({
        eventId: "evt_event_log_integration_throw_1"
    }));

    assert(thrownObservation.accepted === false, "throwing append should not be accepted");
    assert(thrownObservation.reason === "append_failed", "throwing append should report append_failed");
    assert(failures.length === 1, "throwing append should notify observer once");
    assert(failures[0].context.eventId === "evt_event_log_integration_throw_1", "append observer should receive event context");

    const asyncFailures = [];
    const rejectingIntegration = createActionEventLogIntegration({
        adapter: createAdapter({
            appendEvent() {
                return Promise.reject(new Error("append rejected"));
            }
        }),
        onAppendError(err, context) {
            asyncFailures.push({ err, context });
        }
    });

    const rejectedObservation = appendRuntimeActionEventLog(rejectingIntegration, createActionEvent({
        eventId: "evt_event_log_integration_reject_1"
    }));
    const settled = await rejectedObservation.promise;

    assert(settled.accepted === false, "rejecting async append should settle without rejection");
    assert(settled.reason === "append_failed", "rejecting async append should report append_failed");
    assert(asyncFailures.length === 1, "rejecting async append should notify observer once");

    ok("append failures remained non-fatal passed");
}

async function assertHighVolumePolicy() {
    let appendCount = 0;
    const defaultIntegration = createActionEventLogIntegration({
        adapter: createAdapter({
            appendEvent(entry) {
                appendCount++;
                return {
                    accepted: true,
                    eventId: entry.event.eventId,
                    sequence: appendCount,
                    logOffset: `offset-${appendCount}`,
                    storedAt: Date.now()
                };
            }
        })
    });

    const skipped = appendRuntimeActionEventLog(defaultIntegration, createStreamDeltaEvent());
    assert(skipped.skipped === true, "stream delta should skip by default");
    assert(skipped.reason === "high_volume_event_type_excluded", "stream delta skip reason should be high-volume exclusion");
    assert(appendCount === 0, "stream delta skip should not call adapter");

    const highVolumeIntegration = createActionEventLogIntegration({
        adapter: createAdapter({
            capabilities: {
                append: true,
                read: true,
                cursorRead: true,
                highVolumeEvents: true
            },
            appendEvent(entry) {
                appendCount++;
                return {
                    accepted: true,
                    eventId: entry.event.eventId,
                    sequence: appendCount,
                    logOffset: `offset-${appendCount}`,
                    storedAt: Date.now()
                };
            }
        }),
        includeHighVolumeEvents: true
    });

    const accepted = appendRuntimeActionEventLog(highVolumeIntegration, createStreamDeltaEvent({
        eventId: "evt_event_log_integration_stream_2"
    }));

    assert(accepted.accepted === true, "explicit high-volume-capable integration should append stream delta");

    ok("high-volume integration policy passed");
}

async function assertSourceBoundaryGuards() {
    const runtimeSource = await readSource("runtime.mjs");
    const integrationSource = await readSource("runtime/bus/actionEventLog/actionEventLogIntegration.mjs");
    const bridgeSource = await readSource("workerBridge.mjs");
    const workerSource = await readSource("llama_worker/llama.mjs");

    assert(runtimeSource.includes("actionEventLogIntegration.mjs"), "runtime should import only the modular event-log integration seam");
    assert(runtimeSource.includes("createActionEventLogIntegration()"), "runtime should create a no-adapter integration by default");
    assert(runtimeSource.includes("appendRuntimeActionEventLog(actionEventLog, recordedEvent)"), "runtime should append only after in-memory history records the event");
    assert(!runtimeSource.includes("sqlite"), "runtime should not name a SQLite event-log backend");
    assert(!runtimeSource.includes("postgres"), "runtime should not name a PostgreSQL event-log backend");
    assert(!runtimeSource.includes("fs/promises"), "runtime should not own file-backed event-log storage");

    assert(!integrationSource.includes("workerBridge"), "event-log integration must not import workerBridge");
    assert(!integrationSource.includes("llama_worker"), "event-log integration must not import llama_worker");
    assert(!integrationSource.includes("actionEventHistory"), "event-log integration must not import bounded in-memory history");
    assert(!integrationSource.includes("actionEventReplay"), "event-log integration must not import replay helper");
    assert(!integrationSource.includes("actionEventSubscriptionRegistry"), "event-log integration must not import live subscription registry");
    assert(!integrationSource.includes("actionStreamDeltaEvents"), "event-log integration must not import stream delta observer");
    assert(!bridgeSource.includes("actionEventLog"), "workerBridge should not know about action event log integration");
    assert(!workerSource.includes("actionEventLog"), "llama_worker should not know about action event log integration");

    ok("event-log integration source-boundary guards passed");
}

async function main() {
    console.log("[SMOKE] action event log integration");

    assertNoAdapterNoops();
    assertSyncAdapterAppend();
    await assertAsyncAdapterAppend();
    await assertAppendFailuresAreNonFatal();
    await assertHighVolumePolicy();
    await assertSourceBoundaryGuards();

    console.log("[OK] action event log integration smoke passed");
}

main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
});
