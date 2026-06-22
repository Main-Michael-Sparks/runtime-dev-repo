// smokeTestEventLogBackendContract.mjs
//
// Purpose:
// - Contract-only smoke for future Runtime Dev event-log store backends.
// - Validates metadata-only backend definition and policy descriptors without
//   selecting a DB/file backend or wiring runtime durable behavior.
//
// Run:
//   node ./tests/smokeTestEventLogBackendContract.mjs

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

import {
    ACTION_EVENT_LOG_STORE_CONTRACT_VERSION
} from "../runtime/bus/actionEventLog/actionEventLogStoreContract.mjs";
import {
    CONTRACT_ONLY_EVENT_LOG_BACKEND_DEFINITION,
    DEFAULT_EVENT_LOG_BACKEND_POLICY,
    EVENT_LOG_APPEND_ERROR_SURFACES,
    EVENT_LOG_APPEND_POLICIES,
    EVENT_LOG_BACKEND_CONTRACT_VERSION,
    EVENT_LOG_BACKEND_KIND,
    EVENT_LOG_BACKEND_STATUSES,
    EVENT_LOG_RUNTIME_WAIT_MODES,
    assertEventLogBackendDefinition,
    assertEventLogBackendPolicy,
    copyEventLogBackendDefinition,
    copyEventLogBackendPolicy,
    createEventLogBackendDefinition,
    isKnownEventLogAppendErrorSurface,
    isKnownEventLogAppendPolicy,
    isKnownEventLogBackendStatus,
    isKnownEventLogRuntimeWaitMode,
    normalizeEventLogBackendDefinition,
    normalizeEventLogBackendPolicy,
    validateEventLogBackendDefinition,
    validateEventLogBackendPolicy
} from "../runtime/backends/eventLogStore/eventLogBackendContract.mjs";

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

function assertErrorCode(result, code, label) {
    assert(result.ok === false, `${label} should fail validation`);
    assert(
        result.errors.some((error) => error.code === code),
        `${label} missing error code ${code}: ${JSON.stringify(result.errors)}`
    );
}

function assertThrowsValidation(label, fn, code) {
    try {
        fn();
        fail(`${label} should throw`);
    } catch (err) {
        if (String(err.message).startsWith("[FAIL]")) throw err;
        assert(Array.isArray(err.validationErrors), `${label} should carry validationErrors`);
        assert(
            err.validationErrors.some((error) => error.code === code),
            `${label} missing validation error code ${code}: ${JSON.stringify(err.validationErrors)}`
        );
    }
}

async function readSource(relativePath) {
    return fs.readFile(path.join(repoRoot, relativePath), "utf8");
}

function createBestEffortPolicy(overrides = {}) {
    return {
        policyId: "event-log.best-effort.default",
        appendPolicy: "best-effort",
        runtimeWaitMode: "never",
        appendErrorSurface: "observe-only",
        includeHighVolumeEvents: false,
        read: {
            durable: true,
            cursor: true,
            boundedHistoryFallback: false
        },
        ...overrides
    };
}

function createFailClosedPolicy(overrides = {}) {
    return createBestEffortPolicy({
        policyId: "event-log.fail-closed.metadata-only",
        appendPolicy: "fail-closed",
        runtimeWaitMode: "until-settled",
        appendErrorSurface: "throw",
        includeHighVolumeEvents: false,
        ...overrides
    });
}

function createValidDefinition(overrides = {}) {
    return {
        contractVersion: EVENT_LOG_BACKEND_CONTRACT_VERSION,
        backendKind: EVENT_LOG_BACKEND_KIND,
        backendId: "event-log.contract-only",
        status: "contract-only",
        storeContractVersion: ACTION_EVENT_LOG_STORE_CONTRACT_VERSION,
        summary: "Contract-only event-log store backend placeholder.",
        capabilities: {
            append: true,
            read: true,
            cursorRead: true,
            highVolumeEvents: false,
            durable: true
        },
        defaultPolicy: createBestEffortPolicy(),
        ...overrides
    };
}

