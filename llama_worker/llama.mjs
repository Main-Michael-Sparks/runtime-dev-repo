import { parentPort, receiveMessageOnPort } from "worker_threads";
import { getLlama, LlamaChatSession } from "node-llama-cpp";
import { config } from "../runtime/config/config.mjs";
import { deepFreeze } from "../runtime/config/configOverride.mjs";
import { buildContextRetryProfiles } from "../runtime/config/contextRetryProfiles.mjs";
import { resolveWorkerModelPath, createWorkerState } from "./state/workerState.mjs";
import { createWorkerOperationQueue } from "./serialization/workerOperationQueue.mjs";
import { createPromptAbortError } from "./errors/promptAbort.mjs";
import { createOutboundMessages } from "./messages/outboundMessages.mjs";
import { disposeModelWithPolicy, resolveModelDisposalPolicy } from "./lifecycle/modelDisposalPolicy.mjs";

const workerState = createWorkerState({
    baseConfig: config,
    modelPath: resolveWorkerModelPath(import.meta.url, config)
});

const { enqueueWorkerOperation } = createWorkerOperationQueue(workerState);
const {
    postReady,
    postStream,
    postDone,
    postResetDone,
    postModelResetDone,
    postShutdownDone,
    postWorkerError
} = createOutboundMessages(parentPort);

function assertWorkerReadyForNativeCommand() {
    if (workerState.resetting || workerState.shuttingDown) {
        throw new Error("Model is resetting");
    }

    if (!workerState.ready || !workerState.model) {
        throw new Error("Worker not ready");
    }
}

function setActiveInitConfig(msg) {
    if (workerState.initPromise || workerState.model || workerState.ready) return;

    workerState.activeConfig = msg.configSnapshot
        ? deepFreeze(msg.configSnapshot)
        : config;
    workerState.activeInitAttemptId = msg.initAttemptId ?? null;
    workerState.activeProfileName = msg.profileName ?? "base";
}

function resetActiveInitConfig() {
    workerState.activeConfig = config;
    workerState.activeInitAttemptId = null;
    workerState.activeProfileName = null;
}

function createActiveRequestRecord({ id, sessionId, cancelPort }) {
    cancelPort?.unref?.();

    return {
        id,
        sessionId,
        sequence: ++workerState.nextActiveRequestSequence,
        controller: new AbortController(),
        contextController: null,
        cancelPort: cancelPort ?? null,
        state: "running",
        abortReason: null,
        error: null,
        promise: null
    };
}

function getActiveRequest(id) {
    return workerState.activeRequests.get(id) ?? null;
}

function isActiveRequestAborting(record) {
    return record?.state === "aborting" ||
        record?.controller?.signal?.aborted === true ||
        record?.contextController?.signal?.aborted === true;
}

function readCancelPortMessage(record) {
    if (!record?.cancelPort) return null;

    let latestCancel = null;

    while (true) {
        const packet = receiveMessageOnPort(record.cancelPort);
        if (!packet) break;

        if (packet.message?.type === "cancel") {
            latestCancel = packet.message;
        }
    }

    return latestCancel;
}

function synchronizeExternalCancellation(record, message = "Prompt canceled") {
    const packet = readCancelPortMessage(record);
    if (!packet) return false;

    return abortActiveRequest(record, record.abortReason ?? createPromptAbortError(packet.reason ?? message, {
        requestId: record.id,
        sessionId: record.sessionId
    }));
}

function isPromptAbortError(record, err) {
    if (!record) return false;
    if (err === record.abortReason) return true;
    if (err?.isPromptAbort === true) return true;
    if (err?.name === "AbortError" && isActiveRequestAborting(record)) return true;

    return false;
}

