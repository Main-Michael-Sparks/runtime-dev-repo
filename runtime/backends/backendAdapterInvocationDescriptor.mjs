import {
    assertValidation,
    createValidationError,
    createValidationResult,
    isFiniteNonNegativeNumber,
    isPlainObject
} from "../bus/contractValidation.mjs";
import {
    CAPABILITY_EXECUTOR_CONTRACT_VERSION
} from "../execution/capabilityExecutionCommon.mjs";
import {
    validateCapabilityExecutionPlan
} from "../execution/capabilityExecutionPlan.mjs";
import {
    CAPABILITY_EXECUTOR_SKELETON_CONTRACT_VERSION
} from "../execution/capabilityExecutorSkeletonCommon.mjs";
import {
    validateCapabilityExecutorSkeletonPlan
} from "../execution/capabilityExecutorSkeletonPlan.mjs";
import {
    BACKEND_ADAPTER_INVOCATION_BOUNDARY,
    BACKEND_ADAPTER_INVOCATION_CONTRACT_VERSION,
    BACKEND_ADAPTER_INVOCATION_EXECUTABLE,
    BACKEND_ADAPTER_INVOCATION_NATIVE_EXECUTION,
    BACKEND_ADAPTER_INVOCATION_RUNTIME_WIRING,
    BACKEND_ADAPTER_INVOCATION_STATUS,
    addBackendAdapterInvocationMetadataStringValidation,
    addForbiddenBackendAdapterInvocationKeyErrors,
    addOptionalBackendAdapterInvocationStringError,
    addRequiredBackendAdapterInvocationStringError,
    addUnknownBackendAdapterInvocationFieldErrors,
    copyBackendAdapterInvocationDescriptor,
    copyBackendAdapterInvocationValue,
    normalizeBackendAdapterInvocationString,
    prefixBackendAdapterInvocationValidationErrors
} from "./backendAdapterInvocationCommon.mjs";

const BACKEND_ADAPTER_INVOCATION_DESCRIPTOR_FIELDS = new Set([
    "contractVersion",
    "status",
    "invocation",
    "boundary"
]);

const BACKEND_ADAPTER_INVOCATION_FIELDS = new Set([
    "actionId",
    "runId",
    "capability",
    "serviceId",
    "adapterId",
    "backendKind",
    "routeId",
    "modelBundleId",
    "hardwareProfileId",
    "stream",
    "timeoutMs",
    "resultContract",
    "eventContract"
]);

const BACKEND_ADAPTER_INVOCATION_REQUIRED_STRING_FIELDS = new Set([
    "actionId",
    "capability",
    "serviceId",
    "adapterId",
    "backendKind",
    "routeId",
    "resultContract",
    "eventContract"
]);

const BACKEND_ADAPTER_INVOCATION_OPTIONAL_STRING_FIELDS = new Set([
    "runId",
    "modelBundleId",
    "hardwareProfileId"
]);

const BACKEND_ADAPTER_INVOCATION_BOUNDARY_FIELDS = new Set([
    "adapterInvocation",
    "executable",
    "runtimeWiring",
    "nativeExecution"
]);

function createBackendAdapterInvocationBoundary() {
    return {
        adapterInvocation: BACKEND_ADAPTER_INVOCATION_BOUNDARY,
        executable: BACKEND_ADAPTER_INVOCATION_EXECUTABLE,
        runtimeWiring: BACKEND_ADAPTER_INVOCATION_RUNTIME_WIRING,
        nativeExecution: BACKEND_ADAPTER_INVOCATION_NATIVE_EXECUTION
    };
}

function createBackendAdapterInvocationMetadata(invocation) {
    const normalized = {};

    for (const field of BACKEND_ADAPTER_INVOCATION_FIELDS) {
        if (invocation[field] === undefined) continue;

        normalized[field] = normalizeBackendAdapterInvocationString(invocation[field]);
    }

    return normalized;
}

