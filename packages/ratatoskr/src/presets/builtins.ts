/**
 * Built-in capability presets.
 *
 * Each preset defines what it takes to *activate* that capability on a runner:
 * - System dependencies (apt packages)
 * - npm dependencies
 * - Environment variables (→ ENV lines in Dockerfile, + applied to process.env at runtime)
 * - Config files (materialized at Docker build time via heredoc)
 * - Task handlers (module paths for dynamic import)
 * - Docker preparation steps (→ RUN commands in Dockerfile)
 *
 * Capabilities combine — e.g. 'web_search' + 'llm' merges their presets.
 * prepare steps are concatenated in order. Duplicate deps are deduplicated.
 */

import type { CapabilityPreset } from './schema.js';

/**
 * LLM capability — communicates with an LLM API to process tasks.
 * Provides the `llm` task handler.
 *
 * Docker preparation:
 *   - Creates /app/config/llm/ for handler config files
 *   - Writes a JSON config file consumed by llm-handler at runtime
 */
export const llm: CapabilityPreset = {
  name: 'llm',
  description: 'LLM inference — communicates with an OpenAI-compatible API',
  npm: ['openai'],
  environment: {
    LLM_MODEL: {
      description: 'Model name for LLM inference',
      default: 'google/gemma-4-26b-a4b-qat',
    },
    LLM_BASE_URL: {
      description: 'OpenAI-compatible base URL',
      default: 'http://host.docker.internal:1234/v1',
    },
    LLM_API_KEY: {
      description: 'API key for the LLM provider (optional for LM Studio)',
      required: false,
    },
    LLM_MAX_TOKENS: {
      description: 'Maximum tokens per LLM call',
      default: '4096',
    },
    LLM_TEMPERATURE: {
      description: 'LLM temperature setting',
      default: '0.3',
    },
  },
  files: [
    {
      path: '/app/config/llm/defaults.json',
      mode: 0o644,
      content: JSON.stringify(
        {
          model: '${LLM_MODEL:-google/gemma-4-26b-a4b-qat}',
          baseUrl: '${LLM_BASE_URL:-http://host.docker.internal:1234/v1}',
          maxTokens: 4096,
          temperature: 0.3,
        },
        null,
        2,
      ),
    },
  ],
  handlers: {
    llm: {
      module: './handlers/llm-handler.js',
      export: 'llmHandler',
      description: 'Calls an LLM with the given prompt and returns the response',
    },
  },
  prepare: [
    'mkdir -p /app/config/llm /app/scratch',
    'echo "LLM capability: config directory created at /app/config/llm"',
  ],
};

/**
 * Web search capability — searches the web via DuckDuckGo or other engines.
 * Provides the `web_search` and `web_fetch` task handlers.
 *
 * Docker preparation:
 *   - Creates /app/config/web-search/ for engine configuration
 *   - Installs ca-certificates for HTTPS fetches (alpine base)
 */
export const webSearch: CapabilityPreset = {
  name: 'web_search',
  description: 'Web search and fetch — searches the web / fetches URLs via a configurable API',
  apt: ['ca-certificates'],
  environment: {
    WEB_SEARCH_API: {
      description: 'Web search API endpoint',
      default: 'https://api.duckduckgo.com',
    },
    WEB_SEARCH_ENGINE: {
      description: 'Search engine (duckduckgo, tavily, serpapi)',
      default: 'duckduckgo',
    },
    WEB_SEARCH_API_KEY: {
      description: 'API key for the web search provider',
      required: false,
    },
  },
  handlers: {
    web_search: {
      module: './handlers/web-handlers.js',
      export: 'webSearchHandler',
      description: 'Searches the web and returns text results',
    },
    web_fetch: {
      module: './handlers/web-handlers.js',
      export: 'webFetchHandler',
      description: 'Fetches a URL and returns the text content',
    },
  },
  prepare: [
    'mkdir -p /app/config/web-search',
    'echo "web_search capability: config directory created at /app/config/web-search"',
  ],
};

/**
 * Shell capability — executes arbitrary shell commands.
 * Provides the `shell` task handler.
 *
 * Docker preparation:
 *   - Installs common CLI tools useful for shell tasks
 *   - Creates a scratch workspace
 */
