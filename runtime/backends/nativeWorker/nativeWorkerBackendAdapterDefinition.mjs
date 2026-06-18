import {
    assertValidation,
    createValidationError,
    createValidationResult
} from "../../bus/contractValidation.mjs";
import {
    CAPABILITY_CONTRACT_REFS
} from "../../bus/capabilityDefinition.mjs";
import {
    CAPABILITY_SERVICE_CONTRACT_VERSION
} from "../../bus/capabilityServiceContract.mjs";
import {
    copyBackendAdapterDefinition
} from "../backendAdapterCommon.mjs";
import {
    normalizeBackendAdapterDefinition,
    validateBackendAdapterDefinition
} from "../backendAdapterDefinition.mjs";

export const NATIVE_WORKER_BACKEND_ADAPTER_CONTRACT_VERSION = "native-worker-backend-adapter.v1";
export const NATIVE_WORKER_BACKEND_KIND = "nativeWorkerBackend";
export const NATIVE_WORKER_BACKEND_ADAPTER_ID = "native-worker.default";
export const NATIVE_WORKER_BACKEND_ADAPTER_VERSION = "v1";
export const NATIVE_WORKER_BACKEND_ADAPTER_STATUS = "contract-only";

export const NATIVE_WORKER_BACKEND_CAPABILITIES = Object.freeze([
    "text.generate"
]);

export const NATIVE_WORKER_BACKEND_SERVICES = Object.freeze([
    "text.generate.default"
]);

export const NATIVE_WORKER_BACKEND_RESULT_SCHEMA = "text.generate.result.v1";

export const NATIVE_WORKER_BACKEND_RESULT_OUTPUT_FIELDS = Object.freeze([
    "text"
]);

function copyStringArray(value) {
    return Array.isArray(value) ? [...value] : value;
}

function hasExactStringArray(value, expected) {
    if (!Array.isArray(value)) return false;
    if (value.length !== expected.length) return false;

    for (let index = 0; index < expected.length; index++) {
        if (value[index] !== expected[index]) return false;
    }

    return true;
}

function addExactStringError(errors, value, expected, path, code, label) {
    if (value === expected) return;

    errors.push(createValidationError(
        path,
        code,
        `${label} must be ${expected}`,
        {
            expected,
            actual: value
        }
    ));
}

function addExactStringArrayError(errors, value, expected, path, code, label) {
    if (hasExactStringArray(value, expected)) return;

    errors.push(createValidationError(
        path,
        code,
        `${label} must be exactly: ${expected.join(", ")}`,
        {
            expected: [...expected],
            actual: copyStringArray(value)
        }
    ));
}

function createExpectedNativeWorkerBackendAdapterDefinition() {
    return {
        adapterId: NATIVE_WORKER_BACKEND_ADAPTER_ID,
        backendKind: NATIVE_WORKER_BACKEND_KIND,
        version: NATIVE_WORKER_BACKEND_ADAPTER_VERSION,
        status: NATIVE_WORKER_BACKEND_ADAPTER_STATUS,
        summary: "Native worker backend adapter descriptor for the built-in local text-generation worker path.",
        capabilities: [...NATIVE_WORKER_BACKEND_CAPABILITIES],
        services: [...NATIVE_WORKER_BACKEND_SERVICES],
        contracts: {
            servicePlan: CAPABILITY_SERVICE_CONTRACT_VERSION,
            result: CAPABILITY_CONTRACT_REFS.result,
            event: CAPABILITY_CONTRACT_REFS.event
        },
        result: {
            schema: NATIVE_WORKER_BACKEND_RESULT_SCHEMA,
            outputFields: [...NATIVE_WORKER_BACKEND_RESULT_OUTPUT_FIELDS],
            streamingDeltas: "supported",
            errorNormalization: "supported"
        },
        requirements: {
            streaming: "supported",
            cancellation: "supported",
            timeout: "supported"
        },
        compatibility: {
            backendKind: NATIVE_WORKER_BACKEND_KIND,
            modelBundleRequired: true,
            hardwareProfileRequired: true
        }
    };
}

export function createNativeWorkerBackendAdapterDefinition() {
    return createExpectedNativeWorkerBackendAdapterDefinition();
}

