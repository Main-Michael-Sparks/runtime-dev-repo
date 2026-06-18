// smokeTestCapabilityRouterContract.mjs
//
// Purpose:
// - Contract smoke for the Runtime Dev capability router contract branch.
// - Validates metadata-only route definitions, route registries, and route plans
//   without wiring runtime.mjs, workerBridge, backend adapters, or llama_worker modules.
//
// Run:
//   node ./tests/smokeTestCapabilityRouterContract.mjs

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

import {
    CAPABILITY_BUS_CONTRACT_VERSION,
    assertCapabilityBusAction
} from "../runtime/bus/capabilityBusContract.mjs";
import {
    CAPABILITY_ROUTER_CONTRACT_VERSION,
    CAPABILITY_ROUTE_STATUSES,
    assertCapabilityRouteDefinition,
    assertCapabilityRoutePlan,
    assertCapabilityRouterRegistry,
    createCapabilityRouterRegistry,
    getCapabilityRoute,
    hasCapabilityRoute,
    isKnownCapabilityRouteStatus,
    listCapabilityRoutes,
    normalizeCapabilityRouteDefinition,
    normalizeCapabilityRoutePlan,
    normalizeCapabilityRouterRegistry,
    validateCapabilityRouteDefinition,
    validateCapabilityRoutePlan,
    validateCapabilityRouterRegistry
} from "../runtime/router/capabilityRouterContract.mjs";
import {
    CAPABILITY_CONTRACT_REFS
} from "../runtime/bus/capabilityDefinition.mjs";

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

async function readSource(relativePath) {
    return fs.readFile(path.join(repoRoot, relativePath), "utf8");
}

