/**
 * Apply preset environment defaults to process.env at startup.
 *
 * Prepares the runtime environment so that downstream code reading process.env
 * picks up preset-level defaults (e.g. LLM_MODEL, WEB_SEARCH_API) without
 * needing separate fallback logic.
 */
import type { CombinedPreset } from './schema.js';

/**
 * Write every preset-env default to process.env (only if not already set).
 */
export function applyPresetDefaults(combined: CombinedPreset): void {
  for (const [key, val] of Object.entries(combined.environment)) {
    if (val.default !== undefined && !(key in process.env)) {
      process.env[key] = val.default;
    }
  }
}
