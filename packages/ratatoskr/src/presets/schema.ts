/**
 * Capability Preset Schema — JSON schema for defining a runner capability.
 *
 * A preset describes everything needed to *activate* a capability:
 *   - OS / npm dependencies
 *   - Environment variables
 *   - Configuration files to write
 *   - Task handlers to register
 *   - Shell preparation steps (for Dockerfile generation)
 *
 * Capabilities combine by merging their presets (union of deps, files, handlers)
 * and concatenating preparation steps for the Dockerfile.
 */

// ─── Preset type ────────────────────────────────────────────────────────────

/** A single configuration file to materialize. */
export interface PresetFile {
  /** Absolute path inside the container (e.g. /app/config/llm.json). */
  path: string;
  /** File content. Supports ${ENV_VAR} interpolation. */
  content: string;
  /** File mode (default: 644). */
  mode?: number;
}

/** An environment variable declaration. */
export interface PresetEnvVar {
  description: string;
  required?: boolean;
  /** Default value if not set. */
  default?: string;
}

/** A task handler reference. */
export interface PresetHandler {
  /** Module path relative to the runner root. */
  module: string;
  /** Named export to use (default: 'default'). */
  export?: string;
  /** Optional description for docs. */
  description?: string;
}

/** Complete preset definition for a single capability. */
export interface CapabilityPreset {
  /** Canonical capability name (e.g. 'llm', 'web_search', 'shell'). */
  name: string;
  /** Human-readable description. */
  description: string;
  /** OS-level package dependencies. */
  apt?: string[];
  /** npm package dependencies. */
  npm?: string[];
  /** Environment variables required/optional for this capability. */
  environment?: Record<string, PresetEnvVar>;
  /** Configuration files to write at setup time. */
  files?: PresetFile[];
  /** Task handlers to register, keyed by task type (e.g. { 'llm': ... }). */
  handlers?: Record<string, PresetHandler>;
  /** Shell commands to run during Dockerfile preparation (union-merged). */
  prepare?: string[];
  /** Other capabilities this one depends on (references by name). */
  dependsOn?: string[];
}

// ─── Combined preset (result of merging multiple capabilities) ─────────────

/** The result of combining multiple capability presets. */
export interface CombinedPreset {
  /** The union of all capability names. */
  capabilities: string[];
  /** Merged apt deps (deduplicated). */
  apt: string[];
  /** Merged npm deps (deduplicated). */
  npm: string[];
  /** Merged env vars (later presets win conflicts). */
  environment: Record<string, PresetEnvVar>;
  /** Merged config files (later paths overwrite earlier). */
  files: PresetFile[];
  /** Merged handlers (later names overwrite earlier). */
  handlers: Record<string, PresetHandler>;
  /** Concatenated prepare steps (preserve order per capability). */
  prepare: string[];
}

// ─── Combine logic ─────────────────────────────────────────────────────────

/**
 * Combine multiple capability presets into one.
 * Arrays are union-merged (deduplicated by simple equality).
 * Objects are merged (later keys win).
 * Prepare steps are concatenated in order.
 */
export function combinePresets(...presets: CapabilityPreset[]): CombinedPreset {
  const aptSet = new Set<string>();
  const npmSet = new Set<string>();
  const environment: Record<string, PresetEnvVar> = {};
  const files: PresetFile[] = [];
  const handlers: Record<string, PresetHandler> = {};
  const prepare: string[] = [];
  const capabilities: string[] = [];

  for (const p of presets) {
    capabilities.push(p.name);
    for (const dep of p.apt ?? []) aptSet.add(dep);
    for (const dep of p.npm ?? []) npmSet.add(dep);
    Object.assign(environment, p.environment);
    files.push(...(p.files ?? []));
    Object.assign(handlers, p.handlers);
    prepare.push(...(p.prepare ?? []));
  }

  return {
    capabilities,
    apt: [...aptSet],
    npm: [...npmSet],
    environment,
    files,
    handlers,
    prepare,
  };
}

