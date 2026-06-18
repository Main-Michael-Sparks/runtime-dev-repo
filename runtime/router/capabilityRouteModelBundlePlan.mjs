import {
    assertValidation,
    createValidationError,
    createValidationResult,
    isNonEmptyString,
    isPlainObject
} from "../bus/contractValidation.mjs";
import {
    copyHardwareProfileDefinition,
    isSelectableHardwareProfileStatus,
    prefixHardwareProfileValidationErrors
} from "../profiles/hardwareProfileCommon.mjs";
import {
    validateHardwareProfileRegistry
} from "../profiles/hardwareProfileRegistry.mjs";
import {
    copyModelBundleDefinition,
    isSelectableModelBundleStatus,
    prefixModelBundleValidationErrors
} from "../models/modelBundleCommon.mjs";
import {
    validateModelBundleRegistry
} from "../models/modelBundleRegistry.mjs";
import {
    assertCapabilityRouteDefinition,
    validateCapabilityRouteDefinition
} from "./capabilityRouteDefinition.mjs";
import {
    CAPABILITY_ROUTER_CONTRACT_VERSION,
    CAPABILITY_ROUTE_MODEL_BUNDLE_PLAN_CONTRACT_VERSION,
    copyCapabilityRouteDefinition,
    copyCapabilityRouterBusAction,
    prefixCapabilityRouterValidationErrors
} from "./capabilityRouterCommon.mjs";

const CAPABILITY_ROUTE_PLAN_FIELDS = new Set([
    "contractVersion",
    "busAction",
    "route"
]);

function addUnknownRoutePlanFieldErrors(errors, routePlan) {
    if (!isPlainObject(routePlan)) return;

    for (const key of Object.keys(routePlan)) {
        if (CAPABILITY_ROUTE_PLAN_FIELDS.has(key)) continue;

        errors.push(createValidationError(
            key,
            "route_model_bundle_route_plan_unknown_field",
            `Unsupported field for capability route model-bundle plan input: ${key}`,
            {
                key
            }
        ));
    }
}

function copyRoutePlan(routePlan) {
    return {
        contractVersion: routePlan.contractVersion,
        busAction: copyCapabilityRouterBusAction(routePlan.busAction),
        route: copyCapabilityRouteDefinition(routePlan.route)
    };
}

function validateRoutePlanDescriptor(routePlan) {
    const errors = [];

    if (!isPlainObject(routePlan)) {
        return createValidationResult([
            createValidationError(
                "routePlan",
                "route_model_bundle_route_plan_invalid",
                "Capability route model-bundle plan input must be a plain route plan object"
            )
        ]);
    }

    addUnknownRoutePlanFieldErrors(errors, routePlan);

    if (routePlan.contractVersion !== CAPABILITY_ROUTER_CONTRACT_VERSION) {
        errors.push(createValidationError(
            "contractVersion",
            "route_model_bundle_route_contract_version_unsupported",
            `Capability route plan contractVersion must be ${CAPABILITY_ROUTER_CONTRACT_VERSION}`,
            {
                expected: CAPABILITY_ROUTER_CONTRACT_VERSION
            }
        ));
    }

    const routeResult = validateCapabilityRouteDefinition(routePlan.route);
    if (!routeResult.ok) {
        errors.push(...prefixCapabilityRouterValidationErrors(
            routeResult.errors,
            "route",
            "route_model_bundle_route"
        ));
    }

    if (!isPlainObject(routePlan.busAction)) {
        errors.push(createValidationError(
            "busAction",
            "route_model_bundle_route_plan_invalid",
            "Capability route model-bundle plan input must include a plain busAction descriptor"
        ));
    } else {
        const actionCapability = routePlan.busAction?.action?.capability;
        const definitionCapability = routePlan.busAction?.capabilityDefinition?.capability;
        const normalizedRoute = routeResult.ok ? routeResult.value : null;

        if (
            normalizedRoute &&
            isNonEmptyString(actionCapability) &&
            normalizedRoute.capability !== actionCapability.trim()
        ) {
            errors.push(createValidationError(
                "busAction.action.capability",
                "route_model_bundle_route_capability_mismatch",
                "Capability route model-bundle plan route and action must describe the same capability",
                {
                    routeCapability: normalizedRoute.capability,
                    actionCapability: actionCapability.trim()
                }
            ));
        }

        if (
            normalizedRoute &&
            isNonEmptyString(definitionCapability) &&
            normalizedRoute.capability !== definitionCapability.trim()
        ) {
            errors.push(createValidationError(
                "busAction.capabilityDefinition.capability",
                "route_model_bundle_definition_capability_mismatch",
                "Capability route model-bundle plan route and capability definition must describe the same capability",
                {
                    routeCapability: normalizedRoute.capability,
                    definitionCapability: definitionCapability.trim()
                }
            ));
        }
    }

    return createValidationResult(
        errors,
        errors.length === 0
            ? {
                  contractVersion: CAPABILITY_ROUTER_CONTRACT_VERSION,
                  busAction: copyCapabilityRouterBusAction(routePlan.busAction),
                  route: assertCapabilityRouteDefinition(routePlan.route)
              }
            : null
    );
}

