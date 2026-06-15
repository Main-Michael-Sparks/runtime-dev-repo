// smokeTestCapabilityServiceContract.mjs
//
// Purpose:
// - Contract smoke for the Runtime Dev capability service contract branch.
// - Validates service metadata, service registry, and service-plan helpers without
//   wiring runtime.mjs, workerBridge, scheduler, backend adapters, or llama_worker modules.
//
// Run:
//   node ./tests/smokeTestCapabilityServiceContract.mjs

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

import {
    CAPABILITY_BUS_CONTRACT_VERSION,
    assertCapabilityBusAction
} from "../runtime/bus/capabilityBusContract.mjs";
import {
    CAPABILITY_REGISTRY_SCHEMA_VERSION
} from "../runtime/bus/capabilityRegistryContract.mjs";
import {
    CAPABILITY_ROUTER_CONTRACT_VERSION,
    assertCapabilityRoutePlan
} from "../runtime/bus/capabilityRouterContract.mjs";
import {
    CAPABILITY_SERVICE_CONTRACT_VERSION,
    CAPABILITY_SERVICE_REGISTRY_SCHEMA_VERSION,
    CAPABILITY_SERVICE_STATUSES,
    assertCapabilityServiceDefinition,
    assertCapabilityServicePlan,
    assertCapabilityServiceRegistry,
    createCapabilityServiceRegistry,
    getCapabilityService,
    hasCapabilityService,
    isKnownCapabilityServiceApprovalSupportLevel,
    isKnownCapabilityServiceRequirementSupportLevel,
    isKnownCapabilityServiceStatus,
    isSelectableCapabilityServiceStatus,
    listCapabilityServices,
    normalizeCapabilityServiceDefinition,
    normalizeCapabilityServicePlan,
    normalizeCapabilityServiceRegistry,
    validateCapabilityServiceDefinition,
    validateCapabilityServicePlan,
    validateCapabilityServiceRegistry
} from "../runtime/bus/capabilityServiceContract.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

function fail(message) {
    throw new Error(`[FAIL] ${message}`);
}

function ok(message) {
    console.log(`[OK] ${message}`);
}

function assert(condition, message) {
    if (!condition) fail(message);
}

function assertIncludes(array, value, label) {
    assert(array.includes(value), `${label} missing ${value}`);
}

function assertErrorCode(result, code, label) {
    const found = result.errors.some((error) => error.code === code);
    assert(found, `${label} missing error code ${code}: ${JSON.stringify(result.errors)}`);
}

function assertThrowsValidation(label, fn, code) {
    try {
        fn();
        fail(`${label} should throw`);
    } catch (err) {
        if (String(err.message).startsWith("[FAIL]")) throw err;
        assert(Array.isArray(err.validationErrors), `${label} should carry validationErrors`);
        assert(
            err.validationErrors.some((error) => error.code === code),
            `${label} missing validation error code ${code}: ${JSON.stringify(err.validationErrors)}`
        );
    }
}

async function readSource(relativePath) {
    return fs.readFile(path.join(repoRoot, relativePath), "utf8");
}

function createValidActionEnvelope(overrides = {}) {
    return {
        actionId: " act_123 ",
        runId: " run_456 ",
        source: {
            kind: "direct-api"
        },
        capability: "text.generate",
        intent: " direct_prompt ",
        input: {
            prompt: "Say hello.",
            contextRefs: [" ctx_1 "]
        },
        requirements: {
            modelClass: "reasoning-7b",
            contextNeed: "medium",
            stream: true,
            timeoutMs: 60000
        },
        policy: {
            maxTokens: 80,
            approvalRequired: false,
            allowTools: false,
            budget: {}
        },
        trace: {
            operator: "direct_prompt"
        },
        ...overrides
    };
}

function createValidCapabilityDefinition(overrides = {}) {
    return {
        capability: "text.generate",
        version: "v1",
        status: "contract-only",
        summary: "Generate text through an approved text capability service.",
        contracts: {
            action: "actionEnvelope.v1",
            result: "resultEnvelope.v1",
            event: "actionEvent.v1"
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
            backendKinds: ["nativeWorkerBackend"],
            modelBundleRequired: true,
            contextRefs: true
        },
        ...overrides
    };
}

