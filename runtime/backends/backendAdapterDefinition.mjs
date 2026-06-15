import {
    assertValidation,
    createValidationError,
    createValidationResult,
    isNonEmptyString,
    isPlainObject
} from "../bus/contractValidation.mjs";
import {
    CAPABILITY_CONTRACT_REFS,
    CAPABILITY_REQUIREMENT_SUPPORT_LEVELS,
    isKnownCapabilityRequirementSupportLevel
} from "../bus/capabilityDefinition.mjs";
import { isKnownCapability } from "../bus/capabilityTaxonomy.mjs";
import { CAPABILITY_SERVICE_CONTRACT_VERSION } from "../bus/capabilityServiceContract.mjs";
import {
    BACKEND_ADAPTER_STATUSES,
    addBackendAdapterMetadataStringValidation,
    addBackendAdapterStringArrayValidation,
    addForbiddenBackendAdapterKeyErrors,
    addRequiredBackendAdapterStringError,
    addUnknownBackendAdapterFieldErrors,
    copyBackendAdapterDefinition,
    normalizeOptionalString,
    normalizeOptionalStringArray
} from "./backendAdapterCommon.mjs";

const BACKEND_ADAPTER_STATUS_SET = new Set(BACKEND_ADAPTER_STATUSES);
const BACKEND_ADAPTER_REQUIREMENT_SUPPORT_LEVEL_SET = new Set(CAPABILITY_REQUIREMENT_SUPPORT_LEVELS);

const BACKEND_ADAPTER_FIELDS = new Set([
    "adapterId",
    "backendKind",
    "version",
    "status",
    "summary",
    "capabilities",
    "services",
    "contracts",
    "result",
    "requirements",
    "compatibility"
]);

const BACKEND_ADAPTER_CONTRACT_FIELDS = new Set([
    "servicePlan",
    "result",
    "event"
]);

const BACKEND_ADAPTER_RESULT_FIELDS = new Set([
    "schema",
    "outputFields",
    "streamingDeltas",
    "errorNormalization"
]);

const BACKEND_ADAPTER_REQUIREMENT_FIELDS = new Set([
    "streaming",
    "cancellation",
    "timeout"
]);

const BACKEND_ADAPTER_COMPATIBILITY_FIELDS = new Set([
    "backendKind",
    "modelBundleRequired",
    "hardwareProfileRequired"
]);

export function isKnownBackendAdapterStatus(value) {
    return BACKEND_ADAPTER_STATUS_SET.has(value);
}

export function isKnownBackendAdapterRequirementSupportLevel(value) {
    return BACKEND_ADAPTER_REQUIREMENT_SUPPORT_LEVEL_SET.has(value);
}

function normalizeAdapterContracts(contracts) {
    if (!isPlainObject(contracts)) return contracts;

    return {
        ...contracts,
        servicePlan: normalizeOptionalString(contracts.servicePlan),
        result: normalizeOptionalString(contracts.result),
        event: normalizeOptionalString(contracts.event)
    };
}

function normalizeAdapterResult(result) {
    if (!isPlainObject(result)) return result;

    return {
        ...result,
        schema: normalizeOptionalString(result.schema),
        outputFields: normalizeOptionalStringArray(result.outputFields),
        streamingDeltas: normalizeOptionalString(result.streamingDeltas),
        errorNormalization: normalizeOptionalString(result.errorNormalization)
    };
}

function normalizeAdapterRequirements(requirements) {
    if (!isPlainObject(requirements)) return requirements;

    return {
        ...requirements,
        streaming: normalizeOptionalString(requirements.streaming),
        cancellation: normalizeOptionalString(requirements.cancellation),
        timeout: normalizeOptionalString(requirements.timeout)
    };
}

function normalizeAdapterCompatibility(compatibility) {
    if (!isPlainObject(compatibility)) return compatibility;

    return {
        ...compatibility,
        backendKind: normalizeOptionalString(compatibility.backendKind),
        modelBundleRequired: compatibility.modelBundleRequired,
        hardwareProfileRequired: compatibility.hardwareProfileRequired
    };
}

function addRequirementSupportLevelError(errors, value, path) {
    if (!isNonEmptyString(value)) {
        errors.push(createValidationError(
            path,
            "missing_backend_adapter_requirement_support_level",
            `${path} must be a non-empty support-level string`
        ));
        return;
    }

    if (!isKnownBackendAdapterRequirementSupportLevel(value)) {
        errors.push(createValidationError(
            path,
            "unknown_backend_adapter_requirement_support_level",
            `Unknown backend adapter requirement support level: ${value}`,
            {
                supportLevel: value
            }
        ));
    }
}