async function assertConstants() {
    assert(
        EVENT_LOG_BACKEND_CONTRACT_VERSION === "runtime.eventLogBackend.v1",
        "event-log backend contract version should stay v1"
    );
    assert(EVENT_LOG_BACKEND_KIND === "eventLogStoreBackend", "backend kind should be eventLogStoreBackend");
    assert(EVENT_LOG_BACKEND_STATUSES.includes("contract-only"), "statuses should include contract-only");
    assert(EVENT_LOG_APPEND_POLICIES.includes("best-effort"), "append policies should include best-effort");
    assert(EVENT_LOG_APPEND_POLICIES.includes("buffered"), "append policies should include buffered metadata");
    assert(EVENT_LOG_APPEND_POLICIES.includes("fail-closed"), "append policies should include fail-closed metadata");
    assert(EVENT_LOG_RUNTIME_WAIT_MODES.includes("never"), "wait modes should include never");
    assert(EVENT_LOG_APPEND_ERROR_SURFACES.includes("observe-only"), "error surfaces should include observe-only");
    assert(isKnownEventLogAppendPolicy("best-effort"), "best-effort should be a known append policy");
    assert(isKnownEventLogRuntimeWaitMode("until-accepted"), "until-accepted should be a known wait mode");
    assert(isKnownEventLogAppendErrorSurface("operation-result"), "operation-result should be a known error surface");
    assert(isKnownEventLogBackendStatus("planned"), "planned should be a known backend status");

    ok("event-log backend constants passed");
}

async function assertPolicyValidation() {
    const input = createBestEffortPolicy({
        policyId: " event-log.best-effort.trimmed "
    });
    const policy = assertEventLogBackendPolicy(input);

    assert(policy.policyId === "event-log.best-effort.trimmed", "policyId should be normalized");
    assert(policy.appendPolicy === "best-effort", "best-effort policy should pass");
    assert(policy.runtimeWaitMode === "never", "default runtime wait mode should be metadata-only never");
    assert(policy.appendErrorSurface === "observe-only", "default append error surface should observe only");
    assert(policy.includeHighVolumeEvents === false, "high-volume append should default false");
    assert(policy.read.durable === true, "durable read capability metadata should be preserved");
    assert(Object.isFrozen(policy), "policy should be frozen");
    assert(Object.isFrozen(policy.read), "nested read policy should be frozen");
    assert(input.policyId === " event-log.best-effort.trimmed ", "policy normalization should not mutate caller input");

    const copied = copyEventLogBackendPolicy(policy);
    assert(copied !== policy, "copyEventLogBackendPolicy should create a defensive copy");
    assert(copied.read !== policy.read, "copied read policy should not reuse nested object");
    assert(Object.isFrozen(copied.read), "copied read policy should be frozen");

    const failClosed = assertEventLogBackendPolicy(createFailClosedPolicy());
    assert(failClosed.appendPolicy === "fail-closed", "fail-closed should be accepted as metadata vocabulary");
    assert(failClosed.runtimeWaitMode === "until-settled", "until-settled should be accepted as metadata vocabulary");
    assert(failClosed.appendErrorSurface === "throw", "throw should be accepted as metadata vocabulary");

    const buffered = normalizeEventLogBackendPolicy(createBestEffortPolicy({
        policyId: "event-log.buffered.metadata-only",
        appendPolicy: "buffered",
        runtimeWaitMode: "until-accepted",
        appendErrorSurface: "operation-result"
    }));
    assert(buffered.appendPolicy === "buffered", "buffered should normalize as metadata vocabulary");

    assertErrorCode(
        validateEventLogBackendPolicy({ ...createBestEffortPolicy(), appendPolicy: "strict" }),
        "unknown_event_log_backend_append_policy",
        "invalid append policy"
    );
    assertErrorCode(
        validateEventLogBackendPolicy({ ...createBestEffortPolicy(), runtimeWaitMode: "always" }),
        "unknown_event_log_backend_runtime_wait_mode",
        "invalid runtime wait mode"
    );
    assertErrorCode(
        validateEventLogBackendPolicy({ ...createBestEffortPolicy(), appendErrorSurface: "log" }),
        "unknown_event_log_backend_append_error_surface",
        "invalid append error surface"
    );
    assertErrorCode(
        validateEventLogBackendPolicy({ ...createBestEffortPolicy(), includeHighVolumeEvents: "yes" }),
        "invalid_event_log_backend_high_volume_policy",
        "invalid high-volume policy type"
    );
    assertErrorCode(
        validateEventLogBackendPolicy({ ...createBestEffortPolicy(), read: { durable: true, cursor: true } }),
        "invalid_event_log_backend_read_policy_boolean",
        "missing read.boundedHistoryFallback"
    );
    assertErrorCode(
        validateEventLogBackendPolicy({ ...createBestEffortPolicy(), backendKind: "eventLogStoreBackend" }),
        "unknown_event_log_backend_policy_field",
        "unknown policy field"
    );
    assertErrorCode(
        validateEventLogBackendPolicy({ ...createBestEffortPolicy(), policyId: "../event-log" }),
        "forbidden_event_log_backend_metadata_value",
        "path-like policyId"
    );
    assertErrorCode(
        validateEventLogBackendPolicy({ ...createBestEffortPolicy(), adapterFactory: "makeAdapter" }),
        "forbidden_event_log_backend_policy_key",
        "forbidden adapter factory policy key"
    );

    assert(DEFAULT_EVENT_LOG_BACKEND_POLICY.appendPolicy === "best-effort", "default policy should preserve current behavior vocabulary");
    ok("event-log backend policy validation passed");
}