function addNativeWorkerExactContractErrors(errors, adapter) {
    const normalizedAdapter = normalizeBackendAdapterDefinition(adapter);
    const expected = createExpectedNativeWorkerBackendAdapterDefinition();

    addExactStringError(
        errors,
        normalizedAdapter.adapterId,
        expected.adapterId,
        "adapterId",
        "invalid_native_worker_backend_adapter_id",
        "Native worker backend adapterId"
    );
    addExactStringError(
        errors,
        normalizedAdapter.backendKind,
        expected.backendKind,
        "backendKind",
        "invalid_native_worker_backend_kind",
        "Native worker backend backendKind"
    );
    addExactStringError(
        errors,
        normalizedAdapter.version,
        expected.version,
        "version",
        "invalid_native_worker_backend_version",
        "Native worker backend version"
    );
    addExactStringError(
        errors,
        normalizedAdapter.status,
        expected.status,
        "status",
        "invalid_native_worker_backend_status",
        "Native worker backend status"
    );
    addExactStringArrayError(
        errors,
        normalizedAdapter.capabilities,
        expected.capabilities,
        "capabilities",
        "invalid_native_worker_backend_capabilities",
        "Native worker backend capabilities"
    );
    addExactStringArrayError(
        errors,
        normalizedAdapter.services,
        expected.services,
        "services",
        "invalid_native_worker_backend_services",
        "Native worker backend services"
    );
    addExactStringError(
        errors,
        normalizedAdapter.result?.schema,
        expected.result.schema,
        "result.schema",
        "invalid_native_worker_backend_result_schema",
        "Native worker backend result.schema"
    );
    addExactStringArrayError(
        errors,
        normalizedAdapter.result?.outputFields,
        expected.result.outputFields,
        "result.outputFields",
        "invalid_native_worker_backend_result_output_fields",
        "Native worker backend result.outputFields"
    );
    addExactStringError(
        errors,
        normalizedAdapter.result?.streamingDeltas,
        expected.result.streamingDeltas,
        "result.streamingDeltas",
        "invalid_native_worker_backend_streaming_deltas",
        "Native worker backend result.streamingDeltas"
    );
    addExactStringError(
        errors,
        normalizedAdapter.result?.errorNormalization,
        expected.result.errorNormalization,
        "result.errorNormalization",
        "invalid_native_worker_backend_error_normalization",
        "Native worker backend result.errorNormalization"
    );
    addExactStringError(
        errors,
        normalizedAdapter.requirements?.streaming,
        expected.requirements.streaming,
        "requirements.streaming",
        "invalid_native_worker_backend_streaming_requirement",
        "Native worker backend requirements.streaming"
    );
    addExactStringError(
        errors,
        normalizedAdapter.requirements?.cancellation,
        expected.requirements.cancellation,
        "requirements.cancellation",
        "invalid_native_worker_backend_cancellation_requirement",
        "Native worker backend requirements.cancellation"
    );
    addExactStringError(
        errors,
        normalizedAdapter.requirements?.timeout,
        expected.requirements.timeout,
        "requirements.timeout",
        "invalid_native_worker_backend_timeout_requirement",
        "Native worker backend requirements.timeout"
    );
    addExactStringError(
        errors,
        normalizedAdapter.compatibility?.backendKind,
        expected.compatibility.backendKind,
        "compatibility.backendKind",
        "invalid_native_worker_backend_compatibility_kind",
        "Native worker backend compatibility.backendKind"
    );

    if (normalizedAdapter.compatibility?.modelBundleRequired !== true) {
        errors.push(createValidationError(
            "compatibility.modelBundleRequired",
            "invalid_native_worker_backend_model_bundle_requirement",
            "Native worker backend compatibility.modelBundleRequired must be true",
            {
                expected: true,
                actual: normalizedAdapter.compatibility?.modelBundleRequired
            }
        ));
    }

    if (normalizedAdapter.compatibility?.hardwareProfileRequired !== true) {
        errors.push(createValidationError(
            "compatibility.hardwareProfileRequired",
            "invalid_native_worker_backend_hardware_profile_requirement",
            "Native worker backend compatibility.hardwareProfileRequired must be true",
            {
                expected: true,
                actual: normalizedAdapter.compatibility?.hardwareProfileRequired
            }
        ));
    }
}

export function validateNativeWorkerBackendAdapterDefinition(adapter) {
    const genericResult = validateBackendAdapterDefinition(adapter);
    const errors = [...genericResult.errors];

    addNativeWorkerExactContractErrors(errors, adapter);

    return createValidationResult(
        errors,
        errors.length === 0 ? copyBackendAdapterDefinition(genericResult.value) : null
    );
}

export function assertNativeWorkerBackendAdapterDefinition(adapter) {
    return assertValidation(
        validateNativeWorkerBackendAdapterDefinition(adapter),
        "Native worker backend adapter definition validation failed"
    );
}