// ─── Dockerfile generation ─────────────────────────────────────────────────

export interface DockerfileOptions {
  /** Base image (default: node:20-alpine). */
  baseImage?: string;
  /** Working directory (default: /app). */
  workdir?: string;
  /** Port to expose (default: 3100). */
  port?: number;
  /** Entry point command (default: ['node', 'dist/src/runner.js']). */
  cmd?: string[];
  /** Additional RUN commands to prepend. */
  extraRunBefore?: string[];
  /** Additional RUN commands to append. */
  extraRunAfter?: string[];
  /** Additional files to COPY (e.g. source code). */
  extraCopy?: Array<{ from: string; to: string; stage?: string }>;
}

/**
 * Generate a multi-stage Dockerfile from a combined preset.
 *
 * Stage 1 (builder): installs npm deps, compiles TypeScript.
 * Stage 2 (runtime): installs apt deps, sets up env, writes config files.
 */
export function generateDockerfile(preset: CombinedPreset, options?: DockerfileOptions): string {
  const baseImage = options?.baseImage ?? 'node:20-alpine';
  const workdir = options?.workdir ?? '/app';
  const port = options?.port ?? 3100;
  const cmd = options?.cmd ?? ['node', 'dist/src/runner.js'];

  const lines: string[] = [];

  // ── Stage 1: builder ────────────────────────────────────────────────
  lines.push(`FROM ${baseImage} AS builder`, '');
  lines.push(`WORKDIR ${workdir}`, '');
  lines.push('COPY package.json package-lock.json tsconfig.json ./');
  if (preset.npm.length > 0) {
    lines.push(`RUN npm ci && npm install ${preset.npm.join(' ')}`);
  } else {
    lines.push('RUN npm ci');
  }
  lines.push('', 'COPY src/ ./src/');
  lines.push('RUN npx tsc', '');

  // ── Stage 2: runtime ────────────────────────────────────────────────
  lines.push(`FROM ${baseImage}`, '');
  lines.push(`WORKDIR ${workdir}`, '');

  // OS deps
  if (preset.apt.length > 0) {
    lines.push(`RUN apk add --no-cache ${preset.apt.join(' ')}`, '');
  }

  // Extra RUN commands before
  if (options?.extraRunBefore) {
    for (const cmd of options.extraRunBefore) {
      lines.push(`RUN ${cmd}`, '');
    }
  }

  // Prepare steps
  for (const step of preset.prepare) {
    lines.push(`RUN ${step}`, '');
  }

  // Copy from builder
  lines.push(`COPY --from=builder ${workdir}/dist ./dist`);
  lines.push(`COPY --from=builder ${workdir}/node_modules ./node_modules`, '');

  // Extra COPY commands
  if (options?.extraCopy) {
    for (const c of options.extraCopy) {
      const stage = c.stage ? `--from=${c.stage} ` : '';
      lines.push(`COPY ${stage}${c.from} ${c.to}`);
    }
    lines.push('');
  }

  // Config files
  for (const file of preset.files) {
    lines.push(`RUN mkdir -p $(dirname ${file.path}) && cat > ${file.path} << 'PRESET_EOF'`);
    lines.push(file.content);
    lines.push('PRESET_EOF', '');
  }

  // Extra RUN commands after
  if (options?.extraRunAfter) {
    for (const cmd of options.extraRunAfter) {
      lines.push(`RUN ${cmd}`, '');
    }
  }

  // Port + entrypoint
  lines.push(`EXPOSE ${port}`, '');
  if (Object.keys(preset.environment).length > 0) {
    for (const [key, val] of Object.entries(preset.environment)) {
      if (val.default) {
        lines.push(`ENV ${key}=${val.default}`);
      }
    }
    lines.push('');
  }
  lines.push(`CMD ${JSON.stringify(cmd)}`, '');

  return lines.join('\n');
}
