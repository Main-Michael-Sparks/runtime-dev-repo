import {
    assertValidation,
    createValidationError,
    createValidationResult,
    isPlainObject
} from "../bus/contractValidation.mjs";
import {
    CAPABILITY_EXECUTOR_CONTRACT_VERSION
} from "./capabilityExecutionCommon.mjs";
import {
    validateCapabilityExecutionPlan
} from "./capabilityExecutionPlan.mjs";
import {
    CAPABILITY_EXECUTOR_SKELETON_ADAPTER_INVOCATION,
    CAPABILITY_EXECUTOR_SKELETON_CONTRACT_VERSION,
    CAPABILITY_EXECUTOR_SKELETON_EXECUTABLE,
    CAPABILITY_EXECUTOR_SKELETON_EXECUTOR_BOUNDARY,
    CAPABILITY_EXECUTOR_SKELETON_RUNTIME_WIRING,
    CAPABILITY_EXECUTOR_SKELETON_STATUS,
    addCapabilityExecutorSkeletonMetadataStringValidation,
    addForbiddenCapabilityExecutorSkeletonKeyErrors,
    addUnknownCapabilityExecutorSkeletonFieldErrors,
    copyCapabilityExecutorSkeletonPlan,
    copyCapabilityExecutorSkeletonValue,
    prefixCapabilityExecutorSkeletonValidationErrors
} from "./capabilityExecutorSkeletonCommon.mjs";

const CAPABILITY_EXECUTOR_SKELETON_PLAN_FIELDS = new Set([
    "contractVersion",
    "status",
    "executionPlan",
    "invocation",
    "boundary"
]);

