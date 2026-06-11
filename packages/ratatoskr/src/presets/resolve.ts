/**
 * resolveCapabilities — Resolve a list of capability names by walking preset dependsOn trees.
 *
 * Known presets are resolved transitively; unknown names pass through as-is.
 * Returns the deduplicated capability list, handler paths, and combined preset.
 */

import { combinePresets } from './schema.js';
import type { CapabilityPreset, CombinedPreset } from './schema.js';
import { getPreset } from './builtins.js';

interface HandlerPathInfo {
  module: string;
  export: string;
}

/**
 * Resolve capability names as presets.
 * Known presets are walked transitively (dependsOn). Unknown names pass through.
 * Returns:
 *   - capabilities: resolved preset names + unknown pass-throughs
 *   - handlerPaths: { taskType -> { module, export } } collected from presets
 *   - combined: merged CombinedPreset (env vars, deps, files, handlers, prepare)
 */
export function resolveCapabilities(
  rawCaps: string[],
): { capabilities: string[]; handlerPaths: Record<string, HandlerPathInfo>; combined: CombinedPreset } {
  const seen = new Set<string>();
  const resolved: CapabilityPreset[] = [];
  const unknown: string[] = [];

  function walk(name: string): void {
    if (seen.has(name)) return;
    const preset = getPreset(name);
    if (!preset) {
      unknown.push(name);
      return;
    }
    seen.add(name);
    for (const dep of preset.dependsOn ?? []) {
      walk(dep);
    }
    resolved.push(preset);
  }

  for (const cap of rawCaps) walk(cap);

  // Build final capability list: resolved preset names + unknown pass-throughs
  const capabilities = [...resolved.map((p) => p.name), ...unknown];

  // Collect handler paths and get the combined preset
  const combined = combinePresets(...resolved);
  const handlerPaths: Record<string, HandlerPathInfo> = {};
  for (const [type, h] of Object.entries(combined.handlers)) {
    handlerPaths[type] = { module: h.module, export: h.export ?? 'default' };
  }

  return { capabilities, handlerPaths, combined };
}
