import {
    assertValidation,
    createValidationError,
    createValidationResult,
    isNonEmptyString,
    isPlainObject
} from "./contractValidation.mjs";
import {
    CAPABILITY_APPROVAL_SUPPORT_LEVELS,
    CAPABILITY_CONTRACT_REFS,
    CAPABILITY_REQUIREMENT_SUPPORT_LEVELS,
    isKnownCapabilityApprovalSupportLevel,
    isKnownCapabilityRequirementSupportLevel
} from "./capabilityDefinition.mjs";
import { isKnownCapability } from "./capabilityTaxonomy.mjs";
import {
    CAPABILITY_SERVICE_STATUSES,
    addCapabilityServiceMetadataStringValidation,
    addCapabilityServiceStringArrayValidation,
    addForbiddenCapabilityServiceKeyErrors,
    addRequiredCapabilityServiceStringError,
    addUnknownCapabilityServiceFieldErrors,
    copyCapabilityServiceDefinition,
    normalizeOptionalString,
    normalizeOptionalStringArray
} from "./capabilityServiceCommon.mjs";

const CAPABILITY_SERVICE_STATUS_SET = new Set(CAPABILITY_SERVICE_STATUSES);
const CAPABILITY_REQUIREMENT_SUPPORT_LEVEL_SET = new Set(CAPABILITY_REQUIREMENT_SUPPORT_LEVELS);
const CAPABILITY_APPROVAL_SUPPORT_LEVEL_SET = new Set(CAPABILITY_APPROVAL_SUPPORT_LEVELS);

const CAPABILITY_SERVICE_FIELDS = new Set([
    "serviceId",
    "capability",
    "version",
    "status",
    "summary",
    "contracts",
    "input",
    "result",
    "requirements",
    "compatibility"
]);

const CAPABILITY_SERVICE_CONTRACT_FIELDS = new Set([
    "action",
    "result",
    "event"
]);

const CAPABILITY_SERVICE_INPUT_FIELDS = new Set([
    "schema",
    "requiredFields",
    "optionalFields",
    "contextRefs"
]);

const CAPABILITY_SERVICE_RESULT_FIELDS = new Set([
    "schema",
    "outputFields",
    "streamingDeltas"
]);

const CAPABILITY_SERVICE_REQUIREMENT_FIELDS = new Set([
    "streaming",
    "cancellation",
    "timeout",
    "approval"
]);

const CAPABILITY_SERVICE_COMPATIBILITY_FIELDS = new Set([
    "backendKinds",
    "modelBundleRequired",
    "hardwareProfileRequired"
]);

export {
    CAPABILITY_SERVICE_CONTRACT_VERSION,
    CAPABILITY_SERVICE_REGISTRY_SCHEMA_VERSION,
    CAPABILITY_SERVICE_STATUSES
} from "./capabilityServiceCommon.mjs";

export function isKnownCapabilityServiceStatus(value) {
    return CAPABILITY_SERVICE_STATUS_SET.has(value);
}

function normalizeServiceContracts(contracts) {
    return {
        action: normalizeOptionalString(contracts?.action),
        result: normalizeOptionalString(contracts?.result),
        event: normalizeOptionalString(contracts?.event)
    };
}

function normalizeServiceInput(input) {
    return {
        schema: normalizeOptionalString(input?.schema),
        requiredFields: normalizeOptionalStringArray(input?.requiredFields),
        optionalFields: normalizeOptionalStringArray(input?.optionalFields),
        contextRefs: normalizeOptionalString(input?.contextRefs)
    };
}

function normalizeServiceResult(result) {
    return {
        schema: normalizeOptionalString(result?.schema),
        outputFields: normalizeOptionalStringArray(result?.outputFields),
        streamingDeltas: normalizeOptionalString(result?.streamingDeltas)
    };
}

function normalizeServiceRequirements(requirements) {
    return {
        streaming: normalizeOptionalString(requirements?.streaming),
        cancellation: normalizeOptionalString(requirements?.cancellation),
        timeout: normalizeOptionalString(requirements?.timeout),
        approval: normalizeOptionalString(requirements?.approval)
    };
}

function normalizeServiceCompatibility(compatibility) {
    return {
        backendKinds: normalizeOptionalStringArray(compatibility?.backendKinds),
        modelBundleRequired: compatibility?.modelBundleRequired,
        hardwareProfileRequired: compatibility?.hardwareProfileRequired
    };
}

function addRequirementSupportLevelError(errors, value, path) {
    if (!isNonEmptyString(value)) {
        errors.push(createValidationError(
            path,
            "missing_service_requirement_support_level",
            `${path} must be a non-empty support-level string`
        ));
        return;
    }

    if (!isKnownCapabilityRequirementSupportLevel(value)) {
        errors.push(createValidationError(
            path,
            "unknown_service_requirement_support_level",
            `Unknown service requirement support level: ${value}`,
            {
                supportLevel: value
            }
        ));
    }
}

