// smokeTestCapabilityRegistryContract.mjs
//
// Purpose:
// - Contract smoke for the Runtime Dev capability registry branch.
// - Validates capability definition/registry helpers without wiring runtime.mjs,
//   workerBridge, or llama_worker modules.
//
// Run:
//   node ./tests/smokeTestCapabilityRegistryContract.mjs

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

import {
    CAPABILITIES
} from "../runtime/bus/capabilityTaxonomy.mjs";
import {
    CAPABILITY_APPROVAL_SUPPORT_LEVELS,
    CAPABILITY_CONTRACT_REFS,
    CAPABILITY_DEFINITION_STATUSES,
    CAPABILITY_REQUIREMENT_SUPPORT_LEVELS,
    assertCapabilityDefinition,
    isKnownCapabilityApprovalSupportLevel,
    isKnownCapabilityDefinitionStatus,
    isKnownCapabilityRequirementSupportLevel,
    normalizeCapabilityDefinition,
    validateCapabilityDefinition
} from "../runtime/bus/capabilityDefinition.mjs";
import {
    CAPABILITY_REGISTRY_SCHEMA_VERSION,
    assertCapabilityRegistry,
    createCapabilityRegistry,
    getCapabilityDefinition,
    hasCapabilityDefinition,
    listCapabilityDefinitions,
    normalizeCapabilityRegistry,
    validateCapabilityRegistry
} from "../runtime/bus/capabilityRegistryContract.mjs";

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

function createValidCapabilityDefinition(overrides = {}) {
    return {
        capability: "text.generate",
        version: " v1 ",
        status: "contract-only",
        summary: " Generate text through an approved text capability service. ",
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
            backendKinds: [" nativeWorkerBackend "],
            modelBundleRequired: true,
            contextRefs: true
        },
        ...overrides
    };
}

function createValidRegistry(overrides = {}) {
    return {
        schemaVersion: CAPABILITY_REGISTRY_SCHEMA_VERSION,
        capabilities: [
            createValidCapabilityDefinition(),
            createValidCapabilityDefinition({
                capability: "text.embed",
                summary: "Create text embeddings through an approved embedding capability service.",
                requirements: {
                    streaming: "unsupported",
                    cancellation: "supported",
                    timeout: "supported",
                    approval: "unsupported"
                },
                policy: {
                    maxTokens: false,
                    approvalRequired: false,
                    allowTools: false,
                    budget: true
                },
                compatibility: {
                    backendKinds: ["nativeEmbeddingBackend", "llamaServerBackend"],
                    modelBundleRequired: true,
                    contextRefs: false
                }
            })
        ],
        ...overrides
    };
}

async function assertNoRuntimeWiringImports() {
    const sources = {
        "runtime/bus/capabilityDefinition.mjs": await readSource("runtime/bus/capabilityDefinition.mjs"),
        "runtime/bus/capabilityRegistryContract.mjs": await readSource("runtime/bus/capabilityRegistryContract.mjs")
    };

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

    for (const [relativePath, source] of Object.entries(sources)) {
        for (const marker of forbiddenMarkers) {
            if (source.includes(marker)) {
                fail(`${relativePath} includes forbidden runtime wiring marker: ${marker}`);
            }
        }
    }

    ok("capability registry contract modules avoid runtime/worker execution imports");
}