function createValidCapabilityRegistry(definitions = [createValidCapabilityDefinition()]) {
    return {
        schemaVersion: CAPABILITY_REGISTRY_SCHEMA_VERSION,
        capabilities: definitions
    };
}

function createValidRoute(overrides = {}) {
    return {
        routeId: "text-generate-default",
        capability: "text.generate",
        status: "contract-only",
        serviceId: "text.generate.default",
        backendKind: "nativeWorkerBackend",
        backendId: "native-worker.default",
        modelBundleId: "mistral-text-local",
        hardwareProfileId: "laptopFallback",
        requirements: {
            streaming: "supported",
            cancellation: "supported",
            timeout: "supported"
        },
        ...overrides
    };
}

function createValidRouterRegistry(routes = [createValidRoute()]) {
    return {
        schemaVersion: CAPABILITY_ROUTER_CONTRACT_VERSION,
        routes
    };
}

function createValidBusAction({ actionOverrides = {}, definitionOverrides = {} } = {}) {
    return assertCapabilityBusAction(
        createValidActionEnvelope(actionOverrides),
        createValidCapabilityRegistry([
            createValidCapabilityDefinition(definitionOverrides)
        ])
    );
}

function createValidRoutePlan({ busAction = createValidBusAction(), routerRegistry = createValidRouterRegistry() } = {}) {
    return assertCapabilityRoutePlan(busAction, routerRegistry);
}

function createValidService(overrides = {}) {
    return {
        serviceId: " text.generate.default ",
        capability: " text.generate ",
        version: " v1 ",
        status: "contract-only",
        summary: " Validate text generation inputs and normalize text generation results. ",
        contracts: {
            action: "actionEnvelope.v1",
            result: "resultEnvelope.v1",
            event: "actionEvent.v1"
        },
        input: {
            schema: " text.generate.input.v1 ",
            requiredFields: [" prompt "],
            optionalFields: [" contextRefs "],
            contextRefs: "supported"
        },
        result: {
            schema: " text.generate.result.v1 ",
            outputFields: [" text "],
            streamingDeltas: "supported"
        },
        requirements: {
            streaming: "supported",
            cancellation: "supported",
            timeout: "supported",
            approval: "conditional"
        },
        compatibility: {
            backendKinds: [" nativeWorkerBackend "],
            modelBundleRequired: true,
            hardwareProfileRequired: true
        },
        ...overrides
    };
}

function createValidServiceRegistry(services = [createValidService()]) {
    return {
        schemaVersion: CAPABILITY_SERVICE_REGISTRY_SCHEMA_VERSION,
        services
    };
}

async function assertNoRuntimeWiringImports() {
    const serviceFiles = [
        "runtime/bus/capabilityServiceCommon.mjs",
        "runtime/bus/capabilityServiceDefinition.mjs",
        "runtime/bus/capabilityServiceRegistry.mjs",
        "runtime/bus/capabilityServicePlan.mjs",
        "runtime/bus/capabilityServiceContract.mjs"
    ];

    const forbiddenMarkers = [
        "runtime.mjs",
        "workerBridge",
        "llama_worker",
        "node-llama-cpp",
        "../lifecycle/",
        "../request/",
        "../stream/",
        "../observability/",
        "worker_threads",
        "child_process",
        "spawn(",
        "exec(",
        "prompt(",
        "sendToWorker",
        "new Worker",
        "ReadableStream",
        "setTimeout",
        "Date.now"
    ];

    for (const relativePath of serviceFiles) {
        const source = await readSource(relativePath);

        for (const marker of forbiddenMarkers) {
            if (source.includes(marker)) {
                fail(`${relativePath} includes forbidden runtime wiring marker: ${marker}`);
            }
        }
    }

    const runtimeSource = await readSource("runtime.mjs");
    assert(
        !runtimeSource.includes("runtime/bus/capabilityService"),
        "runtime.mjs should not import Capability Service contract modules in this branch"
    );

    ok("capability service contract modules avoid runtime/worker execution imports");
}