function addBooleanFieldError(errors, value, path) {
    if (typeof value === "boolean") return;

    errors.push(createValidationError(
        path,
        "invalid_backend_adapter_boolean_field",
        `${path} must be a boolean`
    ));
}

function validateAdapterContracts(contracts, errors) {
    if (!isPlainObject(contracts)) {
        errors.push(createValidationError(
            "contracts",
            "invalid_backend_adapter_contracts",
            "Backend adapter contracts must be a plain object"
        ));
        return;
    }

    addUnknownBackendAdapterFieldErrors(
        errors,
        contracts,
        BACKEND_ADAPTER_CONTRACT_FIELDS,
        "contracts",
        "unknown_backend_adapter_contract_field",
        "backend adapter contracts"
    );

    const expectedContracts = {
        servicePlan: CAPABILITY_SERVICE_CONTRACT_VERSION,
        result: CAPABILITY_CONTRACT_REFS.result,
        event: CAPABILITY_CONTRACT_REFS.event
    };

    for (const [key, expected] of Object.entries(expectedContracts)) {
        if (contracts[key] !== expected) {
            errors.push(createValidationError(
                `contracts.${key}`,
                "invalid_backend_adapter_contract_ref",
                `contracts.${key} must be ${expected}`,
                {
                    expected
                }
            ));
        }
    }
}

function validateAdapterCapabilities(capabilities, errors) {
    addBackendAdapterStringArrayValidation(errors, capabilities, "capabilities");
    if (!Array.isArray(capabilities)) return;

    for (let index = 0; index < capabilities.length; index++) {
        const capability = typeof capabilities[index] === "string" ? capabilities[index].trim() : capabilities[index];
        if (!isNonEmptyString(capability)) continue;

        if (!isKnownCapability(capability)) {
            errors.push(createValidationError(
                `capabilities[${index}]`,
                "unknown_backend_adapter_capability",
                `Unknown backend adapter capability: ${capability}`,
                {
                    capability
                }
            ));
        }
    }
}

function validateAdapterResult(result, errors) {
    if (!isPlainObject(result)) {
        errors.push(createValidationError(
            "result",
            "invalid_backend_adapter_result",
            "Backend adapter result contract must be a plain object"
        ));
        return;
    }

    addUnknownBackendAdapterFieldErrors(
        errors,
        result,
        BACKEND_ADAPTER_RESULT_FIELDS,
        "result",
        "unknown_backend_adapter_result_field",
        "backend adapter result contract"
    );

    addRequiredBackendAdapterStringError(
        errors,
        result.schema,
        "result.schema",
        "missing_backend_adapter_result_schema",
        "Backend adapter result.schema"
    );
    addBackendAdapterMetadataStringValidation(errors, result.schema, "result.schema");
    addBackendAdapterStringArrayValidation(errors, result.outputFields, "result.outputFields");
    addRequirementSupportLevelError(errors, result.streamingDeltas, "result.streamingDeltas");
    addRequirementSupportLevelError(errors, result.errorNormalization, "result.errorNormalization");
}

function validateAdapterRequirements(requirements, errors) {
    if (!isPlainObject(requirements)) {
        errors.push(createValidationError(
            "requirements",
            "invalid_backend_adapter_requirements",
            "Backend adapter requirements must be a plain object"
        ));
        return;
    }

    addUnknownBackendAdapterFieldErrors(
        errors,
        requirements,
        BACKEND_ADAPTER_REQUIREMENT_FIELDS,
        "requirements",
        "unknown_backend_adapter_requirement_field",
        "backend adapter requirements"
    );

    for (const key of BACKEND_ADAPTER_REQUIREMENT_FIELDS) {
        addRequirementSupportLevelError(errors, requirements[key], `requirements.${key}`);
    }
}

function validateAdapterCompatibility(compatibility, adapter, errors) {
    if (!isPlainObject(compatibility)) {
        errors.push(createValidationError(
            "compatibility",
            "invalid_backend_adapter_compatibility",
            "Backend adapter compatibility must be a plain object"
        ));
        return;
    }

    addUnknownBackendAdapterFieldErrors(
        errors,
        compatibility,
        BACKEND_ADAPTER_COMPATIBILITY_FIELDS,
        "compatibility",
        "unknown_backend_adapter_compatibility_field",
        "backend adapter compatibility"
    );

    addRequiredBackendAdapterStringError(
        errors,
        compatibility.backendKind,
        "compatibility.backendKind",
        "missing_backend_adapter_compatibility_backend_kind",
        "Backend adapter compatibility.backendKind"
    );
    addBackendAdapterMetadataStringValidation(errors, compatibility.backendKind, "compatibility.backendKind");
    addBooleanFieldError(errors, compatibility.modelBundleRequired, "compatibility.modelBundleRequired");
    addBooleanFieldError(errors, compatibility.hardwareProfileRequired, "compatibility.hardwareProfileRequired");

    if (
        isNonEmptyString(adapter.backendKind) &&
        isNonEmptyString(compatibility.backendKind) &&
        adapter.backendKind !== compatibility.backendKind
    ) {
        errors.push(createValidationError(
            "compatibility.backendKind",
            "backend_adapter_compatibility_kind_mismatch",
            "Backend adapter compatibility.backendKind must match backendKind",
            {
                adapterBackendKind: adapter.backendKind,
                compatibilityBackendKind: compatibility.backendKind
            }
        ));
    }
}

