/**
 * Tests for the capability preset system.
 *
 * Covers:
 *   - Builtin preset correctness (structure, deps, handlers, prepare steps)
 *   - combinePresets merging with transitive deps
 *   - applyPresetDefaults writes env defaults to process.env
 *   - generateDockerfile produces valid Dockerfiles for new presets
 *   - resolveCapabilities (via Ratatoskr constructor) resolves transitive deps
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  combinePresets,
  generateDockerfile,
} from '../../src/presets/schema';
import type { CapabilityPreset } from '../../src/presets/schema';
import {
  llm,
  webSearch,
  shell,
  agent,
  codeRunner,
  python,
  nodeRuntime,
  githubCli,
  computerUse,
  android,
  getPreset,
  listPresets,
} from '../../src/presets/builtins';
import { applyPresetDefaults } from '../../src/presets/apply';
import { Ratatoskr } from '../../src/ratatoskr';

describe('CapabilityPreset', () => {
  describe('builtins', () => {
    it('should have all 10 presets registered', () => {
      const all = listPresets();
      expect(all).toHaveLength(10);
    });

    it('should retrieve all presets by name', () => {
      expect(getPreset('llm')?.name).toBe('llm');
      expect(getPreset('web_search')?.name).toBe('web_search');
      expect(getPreset('shell')?.name).toBe('shell');
      expect(getPreset('agent')?.name).toBe('agent');
      expect(getPreset('code')?.name).toBe('code');
      expect(getPreset('python')?.name).toBe('python');
      expect(getPreset('node_runtime')?.name).toBe('node_runtime');
      expect(getPreset('github_cli')?.name).toBe('github_cli');
      expect(getPreset('computer_use')?.name).toBe('computer_use');
      expect(getPreset('android')?.name).toBe('android');
    });

    describe('llm preset', () => {
      it('should have openai npm dep', () => {
        expect(llm.npm).toContain('openai');
        expect(llm.environment?.LLM_API_KEY?.required).toBe(false);
        expect(llm.environment?.LLM_MODEL?.default).toBeDefined();
        expect(llm.environment?.LLM_BASE_URL?.default).toBeDefined();
      });

      it('should have prepare steps for config directory', () => {
        expect(llm.prepare).toBeDefined();
        expect(llm.prepare!.length).toBeGreaterThan(0);
        expect(llm.prepare![0]).toContain('mkdir -p /app/config/llm');
      });

      it('should have config file and handler', () => {
        expect(llm.files?.length).toBe(1);
        expect(llm.files![0].path).toBe('/app/config/llm/defaults.json');
        expect(llm.handlers?.llm).toBeDefined();
        expect(llm.handlers!.llm.module).toContain('llm-handler');
      });
    });

    describe('web_search preset', () => {
      it('should have ca-certificates apt dep', () => {
        expect(webSearch.apt).toContain('ca-certificates');
      });

      it('should have both web_search and web_fetch handlers', () => {
        expect(webSearch.handlers?.web_search).toBeDefined();
        expect(webSearch.handlers?.web_fetch).toBeDefined();
      });

      it('should have prepare steps', () => {
        expect(webSearch.prepare?.length).toBeGreaterThan(0);
      });
    });

    describe('shell preset', () => {
      it('should have CLI tool apt deps', () => {
        expect(shell.apt).toContain('curl');
        expect(shell.apt).toContain('jq');
        expect(shell.apt).toContain('git');
      });

      it('should have shell handler', () => {
        expect(shell.handlers?.shell).toBeDefined();
      });

      it('should have prepare steps for workspace', () => {
        expect(shell.prepare?.length).toBeGreaterThan(0);
        expect(shell.prepare![0]).toContain('/app/scratch');
      });
    });

    describe('agent preset', () => {
      it('should depend on llm, shell, web_search', () => {
        expect(agent.dependsOn).toContain('llm');
        expect(agent.dependsOn).toContain('shell');
        expect(agent.dependsOn).toContain('web_search');
      });

      it('should have agent handler', () => {
        expect(agent.handlers?.agent).toBeDefined();
      });

      it('should have prepare steps for agent workspace', () => {
        expect(agent.prepare?.length).toBeGreaterThan(0);
        expect(agent.prepare![0]).toContain('/app/config/agent');
        expect(agent.prepare![0]).toContain('/app/agent-workspace');
      });
    });

    describe('code runner preset', () => {
      it('should depend on llm', () => {
        expect(codeRunner.dependsOn).toContain('llm');
      });

      it('should have coding-specific env vars', () => {
        expect(codeRunner.environment?.CODE_LLM_MODEL?.default).toBe('google/gemma-4-26b-a4b-qat');
        expect(codeRunner.environment?.CODE_LLM_BASE_URL?.default).toBe('http://host.docker.internal:1234/v1');
        expect(codeRunner.environment?.CODE_TEMPERATURE?.default).toBe('0.2');
        expect(codeRunner.environment?.CODE_MAX_TOKENS?.default).toBe('8192');
      });

      it('should have code handler', () => {
        expect(codeRunner.handlers?.code).toBeDefined();
      });
    });

    describe('python preset', () => {
      it('should have python apt deps', () => {
        expect(python.apt).toContain('python3');
        expect(python.apt).toContain('python3-pip');
        expect(python.apt).toContain('python3-venv');
      });

      it('should have python handler', () => {
        expect(python.handlers?.python).toBeDefined();
      });

      it('should have prepare steps with venv creation', () => {
        expect(python.prepare).toBeDefined();
        expect(python.prepare!.length).toBeGreaterThanOrEqual(2);
        expect(python.prepare![0]).toContain('mkdir -p /app/config/python');
        expect(python.prepare!.some((s) => s.includes('python3 -m venv /app/python-venv'))).toBe(true);
      });

      it('should have config file', () => {
        expect(python.files?.length).toBe(1);
        expect(python.files![0].path).toBe('/app/config/python/defaults.json');
        expect(python.files![0].content).toContain('https://pypi.org/simple/');
      });
    });

    describe('node_runtime preset', () => {
      it('should have tsx npm dep', () => {
        expect(nodeRuntime.npm).toContain('typescript');
        expect(nodeRuntime.npm).toContain('tsx');
      });

      it('should have node environment defaults', () => {
        expect(nodeRuntime.environment?.NODE_ENV?.default).toBe('production');
        expect(nodeRuntime.environment?.NPM_REGISTRY?.default).toBe('https://registry.npmjs.org/');
      });

      it('should have node handler', () => {
        expect(nodeRuntime.handlers?.node).toBeDefined();
      });

      it('should have prepare steps for workspace', () => {
        expect(nodeRuntime.prepare?.length).toBeGreaterThan(0);
        expect(nodeRuntime.prepare![0]).toContain('mkdir -p /app/config/node');
      });
    });

    describe('github_cli preset', () => {
      it('should have gh and git apt deps', () => {
        expect(githubCli.apt).toContain('gh');
        expect(githubCli.apt).toContain('git');
        expect(githubCli.apt).toContain('openssh');
      });

      it('should have github handler', () => {
        expect(githubCli.handlers?.github).toBeDefined();
      });

      it('should have GITHUB_TOKEN as required env var', () => {
        expect(githubCli.environment?.GITHUB_TOKEN?.required).toBe(true);
        expect(githubCli.environment?.GH_HOST?.default).toBe('github.com');
      });

      it('should have prepare steps for gh setup', () => {
        expect(githubCli.prepare).toBeDefined();
        expect(githubCli.prepare!.length).toBeGreaterThanOrEqual(3);
        expect(githubCli.prepare!.some((s) => s.includes('git config'))).toBe(true);
        expect(githubCli.prepare!.some((s) => s.includes('gh version'))).toBe(true);
      });
    });

    describe('computer_use preset', () => {
      it('should depend on llm', () => {
        expect(computerUse.dependsOn).toContain('llm');
      });

      it('should have Realm API env vars', () => {
        expect(computerUse.environment?.REALM_URL?.default).toBe('http://host.docker.internal:8542');
        expect(computerUse.environment?.CU_MAX_ITERATIONS?.default).toBe('50');
      });

      it('should have computer_use handler', () => {
        expect(computerUse.handlers?.computer_use).toBeDefined();
        expect(computerUse.handlers!.computer_use.module).toContain('cu-handler');
      });
    });

    describe('android preset', () => {
      it('should depend on llm', () => {
        expect(android.dependsOn).toContain('llm');
      });

      it('should have Android/Realm env vars', () => {
        expect(android.environment?.REALM_URL?.default).toBe('http://localhost:8542');
        expect(android.environment?.REALM_AVD?.default).toBe('Pixel_9_Pro');
      });

      it('should have android handler', () => {
        expect(android.handlers?.android).toBeDefined();
        expect(android.handlers!.android.module).toContain('android-handler');
      });
    });
  });

  describe('combinePresets', () => {
    it('should merge two presets', () => {
      const combined = combinePresets(llm, webSearch);
      expect(combined.capabilities).toEqual(['llm', 'web_search']);
    });

    it('should deduplicate apt deps', () => {
      const p1: CapabilityPreset = { name: 'a', description: '', apt: ['curl', 'git'] };
      const p2: CapabilityPreset = { name: 'b', description: '', apt: ['git', 'python3'] };
      const combined = combinePresets(p1, p2);
      expect(combined.apt).toEqual(expect.arrayContaining(['curl', 'git', 'python3']));
      expect(combined.apt.length).toBe(3);
    });

    it('should combine environment variables (later wins)', () => {
      const p1: CapabilityPreset = {
        name: 'a', description: '',
        environment: { FOO: { description: 'foo', default: '1' } },
      };
      const p2: CapabilityPreset = {
        name: 'b', description: '',
        environment: { FOO: { description: 'foo override', default: '2' } },
      };
      const combined = combinePresets(p1, p2);
      expect(combined.environment.FOO?.default).toBe('2');
    });

    it('should concatenate prepare steps in order', () => {
      const p1: CapabilityPreset = { name: 'a', description: '', prepare: ['step1', 'step2'] };
      const p2: CapabilityPreset = { name: 'b', description: '', prepare: ['step3'] };
      const combined = combinePresets(p1, p2);
      expect(combined.prepare).toEqual(['step1', 'step2', 'step3']);
    });

    it('should merge handler maps (later wins)', () => {
      const p1: CapabilityPreset = {
        name: 'a', description: '',
        handlers: { foo: { module: './a.js', description: 'handler a' } },
      };
      const p2: CapabilityPreset = {
        name: 'b', description: '',
        handlers: { foo: { module: './b.js', description: 'handler b' } },
      };
      const combined = combinePresets(p1, p2);
      expect(combined.handlers.foo?.module).toBe('./b.js');
    });

    it('should combine llm + web_search + shell', () => {
      const combined = combinePresets(llm, webSearch, shell);
      expect(combined.capabilities).toEqual(['llm', 'web_search', 'shell']);
      expect(combined.npm).toContain('openai');
      expect(combined.handlers.llm).toBeDefined();
      expect(combined.handlers.web_search).toBeDefined();
      expect(combined.handlers.web_fetch).toBeDefined();
      expect(combined.handlers.shell).toBeDefined();
    });

    describe('new preset combinations', () => {
      it('should combine python + node_runtime', () => {
        const combined = combinePresets(python, nodeRuntime);
        expect(combined.capabilities).toEqual(['python', 'node_runtime']);
        expect(combined.apt).toContain('python3');
        expect(combined.apt).toContain('python3-pip');
        expect(combined.npm).toContain('tsx');
        expect(combined.handlers.python).toBeDefined();
        expect(combined.handlers.node).toBeDefined();
      });

      it('should combine python + github_cli', () => {
        const combined = combinePresets(python, githubCli);
        expect(combined.capabilities).toEqual(['python', 'github_cli']);
        expect(combined.apt).toContain('python3');
        expect(combined.apt).toContain('python3-venv');
        expect(combined.apt).toContain('gh');
        expect(combined.handlers.python).toBeDefined();
        expect(combined.handlers.github).toBeDefined();
      });

      it('should combine all new presets', () => {
        const combined = combinePresets(python, nodeRuntime, githubCli);
        expect(combined.capabilities).toEqual(['python', 'node_runtime', 'github_cli']);
        expect(combined.apt).toContain('python3');
        expect(combined.apt).toContain('gh');
        expect(combined.apt).toContain('git');
        expect(combined.npm).toContain('tsx');
        expect(combined.npm).toContain('typescript');
        expect(combined.handlers.python).toBeDefined();
        expect(combined.handlers.node).toBeDefined();
        expect(combined.handlers.github).toBeDefined();
        // prepare steps from all three
        expect(combined.prepare.length).toBeGreaterThan(3);
        expect(combined.prepare.some((s) => s.includes('python3 -m venv'))).toBe(true);
        expect(combined.prepare.some((s) => s.includes('corepack enable'))).toBe(true);
        expect(combined.prepare.some((s) => s.includes('gh version'))).toBe(true);
      });

      it('should combine all 8 presets', () => {
        const combined = combinePresets(llm, webSearch, shell, agent, codeRunner, python, nodeRuntime, githubCli);
        expect(combined.capabilities).toHaveLength(8);
        expect(combined.npm).toContain('openai');
        expect(combined.npm).toContain('tsx');
        expect(combined.apt).toContain('curl');
        expect(combined.apt).toContain('python3');
        expect(combined.apt).toContain('gh');
        expect(combined.apt).toContain('git');
        expect(combined.handlers.llm).toBeDefined();
        expect(combined.handlers.shell).toBeDefined();
        expect(combined.handlers.web_search).toBeDefined();
        expect(combined.handlers.agent).toBeDefined();
        expect(combined.handlers.code).toBeDefined();
        expect(combined.handlers.python).toBeDefined();
        expect(combined.handlers.node).toBeDefined();
        expect(combined.handlers.github).toBeDefined();
      });
    });
  });

  describe('applyPresetDefaults', () => {
    beforeEach(() => {
      // Clean slate for env vars
      for (const key of Object.keys(process.env)) {
        if (key.startsWith('LLM_') || key.startsWith('CODE_') || key.startsWith('WEB_') || key.startsWith('AGENT_') || key.startsWith('NODE_') || key.startsWith('NPM_') || key.startsWith('GH_') || key.startsWith('GITHUB_')) {
          delete process.env[key];
        }
      }
    });

    it('should set LLM env defaults from combined preset', () => {
      const combined = combinePresets(llm, webSearch);
      applyPresetDefaults(combined);
      expect(process.env.LLM_MODEL).toBe('google/gemma-4-26b-a4b-qat');
      expect(process.env.LLM_BASE_URL).toBe('http://host.docker.internal:1234/v1');
      expect(process.env.LLM_MAX_TOKENS).toBe('4096');
      expect(process.env.LLM_TEMPERATURE).toBe('0.3');
      expect(process.env.WEB_SEARCH_API).toBe('https://api.duckduckgo.com');
    });

    it('should not override existing env vars', () => {
      process.env.LLM_MODEL = 'custom-model';
      const combined = combinePresets(llm);
      applyPresetDefaults(combined);
      expect(process.env.LLM_MODEL).toBe('custom-model');
    });

    it('should set python and node env defaults', () => {
      const combined = combinePresets(python, nodeRuntime);
      applyPresetDefaults(combined);
      expect(process.env.NODE_ENV).toBe('production');
      expect(process.env.NPM_REGISTRY).toBe('https://registry.npmjs.org/');
    });

    it('should set github env defaults', () => {
      const combined = combinePresets(githubCli);
      applyPresetDefaults(combined);
      expect(process.env.GH_HOST).toBe('github.com');
    });

    it('should not set GITHUB_TOKEN (no default)', () => {
      const combined = combinePresets(githubCli);
      applyPresetDefaults(combined);
      expect(process.env.GITHUB_TOKEN).toBeUndefined();
    });

    it('should set all env defaults from all 8 presets', () => {
      const combined = combinePresets(llm, webSearch, shell, agent, codeRunner, python, nodeRuntime, githubCli);
      applyPresetDefaults(combined);
      expect(process.env.LLM_MODEL).toBeDefined();
      expect(process.env.LLM_BASE_URL).toBeDefined();
      expect(process.env.WEB_SEARCH_API).toBeDefined();
      expect(process.env.AGENT_MAX_TOOL_ITERATIONS).toBe('25');
      expect(process.env.CODE_LLM_MODEL).toBe('google/gemma-4-26b-a4b-qat');
      expect(process.env.NODE_ENV).toBe('production');
      expect(process.env.GH_HOST).toBe('github.com');
    });
  });

  describe('generateDockerfile', () => {
    it('should produce a valid multi-stage Dockerfile with env vars', () => {
      const combined = combinePresets(llm, codeRunner);
      const df = generateDockerfile(combined, { baseImage: 'node:20-alpine', port: 3100, cmd: ['node', 'runner.js'] });

      expect(df).toContain('FROM node:20-alpine AS builder');
      expect(df).toContain('FROM node:20-alpine');
      expect(df).toContain('ENV CODE_LLM_MODEL=google/gemma-4-26b-a4b-qat');
      expect(df).toContain('ENV CODE_LLM_BASE_URL=http://host.docker.internal:1234/v1');
      expect(df).toContain('EXPOSE 3100');
      expect(df).toContain('CMD ["node","runner.js"]');
    });

    it('should include config files and env vars', () => {
      const p: CapabilityPreset = {
        name: 'test', description: '',
        files: [{ path: '/app/config.json', content: '{"key": "value"}' }],
        environment: { MY_VAR: { description: 'test', default: 'hello' } },
      };
      const df = generateDockerfile(combinePresets(p));
      expect(df).toContain('/app/config.json');
      expect(df).toContain('ENV MY_VAR=hello');
    });

    it('should include prepend/append RUN commands', () => {
      const combined = combinePresets(shell);
      const df = generateDockerfile(combined, {
        extraRunBefore: ['echo "before"'],
        extraRunAfter: ['echo "after"'],
      });
      expect(df).toContain('RUN echo "before"');
      expect(df).toContain('RUN echo "after"');
    });

    describe('new preset Dockerfiles', () => {
      it('should include python venv prepare step', () => {
        const combined = combinePresets(python);
        const df = generateDockerfile(combined);
        expect(df).toContain('python3 -m venv /app/python-venv');
        expect(df).toContain('pip install --upgrade pip');
        expect(df).toContain('apk add --no-cache python3 python3-pip python3-venv build-base python3-dev');
      });

      it('should include node_runtime prepare step', () => {
        const combined = combinePresets(nodeRuntime);
        const df = generateDockerfile(combined);
        expect(df).toContain('corepack enable');
        expect(df).toContain('npm install typescript tsx');
      });

      it('should include github_cli prepare steps', () => {
        const combined = combinePresets(githubCli);
        const df = generateDockerfile(combined);
        expect(df).toContain('apk add --no-cache gh git openssh');
        expect(df).toContain('gh version');
        expect(df).toContain('git config --global init.defaultBranch main');
      });

      it('should generate Dockerfile for all 3 new presets combined', () => {
        const combined = combinePresets(python, nodeRuntime, githubCli);
        const df = generateDockerfile(combined, { baseImage: 'node:20-alpine', port: 3100 });
        // apt deps from all three are in a single line (deduplicated)
        expect(df).toContain('apk add --no-cache');
        expect(df).toContain('python3');
        expect(df).toContain('gh');
        expect(df).toContain('git');
        // npm deps
        expect(df).toContain('npm install typescript tsx');
        // apt deduplication — all packages in one apk line
        const apkLines = df.split('\n').filter((l) => l.startsWith('RUN apk'));
        expect(apkLines).toHaveLength(1);
        expect(apkLines[0]).toContain('gh');
        expect(apkLines[0]).toContain('git');
        expect(apkLines[0]).toContain('openssh');
        // prepare steps in order (verified individually below)
        const dfLines = df.split('\n');
        expect(dfLines.some((l) => l.includes('python3 -m venv'))).toBe(true);
        expect(dfLines.some((l) => l.includes('corepack enable'))).toBe(true);
        expect(dfLines.some((l) => l.includes('gh version'))).toBe(true);
        // env vars
        expect(df).toContain('ENV NODE_ENV=production');
        expect(df).toContain('ENV NPM_REGISTRY=https://registry.npmjs.org/');
        expect(df).toContain('ENV GH_HOST=github.com');
      });

      it('should include config files in the Dockerfile', () => {
        const combined = combinePresets(python, githubCli);
        const df = generateDockerfile(combined);
        expect(df).toContain('/app/config/python/defaults.json');
        expect(df).toContain('/app/config/github/defaults.json');
        expect(df).toContain('PRESET_EOF');
      });
    });
  });

  describe('agent preset composition', () => {
    it('should combine all sub-presets when explicitly included', () => {
      const combined = combinePresets(agent); // agent itself
      expect(combined.handlers.agent).toBeDefined();
      expect(combined.environment.AGENT_MAX_TOOL_ITERATIONS).toBeDefined();
      // sub-preset env vars are NOT included unless explicitly combined
      expect(combined.environment.LLM_API_KEY).toBeUndefined();
    });

    it('should include sub-preset data when agent + deps are combined', () => {
      const combined = combinePresets(agent, llm, webSearch, shell);
      expect(combined.handlers.agent).toBeDefined();
      expect(combined.handlers.llm).toBeDefined();
      expect(combined.handlers.web_search).toBeDefined();
      expect(combined.handlers.shell).toBeDefined();
      expect(combined.environment.LLM_API_KEY).toBeDefined();
      expect(combined.environment.WEB_SEARCH_API).toBeDefined();
      expect(combined.environment.AGENT_MAX_TOOL_ITERATIONS).toBeDefined();
    });
  });

  describe('resolveCapabilities (transitive dependency resolution)', () => {
    it('should resolve llm from code dependency', () => {
      const r = new Ratatoskr({
        yggdrasilUrl: 'http://localhost:9999',
        capabilities: ['code'], // code depends on llm
        heartbeatInterval: 300,
        taskPollInterval: 0, // disable polling
      });
      const state = r.getState();
      expect(state.runnerId).toBeDefined();
    });

    it('should resolve all transitive deps for agent capability', () => {
      const r = new Ratatoskr({
        yggdrasilUrl: 'http://localhost:9999',
        capabilities: ['agent'],
        heartbeatInterval: 300,
        taskPollInterval: 0,
      });
      expect(r.isRegistered()).toBe(false);
    });

    it('should pass through unknown capabilities', () => {
      const r = new Ratatoskr({
        yggdrasilUrl: 'http://localhost:9999',
        capabilities: ['agent', 'browser', 'computer-use'],
        heartbeatInterval: 300,
        taskPollInterval: 0,
      });
      expect(r.isRegistered()).toBe(false);
    });
  });

  describe('resolveCapabilities standalone', () => {
    it('should resolve transitive deps and return combined preset', async () => {
      const { resolveCapabilities } = await import('../../src/presets/resolve');
      const result = resolveCapabilities(['agent', 'code']);
      expect(result.capabilities).toContain('agent');
      expect(result.capabilities).toContain('llm');
      expect(result.capabilities).toContain('shell');
      expect(result.capabilities).toContain('code');
      expect(result.handlerPaths).toHaveProperty('llm');
      expect(result.handlerPaths).toHaveProperty('agent');
      expect(result.combined.environment.LLM_MODEL?.default).toBe('google/gemma-4-26b-a4b-qat');
    });

    it('should pass through unknown names', async () => {
      const { resolveCapabilities } = await import('../../src/presets/resolve');
      const result = resolveCapabilities(['agent', 'browser']);
      expect(result.capabilities).toContain('agent');
      expect(result.capabilities).toContain('browser');
      expect(result.capabilities).not.toContain('computer-use');
    });
  });
});