function testServiceConstants() {
    assert(CAPABILITY_SERVICE_CONTRACT_VERSION === "capability-service.v1", "service contract version should match");
    assert(CAPABILITY_SERVICE_REGISTRY_SCHEMA_VERSION === "capability-service-registry.v1", "service registry schema should match");
    assertIncludes(CAPABILITY_SERVICE_STATUSES, "contract-only", "service statuses");
    assertIncludes(CAPABILITY_SERVICE_STATUSES, "disabled", "service statuses");
    assertIncludes(CAPABILITY_SERVICE_STATUSES, "deprecated", "service statuses");
    assert(isKnownCapabilityServiceStatus("implemented"), "implemented service status should be known");
    assert(!isKnownCapabilityServiceStatus("active"), "active should not be a v1 service status");
    assert(isSelectableCapabilityServiceStatus("experimental"), "experimental should be selectable in v1 metadata");
    assert(!isSelectableCapabilityServiceStatus("disabled"), "disabled should not be selectable");
    assert(isKnownCapabilityServiceRequirementSupportLevel("required"), "required should be a service support level");
    assert(!isKnownCapabilityServiceRequirementSupportLevel("conditional"), "conditional should not be a requirement support level");
    assert(isKnownCapabilityServiceApprovalSupportLevel("conditional"), "conditional should be an approval support level");
    assert(!isKnownCapabilityServiceApprovalSupportLevel("required"), "required should not be an approval support level");

    ok("capability service constants passed");
}

function testValidServiceDefinition() {
    const service = createValidService();
    const result = validateCapabilityServiceDefinition(service);

    assert(result.ok, `valid service should pass: ${JSON.stringify(result.errors)}`);
    assert(result.value.serviceId === "text.generate.default", "serviceId should be trimmed");
    assert(result.value.capability === "text.generate", "capability should be trimmed");
    assert(result.value.input.schema === "text.generate.input.v1", "input schema should be trimmed");
    assert(result.value.input.requiredFields[0] === "prompt", "input required fields should be trimmed");
    assert(result.value.result.outputFields[0] === "text", "result output fields should be trimmed");
    assert(result.value.compatibility.backendKinds[0] === "nativeWorkerBackend", "backend kind should be trimmed");

    const normalized = normalizeCapabilityServiceDefinition(service);
    assert(normalized.serviceId === "text.generate.default", "normalizeCapabilityServiceDefinition should trim serviceId");
    assert(service.serviceId === " text.generate.default ", "normalizeCapabilityServiceDefinition should not mutate caller input");

    const asserted = assertCapabilityServiceDefinition(service);
    assert(asserted.serviceId === "text.generate.default", "assertCapabilityServiceDefinition should return normalized service");

    ok("valid service definition contract passed");
}

function testServiceDefinitionRequiredFields() {
    const invalidRoot = validateCapabilityServiceDefinition(null);
    assert(!invalidRoot.ok, "null service should reject");
    assertErrorCode(invalidRoot, "invalid_capability_service", "null service");

    const missing = validateCapabilityServiceDefinition({});
    assert(!missing.ok, "missing service fields should reject");
    assertErrorCode(missing, "missing_service_id", "missing serviceId");
    assertErrorCode(missing, "missing_service_capability", "missing capability");
    assertErrorCode(missing, "missing_service_version", "missing version");
    assertErrorCode(missing, "missing_service_status", "missing status");
    assertErrorCode(missing, "missing_service_summary", "missing summary");
    assertErrorCode(missing, "invalid_service_contracts", "missing contracts");
    assertErrorCode(missing, "invalid_service_input", "missing input");
    assertErrorCode(missing, "invalid_service_result", "missing result");
    assertErrorCode(missing, "invalid_service_requirements", "missing requirements");
    assertErrorCode(missing, "invalid_service_compatibility", "missing compatibility");

    const unknownCapability = validateCapabilityServiceDefinition(createValidService({ capability: "unknown.capability" }));
    assert(!unknownCapability.ok, "unknown service capability should reject");
    assertErrorCode(unknownCapability, "unknown_service_capability", "unknown service capability");

    const unknownStatus = validateCapabilityServiceDefinition(createValidService({ status: "active" }));
    assert(!unknownStatus.ok, "unknown service status should reject");
    assertErrorCode(unknownStatus, "unknown_service_status", "unknown service status");

    ok("service definition required-field rejection passed");
}

