import {
    assertValidation,
    createValidationError,
    createValidationResult,
    hasForbiddenPathLikeValue,
    isNonEmptyString
} from "./contractValidation.mjs";

export const MAX_CONTEXT_REF_LENGTH = 256;

function validateContextRefValue(value, path) {
    const errors = [];

    if (!isNonEmptyString(value)) {
        errors.push(createValidationError(
            path,
            "invalid_context_ref",
            "Context reference must be a non-empty string"
        ));
        return errors;
    }

    const normalizedValue = value.trim();

    if (normalizedValue.length > MAX_CONTEXT_REF_LENGTH) {
        errors.push(createValidationError(
            path,
            "context_ref_too_long",
            `Context reference must be ${MAX_CONTEXT_REF_LENGTH} characters or fewer`,
            {
                maxLength: MAX_CONTEXT_REF_LENGTH,
                actualLength: normalizedValue.length
            }
        ));
    }

    if (hasForbiddenPathLikeValue(normalizedValue)) {
        errors.push(createValidationError(
            path,
            "forbidden_context_ref_value",
            "Context reference must not be a raw path, model path, projector path, or traversal value"
        ));
    }

    return errors;
}

export function normalizeContextRefs(contextRefs = []) {
    return contextRefs.map((contextRef) => contextRef.trim());
}

export function validateContextRefs(contextRefs, fieldPath = "contextRefs") {
    const errors = [];

    if (!Array.isArray(contextRefs)) {
        return createValidationResult([
            createValidationError(
                fieldPath,
                "invalid_context_refs",
                "Context references must be an array of strings"
            )
        ]);
    }

    for (let index = 0; index < contextRefs.length; index++) {
        errors.push(...validateContextRefValue(
            contextRefs[index],
            `${fieldPath}[${index}]`
        ));
    }

    return createValidationResult(
        errors,
        errors.length === 0 ? normalizeContextRefs(contextRefs) : null
    );
}

export function assertContextRefs(contextRefs, fieldPath = "contextRefs") {
    return assertValidation(
        validateContextRefs(contextRefs, fieldPath),
        "Context reference validation failed"
    );
}
