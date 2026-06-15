import {
    assertValidation,
    collectForbiddenKeys,
    createValidationError,
    createValidationResult,
    hasForbiddenPathLikeValue,
    isNonEmptyString,
    isPlainObject
} from "./contractValidation.mjs";
import { isKnownCapability } from "./capabilityTaxonomy.mjs";

export const CAPABILITY_DEFINITION_STATUSES = Object.freeze([
    "contract-only",
    "planned",
    "experimental",
    "implemented",
    "deprecated"
]);

export const CAPABILITY_REQUIREMENT_SUPPORT_LEVELS = Object.freeze([
    "supported",
    "unsupported",
    "required"
]);

export const CAPABILITY_APPROVAL_SUPPORT_LEVELS = Object.freeze([
    "supported",
    "unsupported",
    "conditional"
]);

export const CAPABILITY_CONTRACT_REFS = Object.freeze({
    action: "actionEnvelope.v1",
    result: "resultEnvelope.v1",
    event: "actionEvent.v1"
});

const CAPABILITY_DEFINITION_STATUS_SET = new Set(CAPABILITY_DEFINITION_STATUSES);
const CAPABILITY_REQUIREMENT_SUPPORT_LEVEL_SET = new Set(CAPABILITY_REQUIREMENT_SUPPORT_LEVELS);
const CAPABILITY_APPROVAL_SUPPORT_LEVEL_SET = new Set(CAPABILITY_APPROVAL_SUPPORT_LEVELS);

const CAPABILITY_DEFINITION_FIELDS = new Set([
    "capability",
    "version",
    "status",
    "summary",
    "contracts",
    "requirements",
    "policy",
    "compatibility"
]);

const CAPABILITY_CONTRACT_FIELDS = new Set([
    "action",
    "result",
    "event"
]);

const CAPABILITY_REQUIREMENT_FIELDS = new Set([
    "streaming",
    "cancellation",
    "timeout",
    "approval"
]);

const CAPABILITY_POLICY_FIELDS = new Set([
    "maxTokens",
    "approvalRequired",
    "allowTools",
    "budget"
]);

const CAPABILITY_COMPATIBILITY_FIELDS = new Set([
    "backendKinds",
    "modelBundleRequired",
    "contextRefs"
]);

const FORBIDDEN_CAPABILITY_DEFINITION_KEYS = new Set([
    "modelPath",
    "baseModel",
    "mmprojPath",
    "projectorPath",
    "backend",
    "backendAdapter",
    "backendOptions",
    "adapterArgs",
    "rawBackendPayload",
    "toolProcess",
    "command",
    "shell",
    "exec",
    "spawn",
    "stdio",
    "cwd",
    "env"
]);

function hasKnownCapabilityDefinitionStatus(value) {
    return CAPABILITY_DEFINITION_STATUS_SET.has(value);
}

function hasKnownCapabilityRequirementSupportLevel(value) {
    return CAPABILITY_REQUIREMENT_SUPPORT_LEVEL_SET.has(value);
}

function hasKnownCapabilityApprovalSupportLevel(value) {
    return CAPABILITY_APPROVAL_SUPPORT_LEVEL_SET.has(value);
}

function normalizeOptionalString(value) {
    return typeof value === "string" ? value.trim() : value;
}

function addForbiddenKeyErrors(errors, definition) {
    const found = collectForbiddenKeys(definition, FORBIDDEN_CAPABILITY_DEFINITION_KEYS);

    for (const entry of found) {
        errors.push(createValidationError(
            entry.path,
            "forbidden_capability_definition_key",
            `Capability definition must not include forbidden key: ${entry.key}`,
            {
                key: entry.key
            }
        ));
    }
}

function addUnknownFieldErrors(errors, objectValue, allowedFields, path, code) {
    if (!isPlainObject(objectValue)) return;

    for (const key of Object.keys(objectValue)) {
        if (allowedFields.has(key)) continue;

        errors.push(createValidationError(
            path ? `${path}.${key}` : key,
            code,
            `Unsupported field for ${path || "capability definition"}: ${key}`,
            {
                key
            }
        ));
    }
}

function addRequiredStringError(errors, value, path, code, label) {
    if (isNonEmptyString(value)) return;

    errors.push(createValidationError(
        path,
        code,
        `${label} must be a non-empty string`
    ));
}

function addBooleanFieldError(errors, value, path) {
    if (typeof value === "boolean") return;

    errors.push(createValidationError(
        path,
        "invalid_boolean_field",
        `${path} must be a boolean`
    ));
}