function testServiceDefinitionUnknownForbiddenAndPathFields() {
    const unknown = validateCapabilityServiceDefinition(createValidService({ priority: 1 }));
    assert(!unknown.ok, "unknown service field should reject");
    assertErrorCode(unknown, "unknown_capability_service_field", "unknown service field");

    const forbiddenRoot = validateCapabilityServiceDefinition(createValidService({ execute: true }));
    assert(!forbiddenRoot.ok, "forbidden service key should reject");
    assertErrorCode(forbiddenRoot, "forbidden_capability_service_key", "forbidden service key");

    const forbiddenNested = validateCapabilityServiceDefinition(createValidService({ compatibility: { backendKinds: ["nativeWorkerBackend"], modelBundleRequired: true, hardwareProfileRequired: false, backendOptions: {} } }));
    assert(!forbiddenNested.ok, "nested forbidden service key should reject");
    assertErrorCode(forbiddenNested, "forbidden_capability_service_key", "nested forbidden service key");

    const pathLike = validateCapabilityServiceDefinition(createValidService({ serviceId: "../service" }));
    assert(!pathLike.ok, "path-like serviceId should reject");
    assertErrorCode(pathLike, "forbidden_service_metadata_value", "path-like serviceId");

    const badInputField = validateCapabilityServiceDefinition(createValidService({ input: { schema: "text.generate.input.v1", requiredFields: ["prompt", "prompt"], optionalFields: ["contextRefs"], contextRefs: "supported" } }));
    assert(!badInputField.ok, "duplicate input required field should reject");
    assertErrorCode(badInputField, "duplicate_service_string_array_entry", "duplicate input required field");

    const badSupport = validateCapabilityServiceDefinition(createValidService({ result: { schema: "text.generate.result.v1", outputFields: ["text"], streamingDeltas: "maybe" } }));
    assert(!badSupport.ok, "unknown result streaming support level should reject");
    assertErrorCode(badSupport, "unknown_service_requirement_support_level", "unknown result streaming support level");

    ok("service definition unknown/forbidden-key rejection passed");
}

function testValidServiceRegistry() {
    const registry = createValidServiceRegistry();
    const result = validateCapabilityServiceRegistry(registry);

    assert(result.ok, `valid service registry should pass: ${JSON.stringify(result.errors)}`);
    assert(result.value.schemaVersion === CAPABILITY_SERVICE_REGISTRY_SCHEMA_VERSION, "service registry schema should match");
    assert(result.value.services[0].serviceId === "text.generate.default", "service registry should normalize services");

    const defaulted = normalizeCapabilityServiceRegistry({ services: [createValidService()] });
    assert(defaulted.schemaVersion === CAPABILITY_SERVICE_REGISTRY_SCHEMA_VERSION, "service registry schema should default");

    const asserted = assertCapabilityServiceRegistry(registry);
    assert(asserted.services.length === 1, "assertCapabilityServiceRegistry should return normalized registry");

    const created = createCapabilityServiceRegistry([createValidService()]);
    assert(created.services[0].serviceId === "text.generate.default", "createCapabilityServiceRegistry should normalize service");

    const listed = listCapabilityServices(registry);
    assert(listed.length === 1, "listCapabilityServices should return one service");
    assert(listed[0] !== result.value.services[0], "listCapabilityServices should return service copies");

    const service = getCapabilityService(registry, " text.generate.default ");
    assert(service.serviceId === "text.generate.default", "getCapabilityService should trim serviceId");
    assert(hasCapabilityService(registry, "text.generate.default"), "hasCapabilityService should find service");
    assert(!hasCapabilityService(registry, "missing-service"), "hasCapabilityService should return false for missing service");

    ok("valid service registry contract passed");
}

function testServiceRegistryDuplicatesAndMultipleCapabilities() {
    const duplicateServiceId = validateCapabilityServiceRegistry(createValidServiceRegistry([
        createValidService({ serviceId: "same-service" }),
        createValidService({ serviceId: "same-service", version: "v2" })
    ]));
    assert(!duplicateServiceId.ok, "duplicate serviceId should reject");
    assertErrorCode(duplicateServiceId, "duplicate_service_id", "duplicate serviceId");

    const multipleServicesForCapability = validateCapabilityServiceRegistry(createValidServiceRegistry([
        createValidService({ serviceId: "text.generate.default" }),
        createValidService({ serviceId: "text.generate.strict-json", result: { schema: "text.generate.json.result.v1", outputFields: ["json"], streamingDeltas: "unsupported" } })
    ]));
    assert(multipleServicesForCapability.ok, `multiple services for one capability should pass: ${JSON.stringify(multipleServicesForCapability.errors)}`);

    ok("service registry duplicate-service and multi-service behavior passed");
}