function buildRequestObsoleteError(requestId) {
    if (requestId === null || requestId === undefined) return null;

    const record = getActiveRequest(requestId);

    if (!record) {
        return createPromptAbortError("Prompt canceled", { requestId });
    }

    synchronizeExternalCancellation(record);

    if (isActiveRequestAborting(record)) {
        return record.abortReason ?? createPromptAbortError("Prompt canceled", {
            requestId,
            sessionId: record.sessionId
        });
    }

    return null;
}

function isRequestObsolete(requestId) {
    return buildRequestObsoleteError(requestId) !== null;
}

function abortActiveRequest(record, reason) {
    if (!record || record.state === "done") return false;

    if (!record.abortReason) {
        record.abortReason = reason ?? createPromptAbortError("Prompt canceled", {
            requestId: record.id,
            sessionId: record.sessionId
        });
    }

    record.state = "aborting";

    if (!record.controller.signal.aborted) {
        record.controller.abort(record.abortReason);
    }

    if (record.contextController && !record.contextController.signal.aborted) {
        record.contextController.abort(record.abortReason);
    }

    return true;
}

function abortActiveRequestById(id, reason) {
    const record = getActiveRequest(id);
    if (!record) return false;

    return abortActiveRequest(record, reason ?? createPromptAbortError("Prompt canceled", {
        requestId: id,
        sessionId: record.sessionId
    }));
}

function getActiveRequestRecords(filterFn = null) {
    const records = [];

    for (const record of workerState.activeRequests.values()) {
        if (record.state === "done") continue;
        if (filterFn && !filterFn(record)) continue;

        records.push(record);
    }

    return records;
}

function abortActiveRequests(filterFn, reasonFactory) {
    const records = getActiveRequestRecords(filterFn);

    for (const record of records) {
        const reason = typeof reasonFactory === "function"
            ? reasonFactory(record)
            : reasonFactory;

        abortActiveRequest(record, reason ?? createPromptAbortError("Prompt canceled", {
            requestId: record.id,
            sessionId: record.sessionId
        }));
    }

    return records;
}

async function waitForActiveRequestBoundaries(records) {
    const pending = records
        .map((record) => record?.promise)
        .filter(Boolean);

    if (pending.length === 0) return [];

    return Promise.allSettled(pending);
}

async function waitForPriorSessionRequestBoundaries(sessionId, currentRequestId) {
    const current = getActiveRequest(currentRequestId);
    if (!current) return;

    const priorRecords = getActiveRequestRecords((record) => (
        record.sessionId === sessionId &&
        record.id !== currentRequestId &&
        record.sequence < current.sequence
    ));

    await waitForActiveRequestBoundaries(priorRecords);
}

function hasActiveRequestForSession(sessionId) {
    return getActiveRequestRecords((record) => record.sessionId === sessionId).length > 0;
}

function findEvictableSessionId() {
    for (const sessionId of workerState.sessions.keys()) {
        if (!hasActiveRequestForSession(sessionId)) {
            return sessionId;
        }
    }

    return null;
}

async function disposeSessionEntry(entry) {
    if (!entry) return;

    const cleanupErrors = [];

    if (entry.session?.disposed !== true && typeof entry.session?.dispose === "function") {
        try {
            entry.session.dispose({
                disposeSequence: true
            });
        } catch (err) {
            cleanupErrors.push(err);
        }
    }

    if (entry.context?.disposed !== true && typeof entry.context?.dispose === "function") {
        try {
            await entry.context.dispose();
        } catch (err) {
            cleanupErrors.push(err);
        }
    }

    if (cleanupErrors.length > 0) {
        throw cleanupErrors[0];
    }
}

async function disposeSessionById(sessionId) {
    const entry = workerState.sessions.get(sessionId);
    if (!entry) return;

    await disposeSessionEntry(entry);
    workerState.sessions.delete(sessionId);
}

async function disposeAllSessions() {
    const cleanupErrors = [];

    for (const [sessionId, entry] of workerState.sessions.entries()) {
        try {
            await disposeSessionEntry(entry);
        } catch (err) {
            cleanupErrors.push({ sessionId, err });
        }
    }

    workerState.sessions.clear();

    if (cleanupErrors.length > 0) {
        throw cleanupErrors[0].err;
    }
}