export const shell: CapabilityPreset = {
  name: 'shell',
  description: 'Shell execution — runs arbitrary shell commands',
  apt: ['curl', 'jq', 'git'],
  prepare: [
    'mkdir -p /app/scratch /app/workspace',
    'echo "shell capability: workspace ready at /app/workspace, tools: curl jq git"',
  ],
  handlers: {
    shell: {
      module: './handlers/shell-handler.js',
      export: 'shellHandler',
      description: 'Executes a shell command and returns stdout/stderr',
    },
  },
};

/**
 * Agent capability — full sub-agent with think-act-execute loop.
 * Depends on llm + shell + web_search.
 * Provides the `agent` task handler.
 *
 * Docker preparation:
 *   - Creates /app/config/agent/ for agent loop config
 *   - Creates /app/agent-workspace/ for agent task artifacts
 */
export const agent: CapabilityPreset = {
  name: 'agent',
  description: 'Full sub-agent — think-act-execute loop with LLM + tools',
  dependsOn: ['llm', 'shell', 'web_search'],
  environment: {
    AGENT_MAX_TOOL_ITERATIONS: {
      description: 'Maximum tool call cycles per task',
      default: '25',
    },
  },
  files: [
    {
      path: '/app/config/agent/defaults.json',
      mode: 0o644,
      content: JSON.stringify(
        {
          maxToolIterations: 25,
          model: '${LLM_MODEL:-google/gemma-4-26b-a4b-qat}',
          baseUrl: '${LLM_BASE_URL:-http://host.docker.internal:1234/v1}',
        },
        null,
        2,
      ),
    },
  ],
  handlers: {
    agent: {
      module: './handlers/agent-handler.js',
      export: 'agentHandler',
      description: 'Executes a goal through a think-act-execute loop with tool-use',
    },
  },
  prepare: [
    'mkdir -p /app/config/agent /app/agent-workspace',
    'echo "agent capability: config at /app/config/agent, workspace at /app/agent-workspace"',
  ],
};

/**
 * Code capability — LLM-based code generation.
 * Depends on llm (code generation uses the LLM). Adds coding-specific
 * environment variables and a lightweight code-review handler.
 *
 * Docker preparation:
 *   - Creates /app/config/code/ for code-gen config
 *   - Creates /app/code-workspace/ for generated code artifacts
 */
export const codeRunner: CapabilityPreset = {
  name: 'code',
  description: 'Code generation — LLM-based code with coding-optimised profile',
  dependsOn: ['llm'],
  environment: {
    CODE_LLM_MODEL: {
      description: 'Model for code generation tasks',
      default: 'google/gemma-4-26b-a4b-qat',
    },
    CODE_LLM_BASE_URL: {
      description: 'LM Studio / OpenAI-compatible base URL for code generation',
      default: 'http://host.docker.internal:1234/v1',
    },
    CODE_LLM_API_KEY: {
      description: 'API key (optional for LM Studio)',
      required: false,
    },
    CODE_TEMPERATURE: {
      description: 'Temperature for code generation (lower = more deterministic)',
      default: '0.2',
    },
    CODE_MAX_TOKENS: {
      description: 'Max tokens per code generation call',
      default: '8192',
    },
  },
  files: [
    {
      path: '/app/config/code/defaults.json',
      mode: 0o644,
      content: JSON.stringify(
        {
          model: '${CODE_LLM_MODEL:-google/gemma-4-26b-a4b-qat}',
          baseUrl: '${CODE_LLM_BASE_URL:-http://host.docker.internal:1234/v1}',
          temperature: 0.2,
          maxTokens: 8192,
        },
        null,
        2,
      ),
    },
  ],
  handlers: {
    code: {
      module: './handlers/code-handler.js',
      export: 'codeHandler',
      description: 'Generates code via LLM with coding-optimised profile',
    },
  },
  prepare: [
    'mkdir -p /app/config/code /app/code-workspace',
    'echo "code capability: config at /app/config/code, workspace at /app/code-workspace"',
  ],
};

/**
 * Python capability — Python 3 runtime with pip and common dev packages.
 *
 * Docker preparation:
 *   - Installs python3, pip, build tools, and common libraries
 *   - Creates /app/python-workspace/ for scripts
 *   - Sets pip index url default
 */