function testValidServicePlan() {
    const routePlan = createValidRoutePlan();
    const serviceRegistry = createValidServiceRegistry();
    const result = validateCapabilityServicePlan(routePlan, serviceRegistry);

    assert(result.ok, `valid service plan should pass: ${JSON.stringify(result.errors)}`);
    assert(result.value.contractVersion === CAPABILITY_SERVICE_CONTRACT_VERSION, "service plan contract version should match");
    assert(result.value.routePlan.contractVersion === CAPABILITY_ROUTER_CONTRACT_VERSION, "service plan should keep route plan contract");
    assert(result.value.routePlan.busAction.contractVersion === CAPABILITY_BUS_CONTRACT_VERSION, "service plan should keep bus action contract");
    assert(result.value.service.serviceId === "text.generate.default", "service plan should select matching service");
    assert(result.value !== routePlan, "service plan should be a new wrapper object");
    assert(result.value.routePlan !== routePlan, "service plan should copy route plan wrapper");
    assert(result.value.service !== serviceRegistry.services[0], "service plan should copy service wrapper");

    const normalized = normalizeCapabilityServicePlan(routePlan, serviceRegistry);
    assert(normalized.service.compatibility.backendKinds[0] === "nativeWorkerBackend", "normalizeCapabilityServicePlan should return normalized plan");

    const asserted = assertCapabilityServicePlan(routePlan, serviceRegistry);
    assert(asserted.service.result.outputFields[0] === "text", "assertCapabilityServicePlan should return normalized service plan");

    ok("valid service plan from route plan and service registry passed");
}

function testServicePlanMissingOrUnselectableService() {
    const routePlan = createValidRoutePlan();

    const missing = validateCapabilityServicePlan(routePlan, createValidServiceRegistry([]));
    assert(!missing.ok, "missing service should reject");
    assertErrorCode(missing, "service_missing_for_route", "missing service");

    const disabled = validateCapabilityServicePlan(routePlan, createValidServiceRegistry([
        createValidService({ status: "disabled" })
    ]));
    assert(!disabled.ok, "disabled service should reject");
    assertErrorCode(disabled, "service_unselectable_status", "disabled service");

    const deprecated = validateCapabilityServicePlan(routePlan, createValidServiceRegistry([
        createValidService({ status: "deprecated" })
    ]));
    assert(!deprecated.ok, "deprecated service should reject");
    assertErrorCode(deprecated, "service_unselectable_status", "deprecated service");

    ok("service plan missing/unselectable service rejection passed");
}