function testCapabilityDefinitionConstants() {
    assertIncludes(CAPABILITY_DEFINITION_STATUSES, "contract-only", "capability statuses");
    assertIncludes(CAPABILITY_DEFINITION_STATUSES, "planned", "capability statuses");
    assertIncludes(CAPABILITY_DEFINITION_STATUSES, "implemented", "capability statuses");
    assertIncludes(CAPABILITY_REQUIREMENT_SUPPORT_LEVELS, "supported", "requirement support levels");
    assertIncludes(CAPABILITY_REQUIREMENT_SUPPORT_LEVELS, "required", "requirement support levels");
    assertIncludes(CAPABILITY_APPROVAL_SUPPORT_LEVELS, "conditional", "approval support levels");

    assert(CAPABILITY_CONTRACT_REFS.action === "actionEnvelope.v1", "action contract ref should be actionEnvelope.v1");
    assert(CAPABILITY_CONTRACT_REFS.result === "resultEnvelope.v1", "result contract ref should be resultEnvelope.v1");
    assert(CAPABILITY_CONTRACT_REFS.event === "actionEvent.v1", "event contract ref should be actionEvent.v1");

    assert(isKnownCapabilityDefinitionStatus("contract-only"), "contract-only should be known status");
    assert(!isKnownCapabilityDefinitionStatus("active"), "active should not be a v1 status");
    assert(isKnownCapabilityRequirementSupportLevel("unsupported"), "unsupported should be known support level");
    assert(!isKnownCapabilityRequirementSupportLevel("maybe"), "maybe should not be a support level");
    assert(isKnownCapabilityApprovalSupportLevel("conditional"), "conditional should be known approval support level");
    assert(!isKnownCapabilityApprovalSupportLevel("required"), "approval required should not be an approval support level");

    ok("capability definition constants passed");
}

function testCapabilityDefinitionValidCase() {
    const definition = createValidCapabilityDefinition();
    const result = validateCapabilityDefinition(definition);

    assert(result.ok, `valid capability definition should pass: ${JSON.stringify(result.errors)}`);
    assert(result.value !== definition, "normalized capability definition should be a copy");
    assert(result.value.capability === "text.generate", "capability should be trimmed");
    assert(result.value.version === "v1", "version should be trimmed");
    assert(result.value.summary.startsWith("Generate text"), "summary should be trimmed");
    assert(result.value.contracts.action === "actionEnvelope.v1", "action contract should be trimmed");
    assert(result.value.compatibility.backendKinds[0] === "nativeWorkerBackend", "backendKinds should be trimmed");

    const normalized = normalizeCapabilityDefinition(definition);
    assert(normalized.capability === "text.generate", "normalizeCapabilityDefinition should trim capability");
    assert(definition.version === " v1 ", "normalizeCapabilityDefinition should not mutate caller input");

    const asserted = assertCapabilityDefinition(definition);
    assert(asserted.capability === "text.generate", "assertCapabilityDefinition should return normalized definition");

    ok("valid capability definition contract passed");
}

function testCapabilityDefinitionRequiredFields() {
    const invalidRoot = validateCapabilityDefinition(null);
    assert(!invalidRoot.ok, "null capability definition should reject");
    assertErrorCode(invalidRoot, "invalid_capability_definition", "null capability definition");

    const missing = validateCapabilityDefinition({});
    assert(!missing.ok, "missing capability definition fields should reject");
    assertErrorCode(missing, "missing_capability", "missing capability");
    assertErrorCode(missing, "missing_version", "missing version");
    assertErrorCode(missing, "missing_status", "missing status");
    assertErrorCode(missing, "missing_summary", "missing summary");
    assertErrorCode(missing, "invalid_contracts", "missing contracts");
    assertErrorCode(missing, "invalid_requirements", "missing requirements");
    assertErrorCode(missing, "invalid_policy", "missing policy");
    assertErrorCode(missing, "invalid_compatibility", "missing compatibility");

    ok("capability definition required-field rejection passed");
}

function testCapabilityDefinitionRejectsUnknowns() {
    const unknownCapability = validateCapabilityDefinition(createValidCapabilityDefinition({
        capability: "text.foo"
    }));
    assert(!unknownCapability.ok, "unknown capability should reject");
    assertErrorCode(unknownCapability, "unknown_capability", "unknown capability");

    const unknownStatus = validateCapabilityDefinition(createValidCapabilityDefinition({
        status: "active"
    }));
    assert(!unknownStatus.ok, "unknown status should reject");
    assertErrorCode(unknownStatus, "unknown_capability_definition_status", "unknown status");

    const unknownRootField = validateCapabilityDefinition({
        ...createValidCapabilityDefinition(),
        executor: "nativeWorkerBackend"
    });
    assert(!unknownRootField.ok, "unknown root field should reject");
    assertErrorCode(unknownRootField, "unknown_capability_definition_field", "unknown root field");

    const unknownRequirementField = validateCapabilityDefinition(createValidCapabilityDefinition({
        requirements: {
            streaming: "supported",
            cancellation: "supported",
            timeout: "supported",
            approval: "conditional",
            queue: "supported"
        }
    }));
    assert(!unknownRequirementField.ok, "unknown requirement field should reject");
    assertErrorCode(unknownRequirementField, "unknown_requirement_field", "unknown requirement field");

    ok("capability definition unknown-field rejection passed");
}