function addApprovalSupportLevelError(errors, value, path) {
    if (!isNonEmptyString(value)) {
        errors.push(createValidationError(
            path,
            "missing_service_approval_support_level",
            `${path} must be a non-empty approval support-level string`
        ));
        return;
    }

    if (!isKnownCapabilityApprovalSupportLevel(value)) {
        errors.push(createValidationError(
            path,
            "unknown_service_approval_support_level",
            `Unknown service approval support level: ${value}`,
            {
                supportLevel: value
            }
        ));
    }
}

function validateServiceContracts(contracts, errors) {
    if (!isPlainObject(contracts)) {
        errors.push(createValidationError(
            "contracts",
            "invalid_service_contracts",
            "Capability service contracts must be a plain object"
        ));
        return;
    }

    addUnknownCapabilityServiceFieldErrors(
        errors,
        contracts,
        CAPABILITY_SERVICE_CONTRACT_FIELDS,
        "contracts",
        "unknown_service_contract_field",
        "capability service contracts"
    );

    for (const [key, expectedValue] of Object.entries(CAPABILITY_CONTRACT_REFS)) {
        if (contracts[key] !== expectedValue) {
            errors.push(createValidationError(
                `contracts.${key}`,
                "invalid_service_contract_ref",
                `contracts.${key} must be ${expectedValue}`,
                {
                    expected: expectedValue
                }
            ));
        }
    }
}

function validateServiceInput(input, errors) {
    if (!isPlainObject(input)) {
        errors.push(createValidationError(
            "input",
            "invalid_service_input",
            "Capability service input contract must be a plain object"
        ));
        return;
    }

    addUnknownCapabilityServiceFieldErrors(
        errors,
        input,
        CAPABILITY_SERVICE_INPUT_FIELDS,
        "input",
        "unknown_service_input_field",
        "capability service input contract"
    );

    addRequiredCapabilityServiceStringError(
        errors,
        input.schema,
        "input.schema",
        "missing_service_input_schema",
        "Capability service input.schema"
    );
    addCapabilityServiceMetadataStringValidation(errors, input.schema, "input.schema");
    addCapabilityServiceStringArrayValidation(errors, input.requiredFields, "input.requiredFields");
    addCapabilityServiceStringArrayValidation(errors, input.optionalFields, "input.optionalFields");
    addRequirementSupportLevelError(errors, input.contextRefs, "input.contextRefs");
}

function validateServiceResult(result, errors) {
    if (!isPlainObject(result)) {
        errors.push(createValidationError(
            "result",
            "invalid_service_result",
            "Capability service result contract must be a plain object"
        ));
        return;
    }

    addUnknownCapabilityServiceFieldErrors(
        errors,
        result,
        CAPABILITY_SERVICE_RESULT_FIELDS,
        "result",
        "unknown_service_result_field",
        "capability service result contract"
    );

    addRequiredCapabilityServiceStringError(
        errors,
        result.schema,
        "result.schema",
        "missing_service_result_schema",
        "Capability service result.schema"
    );
    addCapabilityServiceMetadataStringValidation(errors, result.schema, "result.schema");
    addCapabilityServiceStringArrayValidation(errors, result.outputFields, "result.outputFields");
    addRequirementSupportLevelError(errors, result.streamingDeltas, "result.streamingDeltas");
}

function validateServiceRequirements(requirements, errors) {
    if (!isPlainObject(requirements)) {
        errors.push(createValidationError(
            "requirements",
            "invalid_service_requirements",
            "Capability service requirements must be a plain object"
        ));
        return;
    }

    addUnknownCapabilityServiceFieldErrors(
        errors,
        requirements,
        CAPABILITY_SERVICE_REQUIREMENT_FIELDS,
        "requirements",
        "unknown_service_requirement_field",
        "capability service requirements"
    );

    for (const key of ["streaming", "cancellation", "timeout"]) {
        addRequirementSupportLevelError(errors, requirements[key], `requirements.${key}`);
    }

    addApprovalSupportLevelError(errors, requirements.approval, "requirements.approval");
}

function addBooleanFieldError(errors, value, path) {
    if (typeof value === "boolean") return;

    errors.push(createValidationError(
        path,
        "invalid_service_boolean_field",
        `${path} must be a boolean`
    ));
}

