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
import { createModelLifecycle } from "./lifecycle/modelLifecycle.mjs";
import { createResetLifecycle } from "./lifecycle/resetLifecycle.mjs";
import { createShutdownLifecycle } from "./lifecycle/shutdownLifecycle.mjs";
import {
    disposeSessionById,
    disposeAllSessions,
    disposePartialSessionArtifacts
} from "./session/sessionDisposal.mjs";
import {
    toContextCreateOptions,
    buildContextCreationError
} from "./context/contextOptions.mjs";
import { createChunkFactory } from "./prompt/chunkFactory.mjs";
import { createContextRetryService } from "./context/contextRetryService.mjs";
import { createSessionService } from "./session/sessionService.mjs";
import { createActiveRequestRegistry } from "./cancellation/activeRequestRegistry.mjs";
import { createRequestBoundaries } from "./cancellation/requestBoundaries.mjs";

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

const activeRequestRegistry = createActiveRequestRegistry({
    state: workerState,
    receiveMessageOnPort,
    createPromptAbortError
});

const {
    createActiveRequestRecord,
    getActiveRequest,
    synchronizeExternalCancellation,
    isPromptAbortError,
    buildRequestObsoleteError,
    isRequestObsolete,
    abortActiveRequestById
} = activeRequestRegistry;

const requestBoundaries = createRequestBoundaries({
    requests: activeRequestRegistry
});

const {
    waitForPriorSessionRequestBoundaries
} = requestBoundaries;

const contextRetryService = createContextRetryService({
    state: workerState,
    LlamaChatSession,
    buildContextRetryProfiles,
    requests: activeRequestRegistry,
    toContextCreateOptions,
    buildContextCreationError,
    disposePartialSessionArtifacts
});

const {
    getSession,
    resetSession
} = createSessionService({
    state: workerState,
    boundaries: requestBoundaries,
    contextRetryService,
    disposeSessionById,
    requests: activeRequestRegistry,
    createPromptAbortError
});

const modelLifecycle = createModelLifecycle({
    state: workerState,
    baseConfig: config,
    deepFreeze,
    getLlama,
    disposeAllSessions,
    disposeModelWithPolicy,
    resolveModelDisposalPolicy,
    postReady
});

const {
    assertWorkerReadyForNativeCommand,
    setActiveInitConfig,
    initModel,
    disposeModelStack
} = modelLifecycle;

const { resetModel } = createResetLifecycle({
    state: workerState,
    requests: activeRequestRegistry,
    boundaries: requestBoundaries,
    createPromptAbortError,
    disposeModelStack
});

const { shutdownWorker } = createShutdownLifecycle({
    state: workerState,
    requests: activeRequestRegistry,
    boundaries: requestBoundaries,
    createPromptAbortError,
    disposeModelStack
});

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

    const toChunk = createChunkFactory(workerState.model);

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