function testCapabilityDefinitionRejectsInvalidSections() {
    const invalidContracts = validateCapabilityDefinition(createValidCapabilityDefinition({
        contracts: {
            action: "actionEnvelope.v2",
            result: "resultEnvelope.v1",
            event: "actionEvent.v1"
        }
    }));
    assert(!invalidContracts.ok, "invalid contract ref should reject");
    assertErrorCode(invalidContracts, "invalid_contract_ref", "invalid contract ref");

    const invalidRequirementLevel = validateCapabilityDefinition(createValidCapabilityDefinition({
        requirements: {
            streaming: "optional",
            cancellation: "supported",
            timeout: "supported",
            approval: "conditional"
        }
    }));
    assert(!invalidRequirementLevel.ok, "invalid requirement support level should reject");
    assertErrorCode(invalidRequirementLevel, "unknown_requirement_support_level", "invalid requirement support level");

    const invalidApprovalLevel = validateCapabilityDefinition(createValidCapabilityDefinition({
        requirements: {
            streaming: "supported",
            cancellation: "supported",
            timeout: "supported",
            approval: "required"
        }
    }));
    assert(!invalidApprovalLevel.ok, "invalid approval support level should reject");
    assertErrorCode(invalidApprovalLevel, "unknown_approval_support_level", "invalid approval support level");

    const invalidPolicy = validateCapabilityDefinition(createValidCapabilityDefinition({
        policy: {
            maxTokens: true,
            approvalRequired: "yes",
            allowTools: false,
            budget: true
        }
    }));
    assert(!invalidPolicy.ok, "invalid policy boolean should reject");
    assertErrorCode(invalidPolicy, "invalid_boolean_field", "invalid policy boolean");

    const invalidCompatibility = validateCapabilityDefinition(createValidCapabilityDefinition({
        compatibility: {
            backendKinds: "nativeWorkerBackend",
            modelBundleRequired: true,
            contextRefs: true
        }
    }));
    assert(!invalidCompatibility.ok, "invalid backendKinds should reject");
    assertErrorCode(invalidCompatibility, "invalid_backend_kinds", "invalid backendKinds");

    const pathLikeBackendKind = validateCapabilityDefinition(createValidCapabilityDefinition({
        compatibility: {
            backendKinds: ["../../../nativeWorkerBackend"],
            modelBundleRequired: true,
            contextRefs: true
        }
    }));
    assert(!pathLikeBackendKind.ok, "path-like backend kind should reject");
    assertErrorCode(pathLikeBackendKind, "forbidden_backend_kind_value", "path-like backend kind");

    ok("capability definition invalid-section rejection passed");
}

function testCapabilityDefinitionForbiddenKeys() {
    const withModelPath = validateCapabilityDefinition(createValidCapabilityDefinition({
        compatibility: {
            backendKinds: ["nativeWorkerBackend"],
            modelBundleRequired: true,
            contextRefs: true,
            modelPath: "../../../base/model.gguf"
        }
    }));
    assert(!withModelPath.ok, "modelPath key should reject");
    assertErrorCode(withModelPath, "forbidden_capability_definition_key", "modelPath key");

    const withBackendOptions = validateCapabilityDefinition(createValidCapabilityDefinition({
        compatibility: {
            backendKinds: ["nativeWorkerBackend"],
            modelBundleRequired: true,
            contextRefs: true,
            backendOptions: {
                gpuLayers: 99
            }
        }
    }));
    assert(!withBackendOptions.ok, "backendOptions key should reject");
    assertErrorCode(withBackendOptions, "forbidden_capability_definition_key", "backendOptions key");

    const withToolProcess = validateCapabilityDefinition(createValidCapabilityDefinition({
        policy: {
            maxTokens: true,
            approvalRequired: true,
            allowTools: false,
            budget: true,
            toolProcess: {
                command: "node"
            }
        }
    }));
    assert(!withToolProcess.ok, "tool process command keys should reject");
    assertErrorCode(withToolProcess, "forbidden_capability_definition_key", "tool process command key");

    ok("capability definition forbidden-key guard passed");
}