function createValidAction(overrides = {}) {
    return {
        actionId: "act_router_1",
        runId: "run_router_1",
        source: {
            kind: "direct-api"
        },
        capability: "text.generate",
        intent: "execute_cognitive_node",
        input: {
            prompt: "Say hello briefly."
        },
        requirements: {
            modelClass: "reasoning-7b",
            contextNeed: "medium",
            stream: true,
            timeoutMs: 60000
        },
        policy: {
            maxTokens: 128,
            approvalRequired: false,
            allowTools: false,
            budget: {
                tokens: 128
            }
        },
        trace: {
            operator: "router-contract-smoke"
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
            action: CAPABILITY_CONTRACT_REFS.action,
            result: CAPABILITY_CONTRACT_REFS.result,
            event: CAPABILITY_CONTRACT_REFS.event
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

function createValidCapabilityRegistry(definition = createValidCapabilityDefinition()) {
    return {
        schemaVersion: "capability-registry.v1",
        capabilities: [definition]
    };
}

function createValidBusAction({ action = createValidAction(), definition = createValidCapabilityDefinition() } = {}) {
    return assertCapabilityBusAction(action, createValidCapabilityRegistry(definition));
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

const ROUTER_IMPLEMENTATION_FILES = [
    "runtime/router/capabilityRouterContract.mjs",
    "runtime/router/capabilityRouterCommon.mjs",
    "runtime/router/capabilityRouteDefinition.mjs",
    "runtime/router/capabilityRouterRegistry.mjs",
    "runtime/router/capabilityRoutePlan.mjs",
    "runtime/router/capabilityRouteModelBundlePlan.mjs"
];

const ROUTER_COMPATIBILITY_BARRELS = [
    "runtime/bus/capabilityRouterContract.mjs",
    "runtime/bus/capabilityRouterCommon.mjs",
    "runtime/bus/capabilityRouteDefinition.mjs",
    "runtime/bus/capabilityRouterRegistry.mjs",
    "runtime/bus/capabilityRoutePlan.mjs"
];

async function assertRouterImplementationNamespace() {
    for (const relativePath of ROUTER_IMPLEMENTATION_FILES) {
        await readSource(relativePath);
    }

    ok("capability router implementation modules live under runtime/router/");
}

async function assertBusCompatibilityBarrels() {
    for (const relativePath of ROUTER_COMPATIBILITY_BARRELS) {
        const source = (await readSource(relativePath)).trim();
        const expectedTarget = relativePath
            .replace("runtime/bus/", "../router/");
        const expected = `export * from "${expectedTarget}";`;

        assert(
            source === expected,
            `${relativePath} should be a re-export-only compatibility barrel`
        );
    }

    ok("runtime/bus capability router compatibility files are re-export-only barrels");
}

async function assertNoRuntimeWiringImports() {
    const forbiddenMarkers = [
        "runtime.mjs",
        "workerBridge",
        "llama_worker",
        "node-llama-cpp",
        "../lifecycle/",
        "../request/",
        "../stream/",
        "executeAction",
        "prompt("
    ];

    for (const relativePath of ROUTER_IMPLEMENTATION_FILES) {
        const source = await readSource(relativePath);

        for (const marker of forbiddenMarkers) {
            if (source.includes(marker)) {
                fail(`${relativePath} includes forbidden runtime wiring marker: ${marker}`);
            }
        }
    }

    ok("capability router implementation modules avoid runtime/worker execution imports");
}

function testRouterConstants() {
    assert(CAPABILITY_ROUTER_CONTRACT_VERSION === "capability-router.v1", "router contract version should match");
    assertIncludes(CAPABILITY_ROUTE_STATUSES, "contract-only", "route statuses");
    assertIncludes(CAPABILITY_ROUTE_STATUSES, "disabled", "route statuses");
    assertIncludes(CAPABILITY_ROUTE_STATUSES, "deprecated", "route statuses");
    assert(isKnownCapabilityRouteStatus("implemented"), "implemented route status should be known");
    assert(!isKnownCapabilityRouteStatus("active"), "active should not be a v1 route status");

    ok("capability router constants passed");
}

function testValidRouteDefinition() {
    const route = createValidRoute();
    const result = validateCapabilityRouteDefinition(route);

    assert(result.ok, `valid route should pass: ${JSON.stringify(result.errors)}`);
    assert(result.value.routeId === "text-generate-default", "routeId should be trimmed");
    assert(result.value.capability === "text.generate", "capability should be trimmed");
    assert(result.value.serviceId === "text.generate.default", "serviceId should be trimmed");
    assert(result.value.backendKind === "nativeWorkerBackend", "backendKind should be trimmed");
    assert(result.value.modelBundleId === "mistral-text-local", "modelBundleId should be trimmed");

    const normalized = normalizeCapabilityRouteDefinition(route);
    assert(normalized.routeId === "text-generate-default", "normalizeCapabilityRouteDefinition should trim routeId");
    const trimOnly = normalizeCapabilityRouteDefinition({ ...route, routeId: " text-generate-default " });
    assert(trimOnly.routeId === "text-generate-default", "normalizeCapabilityRouteDefinition should trim routeId");
    assert(route.routeId === "text-generate-default", "normalizeCapabilityRouteDefinition should not mutate caller input");

    const asserted = assertCapabilityRouteDefinition(route);
    assert(asserted.routeId === "text-generate-default", "assertCapabilityRouteDefinition should return normalized route");

    ok("valid route definition contract passed");
}

function testRouteDefinitionRequiredFields() {
    const invalidRoot = validateCapabilityRouteDefinition(null);
    assert(!invalidRoot.ok, "null route should reject");
    assertErrorCode(invalidRoot, "invalid_capability_route", "null route");

    const missing = validateCapabilityRouteDefinition({});
    assert(!missing.ok, "missing route fields should reject");
    assertErrorCode(missing, "missing_route_id", "missing routeId");
    assertErrorCode(missing, "missing_route_capability", "missing capability");
    assertErrorCode(missing, "missing_route_status", "missing status");
    assertErrorCode(missing, "missing_route_service_id", "missing serviceId");
    assertErrorCode(missing, "missing_route_backend_kind", "missing backendKind");

    const unknownCapability = validateCapabilityRouteDefinition(createValidRoute({ capability: "unknown.capability" }));
    assert(!unknownCapability.ok, "unknown route capability should reject");
    assertErrorCode(unknownCapability, "unknown_route_capability", "unknown route capability");

    const unknownStatus = validateCapabilityRouteDefinition(createValidRoute({ status: "active" }));
    assert(!unknownStatus.ok, "unknown route status should reject");
    assertErrorCode(unknownStatus, "unknown_route_status", "unknown route status");

    ok("route definition required-field rejection passed");
}

function testRouteDefinitionUnknownForbiddenAndPathFields() {
    const unknown = validateCapabilityRouteDefinition(createValidRoute({ priority: 1 }));
    assert(!unknown.ok, "unknown route field should reject");
    assertErrorCode(unknown, "unknown_capability_route_field", "unknown route field");

    const forbiddenRoot = validateCapabilityRouteDefinition(createValidRoute({ modelPath: "./model.gguf" }));
    assert(!forbiddenRoot.ok, "forbidden route key should reject");
    assertErrorCode(forbiddenRoot, "forbidden_capability_route_key", "forbidden route key");

    const forbiddenNested = validateCapabilityRouteDefinition(createValidRoute({ requirements: { streaming: "supported", backendOptions: {} } }));
    assert(!forbiddenNested.ok, "nested forbidden route key should reject");
    assertErrorCode(forbiddenNested, "forbidden_capability_route_key", "nested forbidden route key");

    const pathLike = validateCapabilityRouteDefinition(createValidRoute({ serviceId: "../service" }));
    assert(!pathLike.ok, "path-like serviceId should reject");
    assertErrorCode(pathLike, "forbidden_route_metadata_value", "path-like serviceId");

    const badRequirement = validateCapabilityRouteDefinition(createValidRoute({ requirements: { streaming: "maybe" } }));
    assert(!badRequirement.ok, "unknown route requirement support level should reject");
    assertErrorCode(badRequirement, "unknown_route_requirement_support_level", "unknown route support level");

    ok("route definition unknown/forbidden-key rejection passed");
}

function testValidRouterRegistry() {
    const registry = createValidRouterRegistry();
    const result = validateCapabilityRouterRegistry(registry);

    assert(result.ok, `valid router registry should pass: ${JSON.stringify(result.errors)}`);
    assert(result.value.schemaVersion === CAPABILITY_ROUTER_CONTRACT_VERSION, "router registry schema should match");
    assert(result.value.routes[0].routeId === "text-generate-default", "router registry should normalize routes");

    const defaulted = normalizeCapabilityRouterRegistry({ routes: [createValidRoute()] });
    assert(defaulted.schemaVersion === CAPABILITY_ROUTER_CONTRACT_VERSION, "router registry schema should default");

    const asserted = assertCapabilityRouterRegistry(registry);
    assert(asserted.routes.length === 1, "assertCapabilityRouterRegistry should return normalized registry");

    const created = createCapabilityRouterRegistry([createValidRoute()]);
    assert(created.routes[0].routeId === "text-generate-default", "createCapabilityRouterRegistry should normalize route");

    const listed = listCapabilityRoutes(registry);
    assert(listed.length === 1, "listCapabilityRoutes should return one route");
    assert(listed[0] !== result.value.routes[0], "listCapabilityRoutes should return route copies");

    const route = getCapabilityRoute(registry, " text-generate-default ");
    assert(route.routeId === "text-generate-default", "getCapabilityRoute should trim routeId");
    assert(hasCapabilityRoute(registry, "text-generate-default"), "hasCapabilityRoute should find route");
    assert(!hasCapabilityRoute(registry, "missing-route"), "hasCapabilityRoute should return false for missing route");

    ok("valid router registry contract passed");
}

function testRouterRegistryDuplicateRoutes() {
    const duplicateRouteId = validateCapabilityRouterRegistry(createValidRouterRegistry([
        createValidRoute({ routeId: "same-route" }),
        createValidRoute({ routeId: "same-route", capability: "text.embed", serviceId: "text.embed.default" })
    ]));
    assert(!duplicateRouteId.ok, "duplicate routeId should reject");
    assertErrorCode(duplicateRouteId, "duplicate_route_id", "duplicate routeId");

    const duplicateCapability = validateCapabilityRouterRegistry(createValidRouterRegistry([
        createValidRoute({ routeId: "first-route" }),
        createValidRoute({ routeId: "second-route", serviceId: "text.generate.backup", backendId: "native-worker.backup" })
    ]));
    assert(!duplicateCapability.ok, "duplicate selectable route for same capability should reject");
    assertErrorCode(duplicateCapability, "duplicate_selectable_route_for_capability", "duplicate selectable route");

    const disabledPlusActive = validateCapabilityRouterRegistry(createValidRouterRegistry([
        createValidRoute({ routeId: "disabled-route", status: "disabled" }),
        createValidRoute({ routeId: "active-route" })
    ]));
    assert(disabledPlusActive.ok, `disabled plus active same capability should pass: ${JSON.stringify(disabledPlusActive.errors)}`);

    ok("router registry duplicate route rejection passed");
}

function testValidRoutePlan() {
    const busAction = createValidBusAction();
    const routerRegistry = createValidRouterRegistry();
    const result = validateCapabilityRoutePlan(busAction, routerRegistry);

    assert(result.ok, `valid route plan should pass: ${JSON.stringify(result.errors)}`);
    assert(result.value.contractVersion === CAPABILITY_ROUTER_CONTRACT_VERSION, "route plan contract version should match");
    assert(result.value.busAction.contractVersion === CAPABILITY_BUS_CONTRACT_VERSION, "route plan should keep bus action contract");
    assert(result.value.route.routeId === "text-generate-default", "route plan should select matching route");
    assert(result.value !== busAction, "route plan should be a new wrapper object");
    assert(result.value.busAction !== busAction, "route plan should copy bus action wrapper");
    assert(result.value.route !== routerRegistry.routes[0], "route plan should copy route wrapper");

    const normalized = normalizeCapabilityRoutePlan(busAction, routerRegistry);
    assert(normalized.route.backendKind === "nativeWorkerBackend", "normalizeCapabilityRoutePlan should return normalized plan");

    const asserted = assertCapabilityRoutePlan(busAction, routerRegistry);
    assert(asserted.route.modelBundleId === "mistral-text-local", "assertCapabilityRoutePlan should return normalized route plan");

    ok("valid route plan from bus action and router registry passed");
}

function testRoutePlanMissingDisabledDeprecatedRoutes() {
    const busAction = createValidBusAction();

    const missing = validateCapabilityRoutePlan(busAction, createValidRouterRegistry([
        createValidRoute({ routeId: "embed-route", capability: "text.embed", serviceId: "text.embed.default" })
    ]));
    assert(!missing.ok, "missing route should reject");
    assertErrorCode(missing, "route_missing_for_capability", "missing route");

    const disabled = validateCapabilityRoutePlan(busAction, createValidRouterRegistry([
        createValidRoute({ status: "disabled" })
    ]));
    assert(!disabled.ok, "disabled route should reject as unselectable");
    assertErrorCode(disabled, "route_unselectable_status", "disabled route");

    const deprecated = validateCapabilityRoutePlan(busAction, createValidRouterRegistry([
        createValidRoute({ status: "deprecated" })
    ]));
    assert(!deprecated.ok, "deprecated route should reject as unselectable");
    assertErrorCode(deprecated, "route_unselectable_status", "deprecated route");

    ok("missing/disabled/deprecated route plan rejection passed");
}

function testRoutePlanCompatibilityRejections() {
    const incompatibleBackend = validateCapabilityRoutePlan(
        createValidBusAction({
            definition: createValidCapabilityDefinition({
                compatibility: {
                    backendKinds: ["llamaServerBackend"],
                    modelBundleRequired: true,
                    contextRefs: true
                }
            })
        }),
        createValidRouterRegistry()
    );
    assert(!incompatibleBackend.ok, "backendKind incompatibility should reject");
    assertErrorCode(incompatibleBackend, "route_backend_kind_incompatible", "backendKind compatibility");

    const missingModelBundle = validateCapabilityRoutePlan(
        createValidBusAction(),
        createValidRouterRegistry([
            createValidRoute({ modelBundleId: undefined })
        ])
    );
    assert(!missingModelBundle.ok, "modelBundleRequired without route modelBundleId should reject");
    assertErrorCode(missingModelBundle, "route_model_bundle_required", "modelBundleRequired");

    const unsupportedStream = validateCapabilityRoutePlan(
        createValidBusAction({ action: createValidAction({ requirements: { stream: true } }) }),
        createValidRouterRegistry([
            createValidRoute({ requirements: { streaming: "unsupported", cancellation: "supported", timeout: "supported" } })
        ])
    );
    assert(!unsupportedStream.ok, "stream requirement with unsupported route should reject");
    assertErrorCode(unsupportedStream, "route_streaming_unsupported", "stream route support");

    const contextRefs = validateCapabilityRoutePlan(
        createValidBusAction({
            action: createValidAction({ input: { prompt: "hello", contextRefs: ["ctx_1"] } }),
            definition: createValidCapabilityDefinition({
                compatibility: {
                    backendKinds: ["nativeWorkerBackend"],
                    modelBundleRequired: true,
                    contextRefs: false
                }
            })
        }),
        createValidRouterRegistry()
    );
    assert(!contextRefs.ok, "contextRefs disabled by compatibility should reject");
    assertErrorCode(contextRefs, "route_context_refs_incompatible", "contextRefs compatibility");

    ok("route plan compatibility rejection passed");
}

function testRoutePlanBusActionShapeRejections() {
    const invalidContract = validateCapabilityRoutePlan(
        {
            ...createValidBusAction(),
            contractVersion: "capability-bus.v0"
        },
        createValidRouterRegistry()
    );
    assert(!invalidContract.ok, "invalid bus action contract version should reject");
    assertErrorCode(invalidContract, "unsupported_bus_action_contract_version", "bus action contract version");

    const mismatchedCapability = validateCapabilityRoutePlan(
        {
            ...createValidBusAction(),
            capabilityDefinition: createValidCapabilityDefinition({ capability: "text.embed" })
        },
        createValidRouterRegistry()
    );
    assert(!mismatchedCapability.ok, "bus action capability mismatch should reject");
    assertErrorCode(mismatchedCapability, "route_plan_capability_mismatch", "bus action capability mismatch");

    ok("route plan busAction shape rejection passed");
}

async function main() {
    testRouterConstants();
    testValidRouteDefinition();
    testRouteDefinitionRequiredFields();
    testRouteDefinitionUnknownForbiddenAndPathFields();
    testValidRouterRegistry();
    testRouterRegistryDuplicateRoutes();
    testValidRoutePlan();
    testRoutePlanMissingDisabledDeprecatedRoutes();
    testRoutePlanCompatibilityRejections();
    testRoutePlanBusActionShapeRejections();
    await assertRouterImplementationNamespace();
    await assertBusCompatibilityBarrels();
    await assertNoRuntimeWiringImports();

    console.log("All capability router contract smoke checks finished.");
}

main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
});