async function assertDefinitionValidation() {
    const input = createValidDefinition({
        backendId: " event-log.contract-only.trimmed "
    });
    const definition = assertEventLogBackendDefinition(input);

    assert(definition.contractVersion === EVENT_LOG_BACKEND_CONTRACT_VERSION, "definition contractVersion should pass");
    assert(definition.backendKind === EVENT_LOG_BACKEND_KIND, "definition backendKind should pass");
    assert(definition.backendId === "event-log.contract-only.trimmed", "backendId should be normalized");
    assert(definition.storeContractVersion === ACTION_EVENT_LOG_STORE_CONTRACT_VERSION, "definition should point to action-event log store contract");
    assert(definition.capabilities.append === true, "append capability metadata should be preserved");
    assert(definition.capabilities.durable === true, "durable capability metadata should be preserved");
    assert(definition.defaultPolicy.appendPolicy === "best-effort", "default policy should be validated through policy contract");
    assert(Object.isFrozen(definition), "definition should be frozen");
    assert(Object.isFrozen(definition.capabilities), "definition capabilities should be frozen");
    assert(Object.isFrozen(definition.defaultPolicy.read), "definition default policy read object should be frozen");
    assert(input.backendId === " event-log.contract-only.trimmed ", "definition normalization should not mutate caller input");

    const copied = copyEventLogBackendDefinition(definition);
    assert(copied !== definition, "copyEventLogBackendDefinition should create a defensive copy");
    assert(copied.capabilities !== definition.capabilities, "definition copy should not reuse capabilities object");
    assert(Object.isFrozen(copied.defaultPolicy), "definition copy defaultPolicy should be frozen");

    const created = createEventLogBackendDefinition({
        backendId: "event-log.future-postgres.contract",
        status: "planned",
        defaultPolicy: createFailClosedPolicy({
            policyId: "event-log.future-postgres.fail-closed.metadata-only"
        })
    });
    assert(created.status === "planned", "createEventLogBackendDefinition should accept planned metadata");
    assert(created.defaultPolicy.appendPolicy === "fail-closed", "createEventLogBackendDefinition should validate override policy");

    const normalized = normalizeEventLogBackendDefinition(createValidDefinition({ backendId: " event-log.normalized " }));
    assert(normalized.backendId === "event-log.normalized", "normalizeEventLogBackendDefinition should trim backendId");

    assertErrorCode(
        validateEventLogBackendDefinition({ ...createValidDefinition(), backendKind: "nativeWorkerBackend" }),
        "invalid_event_log_backend_kind",
        "invalid backend kind"
    );
    assertErrorCode(
        validateEventLogBackendDefinition({ ...createValidDefinition(), contractVersion: "eventLog.v0" }),
        "invalid_event_log_backend_contract_version",
        "invalid contract version"
    );
    assertErrorCode(
        validateEventLogBackendDefinition({ ...createValidDefinition(), storeContractVersion: "actionEventLog.v0" }),
        "invalid_event_log_backend_store_contract_version",
        "invalid store contract version"
    );
    assertErrorCode(
        validateEventLogBackendDefinition({ ...createValidDefinition(), status: "ready" }),
        "unknown_event_log_backend_status",
        "invalid backend status"
    );
    assertErrorCode(
        validateEventLogBackendDefinition({ ...createValidDefinition(), backendId: "./event-log" }),
        "forbidden_event_log_backend_metadata_value",
        "path-like backendId"
    );
    assertErrorCode(
        validateEventLogBackendDefinition({
            ...createValidDefinition(),
            capabilities: {
                append: true,
                read: true,
                cursorRead: true,
                highVolumeEvents: false,
                durable: "yes"
            }
        }),
        "invalid_event_log_backend_capability_boolean",
        "invalid capability boolean"
    );
    assertErrorCode(
        validateEventLogBackendDefinition({
            ...createValidDefinition(),
            capabilities: {
                append: true,
                read: true,
                cursorRead: true,
                highVolumeEvents: false,
                durable: true,
                streamReplay: true
            }
        }),
        "unknown_event_log_backend_capability_field",
        "unknown capability field"
    );
    assertErrorCode(
        validateEventLogBackendDefinition({
            ...createValidDefinition(),
            defaultPolicy: {
                ...createBestEffortPolicy(),
                appendPolicy: "strict"
            }
        }),
        "unknown_event_log_backend_append_policy",
        "invalid nested default policy"
    );
    assertErrorCode(
        validateEventLogBackendDefinition({ ...createValidDefinition(), appendEvent() {} }),
        "forbidden_event_log_backend_definition_key",
        "forbidden appendEvent definition key"
    );
    assertErrorCode(
        validateEventLogBackendDefinition({ ...createValidDefinition(), dbPath: "./events.db" }),
        "forbidden_event_log_backend_definition_key",
        "forbidden dbPath definition key"
    );

    assertThrowsValidation(
        "assertEventLogBackendPolicy invalid policy",
        () => assertEventLogBackendPolicy({ ...createBestEffortPolicy(), appendPolicy: "strict" }),
        "unknown_event_log_backend_append_policy"
    );
    assertThrowsValidation(
        "assertEventLogBackendDefinition invalid definition",
        () => assertEventLogBackendDefinition({ ...createValidDefinition(), backendKind: "nativeWorkerBackend" }),
        "invalid_event_log_backend_kind"
    );

    assert(CONTRACT_ONLY_EVENT_LOG_BACKEND_DEFINITION.backendKind === EVENT_LOG_BACKEND_KIND, "contract-only definition should use event-log backend kind");
    ok("event-log backend definition validation passed");
}