async function disposeModelStack({ operation } = {}) {
    await disposeAllSessions();

    const modelDisposalPolicy = resolveModelDisposalPolicy({ operation });
    const modelDisposalOutcome = await disposeModelWithPolicy({
        model: workerState.model,
        policy: modelDisposalPolicy
    });

    workerState.model = null;
    workerState.ready = false;
    workerState.initPromise = null;
    resetActiveInitConfig();

    return modelDisposalOutcome;
}

async function initModel() {
    if (workerState.initPromise) return workerState.initPromise;

    workerState.initPromise = (async () => {
        const llama = await getLlama();

        workerState.model = await llama.loadModel({
            modelPath: workerState.modelPath,
            gpuLayers: workerState.activeConfig.modelLoad.gpuLayers,
            useMmap: workerState.activeConfig.modelLoad.useMmap,
            useMlock: workerState.activeConfig.modelLoad.useMlock,
            ignoreMemorySafetyChecks: workerState.activeConfig.modelLoad.ignoreMemorySafetyChecks
        });

        workerState.ready = true;
        workerState.resetting = false;
        workerState.shuttingDown = false;

        postReady({
            initAttemptId: workerState.activeInitAttemptId,
            profileName: workerState.activeProfileName
        });
    })();

    return workerState.initPromise;
}

function toContextCreateOptions(contextConfig) {
    return {
        contextSize: contextConfig.contextSize,
        batchSize: contextConfig.batchSize,
        threads: contextConfig.threads,
        flashAttention: contextConfig.flashAttention,
        performanceTracking: contextConfig.performanceTracking,
        sequences: contextConfig.sequences,
        failedCreationRemedy: contextConfig.failedCreationRemedy,
        ignoreMemorySafetyChecks: contextConfig.ignoreMemorySafetyChecks
    };
}

function buildContextCreationObsoleteError(requestId) {
    const requestObsoleteError = buildRequestObsoleteError(requestId);
    if (requestObsoleteError) return requestObsoleteError;

    if (workerState.resetting || workerState.shuttingDown || !workerState.ready || !workerState.model) {
        return new Error("Model is resetting");
    }

    return null;
}

async function disposePartialSessionArtifacts({ session, context }) {
    const cleanupErrors = [];

    if (session?.disposed !== true && typeof session?.dispose === "function") {
        try {
            session.dispose({
                disposeSequence: true
            });
        } catch (err) {
            cleanupErrors.push(err);
        }
    }

    if (context?.disposed !== true && typeof context?.dispose === "function") {
        try {
            await context.dispose();
        } catch (err) {
            cleanupErrors.push(err);
        }
    }

    if (cleanupErrors.length > 0) {
        throw cleanupErrors[0];
    }
}

function buildContextCreationError({ sessionId, attemptedProfiles, lastError }) {
    const err = new Error(
        `Context creation failed after ${attemptedProfiles.length} attempt(s). ` +
        `Session: ${sessionId}. ` +
        `Attempted profiles: ${attemptedProfiles.join(", ")}. ` +
        `Last error: ${lastError?.message ?? String(lastError)}`
    );

    err.sessionId = sessionId;
    err.attemptedContextProfiles = attemptedProfiles;
    err.lastError = lastError;

    return err;
}