function createBackendAdapterInvocationDescriptorFromInvocation(invocation) {
    return {
        contractVersion: BACKEND_ADAPTER_INVOCATION_CONTRACT_VERSION,
        status: BACKEND_ADAPTER_INVOCATION_STATUS,
        invocation: createBackendAdapterInvocationMetadata(invocation),
        boundary: createBackendAdapterInvocationBoundary()
    };
}

function createBackendAdapterInvocationDescriptorFromExecutionPlan(executionPlan) {
    return createBackendAdapterInvocationDescriptorFromInvocation(executionPlan.invocation);
}

function validateBackendAdapterInvocationMetadata(invocation) {
    const errors = [];

    if (!isPlainObject(invocation)) {
        return createValidationResult([
            createValidationError(
                "invocation",
                "invalid_backend_adapter_invocation_metadata",
                "Backend adapter invocation metadata must be a plain object"
            )
        ]);
    }

    addForbiddenBackendAdapterInvocationKeyErrors(
        errors,
        invocation,
        "forbidden_backend_adapter_invocation_metadata_key",
        "Backend adapter invocation metadata"
    );

    addUnknownBackendAdapterInvocationFieldErrors(
        errors,
        invocation,
        BACKEND_ADAPTER_INVOCATION_FIELDS,
        "invocation",
        "unknown_backend_adapter_invocation_metadata_field",
        "backend adapter invocation metadata"
    );

    const normalized = createBackendAdapterInvocationMetadata(invocation);

    for (const field of BACKEND_ADAPTER_INVOCATION_REQUIRED_STRING_FIELDS) {
        addRequiredBackendAdapterInvocationStringError(
            errors,
            normalized[field],
            `invocation.${field}`,
            `invalid_backend_adapter_invocation_${field}`,
            `Backend adapter invocation ${field}`
        );
        addBackendAdapterInvocationMetadataStringValidation(errors, normalized[field], `invocation.${field}`);
    }

    for (const field of BACKEND_ADAPTER_INVOCATION_OPTIONAL_STRING_FIELDS) {
        addOptionalBackendAdapterInvocationStringError(
            errors,
            normalized[field],
            `invocation.${field}`,
            `invalid_backend_adapter_invocation_${field}`,
            `Backend adapter invocation ${field}`
        );
        addBackendAdapterInvocationMetadataStringValidation(errors, normalized[field], `invocation.${field}`);
    }

    if (normalized.stream !== undefined && typeof normalized.stream !== "boolean") {
        errors.push(createValidationError(
            "invocation.stream",
            "invalid_backend_adapter_invocation_stream_flag",
            "Backend adapter invocation stream must be a boolean when provided"
        ));
    }

    if (normalized.timeoutMs !== undefined && !isFiniteNonNegativeNumber(normalized.timeoutMs)) {
        errors.push(createValidationError(
            "invocation.timeoutMs",
            "invalid_backend_adapter_invocation_timeout_ms",
            "Backend adapter invocation timeoutMs must be a finite non-negative number when provided"
        ));
    }

    return createValidationResult(
        errors,
        errors.length === 0 ? copyBackendAdapterInvocationValue(normalized) : null
    );
}