export const python: CapabilityPreset = {
  name: 'python',
  description: 'Python 3 runtime — run Python scripts, install pip packages, execute notebooks',
  apt: ['python3', 'python3-pip', 'python3-venv', 'build-base', 'python3-dev'],
  files: [
    {
      path: '/app/config/python/defaults.json',
      mode: 0o644,
      content: JSON.stringify(
        {
          pythonVersion: '3',
          pipIndex: 'https://pypi.org/simple/',
          workspace: '/app/python-workspace',
        },
        null,
        2,
      ),
    },
  ],
  handlers: {
    python: {
      module: './handlers/python-handler.js',
      export: 'pythonHandler',
      description: 'Executes a Python script or expression and returns the result',
    },
  },
  prepare: [
    'mkdir -p /app/config/python /app/python-workspace',
    'python3 -m venv /app/python-venv && echo "Python virtualenv created at /app/python-venv"',
    '/app/python-venv/bin/pip install --upgrade pip setuptools wheel 2>&1 | tail -1',
  ],
};

/**
 * Node runtime capability — Node.js runtime for running scripts, npm packages.
 *
 * Docker preparation:
 *   - Node and npm are already in the base image (node:20-alpine)
 *   - Creates /app/node-workspace/ for scripts
 *   - Installs useful global npm tools
 */
export const nodeRuntime: CapabilityPreset = {
  name: 'node_runtime',
  description: 'Node.js runtime — run JS/TS scripts, install npm packages, execute node tooling',
  npm: ['typescript', 'tsx'],
  environment: {
    NODE_ENV: {
      description: 'Node environment',
      default: 'production',
    },
    NPM_REGISTRY: {
      description: 'npm registry URL',
      default: 'https://registry.npmjs.org/',
    },
  },
  files: [
    {
      path: '/app/config/node/defaults.json',
      mode: 0o644,
      content: JSON.stringify(
        {
          nodeVersion: '20',
          npmRegistry: 'https://registry.npmjs.org/',
          workspace: '/app/node-workspace',
        },
        null,
        2,
      ),
    },
  ],
  handlers: {
    node: {
      module: './handlers/node-handler.js',
      export: 'nodeHandler',
      description: 'Executes a Node.js script or expression and returns the result',
    },
  },
  prepare: [
    'mkdir -p /app/config/node /app/node-workspace',
    'corepack enable && echo "corepack enabled"',
  ],
};

/**
 * GitHub CLI capability — interact with GitHub: repos, PRs, issues, Actions.
 *
 * Docker preparation:
 *   - Installs gh CLI and common git tooling
 *   - Creates /app/config/github/ for gh config
 */
export const githubCli: CapabilityPreset = {
  name: 'github_cli',
  description: 'GitHub CLI — manage repos, PRs, issues, Actions, gists via `gh`',
  apt: ['gh', 'git', 'openssh'],
  environment: {
    GH_HOST: {
      description: 'GitHub host (default: github.com for SaaS, or GHE hostname)',
      default: 'github.com',
    },
    GITHUB_TOKEN: {
      description: 'GitHub personal access token for gh auth',
      required: true,
    },
  },
  files: [
    {
      path: '/app/config/github/defaults.json',
      mode: 0o644,
      content: JSON.stringify(
        {
          host: '${GH_HOST:-github.com}',
          workspace: '/app/github-workspace',
        },
        null,
        2,
      ),
    },
  ],
  handlers: {
    github: {
      module: './handlers/github-handler.js',
      export: 'githubHandler',
      description: 'Runs a gh CLI command and returns the output',
    },
  },
  prepare: [
    'mkdir -p /app/config/github /app/github-workspace',
    'gh version 2>/dev/null || echo "WARN: gh not found after install"',
    'git config --global init.defaultBranch main',
    'echo "github_cli capability: gh + git ready, workspace at /app/github-workspace"',
  ],
};

/**
 * Computer Use capability — desktop automation via @theaiinc/realm-api (ubuntu engine).
 *
 * Talks to the Realm API at /api/v1/realms/:id/* for screenshot capture,
 * click, type, and exec. Runs a think-act-observe loop with an LLM.
 *
 * Depends on llm (vision-capable model for screenshot understanding).
 */