async function createSessionContextWithRetry(sessionId, requestId = null) {
    const profiles = buildContextRetryProfiles({
        baseContextConfig: workerState.activeConfig.context,
        creationRetry: workerState.activeConfig.context.creationRetry,
        hardwareProbe: workerState.activeConfig.hardwareProbe ?? null
    });

    const attemptedProfiles = [];
    let lastError = null;

    for (const profile of profiles) {
        const obsoleteBeforeAttempt = buildContextCreationObsoleteError(requestId);
        if (obsoleteBeforeAttempt) throw obsoleteBeforeAttempt;

        attemptedProfiles.push(profile.name);

        let context = null;
        let session = null;
        let contextController = null;
        const record = getActiveRequest(requestId);

        try {
            contextController = new AbortController();

            if (record) {
                record.contextController = contextController;
                synchronizeExternalCancellation(record, "Context creation canceled");
            }

            const obsoleteBeforeCreate = buildContextCreationObsoleteError(requestId);
            if (obsoleteBeforeCreate) throw obsoleteBeforeCreate;

            context = await workerState.model.createContext({
                ...toContextCreateOptions(profile.context),
                createSignal: contextController.signal
            });

            if (typeof context.getSequence !== "function") {
                throw new Error("Context does not expose getSequence()");
            }

            const sequence = context.getSequence();

            session = new LlamaChatSession({
                contextSequence: sequence
            });
        } catch (err) {
            lastError = err;
            await disposePartialSessionArtifacts({ session, context });

            const obsoleteAfterFailure = buildContextCreationObsoleteError(requestId);
            if (obsoleteAfterFailure) throw obsoleteAfterFailure;

            continue;
        } finally {
            if (record?.contextController === contextController) {
                record.contextController = null;
            }
        }

        const wrapper = {
            session,
            context,
            contextProfile: profile.name,
            contextConfig: profile.context
        };

        const obsoleteAfterSuccess = buildContextCreationObsoleteError(requestId);
        if (obsoleteAfterSuccess) {
            await disposePartialSessionArtifacts(wrapper);
            throw obsoleteAfterSuccess;
        }

        return wrapper;
    }

    throw buildContextCreationError({
        sessionId,
        attemptedProfiles,
        lastError
    });
}

async function getSession(sessionId, requestId = null) {
    if (!workerState.model) throw new Error("Model not initialized");

    if (workerState.sessions.has(sessionId)) return workerState.sessions.get(sessionId);

    if (workerState.sessions.size >= workerState.activeConfig.sessions.maxCount) {
        const evictableSessionId = findEvictableSessionId();

        if (!evictableSessionId) {
            throw new Error("Cannot create session: all sessions are active");
        }

        await disposeSessionById(evictableSessionId);
    }

    const wrapper = await createSessionContextWithRetry(sessionId, requestId);
    workerState.sessions.set(sessionId, wrapper);

    return wrapper;
}

async function resetSession(sessionId) {
    const records = abortActiveRequests(
        (record) => record.sessionId === sessionId,
        (record) => createPromptAbortError(`Session reset: ${sessionId}`, {
            requestId: record.id,
            sessionId
        })
    );

    await waitForActiveRequestBoundaries(records);
    await disposeSessionById(sessionId);
}

async function resetModel() {
    workerState.resetting = true;

    const records = abortActiveRequests(
        () => true,
        (record) => createPromptAbortError("Model reset", {
            requestId: record.id,
            sessionId: record.sessionId
        })
    );

    await waitForActiveRequestBoundaries(records);
    await disposeModelStack({ operation: "reset_model" });
}

async function shutdownWorker() {
    workerState.shuttingDown = true;

    const records = abortActiveRequests(
        () => true,
        (record) => createPromptAbortError("Runtime shutdown", {
            requestId: record.id,
            sessionId: record.sessionId
        })
    );

    await waitForActiveRequestBoundaries(records);
    await disposeModelStack({ operation: "shutdown" });
}

function toChunkFactory() {
    let lastTokens = [];

    return function toChunk(t) {
        if (Array.isArray(t)) {
            const chunk = workerState.model.detokenize(t, false, lastTokens);
            lastTokens = [...lastTokens, ...t].slice(-8);
            return chunk;
        }

        if (typeof t === "number") {
            const tokens = [t];
            const chunk = workerState.model.detokenize(tokens, false, lastTokens);
            lastTokens = [...lastTokens, ...tokens].slice(-8);
            return chunk;
        }

        return String(t);
    };
}