function validateContracts(contracts, errors) {
    if (!isPlainObject(contracts)) {
        errors.push(createValidationError(
            "contracts",
            "invalid_contracts",
            "Capability definition contracts must be a plain object"
        ));
        return;
    }

    addUnknownFieldErrors(
        errors,
        contracts,
        CAPABILITY_CONTRACT_FIELDS,
        "contracts",
        "unknown_contract_field"
    );

    for (const [key, expectedValue] of Object.entries(CAPABILITY_CONTRACT_REFS)) {
        if (contracts[key] !== expectedValue) {
            errors.push(createValidationError(
                `contracts.${key}`,
                "invalid_contract_ref",
                `contracts.${key} must be ${expectedValue}`,
                {
                    expected: expectedValue
                }
            ));
        }
    }
}

function validateRequirements(requirements, errors) {
    if (!isPlainObject(requirements)) {
        errors.push(createValidationError(
            "requirements",
            "invalid_requirements",
            "Capability definition requirements must be a plain object"
        ));
        return;
    }

    addUnknownFieldErrors(
        errors,
        requirements,
        CAPABILITY_REQUIREMENT_FIELDS,
        "requirements",
        "unknown_requirement_field"
    );

    for (const key of ["streaming", "cancellation", "timeout"]) {
        if (!isNonEmptyString(requirements[key])) {
            errors.push(createValidationError(
                `requirements.${key}`,
                "missing_requirement_support_level",
                `requirements.${key} must be a non-empty support-level string`
            ));
            continue;
        }

        if (!hasKnownCapabilityRequirementSupportLevel(requirements[key])) {
            errors.push(createValidationError(
                `requirements.${key}`,
                "unknown_requirement_support_level",
                `Unknown requirement support level: ${requirements[key]}`,
                {
                    supportLevel: requirements[key]
                }
            ));
        }
    }

    if (!isNonEmptyString(requirements.approval)) {
        errors.push(createValidationError(
            "requirements.approval",
            "missing_approval_support_level",
            "requirements.approval must be a non-empty approval support-level string"
        ));
        return;
    }

    if (!hasKnownCapabilityApprovalSupportLevel(requirements.approval)) {
        errors.push(createValidationError(
            "requirements.approval",
            "unknown_approval_support_level",
            `Unknown approval support level: ${requirements.approval}`,
            {
                supportLevel: requirements.approval
            }
        ));
    }
}

function validatePolicy(policy, errors) {
    if (!isPlainObject(policy)) {
        errors.push(createValidationError(
            "policy",
            "invalid_policy",
            "Capability definition policy must be a plain object"
        ));
        return;
    }

    addUnknownFieldErrors(
        errors,
        policy,
        CAPABILITY_POLICY_FIELDS,
        "policy",
        "unknown_policy_field"
    );

    for (const key of CAPABILITY_POLICY_FIELDS) {
        addBooleanFieldError(errors, policy[key], `policy.${key}`);
    }
}

function validateBackendKinds(backendKinds, errors) {
    if (!Array.isArray(backendKinds)) {
        errors.push(createValidationError(
            "compatibility.backendKinds",
            "invalid_backend_kinds",
            "compatibility.backendKinds must be an array of non-empty strings"
        ));
        return;
    }

    for (let index = 0; index < backendKinds.length; index++) {
        const backendKind = backendKinds[index];
        const path = `compatibility.backendKinds[${index}]`;

        if (!isNonEmptyString(backendKind)) {
            errors.push(createValidationError(
                path,
                "invalid_backend_kind",
                "backendKinds entries must be non-empty strings"
            ));
            continue;
        }

        if (hasForbiddenPathLikeValue(backendKind.trim())) {
            errors.push(createValidationError(
                path,
                "forbidden_backend_kind_value",
                "backendKinds entries must be metadata labels, not paths or backend payloads"
            ));
        }
    }
}

function validateCompatibility(compatibility, errors) {
    if (!isPlainObject(compatibility)) {
        errors.push(createValidationError(
            "compatibility",
            "invalid_compatibility",
            "Capability definition compatibility must be a plain object"
        ));
        return;
    }

    addUnknownFieldErrors(
        errors,
        compatibility,
        CAPABILITY_COMPATIBILITY_FIELDS,
        "compatibility",
        "unknown_compatibility_field"
    );

    validateBackendKinds(compatibility.backendKinds, errors);
    addBooleanFieldError(errors, compatibility.modelBundleRequired, "compatibility.modelBundleRequired");
    addBooleanFieldError(errors, compatibility.contextRefs, "compatibility.contextRefs");
}