function testCapabilityRegistryValidCase() {
    const registry = createValidRegistry();
    const result = validateCapabilityRegistry(registry);

    assert(result.ok, `valid capability registry should pass: ${JSON.stringify(result.errors)}`);
    assert(result.value !== registry, "normalized capability registry should be a copy");
    assert(result.value.schemaVersion === CAPABILITY_REGISTRY_SCHEMA_VERSION, "schema version should normalize");
    assert(result.value.capabilities[0].capability === "text.generate", "capability definition should normalize inside registry");

    const normalized = normalizeCapabilityRegistry({
        capabilities: [createValidCapabilityDefinition()]
    });
    assert(normalized.schemaVersion === CAPABILITY_REGISTRY_SCHEMA_VERSION, "normalizeCapabilityRegistry should default schemaVersion");

    const asserted = assertCapabilityRegistry(registry);
    assert(asserted.capabilities.length === 2, "assertCapabilityRegistry should return normalized registry");

    const created = createCapabilityRegistry(registry.capabilities);
    assert(created.schemaVersion === CAPABILITY_REGISTRY_SCHEMA_VERSION, "createCapabilityRegistry should set schemaVersion");
    assert(created.capabilities.length === 2, "createCapabilityRegistry should include supplied definitions");

    ok("valid capability registry contract passed");
}

function testCapabilityRegistryRejects() {
    const invalidRoot = validateCapabilityRegistry(null);
    assert(!invalidRoot.ok, "null capability registry should reject");
    assertErrorCode(invalidRoot, "invalid_capability_registry", "null capability registry");

    const invalidCapabilities = validateCapabilityRegistry({
        schemaVersion: CAPABILITY_REGISTRY_SCHEMA_VERSION,
        capabilities: {}
    });
    assert(!invalidCapabilities.ok, "non-array capabilities should reject");
    assertErrorCode(invalidCapabilities, "invalid_capabilities", "non-array capabilities");

    const unsupportedVersion = validateCapabilityRegistry(createValidRegistry({
        schemaVersion: "capability-registry.v2"
    }));
    assert(!unsupportedVersion.ok, "unsupported registry schema should reject");
    assertErrorCode(unsupportedVersion, "unsupported_capability_registry_schema_version", "unsupported schema");

    const unknownRegistryField = validateCapabilityRegistry({
        ...createValidRegistry(),
        executor: "nativeWorkerBackend"
    });
    assert(!unknownRegistryField.ok, "unknown registry field should reject");
    assertErrorCode(unknownRegistryField, "unknown_capability_registry_field", "unknown registry field");

    const nestedInvalidDefinition = validateCapabilityRegistry(createValidRegistry({
        capabilities: [
            createValidCapabilityDefinition({
                status: "active"
            })
        ]
    }));
    assert(!nestedInvalidDefinition.ok, "invalid nested definition should reject");
    assertErrorCode(nestedInvalidDefinition, "unknown_capability_definition_status", "nested invalid definition");
    assert(nestedInvalidDefinition.errors[0].path.startsWith("capabilities[0]"), "nested error path should include capability index");

    ok("capability registry rejection contract passed");
}

function testCapabilityRegistryDuplicates() {
    const duplicate = validateCapabilityRegistry(createValidRegistry({
        capabilities: [
            createValidCapabilityDefinition(),
            createValidCapabilityDefinition({
                version: "v2",
                summary: "Second text.generate version should still reject in v1."
            })
        ]
    }));
    assert(!duplicate.ok, "duplicate capability should reject");
    assertErrorCode(duplicate, "duplicate_capability", "duplicate capability");

    const duplicateVersion = validateCapabilityRegistry(createValidRegistry({
        capabilities: [
            createValidCapabilityDefinition(),
            createValidCapabilityDefinition()
        ]
    }));
    assert(!duplicateVersion.ok, "duplicate capability/version should reject");
    assertErrorCode(duplicateVersion, "duplicate_capability", "duplicate capability version case should include duplicate capability");
    assertErrorCode(duplicateVersion, "duplicate_capability_version", "duplicate capability version");

    ok("capability registry duplicate rejection passed");
}