async function runPromptTask(record, msg) {
    const {
        id,
        text,
        sessionId = "default",
        stream = true
    } = msg;

    await waitForPriorSessionRequestBoundaries(sessionId, id);
    synchronizeExternalCancellation(record);

    const obsoleteBeforeSession = buildRequestObsoleteError(id);
    if (obsoleteBeforeSession) throw obsoleteBeforeSession;

    const { session } = await getSession(sessionId, id);
    synchronizeExternalCancellation(record);

    const toChunk = toChunkFactory();

    const result = await session.prompt(text, {
        maxTokens: workerState.activeConfig.model.maxTokens,
        temperature: workerState.activeConfig.model.temperature,
        topK: workerState.activeConfig.model.topK,
        topP: workerState.activeConfig.model.topP,
        repeatPenalty: workerState.activeConfig.model.repeatPenalty,
        signal: record.controller.signal,
        stopOnAbortSignal: false,

        onToken(t) {
            synchronizeExternalCancellation(record);
            if (isRequestObsolete(id)) return;
            if (!stream) return;

            const chunk = toChunk(t);

            postStream({
                id,
                token: chunk
            });
        }
    });

    const obsoleteAfterPrompt = buildRequestObsoleteError(id);
    if (obsoleteAfterPrompt) throw obsoleteAfterPrompt;

    postDone({
        id,
        res: result
    });
}

async function handlePromptMessage(msg) {
    const {
        id,
        sessionId = "default",
        cancelPort = null
    } = msg;

    const record = createActiveRequestRecord({ id, sessionId, cancelPort });
    workerState.activeRequests.set(id, record);

    record.promise = (async () => {
        try {
            await runPromptTask(record, msg);
        } catch (err) {
            record.error = err;

            if (isPromptAbortError(record, err)) {
                return;
            }

            throw err;
        } finally {
            record.state = "done";
            workerState.activeRequests.delete(id);

            try {
                record.cancelPort?.close();
            } catch {
                // no-op: port may already be closed
            }
        }
    })();

    await record.promise;
}

parentPort.on("message", async (msg) => {
    try {
        if (msg.type === "init") {
            setActiveInitConfig(msg);
            await initModel();
            return;
        }

        if (msg.type === "cancel") {
            const record = getActiveRequest(msg.id);
            const reason = createPromptAbortError(msg.reason ?? "Prompt canceled", {
                requestId: msg.id,
                sessionId: msg.sessionId ?? record?.sessionId ?? null
            });

            abortActiveRequestById(msg.id, reason);
            return;
        }

        if (msg.type === "shutdown") {
            await enqueueWorkerOperation("shutdown", async () => {
                await shutdownWorker();
                postShutdownDone();
            });
            return;
        }

        if (msg.type === "reset_session") {
            await enqueueWorkerOperation("reset_session", async () => {
                assertWorkerReadyForNativeCommand();
                await resetSession(msg.sessionId);
                postResetDone({
                    sessionId: msg.sessionId
                });
            });
            return;
        }

        if (msg.type === "reset_model") {
            await enqueueWorkerOperation("reset_model", async () => {
                assertWorkerReadyForNativeCommand();
                await resetModel();
                postModelResetDone();
            });
            return;
        }

        if (msg.type === "prompt") {
            assertWorkerReadyForNativeCommand();
            await handlePromptMessage(msg);
        }
    } catch (err) {
        const initErrorMeta = msg.type === "init" || msg.initAttemptId !== undefined
            ? {
                  initAttemptId: msg.initAttemptId ?? workerState.activeInitAttemptId,
                  profileName: msg.profileName ?? workerState.activeProfileName
              }
            : {};

        postWorkerError({
            id: msg.id,
            initErrorMeta,
            err,
            sessionId: msg.sessionId || null
        });
    }
});
