import {
    CAPABILITY_CONTRACT_REFS
} from "../capabilityDefinition.mjs";
import {
    createCapabilityRegistry
} from "../capabilityRegistryContract.mjs";
import {
    createCapabilityServiceRegistry
} from "../capabilityServiceContract.mjs";
import {
    createCapabilityRouterRegistry
} from "../../router/capabilityRouterRegistry.mjs";
import {
    createBackendAdapterRegistry
} from "../../backends/backendAdapterRegistry.mjs";
import {
    NATIVE_WORKER_BACKEND_ADAPTER_ID,
    NATIVE_WORKER_BACKEND_KIND,
    createNativeWorkerBackendAdapterDefinition
} from "../../backends/nativeWorker/nativeWorkerBackendAdapterDefinition.mjs";

export const DEFAULT_EXECUTE_ACTION_ROUTE_ID = "text-generate-default";
export const DEFAULT_EXECUTE_ACTION_SERVICE_ID = "text.generate.default";
export const DEFAULT_EXECUTE_ACTION_MODEL_BUNDLE_ID = "mistral-text-local";
export const DEFAULT_EXECUTE_ACTION_HARDWARE_PROFILE_ID = "laptopFallback";

function createTextGenerateCapability() {
    return {
        capability: "text.generate",
        version: "v1",
        status: "contract-only",
        summary: "Generate text through an approved text capability service.",
        contracts: {
            ...CAPABILITY_CONTRACT_REFS
        },
        requirements: {
            streaming: "supported",
            cancellation: "supported",
            timeout: "supported",
            approval: "conditional"
        },
        policy: {
            maxTokens: true,
            approvalRequired: true,
            allowTools: false,
            budget: true
        },
        compatibility: {
            backendKinds: [NATIVE_WORKER_BACKEND_KIND],
            modelBundleRequired: true,
            contextRefs: true
        }
    };
}

function createTextGenerateRoute() {
    return {
        routeId: DEFAULT_EXECUTE_ACTION_ROUTE_ID,
        capability: "text.generate",
        status: "contract-only",
        serviceId: DEFAULT_EXECUTE_ACTION_SERVICE_ID,
        backendKind: NATIVE_WORKER_BACKEND_KIND,
        backendId: NATIVE_WORKER_BACKEND_ADAPTER_ID,
        modelBundleId: DEFAULT_EXECUTE_ACTION_MODEL_BUNDLE_ID,
        hardwareProfileId: DEFAULT_EXECUTE_ACTION_HARDWARE_PROFILE_ID,
        requirements: {
            streaming: "supported",
            cancellation: "supported",
            timeout: "supported"
        }
    };
}

function createTextGenerateService() {
    return {
        serviceId: DEFAULT_EXECUTE_ACTION_SERVICE_ID,
        capability: "text.generate",
        version: "v1",
        status: "contract-only",
        summary: "Validate text generation inputs and normalize text generation results.",
        contracts: {
            ...CAPABILITY_CONTRACT_REFS
        },
        input: {
            schema: "text.generate.input.v1",
            requiredFields: ["prompt"],
            optionalFields: ["contextRefs"],
            contextRefs: "supported"
        },
        result: {
            schema: "text.generate.result.v1",
            outputFields: ["text"],
            streamingDeltas: "supported"
        },
        requirements: {
            streaming: "supported",
            cancellation: "supported",
            timeout: "supported",
            approval: "conditional"
        },
        compatibility: {
            backendKinds: [NATIVE_WORKER_BACKEND_KIND],
            modelBundleRequired: true,
            hardwareProfileRequired: true
        }
    };
}

export function createDefaultExecuteActionRegistries() {
    return {
        capabilityRegistry: createCapabilityRegistry([
            createTextGenerateCapability()
        ]),
        routerRegistry: createCapabilityRouterRegistry([
            createTextGenerateRoute()
        ]),
        serviceRegistry: createCapabilityServiceRegistry([
            createTextGenerateService()
        ]),
        backendAdapterRegistry: createBackendAdapterRegistry([
            createNativeWorkerBackendAdapterDefinition()
        ])
    };
}