export const computerUse: CapabilityPreset = {
  name: 'computer_use',
  description: 'Computer use — desktop automation via Realm ubuntu engine',
  dependsOn: ['llm'],
  environment: {
    REALM_URL: {
      description: 'Base URL of the Realm API server',
      default: 'http://host.docker.internal:8542',
    },
    REALM_API_KEY: {
      description: 'API key for the Realm server (optional)',
      required: false,
    },
    REALM_ID: {
      description: 'Existing realm ID to reuse (optional — creates one if unset)',
      required: false,
    },
    CU_MAX_ITERATIONS: {
      description: 'Maximum action-observe cycles per task',
      default: '50',
    },
  },
  files: [
    {
      path: '/app/config/computer-use/defaults.json',
      mode: 0o644,
      content: JSON.stringify(
        {
          realmUrl: '${REALM_URL:-http://host.docker.internal:8542}',
          engine: 'ubuntu',
          maxIterations: 50,
        },
        null,
        2,
      ),
    },
  ],
  handlers: {
    computer_use: {
      module: './handlers/cu-handler.js',
      export: 'computerUseHandler',
      description: 'Runs a computer-use loop: screenshot -> think -> act -> observe',
    },
  },
  prepare: [
    'mkdir -p /app/config/computer-use /app/cu-screenshots',
    'echo "computer_use capability: Realm ubuntu engine, workspace at /app/cu-screenshots"',
  ],
};

/**
 * Android capability — mobile automation via @theaiinc/realm-api (vm engine).
 *
 * Uses Realm's VMEngine to boot an Android emulator, install the Realm Agent APK,
 * and drive the device through the same universal Realm API (capture, click, type, navigate).
 *
 * The Realm server must have VMEngine registered and ANDROID_HOME / REALM_AVD configured.
 * Depends on llm (vision-capable model for screenshot understanding).
 */
export const android: CapabilityPreset = {
  name: 'android',
  description: 'Android automation — mobile UI control via Realm VM engine (emulator + ADB)',
  dependsOn: ['llm'],
  environment: {
    REALM_URL: {
      description: 'Base URL of the Realm API server',
      default: 'http://localhost:8542',
    },
    REALM_API_KEY: {
      description: 'API key for the Realm server (optional)',
      required: false,
    },
    REALM_ID: {
      description: 'Existing realm ID to reuse (optional — creates one if unset)',
      required: false,
    },
    REALM_AVD: {
      description: 'Android Virtual Device name for the emulator',
      default: 'Pixel_9_Pro',
    },
    ANDROID_HOME: {
      description: 'Path to Android SDK (required on Realm server host)',
      required: false,
    },
    CU_MAX_ITERATIONS: {
      description: 'Maximum action-observe cycles per task',
      default: '50',
    },
  },
  files: [
    {
      path: '/app/config/android/defaults.json',
      mode: 0o644,
      content: JSON.stringify(
        {
          realmUrl: '${REALM_URL:-http://localhost:8542}',
          engine: 'vm',
          avd: '${REALM_AVD:-Pixel_9_Pro}',
          maxIterations: 50,
        },
        null,
        2,
      ),
    },
  ],
  handlers: {
    android: {
      module: './handlers/android-handler.js',
      export: 'androidHandler',
      description: 'Runs an Android automation loop: screenshot -> think -> tap/type -> observe',
    },
  },
  prepare: [
    'mkdir -p /app/config/android /app/android-screenshots',
    'echo "android capability: Realm VM engine (Android emulator), workspace at /app/android-screenshots"',
  ],
};

// ─── Registry of all builtin presets ───────────────────────────────────────

const presetRegistry = new Map<string, CapabilityPreset>();

export function registerPreset(preset: CapabilityPreset): void {
  if (presetRegistry.has(preset.name)) {
    throw new Error(`Preset "${preset.name}" already registered`);
  }
  presetRegistry.set(preset.name, preset);
}

export function getPreset(name: string): CapabilityPreset | undefined {
  return presetRegistry.get(name);
}

export function listPresets(): CapabilityPreset[] {
  return Array.from(presetRegistry.values());
}

// Auto-register on import
for (const p of [llm, webSearch, shell, agent, codeRunner, python, nodeRuntime, githubCli, computerUse, android]) {
  registerPreset(p);
}