function validateNeededModelBundleRegistry(errors, route, modelBundleRegistry) {
    if (!isNonEmptyString(route.modelBundleId)) return null;

    if (modelBundleRegistry === undefined || modelBundleRegistry === null) {
        errors.push(createValidationError(
            "modelBundleRegistry",
            "route_model_bundle_registry_missing",
            "Model bundle registry is required when a route declares modelBundleId",
            {
                modelBundleId: route.modelBundleId
            }
        ));
        return null;
    }

    const registryResult = validateModelBundleRegistry(modelBundleRegistry);
    if (!registryResult.ok) {
        errors.push(...prefixModelBundleValidationErrors(
            registryResult.errors,
            "modelBundleRegistry",
            "route_model_bundle_registry"
        ));
        return null;
    }

    const selectedBundle = registryResult.value.bundles.find((bundle) => bundle.bundleId === route.modelBundleId) ?? null;

    if (!selectedBundle) {
        errors.push(createValidationError(
            "route.modelBundleId",
            "route_model_bundle_missing",
            `Model bundle registry does not define route modelBundleId: ${route.modelBundleId}`,
            {
                modelBundleId: route.modelBundleId
            }
        ));
        return null;
    }

    return selectedBundle;
}

function addModelBundleCompatibilityErrors(errors, route, bundle) {
    if (!bundle) return;

    if (!isSelectableModelBundleStatus(bundle.status)) {
        errors.push(createValidationError(
            "modelBundle.status",
            "route_model_bundle_unselectable_status",
            `Model bundle is not selectable: ${bundle.bundleId}`,
            {
                bundleId: bundle.bundleId,
                status: bundle.status
            }
        ));
    }

    if (!bundle.capabilities.includes(route.capability)) {
        errors.push(createValidationError(
            "modelBundle.capabilities",
            "route_model_bundle_capability_incompatible",
            `Model bundle does not support route capability: ${route.capability}`,
            {
                capability: route.capability,
                allowedCapabilities: [...bundle.capabilities]
            }
        ));
    }

    if (bundle.backendKind !== route.backendKind) {
        errors.push(createValidationError(
            "modelBundle.backendKind",
            "route_model_bundle_backend_kind_mismatch",
            "Model bundle backendKind must match route backendKind",
            {
                modelBundleBackendKind: bundle.backendKind,
                routeBackendKind: route.backendKind
            }
        ));
    }

    if (
        isNonEmptyString(route.backendId) &&
        isNonEmptyString(bundle.backendId) &&
        route.backendId !== bundle.backendId
    ) {
        errors.push(createValidationError(
            "modelBundle.backendId",
            "route_model_bundle_backend_id_mismatch",
            "Model bundle backendId must match route backendId when both are declared",
            {
                modelBundleBackendId: bundle.backendId,
                routeBackendId: route.backendId
            }
        ));
    }
}

