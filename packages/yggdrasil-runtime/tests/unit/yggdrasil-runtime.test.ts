/**
 * Tests for YggdrasilRuntime — the ComputerUseRuntime implementation that
 * bridges Cognition to Yggdrasil + Realm.
 *
 * Architecture:
 *   start()   → POST /api/v1/sessions  (Yggdrasil control plane)
 *   stop()    → DELETE /api/v1/sessions/:id (Yggdrasil)
 *   observe   → GET  /capture           (Realm data plane)
 *   input     → POST /click, /type etc. (Realm data plane)
 *
 * Tests verify local logic; all HTTP calls to Yggdrasil and Realm are mocked.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// eslint-disable-next-line @typescript-eslint/naming-convention
import axios from 'axios';
import { YggdrasilRuntime } from '../../src/yggdrasil-runtime';

import type { CreateSessionResponse } from '../../src/types';

let mockInstance: Record<string, ReturnType<typeof vi.fn>>;

vi.mock('axios', () => {
  const instance = {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  };
  const mockAxios = vi.fn(() => Promise.resolve());
  mockAxios.create = vi.fn(() => instance);
  return { default: mockAxios };
});

/**
 * Valid session descriptor with real-looking URLs so getRealmBaseUrl doesn't throw.
 */
function validDescriptor(overrides?: Partial<CreateSessionResponse['descriptor']>): CreateSessionResponse['descriptor'] {
  return {
    id: 'test-session-1',
    type: 'computer-use',
    state: 'active',
    observationEndpoint: 'http://realm:8542/api/v1/realms/r-1/capture',
    inputEndpoint: 'http://realm:8542/api/v1/realms/r-1',
    capabilities: ['mouse', 'keyboard'],
    observationMethod: 'screenshot',
    realmId: 'r-1',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function validSessionResponse(overrides?: Partial<CreateSessionResponse>): CreateSessionResponse {
  return {
    sessionId: 'test-session-1',
    descriptor: validDescriptor(overrides?.descriptor),
    ...overrides,
  };
}

describe('YggdrasilRuntime', () => {
  let runtime: YggdrasilRuntime;

  beforeEach(() => {
    vi.clearAllMocks();
    mockInstance = (axios.create as ReturnType<typeof vi.fn>).mock.results[0]?.value;
  });

  function createRuntime(config?: Partial<ConstructorParameters<typeof YggdrasilRuntime>[0]>) {
    runtime = new YggdrasilRuntime({
      yggdrasilUrl: 'http://yggdrasil.test:3000',
      apiKey: 'test-key',
      ...config,
    });
    // Re-capture instance after constructor calls axios.create()
    mockInstance = (axios.create as ReturnType<typeof vi.fn>).mock.results[0]?.value;
  }

  /** Set up a session via start() so the runtime has an active session + realm client. */
  async function setupSession() {
    mockInstance.post.mockResolvedValue({ data: validSessionResponse() });
    await runtime.start();
  }

  // ── Constructor ───────────────────────────────────────────────────────

  describe('constructor', () => {
    it('should store config and create Yggdrasil client', () => {
      createRuntime();
      expect(axios.create).toHaveBeenCalledWith(
        expect.objectContaining({ baseURL: 'http://yggdrasil.test:3000' }),
      );
      expect(runtime.name).toBe('yggdrasil');
      expect(runtime.running).toBe(false);
    });

    it('should default sessionType to computer-use', () => {
      createRuntime();
      expect(runtime['config'].sessionType).toBe('computer-use');
    });

    it('should pass through apiKey as x-api-key header', () => {
      createRuntime({ apiKey: 'my-secret' });
      expect(axios.create).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: expect.objectContaining({ 'x-api-key': 'my-secret' }),
        }),
      );
    });

    it('should work without apiKey', () => {
      runtime = new YggdrasilRuntime({ yggdrasilUrl: 'http://yggdrasil.test:3000' });
      expect(runtime).toBeDefined();
    });
  });

  // ── Lifecycle (health) ────────────────────────────────────────────────

  describe('health', () => {
    it('should return health info from Yggdrasil', async () => {
      createRuntime();
      mockInstance.get.mockResolvedValue({ data: { version: '0.1.0' } });

      const result = await runtime.health();

      expect(result.platform).toBe('unknown');
      expect(result.version).toBe('0.1.0');
      expect(mockInstance.get).toHaveBeenCalledWith('/health', expect.any(Object));
    });

    it('should return unknown platform on error', async () => {
      createRuntime();
      mockInstance.get.mockRejectedValue(new Error('Yggdrasil unreachable'));

      const result = await runtime.health();

      expect(result.platform).toBe('unknown');
      expect(result.version).toBeUndefined();
    });

    it('should include screens when session is active', async () => {
      createRuntime();
      mockInstance.post.mockResolvedValue({ data: validSessionResponse() });
      mockInstance.get.mockResolvedValue({ data: { version: '0.1.0' } });

      await runtime.start();
      const result = await runtime.health();

      expect(result.screens).toBeDefined();
      expect(result.screens).toHaveLength(1);
    });
  });

  // ── Start / Stop ──────────────────────────────────────────────────────

  describe('start', () => {
    it('should create a session via Yggdrasil and return descriptor', async () => {
      createRuntime();
      mockInstance.post.mockResolvedValue({ data: validSessionResponse() });

      const descriptor = await runtime.start();

      expect(descriptor.id).toBe('test-session-1');
      expect(descriptor.state).toBe('active');
      expect(runtime.running).toBe(true);
      expect(runtime.getSession()).toBe(descriptor);
    });

    it('should POST the correct session type', async () => {
      createRuntime({ sessionType: 'phone-use' });
      mockInstance.post.mockResolvedValue({
        data: validSessionResponse({ descriptor: validDescriptor({ type: 'phone-use', capabilities: ['touch'] }) }),
      });

      await runtime.start();

      expect(mockInstance.post).toHaveBeenCalledWith(
        '/api/v1/sessions',
        expect.objectContaining({ type: 'phone-use' }),
      );
    });

    it('should pass ownerId and participantIds', async () => {
      createRuntime({ ownerId: 'user-a', participantIds: ['user-b', 'user-c'] });
      mockInstance.post.mockResolvedValue({
        data: validSessionResponse({
          descriptor: validDescriptor({ ownerId: 'user-a', participantIds: ['user-b', 'user-c'] }),
        }),
      });

      await runtime.start();

      expect(mockInstance.post).toHaveBeenCalledWith(
        '/api/v1/sessions',
        expect.objectContaining({ ownerId: 'user-a', participantIds: ['user-b', 'user-c'] }),
      );
    });

    it('should pass capabilities filter', async () => {
      createRuntime({ capabilities: ['observe', 'keyboard'] });
      mockInstance.post.mockResolvedValue({
        data: validSessionResponse({ descriptor: validDescriptor({ capabilities: ['observe', 'keyboard'] }) }),
      });

      await runtime.start();

      expect(mockInstance.post).toHaveBeenCalledWith(
        '/api/v1/sessions',
        expect.objectContaining({ capabilities: ['observe', 'keyboard'] }),
      );
    });

    it('should not send ownerId when not configured', async () => {
      createRuntime();
      mockInstance.post.mockResolvedValue({ data: validSessionResponse() });

      await runtime.start();

      const callBody = mockInstance.post.mock.calls.find(
        (c: unknown[]) => c[0] === '/api/v1/sessions',
      )?.[1] as Record<string, unknown>;
      expect(callBody?.ownerId).toBeUndefined();
    });

    it('should create a second axios instance for Realm client', async () => {
      createRuntime();
      mockInstance.post.mockResolvedValue({ data: validSessionResponse() });

      await runtime.start();

      // axios.create called twice — once in constructor, once in start()
      expect(axios.create).toHaveBeenCalledTimes(2);
    });
  });

  describe('stop', () => {
    it('should terminate session via Yggdrasil and clean up', async () => {
      createRuntime();
      await setupSession();

      await runtime.stop();

      expect(mockInstance.delete).toHaveBeenCalledWith('/api/v1/sessions/test-session-1');
      expect(runtime.running).toBe(false);
      expect(runtime.getSession()).toBeNull();
    });

    it('should be a no-op when no session exists', async () => {
      createRuntime();

      await runtime.stop();

      expect(mockInstance.delete).not.toHaveBeenCalled();
      expect(runtime.running).toBe(false);
    });

    it('should not throw when Yggdrasil delete fails', async () => {
      createRuntime();
      await setupSession();

      mockInstance.delete.mockRejectedValue(new Error('Network error'));

      await expect(runtime.stop()).resolves.toBeUndefined();
      expect(runtime.running).toBe(false);
    });
  });

  describe('getSession / running', () => {
    it('should return null before start', () => {
      createRuntime();
      expect(runtime.getSession()).toBeNull();
      expect(runtime.running).toBe(false);
    });

    it('should return session after start', async () => {
      createRuntime();
      await setupSession();
      expect(runtime.getSession()).not.toBeNull();
      expect(runtime.getSession()!.id).toBe('test-session-1');
      expect(runtime.running).toBe(true);
    });

    it('should return null after stop', async () => {
      createRuntime();
      await setupSession();
      await runtime.stop();
      expect(runtime.getSession()).toBeNull();
      expect(runtime.running).toBe(false);
    });
  });

  // ── Screen observation ────────────────────────────────────────────────

  describe('getScreenImage', () => {
    it('should capture screenshot from Realm', async () => {
      createRuntime();
      await setupSession();

      mockInstance.get.mockResolvedValue({ data: { screenshot: 'base64img123' } });

      const result = await runtime.getScreenImage();

      expect(result).toBe('base64img123');
      expect(mockInstance.get).toHaveBeenCalledWith('/capture', expect.any(Object));
    });

    it('should return undefined when no active session', async () => {
      createRuntime();

      const result = await runtime.getScreenImage();

      expect(result).toBeUndefined();
    });

    it('should return undefined when Realm errors', async () => {
      createRuntime();
      await setupSession();

      mockInstance.get.mockRejectedValue(new Error('Realm error'));

      const result = await runtime.getScreenImage();

      expect(result).toBeUndefined();
    });

    it('should pass scale and region params', async () => {
      createRuntime();
      await setupSession();

      mockInstance.get.mockResolvedValue({ data: { screenshot: 'img' } });

      await runtime.getScreenImage({ scale: 1, region: { x: 0, y: 0, width: 100, height: 100 } });

      expect(mockInstance.get).toHaveBeenCalledWith(
        '/capture',
        expect.objectContaining({
          params: expect.objectContaining({ scale: 1, region: { x: 0, y: 0, width: 100, height: 100 } }),
        }),
      );
    });
  });

  describe('listScreens', () => {
    it('should return screens from Realm', async () => {
      createRuntime();
      await setupSession();

      mockInstance.get.mockResolvedValue({
        data: { screens: [{ index: 0, width: 1920, height: 1080, x: 0, y: 0 }] },
      });

      const result = await runtime.listScreens();

      expect(result).toHaveLength(1);
      expect(result[0]?.width).toBe(1920);
      expect(mockInstance.get).toHaveBeenCalledWith('/screens');
    });

    it('should return empty when no session', async () => {
      createRuntime();
      const result = await runtime.listScreens();
      expect(result).toEqual([]);
    });

    it('should return empty on error', async () => {
      createRuntime();
      await setupSession();

      mockInstance.get.mockRejectedValue(new Error('error'));

      const result = await runtime.listScreens();
      expect(result).toEqual([]);
    });
  });

  describe('getScreenSize', () => {
    it('should return size from Realm', async () => {
      createRuntime();
      await setupSession();

      mockInstance.get.mockResolvedValue({ data: { width: 2560, height: 1440 } });

      const result = await runtime.getScreenSize();

      expect(result).toEqual({ width: 2560, height: 1440 });
    });

    it('should return fallback when no session', async () => {
      createRuntime();
      const result = await runtime.getScreenSize();
      expect(result).toEqual({ width: 1920, height: 1080 });
    });

    it('should return fallback on error', async () => {
      createRuntime();
      await setupSession();

      mockInstance.get.mockRejectedValue(new Error('error'));

      const result = await runtime.getScreenSize();
      expect(result).toEqual({ width: 1920, height: 1080 });
    });
  });

  // ── Input actions ─────────────────────────────────────────────────────

  describe('click', () => {
    it('should send click to Realm', async () => {
      createRuntime();
      await setupSession();

      await runtime.click({ x: 100, y: 200 });

      expect(mockInstance.post).toHaveBeenCalledWith('/click', { x: 100, y: 200 });
    });

    it('should include clickCount when > 1', async () => {
      createRuntime();
      await setupSession();

      await runtime.click({ x: 100, y: 200, clickCount: 2 });

      expect(mockInstance.post).toHaveBeenCalledWith(
        '/click',
        expect.objectContaining({ click_count: 2, x: 100, y: 200 }),
      );
    });

    it('should omit click_count when clickCount is 1', async () => {
      createRuntime();
      await setupSession();

      await runtime.click({ x: 100, y: 200, clickCount: 1 });

      const callArg = (mockInstance.post.mock.calls.find(
        (c: unknown[]) => c[0] === '/click',
      )?.[1] as Record<string, unknown>);
      expect(callArg?.click_count).toBeUndefined();
    });

    it('should include button when not left', async () => {
      createRuntime();
      await setupSession();

      await runtime.click({ x: 100, y: 200, button: 'right' });

      expect(mockInstance.post).toHaveBeenCalledWith(
        '/click',
        expect.objectContaining({ button: 'right' }),
      );
    });

    it('should throw when no active session', async () => {
      createRuntime();
      await expect(runtime.click({ x: 0, y: 0 })).rejects.toThrow('No active session');
    });
  });

  describe('type', () => {
    it('should send type to Realm', async () => {
      createRuntime();
      await setupSession();

      await runtime.type({ text: 'hello world' });

      expect(mockInstance.post).toHaveBeenCalledWith('/type', { text: 'hello world' });
    });

    it('should include replace flag', async () => {
      createRuntime();
      await setupSession();

      await runtime.type({ text: 'hello', replace: true });

      expect(mockInstance.post).toHaveBeenCalledWith(
        '/type',
        expect.objectContaining({ replace: true }),
      );
    });

    it('should throw when no active session', async () => {
      createRuntime();
      await expect(runtime.type({ text: 'hi' })).rejects.toThrow('No active session');
    });
  });

  describe('keyPress', () => {
    it('should send single key to Realm', async () => {
      createRuntime();
      await setupSession();

      await runtime.keyPress({ keys: 'enter' });

      expect(mockInstance.post).toHaveBeenCalledWith('/key', { keys: 'enter' });
    });

    it('should send key combination to Realm', async () => {
      createRuntime();
      await setupSession();

      await runtime.keyPress({ keys: ['command', 'n'] });

      expect(mockInstance.post).toHaveBeenCalledWith('/key', { keys: 'command,n' });
    });

    it('should throw when no active session', async () => {
      createRuntime();
      await expect(runtime.keyPress({ keys: 'enter' })).rejects.toThrow('No active session');
    });
  });

  describe('scroll', () => {
    it('should send scroll to Realm', async () => {
      createRuntime();
      await setupSession();

      await runtime.scroll({ deltaX: 0, deltaY: -100 });

      expect(mockInstance.post).toHaveBeenCalledWith('/scroll', { deltaX: 0, deltaY: -100 });
    });

    it('should default missing deltas to 0', async () => {
      createRuntime();
      await setupSession();

      await runtime.scroll({});

      expect(mockInstance.post).toHaveBeenCalledWith('/scroll', { deltaX: 0, deltaY: 0 });
    });

    it('should throw when no active session', async () => {
      createRuntime();
      await expect(runtime.scroll({})).rejects.toThrow('No active session');
    });
  });

  describe('mouseMove', () => {
    it('should send mouse move to Realm', async () => {
      createRuntime();
      await setupSession();

      await runtime.mouseMove(500, 300);

      expect(mockInstance.post).toHaveBeenCalledWith('/mouse/move', { x: 500, y: 300 });
    });
  });

  // ── Window / app management ───────────────────────────────────────────

  describe('focusWindow', () => {
    it('should send focus to Realm', async () => {
      createRuntime();
      await setupSession();

      await runtime.focusWindow('Chrome');

      expect(mockInstance.post).toHaveBeenCalledWith('/window/focus', { name: 'Chrome' });
    });

    it('should not throw on Realm error', async () => {
      createRuntime();
      await setupSession();

      mockInstance.post.mockRejectedValue(new Error('error'));

      await expect(runtime.focusWindow('Chrome')).resolves.toBeUndefined();
    });

    it('should throw when no active session', async () => {
      createRuntime();
      await expect(runtime.focusWindow('Chrome')).rejects.toThrow('No active session');
    });
  });

  describe('listWindows', () => {
    it('should return windows from Realm', async () => {
      createRuntime();
      await setupSession();

      mockInstance.get.mockResolvedValue({ data: { windows: ['Chrome', 'Terminal'] } });

      const result = await runtime.listWindows();

      expect(result).toEqual(['Chrome', 'Terminal']);
    });

    it('should return empty when no session', async () => {
      createRuntime();
      const result = await runtime.listWindows();
      expect(result).toEqual([]);
    });
  });

  describe('openApplication', () => {
    it('should send open app to Realm', async () => {
      createRuntime();
      await setupSession();

      await runtime.openApplication('Safari');

      expect(mockInstance.post).toHaveBeenCalledWith('/app/open', { name: 'Safari' });
    });

    it('should throw when no active session', async () => {
      createRuntime();
      await expect(runtime.openApplication('Safari')).rejects.toThrow('No active session');
    });
  });

  describe('getWindowBounds', () => {
    it('should return bounds from Realm', async () => {
      createRuntime();
      await setupSession();

      mockInstance.post.mockResolvedValue({
        data: { bounds: { x: 0, y: 0, width: 800, height: 600 } },
      });

      const result = await runtime.getWindowBounds('Chrome');

      expect(result).toEqual({ x: 0, y: 0, width: 800, height: 600 });
      expect(mockInstance.post).toHaveBeenCalledWith('/window/bounds', { name: 'Chrome' });
    });

    it('should return null when no session', async () => {
      createRuntime();
      const result = await runtime.getWindowBounds('Chrome');
      expect(result).toBeNull();
    });

    it('should return null on error', async () => {
      createRuntime();
      await setupSession();

      mockInstance.post.mockRejectedValue(new Error('error'));

      const result = await runtime.getWindowBounds('Chrome');
      expect(result).toBeNull();
    });
  });

  // ── executeStep ───────────────────────────────────────────────────────

  describe('executeStep', () => {
    it('should dispatch screenshot action', async () => {
      createRuntime();
      await setupSession();
      mockInstance.get.mockResolvedValue({ data: { screenshot: 'img123' } });

      const result = await runtime.executeStep('screenshot');

      expect(result.output).toBe('Screen captured');
      expect(result.screenshot).toBe('img123');
    });

    it('should dispatch read_screen action', async () => {
      createRuntime();
      await setupSession();
      mockInstance.get.mockResolvedValue({ data: { screenshot: 'img456' } });

      const result = await runtime.executeStep('read_screen');

      expect(result.output).toBe('Screen captured');
      expect(result.screenshot).toBe('img456');
    });

    it('should dispatch click action', async () => {
      createRuntime();
      await setupSession();

      const result = await runtime.executeStep('click', undefined, { x: 100, y: 200 });

      expect(result.output).toContain('Clicked at (100, 200)');
      expect(mockInstance.post).toHaveBeenCalledWith(
        '/click',
        expect.objectContaining({ x: 100, y: 200 }),
      );
    });

    it('should dispatch type action', async () => {
      createRuntime();
      await setupSession();

      const result = await runtime.executeStep('type', undefined, { text: 'hello' });

      expect(result.output).toContain('hello');
      expect(mockInstance.post).toHaveBeenCalledWith('/type', expect.objectContaining({ text: 'hello' }));
    });

    it('should dispatch type_text action', async () => {
      createRuntime();
      await setupSession();

      const result = await runtime.executeStep('type_text', undefined, { text: 'world' });

      expect(result.output).toContain('world');
      expect(mockInstance.post).toHaveBeenCalledWith('/type', expect.objectContaining({ text: 'world' }));
    });

    it('should dispatch key_press action', async () => {
      createRuntime();
      await setupSession();

      const result = await runtime.executeStep('key_press', undefined, { keys: 'enter' });

      expect(result.output).toContain('enter');
      expect(mockInstance.post).toHaveBeenCalledWith('/key', expect.objectContaining({ keys: 'enter' }));
    });

    it('should dispatch scroll action', async () => {
      createRuntime();
      await setupSession();

      const result = await runtime.executeStep('scroll', undefined, { x: 0, y: -100 });

      expect(result.output).toBe('Scrolled');
      expect(mockInstance.post).toHaveBeenCalledWith('/scroll', expect.objectContaining({ deltaY: -100 }));
    });

    it('should dispatch wait action', async () => {
      createRuntime();
      const result = await runtime.executeStep('wait');
      expect(result.output).toBe('Waited 1 second');
    });

    it('should dispatch focus_window action', async () => {
      createRuntime();
      await setupSession();

      const result = await runtime.executeStep('focus_window', undefined, { windowName: 'Terminal' });

      expect(result.output).toContain('Terminal');
      expect(mockInstance.post).toHaveBeenCalledWith('/window/focus', { name: 'Terminal' });
    });

    it('should dispatch open_app action', async () => {
      createRuntime();
      await setupSession();

      const result = await runtime.executeStep('open_app', 'Safari');

      expect(result.output).toContain('Safari');
      expect(mockInstance.post).toHaveBeenCalledWith('/app/open', { name: 'Safari' });
    });

    it('should return unsupported for unknown actions', async () => {
      createRuntime();
      const result = await runtime.executeStep('unknown_action');
      expect(result.output).toContain('not supported');
    });
  });

  // ── Stub methods (not-yet-supported via Realm) ────────────────────────

  describe('stubs', () => {
    it('ocrScreenshot should return empty text', async () => {
      createRuntime();
      const result = await runtime.ocrScreenshot();
      expect(result.text).toBe('');
    });

    it('getPageText should return empty text', async () => {
      createRuntime();
      const result = await runtime.getPageText();
      expect(result.text).toBe('');
    });

    it('parseUI should return empty elements', async () => {
      createRuntime();
      const result = await runtime.parseUI('imgb64');
      expect(result.elements).toEqual([]);
    });

    it('moveWindowToScreen should not throw', async () => {
      createRuntime();
      await expect(runtime.moveWindowToScreen('Chrome', 1)).resolves.toBeUndefined();
    });

    it('launchOverlay should not throw', async () => {
      createRuntime();
      await expect(runtime.launchOverlay()).resolves.toBeUndefined();
    });

    it('startInterferenceDetection should not throw', async () => {
      createRuntime();
      await expect(runtime.startInterferenceDetection()).resolves.toBeUndefined();
    });

    it('stopInterferenceDetection should not throw', async () => {
      createRuntime();
      await expect(runtime.stopInterferenceDetection()).resolves.toBeUndefined();
    });
  });

  // ── Capabilities ──────────────────────────────────────────────────────

  describe('capabilities', () => {
    it('should report canObserve and canInput', () => {
      createRuntime();
      expect(runtime.capabilities.canObserve).toBe(true);
      expect(runtime.capabilities.canInput).toBe(true);
    });

    it('should report no Chrome bridge or OCR support', () => {
      createRuntime();
      expect(runtime.capabilities.supportsChromeBridge).toBe(false);
      expect(runtime.capabilities.supportsOcr).toBe(false);
      expect(runtime.capabilities.supportsInterferenceDetection).toBe(false);
    });
  });

  // ── Internal helpers ─────────────────────────────────────────────────

  describe('getRealmBaseUrl', () => {
    it('should strip /capture from observation endpoint', () => {
      createRuntime();
      const base = runtime['getRealmBaseUrl']('http://realm:8542/api/v1/realms/r-1/capture');
      expect(base).toBe('http://realm:8542/api/v1/realms/r-1');
    });

    it('should handle observation endpoint without /capture', () => {
      createRuntime();
      const base = runtime['getRealmBaseUrl']('http://realm:8542/api/v1/realms/r-1/');
      expect(base).toBe('http://realm:8542/api/v1/realms/r-1');
    });

    it('should return empty string for empty endpoint', () => {
      createRuntime();
      const base = runtime['getRealmBaseUrl']('');
      expect(base).toBe('');
    });
  });
});
