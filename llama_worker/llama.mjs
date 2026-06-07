import { parentPort, receiveMessageOnPort } from "worker_threads";
import { getLlama, LlamaChatSession } from "node-llama-cpp";
import { config } from "../runtime/config/config.mjs";
import { deepFreeze } from "../runtime/config/configOverride.mjs";
import { buildContextRetryProfiles } from "../runtime/config/contextRetryProfiles.mjs";
import { resolveWorkerModelPath, createWorkerState } from "./state/workerState.mjs";
import { createWorkerOperationQueue } from "./serialization/workerOperationQueue.mjs";
import { createPromptAbortError } from "./errors/promptAbort.mjs";
import { createOutboundMessages } from "./messages/outboundMessages.mjs";
import { createWorkerProtocolRouter } from "./messages/workerProtocolRouter.mjs";
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
import { createPromptRunner } from "./prompt/promptRunner.mjs";
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

const requestBoundaries = createRequestBoundaries({
    requests: activeRequestRegistry
});

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

const { handlePromptMessage } = createPromptRunner({
    state: workerState,
    requests: activeRequestRegistry,
    boundaries: requestBoundaries,
    sessionService: {
        getSession
    },
    createChunkFactory,
    postStream,
    postDone
});

const handleWorkerMessage = createWorkerProtocolRouter({
    state: workerState,
    enqueueWorkerOperation,
    modelLifecycle: {
        assertWorkerReadyForNativeCommand,
        setActiveInitConfig,
        initModel
    },
    sessionService: {
        resetSession
    },
    resetLifecycle: {
        resetModel
    },
    shutdownLifecycle: {
        shutdownWorker
    },
    promptRunner: {
        handlePromptMessage
    },
    requests: activeRequestRegistry,
    createPromptAbortError,
    postResetDone,
    postModelResetDone,
    postShutdownDone,
    postWorkerError
});

parentPort.on("message", handleWorkerMessage);