function normalizeContracts(contracts) {
    return {
        action: normalizeOptionalString(contracts?.action),
        result: normalizeOptionalString(contracts?.result),
        event: normalizeOptionalString(contracts?.event)
    };
}

function normalizeRequirements(requirements) {
    return {
        streaming: normalizeOptionalString(requirements?.streaming),
        cancellation: normalizeOptionalString(requirements?.cancellation),
        timeout: normalizeOptionalString(requirements?.timeout),
        approval: normalizeOptionalString(requirements?.approval)
    };
}

function normalizePolicy(policy) {
    return {
        maxTokens: policy?.maxTokens,
        approvalRequired: policy?.approvalRequired,
        allowTools: policy?.allowTools,
        budget: policy?.budget
    };
}

function normalizeCompatibility(compatibility) {
    return {
        backendKinds: Array.isArray(compatibility?.backendKinds)
            ? compatibility.backendKinds.map((backendKind) => normalizeOptionalString(backendKind))
            : compatibility?.backendKinds,
        modelBundleRequired: compatibility?.modelBundleRequired,
        contextRefs: compatibility?.contextRefs
    };
}

export function isKnownCapabilityDefinitionStatus(value) {
    return hasKnownCapabilityDefinitionStatus(value);
}

export function isKnownCapabilityRequirementSupportLevel(value) {
    return hasKnownCapabilityRequirementSupportLevel(value);
}

export function isKnownCapabilityApprovalSupportLevel(value) {
    return hasKnownCapabilityApprovalSupportLevel(value);
}

export function normalizeCapabilityDefinition(definition) {
    return {
        ...definition,
        capability: normalizeOptionalString(definition?.capability),
        version: normalizeOptionalString(definition?.version),
        status: normalizeOptionalString(definition?.status),
        summary: normalizeOptionalString(definition?.summary),
        contracts: normalizeContracts(definition?.contracts),
        requirements: normalizeRequirements(definition?.requirements),
        policy: normalizePolicy(definition?.policy),
        compatibility: normalizeCompatibility(definition?.compatibility)
    };
}

export function validateCapabilityDefinition(definition) {
    const errors = [];

    if (!isPlainObject(definition)) {
        return createValidationResult([
            createValidationError(
                "",
                "invalid_capability_definition",
                "Capability definition must be a plain object"
            )
        ]);
    }

    addForbiddenKeyErrors(errors, definition);
    addUnknownFieldErrors(
        errors,
        definition,
        CAPABILITY_DEFINITION_FIELDS,
        "",
        "unknown_capability_definition_field"
    );

    if (!isNonEmptyString(definition.capability)) {
        errors.push(createValidationError(
            "capability",
            "missing_capability",
            "Capability definition capability must be a non-empty string"
        ));
    } else if (!isKnownCapability(definition.capability)) {
        errors.push(createValidationError(
            "capability",
            "unknown_capability",
            `Unknown capability: ${definition.capability}`,
            {
                capability: definition.capability
            }
        ));
    }

    addRequiredStringError(
        errors,
        definition.version,
        "version",
        "missing_version",
        "Capability definition version"
    );
    addRequiredStringError(
        errors,
        definition.summary,
        "summary",
        "missing_summary",
        "Capability definition summary"
    );

    if (!isNonEmptyString(definition.status)) {
        errors.push(createValidationError(
            "status",
            "missing_status",
            "Capability definition status must be a non-empty string"
        ));
    } else if (!hasKnownCapabilityDefinitionStatus(definition.status)) {
        errors.push(createValidationError(
            "status",
            "unknown_capability_definition_status",
            `Unknown capability definition status: ${definition.status}`,
            {
                status: definition.status
            }
        ));
    }

    validateContracts(definition.contracts, errors);
    validateRequirements(definition.requirements, errors);
    validatePolicy(definition.policy, errors);
    validateCompatibility(definition.compatibility, errors);

    return createValidationResult(
        errors,
        errors.length === 0 ? normalizeCapabilityDefinition(definition) : null
    );
}

export function assertCapabilityDefinition(definition) {
    return assertValidation(
        validateCapabilityDefinition(definition),
        "Capability definition validation failed"
    );
}
