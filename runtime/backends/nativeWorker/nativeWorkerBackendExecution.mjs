import {
    assertCapabilityBusExecuteActionOrchestrationDescriptor
} from "../../bus/executeAction/capabilityBusExecuteActionOrchestration.mjs";
import {
    NATIVE_WORKER_BACKEND_ADAPTER_ID,
    NATIVE_WORKER_BACKEND_KIND,
    NATIVE_WORKER_BACKEND_SERVICES
} from "./nativeWorkerBackendAdapterDefinition.mjs";

const NATIVE_WORKER_TEXT_CAPABILITY = "text.generate";

function createUnsupportedNativeWorkerExecutionError(message, details = {}) {
    const err = new Error(message);
    err.code = details.code ?? "unsupported_native_worker_backend_execution";
    err.kind = details.kind ?? "unsupported_route";
    err.details = { ...details };
    return err;
}

function assertRunNativeTextRequest(deps) {
    if (!deps || typeof deps.runNativeTextRequest !== "function") {
        throw new Error("nativeWorkerBackend execution requires deps.runNativeTextRequest");
    }
}

function getInvocation(orchestrationDescriptor) {
    return orchestrationDescriptor.backendAdapterInvocationDescriptor.invocation;
}

function getActionInput(orchestrationDescriptor) {
    return orchestrationDescriptor.executeActionPlan.busAction.action.input;
}

function getActionRequirements(orchestrationDescriptor) {
    return orchestrationDescriptor.executeActionPlan.busAction.action.requirements ?? {};
}

function assertNativeWorkerInvocation(invocation) {
    if (invocation.capability !== NATIVE_WORKER_TEXT_CAPABILITY) {
        throw createUnsupportedNativeWorkerExecutionError(
            `nativeWorkerBackend execution supports ${NATIVE_WORKER_TEXT_CAPABILITY} only`,
            {
                code: "unsupported_native_worker_backend_capability",
                capability: invocation.capability
            }
        );
    }

    if (invocation.backendKind !== NATIVE_WORKER_BACKEND_KIND) {
        throw createUnsupportedNativeWorkerExecutionError(
            `nativeWorkerBackend execution requires backendKind ${NATIVE_WORKER_BACKEND_KIND}`,
            {
                code: "unsupported_native_worker_backend_kind",
                backendKind: invocation.backendKind,
                expectedBackendKind: NATIVE_WORKER_BACKEND_KIND
            }
        );
    }

    if (invocation.adapterId !== NATIVE_WORKER_BACKEND_ADAPTER_ID) {
        throw createUnsupportedNativeWorkerExecutionError(
            `nativeWorkerBackend execution requires adapterId ${NATIVE_WORKER_BACKEND_ADAPTER_ID}`,
            {
                code: "unsupported_native_worker_backend_adapter",
                adapterId: invocation.adapterId,
                expectedAdapterId: NATIVE_WORKER_BACKEND_ADAPTER_ID
            }
        );
    }

    if (!NATIVE_WORKER_BACKEND_SERVICES.includes(invocation.serviceId)) {
        throw createUnsupportedNativeWorkerExecutionError(
            `nativeWorkerBackend execution does not support serviceId ${invocation.serviceId}`,
            {
                code: "unsupported_native_worker_backend_service",
                serviceId: invocation.serviceId,
                supportedServices: [...NATIVE_WORKER_BACKEND_SERVICES]
            }
        );
    }
}

function extractPrompt(input) {
    const prompt = typeof input?.prompt === "string" ? input.prompt : "";

    if (!prompt.trim()) {
        throw createUnsupportedNativeWorkerExecutionError(
            "nativeWorkerBackend text.generate execution requires input.prompt",
            {
                code: "missing_native_worker_text_prompt",
                kind: "validation"
            }
        );
    }

    return prompt;
}

function createNativeTextRequestOptions(invocation, requirements, options) {
    return {
        ...options,
        stream: invocation.stream === true,
        ...(requirements.timeoutMs === undefined ? {} : { timeoutMs: requirements.timeoutMs })
    };
}

export async function runNativeWorkerAction(orchestrationDescriptor, deps = {}, options = {}) {
    assertRunNativeTextRequest(deps);

    const orchestration = assertCapabilityBusExecuteActionOrchestrationDescriptor(orchestrationDescriptor);
    const invocation = getInvocation(orchestration);

    assertNativeWorkerInvocation(invocation);

    const prompt = extractPrompt(getActionInput(orchestration));
    const requestOptions = createNativeTextRequestOptions(
        invocation,
        getActionRequirements(orchestration),
        options
    );
    const requestHandle = await deps.runNativeTextRequest(prompt, requestOptions);

    return {
        actionId: invocation.actionId,
        ...(invocation.runId === undefined ? {} : { runId: invocation.runId }),
        capability: invocation.capability,
        requestId: requestHandle.id,
        backend: {
            kind: invocation.backendKind,
            adapterId: invocation.adapterId,
            ...(invocation.modelBundleId === undefined ? {} : { modelBundleId: invocation.modelBundleId }),
            ...(invocation.hardwareProfileId === undefined ? {} : { hardwareProfileId: invocation.hardwareProfileId })
        },
        stream: requestHandle.stream,
        done: requestHandle.done
    };
}