function validateBackendAdapterInvocationBoundary(boundary) {
    const errors = [];

    if (!isPlainObject(boundary)) {
        return createValidationResult([
            createValidationError(
                "boundary",
                "invalid_backend_adapter_invocation_boundary",
                "Backend adapter invocation boundary must be a plain object"
            )
        ]);
    }

    addForbiddenBackendAdapterInvocationKeyErrors(
        errors,
        boundary,
        "forbidden_backend_adapter_invocation_boundary_key",
        "Backend adapter invocation boundary"
    );

    addUnknownBackendAdapterInvocationFieldErrors(
        errors,
        boundary,
        BACKEND_ADAPTER_INVOCATION_BOUNDARY_FIELDS,
        "boundary",
        "unknown_backend_adapter_invocation_boundary_field",
        "backend adapter invocation boundary"
    );

    if (boundary.adapterInvocation !== BACKEND_ADAPTER_INVOCATION_BOUNDARY) {
        errors.push(createValidationError(
            "boundary.adapterInvocation",
            "invalid_backend_adapter_invocation_boundary_adapter_invocation",
            `Backend adapter invocation boundary.adapterInvocation must be ${BACKEND_ADAPTER_INVOCATION_BOUNDARY}`,
            {
                expected: BACKEND_ADAPTER_INVOCATION_BOUNDARY
            }
        ));
    }

    if (boundary.executable !== BACKEND_ADAPTER_INVOCATION_EXECUTABLE) {
        errors.push(createValidationError(
            "boundary.executable",
            "invalid_backend_adapter_invocation_boundary_executable",
            "Backend adapter invocation boundary.executable must be false"
        ));
    }

    if (boundary.runtimeWiring !== BACKEND_ADAPTER_INVOCATION_RUNTIME_WIRING) {
        errors.push(createValidationError(
            "boundary.runtimeWiring",
            "invalid_backend_adapter_invocation_boundary_runtime_wiring",
            `Backend adapter invocation boundary.runtimeWiring must be ${BACKEND_ADAPTER_INVOCATION_RUNTIME_WIRING}`,
            {
                expected: BACKEND_ADAPTER_INVOCATION_RUNTIME_WIRING
            }
        ));
    }

    if (boundary.nativeExecution !== BACKEND_ADAPTER_INVOCATION_NATIVE_EXECUTION) {
        errors.push(createValidationError(
            "boundary.nativeExecution",
            "invalid_backend_adapter_invocation_boundary_native_execution",
            `Backend adapter invocation boundary.nativeExecution must be ${BACKEND_ADAPTER_INVOCATION_NATIVE_EXECUTION}`,
            {
                expected: BACKEND_ADAPTER_INVOCATION_NATIVE_EXECUTION
            }
        ));
    }

    return createValidationResult(
        errors,
        errors.length === 0 ? copyBackendAdapterInvocationValue(boundary) : null
    );
}

function validateNormalizedBackendAdapterInvocationDescriptor(descriptor) {
    const errors = [];

    if (!isPlainObject(descriptor)) {
        return createValidationResult([
            createValidationError(
                "descriptor",
                "invalid_backend_adapter_invocation_descriptor",
                "Backend adapter invocation descriptor must be a plain object"
            )
        ]);
    }

    addForbiddenBackendAdapterInvocationKeyErrors(
        errors,
        descriptor,
        "forbidden_backend_adapter_invocation_descriptor_key",
        "Backend adapter invocation descriptor"
    );

    addUnknownBackendAdapterInvocationFieldErrors(
        errors,
        descriptor,
        BACKEND_ADAPTER_INVOCATION_DESCRIPTOR_FIELDS,
        "descriptor",
        "unknown_backend_adapter_invocation_descriptor_field",
        "backend adapter invocation descriptor"
    );

    if (descriptor.contractVersion !== BACKEND_ADAPTER_INVOCATION_CONTRACT_VERSION) {
        errors.push(createValidationError(
            "descriptor.contractVersion",
            "unsupported_backend_adapter_invocation_contract_version",
            `Backend adapter invocation descriptor contractVersion must be ${BACKEND_ADAPTER_INVOCATION_CONTRACT_VERSION}`,
            {
                expected: BACKEND_ADAPTER_INVOCATION_CONTRACT_VERSION
            }
        ));
    }

    if (descriptor.status !== BACKEND_ADAPTER_INVOCATION_STATUS) {
        errors.push(createValidationError(
            "descriptor.status",
            "invalid_backend_adapter_invocation_status",
            `Backend adapter invocation descriptor status must be ${BACKEND_ADAPTER_INVOCATION_STATUS}`,
            {
                expected: BACKEND_ADAPTER_INVOCATION_STATUS
            }
        ));
    }

    const invocationResult = validateBackendAdapterInvocationMetadata(descriptor.invocation);

    if (!invocationResult.ok) {
        errors.push(...prefixBackendAdapterInvocationValidationErrors(
            invocationResult.errors,
            "descriptor",
            "backend_adapter_invocation_descriptor"
        ));
    }

    const boundaryResult = validateBackendAdapterInvocationBoundary(descriptor.boundary);

    if (!boundaryResult.ok) {
        errors.push(...prefixBackendAdapterInvocationValidationErrors(
            boundaryResult.errors,
            "descriptor",
            "backend_adapter_invocation_descriptor"
        ));
    }

    return createValidationResult(
        errors,
        errors.length === 0
            ? copyBackendAdapterInvocationDescriptor({
                  contractVersion: BACKEND_ADAPTER_INVOCATION_CONTRACT_VERSION,
                  status: BACKEND_ADAPTER_INVOCATION_STATUS,
                  invocation: invocationResult.value,
                  boundary: boundaryResult.value
              })
            : null
    );
}