export function normalizeBackendAdapterDefinition(adapter) {
    return {
        ...adapter,
        adapterId: normalizeOptionalString(adapter?.adapterId),
        backendKind: normalizeOptionalString(adapter?.backendKind),
        version: normalizeOptionalString(adapter?.version),
        status: normalizeOptionalString(adapter?.status),
        summary: normalizeOptionalString(adapter?.summary),
        capabilities: normalizeOptionalStringArray(adapter?.capabilities),
        services: normalizeOptionalStringArray(adapter?.services),
        contracts: normalizeAdapterContracts(adapter?.contracts),
        result: normalizeAdapterResult(adapter?.result),
        requirements: normalizeAdapterRequirements(adapter?.requirements),
        compatibility: normalizeAdapterCompatibility(adapter?.compatibility)
    };
}

export function validateBackendAdapterDefinition(adapter) {
    const errors = [];

    if (!isPlainObject(adapter)) {
        return createValidationResult([
            createValidationError(
                "",
                "invalid_backend_adapter",
                "Backend adapter definition must be a plain object"
            )
        ]);
    }

    const normalizedAdapter = normalizeBackendAdapterDefinition(adapter);

    addForbiddenBackendAdapterKeyErrors(
        errors,
        adapter,
        "forbidden_backend_adapter_key",
        "Backend adapter definition"
    );
    addUnknownBackendAdapterFieldErrors(
        errors,
        adapter,
        BACKEND_ADAPTER_FIELDS,
        "",
        "unknown_backend_adapter_field",
        "backend adapter definition"
    );

    addRequiredBackendAdapterStringError(
        errors,
        normalizedAdapter.adapterId,
        "adapterId",
        "missing_backend_adapter_id",
        "Backend adapter adapterId"
    );
    addRequiredBackendAdapterStringError(
        errors,
        normalizedAdapter.backendKind,
        "backendKind",
        "missing_backend_adapter_backend_kind",
        "Backend adapter backendKind"
    );
    addRequiredBackendAdapterStringError(
        errors,
        normalizedAdapter.version,
        "version",
        "missing_backend_adapter_version",
        "Backend adapter version"
    );
    addRequiredBackendAdapterStringError(
        errors,
        normalizedAdapter.summary,
        "summary",
        "missing_backend_adapter_summary",
        "Backend adapter summary"
    );

    if (!isNonEmptyString(normalizedAdapter.status)) {
        errors.push(createValidationError(
            "status",
            "missing_backend_adapter_status",
            "Backend adapter status must be a non-empty string"
        ));
    } else if (!isKnownBackendAdapterStatus(normalizedAdapter.status)) {
        errors.push(createValidationError(
            "status",
            "unknown_backend_adapter_status",
            `Unknown backend adapter status: ${normalizedAdapter.status}`,
            {
                status: normalizedAdapter.status
            }
        ));
    }

    for (const key of ["adapterId", "backendKind", "version", "summary"]) {
        addBackendAdapterMetadataStringValidation(errors, normalizedAdapter[key], key);
    }

    validateAdapterCapabilities(normalizedAdapter.capabilities, errors);
    addBackendAdapterStringArrayValidation(errors, normalizedAdapter.services, "services");
    validateAdapterContracts(normalizedAdapter.contracts, errors);
    validateAdapterResult(normalizedAdapter.result, errors);
    validateAdapterRequirements(normalizedAdapter.requirements, errors);
    validateAdapterCompatibility(normalizedAdapter.compatibility, normalizedAdapter, errors);

    return createValidationResult(
        errors,
        errors.length === 0 ? copyBackendAdapterDefinition(normalizedAdapter) : null
    );
}

export function assertBackendAdapterDefinition(adapter) {
    return assertValidation(
        validateBackendAdapterDefinition(adapter),
        "Backend adapter definition validation failed"
    );
}

export { copyBackendAdapterDefinition };
