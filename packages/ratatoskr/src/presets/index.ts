/**
 * Capability Presets — define how to activate runner capabilities.
 *
 * Each capability has a JSON preset describing its:
 *   - OS / npm dependencies
 *   - Environment variables
 *   - Config files
 *   - Task handlers
 *   - Docker preparation steps
 *
 * Capabilities combine by merging their presets (union of deps, union of handlers)
 * so that e.g. a runner with 'web_search' + 'llm' gets the combined setup.
 *
 * Usage:
 *   import { combinePresets, generateDockerfile, getPreset } from './presets/index.js';
 *   import { llm, webSearch } from './presets/builtins.js';
 *
 *   const combined = combinePresets(llm, webSearch);
 *   const dockerfile = generateDockerfile(combined);
 *
 *   // Resolve a list of capability names (handles transitive dependsOn):
 *   const { capabilities, combined } = resolveCapabilities(['agent', 'code']);
 */

export type { CapabilityPreset, CombinedPreset, PresetFile, PresetEnvVar, PresetHandler, DockerfileOptions } from './schema.js';
export { combinePresets, generateDockerfile } from './schema.js';
export { registerPreset, getPreset, listPresets } from './builtins.js';
export { llm, webSearch, shell, agent, codeRunner, python, nodeRuntime, githubCli, computerUse, android } from './builtins.js';
export { applyPresetDefaults } from './apply.js';
export { resolveCapabilities } from './resolve.js';