function testServicePlanCompatibilityRejections() {
    const routePlan = createValidRoutePlan();

    const wrongCapability = validateCapabilityServicePlan(routePlan, createValidServiceRegistry([
        createValidService({ serviceId: "text.generate.default", capability: "text.embed" })
    ]));
    assert(!wrongCapability.ok, "wrong service capability should reject");
    assertErrorCode(wrongCapability, "service_capability_mismatch", "wrong service capability");

    const wrongBackendKind = validateCapabilityServicePlan(routePlan, createValidServiceRegistry([
        createValidService({ compatibility: { backendKinds: ["llamaServerBackend"], modelBundleRequired: true, hardwareProfileRequired: false } })
    ]));
    assert(!wrongBackendKind.ok, "wrong service backend kind should reject");
    assertErrorCode(wrongBackendKind, "service_backend_kind_incompatible", "wrong backend kind");

    const missingModelBundle = validateCapabilityServicePlan(
        createValidRoutePlan({
            busAction: createValidBusAction({
                definitionOverrides: {
                    compatibility: {
                        backendKinds: ["nativeWorkerBackend"],
                        modelBundleRequired: false,
                        contextRefs: true
                    }
                }
            }),
            routerRegistry: createValidRouterRegistry([createValidRoute({ modelBundleId: undefined })])
        }),
        createValidServiceRegistry([createValidService({ compatibility: { backendKinds: ["nativeWorkerBackend"], modelBundleRequired: true, hardwareProfileRequired: false } })])
    );
    assert(!missingModelBundle.ok, "missing modelBundleId should reject when service requires it");
    assertErrorCode(missingModelBundle, "service_model_bundle_required", "missing model bundle");

    const missingHardwareProfile = validateCapabilityServicePlan(
        createValidRoutePlan({ routerRegistry: createValidRouterRegistry([createValidRoute({ hardwareProfileId: undefined })]) }),
        createValidServiceRegistry([createValidService({ compatibility: { backendKinds: ["nativeWorkerBackend"], modelBundleRequired: true, hardwareProfileRequired: true } })])
    );
    assert(!missingHardwareProfile.ok, "missing hardwareProfileId should reject when service requires it");
    assertErrorCode(missingHardwareProfile, "service_hardware_profile_required", "missing hardware profile");

    const streamingUnsupported = validateCapabilityServicePlan(routePlan, createValidServiceRegistry([
        createValidService({ requirements: { streaming: "unsupported", cancellation: "supported", timeout: "supported", approval: "conditional" } })
    ]));
    assert(!streamingUnsupported.ok, "service streaming unsupported should reject streaming action");
    assertErrorCode(streamingUnsupported, "service_streaming_unsupported", "streaming unsupported");

    const timeoutUnsupported = validateCapabilityServicePlan(routePlan, createValidServiceRegistry([
        createValidService({ requirements: { streaming: "supported", cancellation: "supported", timeout: "unsupported", approval: "conditional" } })
    ]));
    assert(!timeoutUnsupported.ok, "service timeout unsupported should reject action timeout requirement");
    assertErrorCode(timeoutUnsupported, "service_timeout_unsupported", "timeout unsupported");

    const contextRefsUnsupported = validateCapabilityServicePlan(routePlan, createValidServiceRegistry([
        createValidService({ input: { schema: "text.generate.input.v1", requiredFields: ["prompt"], optionalFields: [], contextRefs: "unsupported" } })
    ]));
    assert(!contextRefsUnsupported.ok, "service contextRefs unsupported should reject action contextRefs");
    assertErrorCode(contextRefsUnsupported, "service_context_refs_unsupported", "contextRefs unsupported");

    ok("service plan compatibility rejection passed");
}

function testServicePlanWrapperValidation() {
    const routePlan = createValidRoutePlan();

    const wrongContractVersion = validateCapabilityServicePlan(
        { ...routePlan, contractVersion: "wrong" },
        createValidServiceRegistry()
    );
    assert(!wrongContractVersion.ok, "wrong route plan contractVersion should reject");
    assertErrorCode(wrongContractVersion, "unsupported_capability_route_plan_contract_version", "wrong route plan contract");

    const unknownRoutePlanKey = validateCapabilityServicePlan(
        { ...routePlan, unexpected: true },
        createValidServiceRegistry()
    );
    assert(!unknownRoutePlanKey.ok, "unknown route plan wrapper field should reject");
    assertErrorCode(unknownRoutePlanKey, "unknown_service_plan_route_plan_field", "unknown route plan wrapper field");

    assertThrowsValidation(
        "assertCapabilityServicePlan invalid registry",
        () => assertCapabilityServicePlan(routePlan, { services: [{ serviceId: "bad" }] }),
        "service_plan_service_registry_service_registry_service_invalid_service_contracts"
    );

    ok("service plan wrapper validation passed");
}

async function main() {
    await assertNoRuntimeWiringImports();
    testServiceConstants();
    testValidServiceDefinition();
    testServiceDefinitionRequiredFields();
    testServiceDefinitionUnknownForbiddenAndPathFields();
    testValidServiceRegistry();
    testServiceRegistryDuplicatesAndMultipleCapabilities();
    testValidServicePlan();
    testServicePlanMissingOrUnselectableService();
    testServicePlanCompatibilityRejections();
    testServicePlanWrapperValidation();

    console.log("All capability service contract smoke tests finished.");
}

main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
});