function testCapabilityRegistryLookupHelpers() {
    const registry = createCapabilityRegistry(createValidRegistry().capabilities);
    const definitions = listCapabilityDefinitions(registry);

    assert(definitions.length === 2, "listCapabilityDefinitions should return both definitions");
    assert(definitions[0] !== registry.capabilities[0], "listCapabilityDefinitions should return copied definition entries");
    assert(hasCapabilityDefinition(registry, " text.generate "), "hasCapabilityDefinition should trim lookup capability");
    assert(!hasCapabilityDefinition(registry, "tool.call"), "hasCapabilityDefinition should be false for missing capability");

    const textGenerate = getCapabilityDefinition(registry, " text.generate ");
    assert(textGenerate.capability === "text.generate", "getCapabilityDefinition should return matching definition");
    assert(getCapabilityDefinition(registry, "tool.call") === null, "getCapabilityDefinition should return null for missing capability");

    textGenerate.summary = "mutated";
    const textGenerateAgain = getCapabilityDefinition(registry, "text.generate");
    assert(textGenerateAgain.summary !== "mutated", "lookup helper result mutation should not mutate registry state");

    definitions[0].summary = "mutated list";
    const afterListMutation = getCapabilityDefinition(registry, "text.generate");
    assert(afterListMutation.summary !== "mutated list", "list helper result mutation should not mutate registry state");

    ok("capability registry lookup helpers passed");
}

function testCapabilityRegistryForbiddenKeys() {
    const withModelPath = validateCapabilityRegistry({
        schemaVersion: CAPABILITY_REGISTRY_SCHEMA_VERSION,
        capabilities: [createValidCapabilityDefinition()],
        modelPath: "../../../base/model.gguf"
    });
    assert(!withModelPath.ok, "registry modelPath key should reject");
    assertErrorCode(withModelPath, "forbidden_capability_registry_key", "registry modelPath key");

    const nestedCommand = validateCapabilityRegistry(createValidRegistry({
        capabilities: [
            createValidCapabilityDefinition({
                compatibility: {
                    backendKinds: ["nativeWorkerBackend"],
                    modelBundleRequired: true,
                    contextRefs: true,
                    toolProcess: {
                        command: "node"
                    }
                }
            })
        ]
    }));
    assert(!nestedCommand.ok, "nested tool process command should reject");
    assertErrorCode(nestedCommand, "forbidden_capability_registry_key", "nested command registry key");

    ok("capability registry forbidden-key guard passed");
}

function testTaxonomyCompatibility() {
    for (const capability of CAPABILITIES) {
        const definition = createValidCapabilityDefinition({
            capability,
            summary: `Contract-only definition for ${capability}.`,
            compatibility: {
                backendKinds: ["metadataOnlyBackendKind"],
                modelBundleRequired: capability.startsWith("text.") || capability === "vision.chat",
                contextRefs: true
            }
        });
        const result = validateCapabilityDefinition(definition);
        assert(result.ok, `${capability} definition should pass with generic metadata: ${JSON.stringify(result.errors)}`);
    }

    ok("capability taxonomy compatibility passed");
}

async function main() {
    console.log("[SMOKE] capability registry contract");

    testCapabilityDefinitionConstants();
    testCapabilityDefinitionValidCase();
    testCapabilityDefinitionRequiredFields();
    testCapabilityDefinitionRejectsUnknowns();
    testCapabilityDefinitionRejectsInvalidSections();
    testCapabilityDefinitionForbiddenKeys();
    testCapabilityRegistryValidCase();
    testCapabilityRegistryRejects();
    testCapabilityRegistryDuplicates();
    testCapabilityRegistryLookupHelpers();
    testCapabilityRegistryForbiddenKeys();
    testTaxonomyCompatibility();
    await assertNoRuntimeWiringImports();

    console.log("\nAll capability registry contract smoke checks finished.");
}

main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
});