function validateNeededHardwareProfileRegistry(errors, effectiveHardwareProfileId, hardwareProfileRegistry) {
    if (!isNonEmptyString(effectiveHardwareProfileId)) return null;

    if (hardwareProfileRegistry === undefined || hardwareProfileRegistry === null) {
        errors.push(createValidationError(
            "hardwareProfileRegistry",
            "route_hardware_profile_registry_missing",
            "Hardware profile registry is required when a route or model bundle declares an effective hardwareProfileId",
            {
                hardwareProfileId: effectiveHardwareProfileId
            }
        ));
        return null;
    }

    const registryResult = validateHardwareProfileRegistry(hardwareProfileRegistry);
    if (!registryResult.ok) {
        errors.push(...prefixHardwareProfileValidationErrors(
            registryResult.errors,
            "hardwareProfileRegistry",
            "route_hardware_profile_registry"
        ));
        return null;
    }

    const selectedProfile = registryResult.value.profiles.find((profile) => profile.profileId === effectiveHardwareProfileId) ?? null;

    if (!selectedProfile) {
        errors.push(createValidationError(
            "effectiveHardwareProfileId",
            "route_hardware_profile_missing",
            `Hardware profile registry does not define effective hardwareProfileId: ${effectiveHardwareProfileId}`,
            {
                hardwareProfileId: effectiveHardwareProfileId
            }
        ));
        return null;
    }

    return selectedProfile;
}

function addHardwareProfileCompatibilityErrors(errors, route, profile) {
    if (!profile) return;

    if (!isSelectableHardwareProfileStatus(profile.status)) {
        errors.push(createValidationError(
            "hardwareProfile.status",
            "route_hardware_profile_unselectable_status",
            `Hardware profile is not selectable: ${profile.profileId}`,
            {
                profileId: profile.profileId,
                status: profile.status
            }
        ));
    }

    if (!profile.capabilities.includes(route.capability)) {
        errors.push(createValidationError(
            "hardwareProfile.capabilities",
            "route_hardware_profile_capability_incompatible",
            `Hardware profile does not support route capability: ${route.capability}`,
            {
                capability: route.capability,
                allowedCapabilities: [...profile.capabilities]
            }
        ));
    }

    if (!profile.backendKinds.includes(route.backendKind)) {
        errors.push(createValidationError(
            "hardwareProfile.backendKinds",
            "route_hardware_profile_backend_kind_incompatible",
            `Hardware profile does not support route backendKind: ${route.backendKind}`,
            {
                backendKind: route.backendKind,
                allowedBackendKinds: [...profile.backendKinds]
            }
        ));
    }
}

function resolveEffectiveHardwareProfileId(route, bundle) {
    if (isNonEmptyString(route.hardwareProfileId)) return route.hardwareProfileId;
    if (isNonEmptyString(bundle?.defaultHardwareProfileId)) return bundle.defaultHardwareProfileId;
    return null;
}

export function validateCapabilityRouteModelBundlePlan(routePlan, registries = {}) {
    const errors = [];
    const routePlanResult = validateRoutePlanDescriptor(routePlan);

    if (!routePlanResult.ok) {
        return createValidationResult(routePlanResult.errors);
    }

    const normalizedRoutePlan = routePlanResult.value;
    const route = normalizedRoutePlan.route;
    const selectedBundle = validateNeededModelBundleRegistry(errors, route, registries.modelBundleRegistry);
    addModelBundleCompatibilityErrors(errors, route, selectedBundle);

    const effectiveHardwareProfileId = resolveEffectiveHardwareProfileId(route, selectedBundle);
    const selectedProfile = validateNeededHardwareProfileRegistry(
        errors,
        effectiveHardwareProfileId,
        registries.hardwareProfileRegistry
    );
    addHardwareProfileCompatibilityErrors(errors, route, selectedProfile);

    return createValidationResult(
        errors,
        errors.length === 0
            ? {
                  contractVersion: CAPABILITY_ROUTE_MODEL_BUNDLE_PLAN_CONTRACT_VERSION,
                  routePlan: copyRoutePlan(normalizedRoutePlan),
                  modelBundle: selectedBundle ? copyModelBundleDefinition(selectedBundle) : null,
                  hardwareProfile: selectedProfile ? copyHardwareProfileDefinition(selectedProfile) : null,
                  effectiveHardwareProfileId
              }
            : null
    );
}

export function assertCapabilityRouteModelBundlePlan(routePlan, registries = {}) {
    return assertValidation(
        validateCapabilityRouteModelBundlePlan(routePlan, registries),
        "Capability route model-bundle plan validation failed"
    );
}

export function normalizeCapabilityRouteModelBundlePlan(routePlan, registries = {}) {
    return assertCapabilityRouteModelBundlePlan(routePlan, registries);
}