function looksLikeBackendAdapterInvocationDescriptor(value) {
    if (!isPlainObject(value)) return false;
    if (value.contractVersion === BACKEND_ADAPTER_INVOCATION_CONTRACT_VERSION) return true;
    if (typeof value.contractVersion === "string" && value.contractVersion.startsWith("backend-adapter-invocation.")) return true;
    return isPlainObject(value.boundary) && value.boundary.nativeExecution !== undefined;
}

function looksLikeCapabilityExecutorSkeletonPlan(value) {
    if (!isPlainObject(value)) return false;
    if (value.contractVersion === CAPABILITY_EXECUTOR_SKELETON_CONTRACT_VERSION) return true;
    if (typeof value.contractVersion === "string" && value.contractVersion.startsWith("capability-executor-skeleton.")) return true;
    return value.executionPlan !== undefined && value.boundary !== undefined;
}

function looksLikeCapabilityExecutionPlan(value) {
    if (!isPlainObject(value)) return false;
    if (value.contractVersion === CAPABILITY_EXECUTOR_CONTRACT_VERSION) return true;
    if (typeof value.contractVersion === "string" && value.contractVersion.startsWith("capability-executor.")) return true;
    return value.backendPlan !== undefined && value.invocation !== undefined;
}

export function validateBackendAdapterInvocationDescriptor(value) {
    if (looksLikeBackendAdapterInvocationDescriptor(value)) {
        return validateNormalizedBackendAdapterInvocationDescriptor(value);
    }

    if (looksLikeCapabilityExecutorSkeletonPlan(value)) {
        const skeletonResult = validateCapabilityExecutorSkeletonPlan(value);

        if (!skeletonResult.ok) {
            return createValidationResult(prefixBackendAdapterInvocationValidationErrors(
                skeletonResult.errors,
                "source",
                "backend_adapter_invocation_source_skeleton"
            ));
        }

        return validateNormalizedBackendAdapterInvocationDescriptor(
            createBackendAdapterInvocationDescriptorFromExecutionPlan(skeletonResult.value.executionPlan)
        );
    }

    if (looksLikeCapabilityExecutionPlan(value)) {
        const executionResult = validateCapabilityExecutionPlan(value);

        if (!executionResult.ok) {
            return createValidationResult(prefixBackendAdapterInvocationValidationErrors(
                executionResult.errors,
                "source",
                "backend_adapter_invocation_source_execution"
            ));
        }

        return validateNormalizedBackendAdapterInvocationDescriptor(
            createBackendAdapterInvocationDescriptorFromExecutionPlan(executionResult.value)
        );
    }

    return createValidationResult([
        createValidationError(
            "source",
            "unsupported_backend_adapter_invocation_source",
            "Backend adapter invocation descriptor must be derived from a capability execution plan or executor skeleton descriptor"
        )
    ]);
}

export function normalizeBackendAdapterInvocationDescriptor(value) {
    return assertBackendAdapterInvocationDescriptor(value);
}

export function assertBackendAdapterInvocationDescriptor(value) {
    return assertValidation(
        validateBackendAdapterInvocationDescriptor(value),
        "Backend adapter invocation descriptor validation failed"
    );
}