async function assertMetadataOnlyBoundary() {
    const modulePaths = [
        "runtime/backends/eventLogStore/eventLogBackendCommon.mjs",
        "runtime/backends/eventLogStore/eventLogBackendPolicy.mjs",
        "runtime/backends/eventLogStore/eventLogBackendDefinition.mjs",
        "runtime/backends/eventLogStore/eventLogBackendContract.mjs"
    ];

    const forbiddenFragments = [
        "../runtime.mjs",
        "../../runtime.mjs",
        "../../../runtime.mjs",
        "workerBridge",
        "llama_worker",
        "runtime/lifecycle",
        "runtime/request",
        "runtime/stream",
        "node-llama-cpp",
        "fs/promises",
        "child_process",
        "sqlite",
        "postgres",
        "better-sqlite3"
    ];

    for (const modulePath of modulePaths) {
        const source = await readSource(modulePath);
        for (const fragment of forbiddenFragments) {
            assert(!source.includes(fragment), `${modulePath} should not include forbidden fragment ${fragment}`);
        }

        assert(!/\bappendEvent\s*\(/.test(source), `${modulePath} should not implement appendEvent()`);
        assert(!/\breadEvents\s*\(/.test(source), `${modulePath} should not implement readEvents()`);
        assert(!/new\s+Worker\b/.test(source), `${modulePath} should not create workers`);
    }

    const runtimeSource = await readSource("runtime.mjs");
    assert(
        !runtimeSource.includes("eventLogBackendContract") &&
            !runtimeSource.includes("eventLogStoreBackend"),
        "runtime.mjs should not select or wire an event-log backend in this contract-only branch"
    );

    ok("event-log backend metadata-only source-boundary guards passed");
}

async function main() {
    console.log("[SMOKE] event-log backend contract");

    await assertConstants();
    await assertPolicyValidation();
    await assertDefinitionValidation();
    await assertMetadataOnlyBoundary();

    console.log("[OK] event-log backend contract smoke passed");
}

main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
});