const CAPABILITY_EXECUTOR_SKELETON_INVOCATION_FIELDS = new Set([
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

const CAPABILITY_EXECUTOR_SKELETON_BOUNDARY_FIELDS = new Set([
    "executor",
    "executable",
    "adapterInvocation",
    "runtimeWiring"
]);

function createCapabilityExecutorSkeletonInvocation(executionPlan) {
    return copyCapabilityExecutorSkeletonValue(executionPlan.invocation);
}

function createCapabilityExecutorSkeletonBoundary() {
    return {
        executor: CAPABILITY_EXECUTOR_SKELETON_EXECUTOR_BOUNDARY,
        executable: CAPABILITY_EXECUTOR_SKELETON_EXECUTABLE,
        adapterInvocation: CAPABILITY_EXECUTOR_SKELETON_ADAPTER_INVOCATION,
        runtimeWiring: CAPABILITY_EXECUTOR_SKELETON_RUNTIME_WIRING
    };
}

function createCapabilityExecutorSkeletonPlan(executionPlan) {
    return {
        contractVersion: CAPABILITY_EXECUTOR_SKELETON_CONTRACT_VERSION,
        status: CAPABILITY_EXECUTOR_SKELETON_STATUS,
        executionPlan: copyCapabilityExecutorSkeletonValue(executionPlan),
        invocation: createCapabilityExecutorSkeletonInvocation(executionPlan),
        boundary: createCapabilityExecutorSkeletonBoundary()
    };
}

function validateCapabilityExecutorSkeletonInvocation(invocation, executionPlan) {
    const errors = [];

    if (!isPlainObject(invocation)) {
        return createValidationResult([
            createValidationError(
                "invocation",
                "invalid_capability_executor_skeleton_invocation",
                "Capability executor skeleton invocation must be a plain object"
            )
        ]);
    }

    addForbiddenCapabilityExecutorSkeletonKeyErrors(
        errors,
        invocation,
        "forbidden_capability_executor_skeleton_invocation_key",
        "Capability executor skeleton invocation"
    );

    addUnknownCapabilityExecutorSkeletonFieldErrors(
        errors,
        invocation,
        CAPABILITY_EXECUTOR_SKELETON_INVOCATION_FIELDS,
        "invocation",
        "unknown_capability_executor_skeleton_invocation_field",
        "capability executor skeleton invocation"
    );

    const expectedInvocation = executionPlan.invocation;

    for (const field of CAPABILITY_EXECUTOR_SKELETON_INVOCATION_FIELDS) {
        addCapabilityExecutorSkeletonMetadataStringValidation(
            errors,
            typeof invocation[field] === "string" ? invocation[field] : undefined,
            `invocation.${field}`
        );

        if (invocation[field] !== expectedInvocation[field]) {
            errors.push(createValidationError(
                `invocation.${field}`,
                `capability_executor_skeleton_${field}_mismatch`,
                `Capability executor skeleton invocation ${field} must match executionPlan invocation ${field}`
            ));
        }
    }

    return createValidationResult(
        errors,
        errors.length === 0 ? copyCapabilityExecutorSkeletonValue(invocation) : null
    );
}

function validateCapabilityExecutorSkeletonBoundary(boundary) {
    const errors = [];

    if (!isPlainObject(boundary)) {
        return createValidationResult([
            createValidationError(
                "boundary",
                "invalid_capability_executor_skeleton_boundary",
                "Capability executor skeleton boundary must be a plain object"
            )
        ]);
    }

    addForbiddenCapabilityExecutorSkeletonKeyErrors(
        errors,
        boundary,
        "forbidden_capability_executor_skeleton_boundary_key",
        "Capability executor skeleton boundary"
    );

    addUnknownCapabilityExecutorSkeletonFieldErrors(
        errors,
        boundary,
        CAPABILITY_EXECUTOR_SKELETON_BOUNDARY_FIELDS,
        "boundary",
        "unknown_capability_executor_skeleton_boundary_field",
        "capability executor skeleton boundary"
    );

    if (boundary.executor !== CAPABILITY_EXECUTOR_SKELETON_EXECUTOR_BOUNDARY) {
        errors.push(createValidationError(
            "boundary.executor",
            "invalid_capability_executor_skeleton_boundary_executor",
            `Capability executor skeleton boundary.executor must be ${CAPABILITY_EXECUTOR_SKELETON_EXECUTOR_BOUNDARY}`,
            {
                expected: CAPABILITY_EXECUTOR_SKELETON_EXECUTOR_BOUNDARY
            }
        ));
    }

    if (boundary.executable !== CAPABILITY_EXECUTOR_SKELETON_EXECUTABLE) {
        errors.push(createValidationError(
            "boundary.executable",
            "invalid_capability_executor_skeleton_boundary_executable",
            "Capability executor skeleton boundary.executable must be false"
        ));
    }

    if (boundary.adapterInvocation !== CAPABILITY_EXECUTOR_SKELETON_ADAPTER_INVOCATION) {
        errors.push(createValidationError(
            "boundary.adapterInvocation",
            "invalid_capability_executor_skeleton_boundary_adapter_invocation",
            `Capability executor skeleton boundary.adapterInvocation must be ${CAPABILITY_EXECUTOR_SKELETON_ADAPTER_INVOCATION}`,
            {
                expected: CAPABILITY_EXECUTOR_SKELETON_ADAPTER_INVOCATION
            }
        ));
    }

    if (boundary.runtimeWiring !== CAPABILITY_EXECUTOR_SKELETON_RUNTIME_WIRING) {
        errors.push(createValidationError(
            "boundary.runtimeWiring",
            "invalid_capability_executor_skeleton_boundary_runtime_wiring",
            `Capability executor skeleton boundary.runtimeWiring must be ${CAPABILITY_EXECUTOR_SKELETON_RUNTIME_WIRING}`,
            {
                expected: CAPABILITY_EXECUTOR_SKELETON_RUNTIME_WIRING
            }
        ));
    }

    return createValidationResult(
        errors,
        errors.length === 0 ? copyCapabilityExecutorSkeletonValue(boundary) : null
    );
}

function validateNormalizedCapabilityExecutorSkeletonPlan(skeletonPlan) {
    const errors = [];

    if (!isPlainObject(skeletonPlan)) {
        return createValidationResult([
            createValidationError(
                "skeletonPlan",
                "invalid_capability_executor_skeleton_plan",
                "Capability executor skeleton plan must be a plain object"
            )
        ]);
    }

    addForbiddenCapabilityExecutorSkeletonKeyErrors(
        errors,
        skeletonPlan,
        "forbidden_capability_executor_skeleton_plan_key",
        "Capability executor skeleton plan"
    );

    addUnknownCapabilityExecutorSkeletonFieldErrors(
        errors,
        skeletonPlan,
        CAPABILITY_EXECUTOR_SKELETON_PLAN_FIELDS,
        "skeletonPlan",
        "unknown_capability_executor_skeleton_plan_field",
        "capability executor skeleton plan"
    );

    if (skeletonPlan.contractVersion !== CAPABILITY_EXECUTOR_SKELETON_CONTRACT_VERSION) {
        errors.push(createValidationError(
            "skeletonPlan.contractVersion",
            "unsupported_capability_executor_skeleton_contract_version",
            `Capability executor skeleton contractVersion must be ${CAPABILITY_EXECUTOR_SKELETON_CONTRACT_VERSION}`,
            {
                expected: CAPABILITY_EXECUTOR_SKELETON_CONTRACT_VERSION
            }
        ));
    }

    if (skeletonPlan.status !== CAPABILITY_EXECUTOR_SKELETON_STATUS) {
        errors.push(createValidationError(
            "skeletonPlan.status",
            "invalid_capability_executor_skeleton_status",
            `Capability executor skeleton status must be ${CAPABILITY_EXECUTOR_SKELETON_STATUS}`,
            {
                expected: CAPABILITY_EXECUTOR_SKELETON_STATUS
            }
        ));
    }

    const executionPlanResult = validateCapabilityExecutionPlan(skeletonPlan.executionPlan);

    if (!executionPlanResult.ok) {
        errors.push(...prefixCapabilityExecutorSkeletonValidationErrors(
            executionPlanResult.errors,
            "skeletonPlan.executionPlan",
            "capability_executor_skeleton_execution_plan"
        ));
    }

    if (errors.length > 0 || !executionPlanResult.ok) {
        return createValidationResult(errors);
    }

    const executionPlan = executionPlanResult.value;
    const invocationResult = validateCapabilityExecutorSkeletonInvocation(
        skeletonPlan.invocation,
        executionPlan
    );

    if (!invocationResult.ok) {
        errors.push(...prefixCapabilityExecutorSkeletonValidationErrors(
            invocationResult.errors,
            "skeletonPlan",
            "capability_executor_skeleton"
        ));
    }

    const boundaryResult = validateCapabilityExecutorSkeletonBoundary(skeletonPlan.boundary);

    if (!boundaryResult.ok) {
        errors.push(...prefixCapabilityExecutorSkeletonValidationErrors(
            boundaryResult.errors,
            "skeletonPlan",
            "capability_executor_skeleton"
        ));
    }

    return createValidationResult(
        errors,
        errors.length === 0
            ? copyCapabilityExecutorSkeletonPlan({
                  contractVersion: CAPABILITY_EXECUTOR_SKELETON_CONTRACT_VERSION,
                  status: CAPABILITY_EXECUTOR_SKELETON_STATUS,
                  executionPlan,
                  invocation: invocationResult.value,
                  boundary: boundaryResult.value
              })
            : null
    );
}

function looksLikeCapabilityExecutorSkeletonPlan(value) {
    if (!isPlainObject(value)) return false;
    if (value.contractVersion === CAPABILITY_EXECUTOR_SKELETON_CONTRACT_VERSION) return true;
    if (typeof value.contractVersion === "string" && value.contractVersion.startsWith("capability-executor-skeleton.")) return true;
    return value.executionPlan !== undefined || value.boundary !== undefined || value.status === CAPABILITY_EXECUTOR_SKELETON_STATUS;
}

export function validateCapabilityExecutorSkeletonPlan(value) {
    if (looksLikeCapabilityExecutorSkeletonPlan(value)) {
        return validateNormalizedCapabilityExecutorSkeletonPlan(value);
    }

    const executionPlanResult = validateCapabilityExecutionPlan(value);

    if (!executionPlanResult.ok) {
        return createValidationResult(executionPlanResult.errors);
    }

    const skeletonPlan = createCapabilityExecutorSkeletonPlan(executionPlanResult.value);
    return validateNormalizedCapabilityExecutorSkeletonPlan(skeletonPlan);
}

export function normalizeCapabilityExecutorSkeletonPlan(executionPlan) {
    return assertCapabilityExecutorSkeletonPlan(executionPlan);
}

export function assertCapabilityExecutorSkeletonPlan(executionPlan) {
    return assertValidation(
        validateCapabilityExecutorSkeletonPlan(executionPlan),
        "Capability executor skeleton plan validation failed"
    );
}
