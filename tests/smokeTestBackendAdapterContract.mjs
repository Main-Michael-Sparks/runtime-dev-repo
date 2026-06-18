// smokeTestBackendAdapterContract.mjs
//
// Purpose:
// - Contract smoke for the Runtime Dev backend adapter contract branch.
// - Validates metadata-only backend adapter definitions, registries, and adapter plans
//   without wiring runtime.mjs, workerBridge, executable backends, or llama_worker modules.
//
// Run:
//   node ./tests/smokeTestBackendAdapterContract.mjs

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
} from "../runtime/router/capabilityRouterContract.mjs";
import {
    CAPABILITY_SERVICE_CONTRACT_VERSION,
    CAPABILITY_SERVICE_REGISTRY_SCHEMA_VERSION,
    assertCapabilityServicePlan
} from "../runtime/bus/capabilityServiceContract.mjs";
import {
    BACKEND_ADAPTER_CONTRACT_VERSION,
    BACKEND_ADAPTER_REGISTRY_SCHEMA_VERSION,
    BACKEND_ADAPTER_STATUSES,
    assertBackendAdapterDefinition,
    assertBackendAdapterPlan,
    assertBackendAdapterRegistry,
    createBackendAdapterRegistry,
    getBackendAdapter,
    hasBackendAdapter,
    isKnownBackendAdapterRequirementSupportLevel,
    isKnownBackendAdapterStatus,
    isSelectableBackendAdapterStatus,
    listBackendAdapters,
    normalizeBackendAdapterDefinition,
    normalizeBackendAdapterPlan,
    normalizeBackendAdapterRegistry,
    validateBackendAdapterDefinition,
    validateBackendAdapterPlan,
    validateBackendAdapterRegistry
} from "../runtime/backends/backendAdapterContract.mjs";

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
        actionId: "act_backend_1",
        runId: "run_backend_1",
        source: {
            kind: "direct-api"
        },
        capability: "text.generate",
        intent: "execute_cognitive_node",
        input: {
            prompt: "Say hello briefly.",
            contextRefs: ["ctx_1"]
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
            operator: "backend-adapter-contract-smoke"
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

function createValidBusAction({ actionOverrides = {}, definitionOverrides = {} } = {}) {
    return assertCapabilityBusAction(
        createValidActionEnvelope(actionOverrides),
        createValidCapabilityRegistry([
            createValidCapabilityDefinition(definitionOverrides)
        ])
    );
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

function createValidRoutePlan({ busAction = createValidBusAction(), routerRegistry = createValidRouterRegistry() } = {}) {
    return assertCapabilityRoutePlan(busAction, routerRegistry);
}

function createValidService(overrides = {}) {
    return {
        serviceId: "text.generate.default",
        capability: "text.generate",
        version: "v1",
        status: "contract-only",
        summary: "Validate text generation inputs and normalize text generation results.",
        contracts: {
            action: "actionEnvelope.v1",
            result: "resultEnvelope.v1",
            event: "actionEvent.v1"
        },
        input: {
            schema: "text.generate.input.v1",
            requiredFields: ["prompt"],
            optionalFields: ["contextRefs"],
            contextRefs: "supported"
        },
        result: {
            schema: "text.generate.result.v1",
            outputFields: ["text"],
            streamingDeltas: "supported"
        },
        requirements: {
            streaming: "supported",
            cancellation: "supported",
            timeout: "supported",
            approval: "conditional"
        },
        compatibility: {
            backendKinds: ["nativeWorkerBackend"],
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

function createValidServicePlan({ routePlan = createValidRoutePlan(), serviceRegistry = createValidServiceRegistry() } = {}) {
    return assertCapabilityServicePlan(routePlan, serviceRegistry);
}

function createValidAdapter(overrides = {}) {
    return {
        adapterId: " native-worker.default ",
        backendKind: " nativeWorkerBackend ",
        version: " v1 ",
        status: "contract-only",
        summary: " Native worker backend adapter descriptor. ",
        capabilities: [" text.generate "],
        services: [" text.generate.default "],
        contracts: {
            servicePlan: CAPABILITY_SERVICE_CONTRACT_VERSION,
            result: "resultEnvelope.v1",
            event: "actionEvent.v1"
        },
        result: {
            schema: " text.generate.result.v1 ",
            outputFields: [" text "],
            streamingDeltas: "supported",
            errorNormalization: "supported"
        },
        requirements: {
            streaming: "supported",
            cancellation: "supported",
            timeout: "supported"
        },
        compatibility: {
            backendKind: " nativeWorkerBackend ",
            modelBundleRequired: true,
            hardwareProfileRequired: true
        },
        ...overrides
    };
}

function createValidAdapterRegistry(adapters = [createValidAdapter()]) {
    return {
        schemaVersion: BACKEND_ADAPTER_REGISTRY_SCHEMA_VERSION,
        adapters
    };
}

async function assertNoRuntimeWiringImports() {
    const backendFiles = [
        "runtime/backends/backendAdapterCommon.mjs",
        "runtime/backends/backendAdapterDefinition.mjs",
        "runtime/backends/backendAdapterRegistry.mjs",
        "runtime/backends/backendAdapterPlan.mjs",
        "runtime/backends/backendAdapterContract.mjs",
        "runtime/backends/nativeWorker/nativeWorkerBackendAdapterDefinition.mjs",
        "runtime/backends/nativeWorker/nativeWorkerBackendContract.mjs"
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
        "new Worker",
        "sendToWorker",
        "ReadableStream",
        "setTimeout",
        "Date.now"
    ];

    for (const relativePath of backendFiles) {
        const source = await readSource(relativePath);

        for (const marker of forbiddenMarkers) {
            if (source.includes(marker)) {
                fail(`${relativePath} includes forbidden runtime wiring marker: ${marker}`);
            }
        }
    }

    const runtimeSource = await readSource("runtime.mjs");
    assert(
        !runtimeSource.includes("runtime/backends") && !runtimeSource.includes("./runtime/backends"),
        "runtime.mjs should not import backend adapter contract modules in this branch"
    );

    ok("backend adapter contract modules avoid runtime/worker execution imports");
}

function testBackendAdapterConstants() {
    assert(BACKEND_ADAPTER_CONTRACT_VERSION === "backend-adapter.v1", "backend adapter contract version should match");
    assert(BACKEND_ADAPTER_REGISTRY_SCHEMA_VERSION === "backend-adapter-registry.v1", "backend adapter registry schema should match");
    assertIncludes(BACKEND_ADAPTER_STATUSES, "contract-only", "backend adapter statuses");
    assertIncludes(BACKEND_ADAPTER_STATUSES, "disabled", "backend adapter statuses");
    assertIncludes(BACKEND_ADAPTER_STATUSES, "deprecated", "backend adapter statuses");
    assert(isKnownBackendAdapterStatus("implemented"), "implemented backend adapter status should be known");
    assert(!isKnownBackendAdapterStatus("active"), "active should not be a v1 backend adapter status");
    assert(isSelectableBackendAdapterStatus("experimental"), "experimental should be selectable in v1 metadata");
    assert(!isSelectableBackendAdapterStatus("disabled"), "disabled should not be selectable");
    assert(isKnownBackendAdapterRequirementSupportLevel("required"), "required should be an adapter support level");
    assert(!isKnownBackendAdapterRequirementSupportLevel("conditional"), "conditional should not be an adapter requirement support level");

    ok("backend adapter constants passed");
}

function testValidBackendAdapterDefinition() {
    const adapter = createValidAdapter();
    const result = validateBackendAdapterDefinition(adapter);

    assert(result.ok, `valid adapter should pass: ${JSON.stringify(result.errors)}`);
    assert(result.value.adapterId === "native-worker.default", "adapterId should be trimmed");
    assert(result.value.backendKind === "nativeWorkerBackend", "backendKind should be trimmed");
    assert(result.value.capabilities[0] === "text.generate", "capabilities should be trimmed");
    assert(result.value.services[0] === "text.generate.default", "services should be trimmed");
    assert(result.value.compatibility.backendKind === "nativeWorkerBackend", "compatibility backendKind should be trimmed");

    const normalized = normalizeBackendAdapterDefinition(adapter);
    assert(normalized.adapterId === "native-worker.default", "normalizeBackendAdapterDefinition should trim adapterId");
    assert(adapter.adapterId === " native-worker.default ", "normalizeBackendAdapterDefinition should not mutate caller input");

    const asserted = assertBackendAdapterDefinition(adapter);
    assert(asserted.adapterId === "native-worker.default", "assertBackendAdapterDefinition should return normalized adapter");

    ok("valid backend adapter definition contract passed");
}

function testBackendAdapterDefinitionRequiredFields() {
    const invalidRoot = validateBackendAdapterDefinition(null);
    assert(!invalidRoot.ok, "null adapter should reject");
    assertErrorCode(invalidRoot, "invalid_backend_adapter", "null adapter");

    const missing = validateBackendAdapterDefinition({});
    assert(!missing.ok, "missing adapter fields should reject");
    assertErrorCode(missing, "missing_backend_adapter_id", "missing adapterId");
    assertErrorCode(missing, "missing_backend_adapter_backend_kind", "missing backendKind");
    assertErrorCode(missing, "missing_backend_adapter_status", "missing status");
    assertErrorCode(missing, "invalid_backend_adapter_result", "missing result");
    assertErrorCode(missing, "invalid_backend_adapter_requirements", "missing requirements");
    assertErrorCode(missing, "invalid_backend_adapter_compatibility", "missing compatibility");

    const unknownCapability = validateBackendAdapterDefinition(createValidAdapter({ capabilities: ["unknown.capability"] }));
    assert(!unknownCapability.ok, "unknown adapter capability should reject");
    assertErrorCode(unknownCapability, "unknown_backend_adapter_capability", "unknown adapter capability");

    const unknownStatus = validateBackendAdapterDefinition(createValidAdapter({ status: "active" }));
    assert(!unknownStatus.ok, "unknown adapter status should reject");
    assertErrorCode(unknownStatus, "unknown_backend_adapter_status", "unknown adapter status");

    ok("backend adapter definition required-field rejection passed");
}

function testBackendAdapterDefinitionFieldGuards() {
    const unknownTop = validateBackendAdapterDefinition({ ...createValidAdapter(), extra: true });
    assert(!unknownTop.ok, "unknown top-level adapter field should reject");
    assertErrorCode(unknownTop, "unknown_backend_adapter_field", "unknown top-level adapter field");

    const unknownNested = validateBackendAdapterDefinition({
        ...createValidAdapter(),
        result: {
            ...createValidAdapter().result,
            raw: true
        }
    });
    assert(!unknownNested.ok, "unknown nested adapter field should reject");
    assertErrorCode(unknownNested, "unknown_backend_adapter_result_field", "unknown nested adapter field");

    const polluted = validateBackendAdapterDefinition({
        ...createValidAdapter(),
        result: {
            ...createValidAdapter().result,
            constructor: {}
        }
    });
    assert(!polluted.ok, "prototype-pollution key should reject");
    assertErrorCode(polluted, "forbidden_backend_adapter_key", "prototype-pollution key");

    const executionKey = validateBackendAdapterDefinition({
        ...createValidAdapter(),
        handler: () => {}
    });
    assert(!executionKey.ok, "execution key should reject");
    assertErrorCode(executionKey, "forbidden_backend_adapter_key", "execution key");

    const modelPathKey = validateBackendAdapterDefinition({
        ...createValidAdapter(),
        modelPath: "../../../base/model.gguf"
    });
    assert(!modelPathKey.ok, "model path key should reject");
    assertErrorCode(modelPathKey, "forbidden_backend_adapter_key", "model path key");

    const pathLikeValue = validateBackendAdapterDefinition(createValidAdapter({ backendKind: "../nativeWorkerBackend" }));
    assert(!pathLikeValue.ok, "path-like backendKind should reject");
    assertErrorCode(pathLikeValue, "forbidden_backend_adapter_metadata_value", "path-like backendKind");

    ok("backend adapter definition field guard rejection passed");
}

function testBackendAdapterContractValidation() {
    const invalidContracts = validateBackendAdapterDefinition(createValidAdapter({
        contracts: {
            servicePlan: "wrong.v1",
            result: "resultEnvelope.v1",
            event: "actionEvent.v1"
        }
    }));
    assert(!invalidContracts.ok, "invalid contract ref should reject");
    assertErrorCode(invalidContracts, "invalid_backend_adapter_contract_ref", "invalid contract ref");

    const invalidRequirement = validateBackendAdapterDefinition(createValidAdapter({
        requirements: {
            streaming: "sometimes",
            cancellation: "supported",
            timeout: "supported"
        }
    }));
    assert(!invalidRequirement.ok, "invalid requirement support level should reject");
    assertErrorCode(invalidRequirement, "unknown_backend_adapter_requirement_support_level", "invalid requirement level");

    const compatibilityMismatch = validateBackendAdapterDefinition(createValidAdapter({
        compatibility: {
            backendKind: "llamaServerBackend",
            modelBundleRequired: true,
            hardwareProfileRequired: true
        }
    }));
    assert(!compatibilityMismatch.ok, "compatibility backendKind mismatch should reject");
    assertErrorCode(compatibilityMismatch, "backend_adapter_compatibility_kind_mismatch", "compatibility backendKind mismatch");

    ok("backend adapter nested contract validation passed");
}

function testBackendAdapterRegistry() {
    const registry = createBackendAdapterRegistry([createValidAdapter()]);
    assert(registry.schemaVersion === BACKEND_ADAPTER_REGISTRY_SCHEMA_VERSION, "registry schema should default");
    assert(registry.adapters.length === 1, "registry should include one adapter");

    const list = listBackendAdapters(registry);
    assert(list.length === 1, "listBackendAdapters should return one adapter");
    list[0].adapterId = "mutated";
    assert(getBackendAdapter(registry, "native-worker.default").adapterId === "native-worker.default", "list should return copies");

    const adapter = getBackendAdapter(registry, " native-worker.default ");
    assert(adapter.adapterId === "native-worker.default", "getBackendAdapter should trim lookup id");
    adapter.adapterId = "mutated";
    assert(getBackendAdapter(registry, "native-worker.default").adapterId === "native-worker.default", "getBackendAdapter should return copies");
    assert(hasBackendAdapter(registry, "native-worker.default"), "hasBackendAdapter should find existing adapter");
    assert(!hasBackendAdapter(registry, "missing"), "hasBackendAdapter should return false for missing adapter");

    const normalized = normalizeBackendAdapterRegistry({ adapters: [createValidAdapter()] });
    assert(normalized.schemaVersion === BACKEND_ADAPTER_REGISTRY_SCHEMA_VERSION, "normalizeBackendAdapterRegistry should default schemaVersion");

    const asserted = assertBackendAdapterRegistry({ adapters: [createValidAdapter()] });
    assert(asserted.schemaVersion === BACKEND_ADAPTER_REGISTRY_SCHEMA_VERSION, "assertBackendAdapterRegistry should default schemaVersion");

    ok("backend adapter registry contract passed");
}

function testBackendAdapterRegistryRejections() {
    const invalidRoot = validateBackendAdapterRegistry(null);
    assert(!invalidRoot.ok, "null registry should reject");
    assertErrorCode(invalidRoot, "invalid_backend_adapter_registry", "null registry");

    const invalidSchema = validateBackendAdapterRegistry({
        schemaVersion: "wrong.v1",
        adapters: []
    });
    assert(!invalidSchema.ok, "invalid registry schema should reject");
    assertErrorCode(invalidSchema, "unsupported_backend_adapter_registry_schema_version", "invalid registry schema");

    const duplicate = validateBackendAdapterRegistry({
        adapters: [
            createValidAdapter(),
            createValidAdapter()
        ]
    });
    assert(!duplicate.ok, "duplicate adapterId should reject");
    assertErrorCode(duplicate, "duplicate_backend_adapter_id", "duplicate adapterId");

    const sameKindDifferentIds = validateBackendAdapterRegistry({
        adapters: [
            createValidAdapter({ adapterId: "native-worker.default" }),
            createValidAdapter({ adapterId: "native-worker.fallback" })
        ]
    });
    assert(sameKindDifferentIds.ok, `same backendKind with unique adapterId should pass: ${JSON.stringify(sameKindDifferentIds.errors)}`);

    ok("backend adapter registry rejection contract passed");
}

function testValidBackendAdapterPlan() {
    const servicePlan = createValidServicePlan();
    const registry = createValidAdapterRegistry();
    const result = validateBackendAdapterPlan(servicePlan, registry);

    assert(result.ok, `valid backend adapter plan should pass: ${JSON.stringify(result.errors)}`);
    assert(result.value.contractVersion === BACKEND_ADAPTER_CONTRACT_VERSION, "backend adapter plan contract version should match");
    assert(result.value.servicePlan.contractVersion === CAPABILITY_SERVICE_CONTRACT_VERSION, "plan should include service plan descriptor");
    assert(result.value.adapter.adapterId === "native-worker.default", "plan should include selected adapter descriptor");

    const normalized = normalizeBackendAdapterPlan(servicePlan, registry);
    assert(normalized.adapter.adapterId === "native-worker.default", "normalizeBackendAdapterPlan should return selected adapter");

    const asserted = assertBackendAdapterPlan(servicePlan, registry);
    assert(asserted.adapter.adapterId === "native-worker.default", "assertBackendAdapterPlan should return selected adapter");

    result.value.adapter.adapterId = "mutated";
    assert(getBackendAdapter(registry, "native-worker.default").adapterId === "native-worker.default", "plan output should not mutate registry internals");

    ok("valid backend adapter plan contract passed");
}

function testBackendAdapterPlanAdapterSelection() {
    const routeWithoutBackendId = createValidRoute({ backendId: undefined });
    const servicePlan = createValidServicePlan({ routePlan: createValidRoutePlan({ routerRegistry: createValidRouterRegistry([routeWithoutBackendId]) }) });

    const oneMatch = validateBackendAdapterPlan(
        servicePlan,
        createValidAdapterRegistry([createValidAdapter({ adapterId: "native-worker.only" })])
    );
    assert(oneMatch.ok, `single matching backendKind without backendId should pass: ${JSON.stringify(oneMatch.errors)}`);

    const ambiguous = validateBackendAdapterPlan(
        servicePlan,
        createValidAdapterRegistry([
            createValidAdapter({ adapterId: "native-worker.one" }),
            createValidAdapter({ adapterId: "native-worker.two" })
        ])
    );
    assert(!ambiguous.ok, "ambiguous backendKind without backendId should reject");
    assertErrorCode(ambiguous, "backend_adapter_route_backend_id_required", "ambiguous backendKind without backendId");

    const missing = validateBackendAdapterPlan(
        createValidServicePlan({
            routePlan: createValidRoutePlan({ routerRegistry: createValidRouterRegistry([createValidRoute({ backendId: "missing-adapter" })]) })
        }),
        createValidAdapterRegistry()
    );
    assert(!missing.ok, "missing route backendId should reject");
    assertErrorCode(missing, "backend_adapter_missing_for_route", "missing route backendId");

    ok("backend adapter plan adapter selection passed");
}

function testBackendAdapterPlanCompatibilityRejections() {
    const servicePlan = createValidServicePlan();

    const disabled = validateBackendAdapterPlan(
        servicePlan,
        createValidAdapterRegistry([createValidAdapter({ status: "disabled" })])
    );
    assert(!disabled.ok, "disabled adapter should reject during planning");
    assertErrorCode(disabled, "backend_adapter_unselectable_status", "disabled adapter");

    const backendMismatch = validateBackendAdapterPlan(
        servicePlan,
        createValidAdapterRegistry([createValidAdapter({
            backendKind: "llamaServerBackend",
            compatibility: {
                backendKind: "llamaServerBackend",
                modelBundleRequired: true,
                hardwareProfileRequired: true
            }
        })])
    );
    assert(!backendMismatch.ok, "backendKind mismatch should reject");
    assertErrorCode(backendMismatch, "backend_adapter_backend_kind_mismatch", "backendKind mismatch");

    const capabilityMismatch = validateBackendAdapterPlan(
        servicePlan,
        createValidAdapterRegistry([createValidAdapter({ capabilities: ["text.embed"] })])
    );
    assert(!capabilityMismatch.ok, "capability mismatch should reject");
    assertErrorCode(capabilityMismatch, "backend_adapter_capability_incompatible", "capability mismatch");

    const serviceMismatch = validateBackendAdapterPlan(
        servicePlan,
        createValidAdapterRegistry([createValidAdapter({ services: ["text.generate.other"] })])
    );
    assert(!serviceMismatch.ok, "serviceId mismatch should reject");
    assertErrorCode(serviceMismatch, "backend_adapter_service_incompatible", "serviceId mismatch");

    const streamingMismatch = validateBackendAdapterPlan(
        servicePlan,
        createValidAdapterRegistry([createValidAdapter({
            requirements: {
                streaming: "unsupported",
                cancellation: "supported",
                timeout: "supported"
            }
        })])
    );
    assert(!streamingMismatch.ok, "streaming mismatch should reject");
    assertErrorCode(streamingMismatch, "backend_adapter_streaming_unsupported", "streaming mismatch");

    const cancellationMismatch = validateBackendAdapterPlan(
        createValidServicePlan({
            routePlan: createValidRoutePlan({
                routerRegistry: createValidRouterRegistry([createValidRoute({
                    requirements: {
                        streaming: "supported",
                        cancellation: "required",
                        timeout: "supported"
                    }
                })])
            })
        }),
        createValidAdapterRegistry([createValidAdapter({
            requirements: {
                streaming: "supported",
                cancellation: "unsupported",
                timeout: "supported"
            }
        })])
    );
    assert(!cancellationMismatch.ok, "cancellation mismatch should reject");
    assertErrorCode(cancellationMismatch, "backend_adapter_route_cancellation_incompatible", "cancellation mismatch");

    const timeoutMismatch = validateBackendAdapterPlan(
        servicePlan,
        createValidAdapterRegistry([createValidAdapter({
            requirements: {
                streaming: "supported",
                cancellation: "supported",
                timeout: "unsupported"
            }
        })])
    );
    assert(!timeoutMismatch.ok, "timeout mismatch should reject");
    assertErrorCode(timeoutMismatch, "backend_adapter_timeout_unsupported", "timeout mismatch");

    const errorNormalizationMismatch = validateBackendAdapterPlan(
        servicePlan,
        createValidAdapterRegistry([createValidAdapter({
            result: {
                schema: "text.generate.result.v1",
                outputFields: ["text"],
                streamingDeltas: "supported",
                errorNormalization: "unsupported"
            }
        })])
    );
    assert(!errorNormalizationMismatch.ok, "error normalization mismatch should reject");
    assertErrorCode(errorNormalizationMismatch, "backend_adapter_error_normalization_unsupported", "error normalization mismatch");

    ok("backend adapter plan compatibility rejections passed");
}

function testBackendAdapterPlanRequiredRouteMetadata() {
    const looseService = createValidService({
        compatibility: {
            backendKinds: ["nativeWorkerBackend"],
            modelBundleRequired: false,
            hardwareProfileRequired: false
        }
    });
    const looseBusAction = createValidBusAction({
        definitionOverrides: {
            compatibility: {
                backendKinds: ["nativeWorkerBackend"],
                modelBundleRequired: false,
                contextRefs: true
            }
        }
    });
    const looseServicePlan = createValidServicePlan({
        routePlan: createValidRoutePlan({
            busAction: looseBusAction,
            routerRegistry: createValidRouterRegistry([createValidRoute({
                modelBundleId: undefined,
                hardwareProfileId: undefined
            })])
        }),
        serviceRegistry: createValidServiceRegistry([looseService])
    });

    const missingModel = validateBackendAdapterPlan(
        looseServicePlan,
        createValidAdapterRegistry([createValidAdapter({
            compatibility: {
                backendKind: "nativeWorkerBackend",
                modelBundleRequired: true,
                hardwareProfileRequired: false
            }
        })])
    );
    assert(!missingModel.ok, "adapter-required modelBundleId should reject");
    assertErrorCode(missingModel, "backend_adapter_model_bundle_required", "adapter-required modelBundleId");

    const missingHardware = validateBackendAdapterPlan(
        looseServicePlan,
        createValidAdapterRegistry([createValidAdapter({
            compatibility: {
                backendKind: "nativeWorkerBackend",
                modelBundleRequired: false,
                hardwareProfileRequired: true
            }
        })])
    );
    assert(!missingHardware.ok, "adapter-required hardwareProfileId should reject");
    assertErrorCode(missingHardware, "backend_adapter_hardware_profile_required", "adapter-required hardwareProfileId");

    ok("backend adapter plan required route metadata rejections passed");
}

function testBackendAdapterPlanDescriptorOnly() {
    const servicePlan = createValidServicePlan();
    const plan = assertBackendAdapterPlan(servicePlan, createValidAdapterRegistry());

    assert(typeof plan.adapter.handler === "undefined", "plan adapter must not include handler");
    assert(typeof plan.adapter.execute === "undefined", "plan adapter must not include execute");
    assert(typeof plan.adapter.rawBackendPayload === "undefined", "plan adapter must not include rawBackendPayload");
    assert(typeof plan.adapter.modelPath === "undefined", "plan adapter must not include modelPath");
    assert(typeof plan.servicePlan.routePlan.route.backendKind === "string", "plan should preserve route metadata only");

    assertThrowsValidation(
        "assertBackendAdapterPlan missing adapter",
        () => assertBackendAdapterPlan(
            createValidServicePlan({
                routePlan: createValidRoutePlan({ routerRegistry: createValidRouterRegistry([createValidRoute({ backendId: "missing" })]) })
            }),
            createValidAdapterRegistry()
        ),
        "backend_adapter_missing_for_route"
    );

    ok("backend adapter plan descriptor-only contract passed");
}

await assertNoRuntimeWiringImports();
testBackendAdapterConstants();
testValidBackendAdapterDefinition();
testBackendAdapterDefinitionRequiredFields();
testBackendAdapterDefinitionFieldGuards();
testBackendAdapterContractValidation();
testBackendAdapterRegistry();
testBackendAdapterRegistryRejections();
testValidBackendAdapterPlan();
testBackendAdapterPlanAdapterSelection();
testBackendAdapterPlanCompatibilityRejections();
testBackendAdapterPlanRequiredRouteMetadata();
testBackendAdapterPlanDescriptorOnly();

console.log("All backend adapter contract smoke tests finished.");