function validateServiceCompatibility(compatibility, errors) {
    if (!isPlainObject(compatibility)) {
        errors.push(createValidationError(
            "compatibility",
            "invalid_service_compatibility",
            "Capability service compatibility must be a plain object"
        ));
        return;
    }

    addUnknownCapabilityServiceFieldErrors(
        errors,
        compatibility,
        CAPABILITY_SERVICE_COMPATIBILITY_FIELDS,
        "compatibility",
        "unknown_service_compatibility_field",
        "capability service compatibility"
    );

    addCapabilityServiceStringArrayValidation(errors, compatibility.backendKinds, "compatibility.backendKinds");
    addBooleanFieldError(errors, compatibility.modelBundleRequired, "compatibility.modelBundleRequired");
    addBooleanFieldError(errors, compatibility.hardwareProfileRequired, "compatibility.hardwareProfileRequired");
}

export function normalizeCapabilityServiceDefinition(service) {
    return {
        ...service,
        serviceId: normalizeOptionalString(service?.serviceId),
        capability: normalizeOptionalString(service?.capability),
        version: normalizeOptionalString(service?.version),
        status: normalizeOptionalString(service?.status),
        summary: normalizeOptionalString(service?.summary),
        contracts: normalizeServiceContracts(service?.contracts),
        input: normalizeServiceInput(service?.input),
        result: normalizeServiceResult(service?.result),
        requirements: normalizeServiceRequirements(service?.requirements),
        compatibility: normalizeServiceCompatibility(service?.compatibility)
    };
}

export function validateCapabilityServiceDefinition(service) {
    const errors = [];

    if (!isPlainObject(service)) {
        return createValidationResult([
            createValidationError(
                "",
                "invalid_capability_service",
                "Capability service definition must be a plain object"
            )
        ]);
    }

    addForbiddenCapabilityServiceKeyErrors(
        errors,
        service,
        "forbidden_capability_service_key",
        "Capability service definition"
    );
    addUnknownCapabilityServiceFieldErrors(
        errors,
        service,
        CAPABILITY_SERVICE_FIELDS,
        "",
        "unknown_capability_service_field",
        "capability service definition"
    );

    const normalizedService = normalizeCapabilityServiceDefinition(service);

    if (!isNonEmptyString(normalizedService.capability)) {
        errors.push(createValidationError(
            "capability",
            "missing_service_capability",
            "Capability service capability must be a non-empty string"
        ));
    } else if (!isKnownCapability(normalizedService.capability)) {
        errors.push(createValidationError(
            "capability",
            "unknown_service_capability",
            `Unknown service capability: ${normalizedService.capability}`,
            {
                capability: normalizedService.capability
            }
        ));
    }

    if (!isNonEmptyString(normalizedService.status)) {
        errors.push(createValidationError(
            "status",
            "missing_service_status",
            "Capability service status must be a non-empty string"
        ));
    } else if (!isKnownCapabilityServiceStatus(normalizedService.status)) {
        errors.push(createValidationError(
            "status",
            "unknown_service_status",
            `Unknown capability service status: ${normalizedService.status}`,
            {
                status: normalizedService.status
            }
        ));
    }

    addRequiredCapabilityServiceStringError(
        errors,
        normalizedService.serviceId,
        "serviceId",
        "missing_service_id",
        "Capability service serviceId"
    );
    addRequiredCapabilityServiceStringError(
        errors,
        normalizedService.version,
        "version",
        "missing_service_version",
        "Capability service version"
    );
    addRequiredCapabilityServiceStringError(
        errors,
        normalizedService.summary,
        "summary",
        "missing_service_summary",
        "Capability service summary"
    );

    for (const key of ["serviceId", "version"]) {
        addCapabilityServiceMetadataStringValidation(errors, normalizedService[key], key);
    }

    validateServiceContracts(
        isPlainObject(service.contracts) ? normalizedService.contracts : service.contracts,
        errors
    );
    validateServiceInput(
        isPlainObject(service.input) ? normalizedService.input : service.input,
        errors
    );
    validateServiceResult(
        isPlainObject(service.result) ? normalizedService.result : service.result,
        errors
    );
    validateServiceRequirements(
        isPlainObject(service.requirements) ? normalizedService.requirements : service.requirements,
        errors
    );
    validateServiceCompatibility(
        isPlainObject(service.compatibility) ? normalizedService.compatibility : service.compatibility,
        errors
    );

    return createValidationResult(
        errors,
        errors.length === 0 ? normalizedService : null
    );
}

export function assertCapabilityServiceDefinition(service) {
    return assertValidation(
        validateCapabilityServiceDefinition(service),
        "Capability service definition validation failed"
    );
}

export function isKnownCapabilityServiceRequirementSupportLevel(value) {
    return CAPABILITY_REQUIREMENT_SUPPORT_LEVEL_SET.has(value);
}

export function isKnownCapabilityServiceApprovalSupportLevel(value) {
    return CAPABILITY_APPROVAL_SUPPORT_LEVEL_SET.has(value);
}

export { copyCapabilityServiceDefinition };
