/**
 * YggdrasilRuntime — ComputerUseRuntime implementation that bridges Cognition
 * to Yggdrasil + Realm for remote desktop automation.
 *
 * Architecture:
 *   Yggdrasil is the control plane (session create/terminate).
 *   Realm is the data plane (observation/input).
 *
 * YggdrasilRuntime talks to Yggdrasil for session lifecycle and to Realm
 * directly for screenshots and input actions.
 *
 * Cognition never knows Yggdrasil, Ratatoskr, or Realm exist.
 */

import axios, { type AxiosInstance } from 'axios';
import type {
  YggdrasilRuntimeConfig,
  CreateSessionResponse,
  SessionDescriptor,
  ScreenInfo,
  ScreenshotOptions,
  ClickOptions,
  TypeOptions,
  KeyPressOptions,
  ScrollOptions,
  HealthInfo,
  RuntimeCapabilities,
  ComputerActionResult,
  OcrResult,
  PageTextResult,
  WindowBounds,
  UIDetection,
} from './types.js';

const ACTION_TIMEOUT_MS = 60_000;

export class YggdrasilRuntime {
  readonly name = 'yggdrasil';
  readonly capabilities: RuntimeCapabilities = {
    canObserve: true,
    canInput: true,
    screenshotMaxWidth: 1024,
    supportsChromeBridge: false,
    supportsOcr: false,
    supportsInterferenceDetection: false,
  };

  private readonly yggdrasilClient: AxiosInstance;
  private readonly config: YggdrasilRuntimeConfig;
  private session: SessionDescriptor | null = null;
  private realmClient: AxiosInstance | null = null;
  private _running = false;

  constructor(config: YggdrasilRuntimeConfig) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (config.apiKey) headers['x-api-key'] = config.apiKey;

    this.config = {
      ...config,
      sessionType: config.sessionType ?? 'computer-use',
    };

    this.yggdrasilClient = axios.create({
      baseURL: this.config.yggdrasilUrl.replace(/\/$/, ''),
      headers,
      timeout: ACTION_TIMEOUT_MS,
    });
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────

  /**
   * Check whether the Yggdrasil server is reachable and healthy.
   */
  async health(): Promise<HealthInfo> {
    try {
      const { data } = await this.yggdrasilClient.get('/health', { timeout: 5000 });
      const info: HealthInfo = {
        platform: 'unknown',
        version: data?.version,
      };
      if (this.session) {
        info.screens = [{ index: 0, width: 0, height: 0, x: 0, y: 0 }];
      }
      return info;
    } catch {
      return { platform: 'unknown' };
    }
  }

  // ── Screen observation ─────────────────────────────────────────────────

  /**
   * Capture the current screen via Realm. Returns a base64-encoded JPEG.
   */
  async getScreenImage(options?: ScreenshotOptions): Promise<string | undefined> {
    const client = this.getRealmClient();
    if (!client) return undefined;

    try {
      const params: Record<string, unknown> = {};
      if (options?.scale) params.scale = options.scale;
      if (options?.region) params.region = options.region;

      const { data } = await client.get('/capture', { params });
      if (data?.screenshot) {
        return data.screenshot as string;
      }
    } catch {
      // Observation failed — session may be terminated
    }
    return undefined;
  }

  /**
   * List available displays via Realm.
   */
  async listScreens(): Promise<ScreenInfo[]> {
    const client = this.getRealmClient();
    if (!client) return [];

    try {
      const { data } = await client.get<{ screens?: ScreenInfo[] }>('/screens');
      return data?.screens ?? [];
    } catch {
      return [];
    }
  }

  /**
   * Get the native CSS-pixel dimensions of the current display.
   */
  async getScreenSize(): Promise<{ width: number; height: number }> {
    const client = this.getRealmClient();
    if (!client) return { width: 1920, height: 1080 };

    try {
      const { data } = await client.get<{ width: number; height: number }>('/screens/size');
      return data;
    } catch {
      return { width: 1920, height: 1080 };
    }
  }

  /**
   * Perform OCR on the current screen.
   * Requires `capabilities.supportsOcr === true` — currently not supported.
   */
  async ocrScreenshot(_options?: ScreenshotOptions): Promise<OcrResult> {
    return { text: '' };
  }

  /**
   * Extract visible page text via Chrome Bridge / DOM.
   * Requires `capabilities.supportsChromeBridge === true` — currently not supported.
   */
  async getPageText(_options?: { tabHint?: string }): Promise<PageTextResult> {
    return { text: '' };
  }

  /**
   * Parse UI elements from a screenshot.
   * Currently not supported via Realm.
   */
  async parseUI(_imageB64: string): Promise<UIDetection> {
    return { elements: [] };
  }

  // ── Window / app management ────────────────────────────────────────────

  /**
   * Focus a window. Delegated to Realm's window management.
   */
  async focusWindow(name: string): Promise<void> {
    const client = this.getRealmClient();
    if (!client) throw new Error('No active session');

    await client.post('/window/focus', { name }).catch(() => {});
  }

  /**
   * List open windows via Realm.
   */
  async listWindows(): Promise<string[]> {
    const client = this.getRealmClient();
    if (!client) return [];

    try {
      const { data } = await client.get<{ windows?: string[] }>('/windows');
      return data?.windows ?? [];
    } catch {
      return [];
    }
  }

  /**
   * Open an application.
   */
  async openApplication(name: string): Promise<void> {
    const client = this.getRealmClient();
    if (!client) throw new Error('No active session');

    await client.post('/app/open', { name }).catch(() => {});
  }

  /**
   * Get bounding box of a window.
   */
  async getWindowBounds(name: string): Promise<WindowBounds | null> {
    const client = this.getRealmClient();
    if (!client) return null;

    try {
      const { data } = await client.post<{ bounds: WindowBounds }>('/window/bounds', { name });
      return data?.bounds ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Move a window to a specific display.
   */
  async moveWindowToScreen(_windowName: string, _displayIndex: number): Promise<void> {
    // Not yet supported
  }

  // ── Input actions ──────────────────────────────────────────────────────

  /**
   * Click at the specified coordinates via Realm.
   */
  async click(options: ClickOptions): Promise<void> {
    const client = this.getRealmClient();
    if (!client) throw new Error('No active session');

    await client.post('/click', {
      x: options.x,
      y: options.y,
      ...(options.clickCount && options.clickCount > 1 ? { click_count: options.clickCount } : {}),
      ...(options.button && options.button !== 'left' ? { button: options.button } : {}),
    });
  }

  /**
   * Type text via Realm.
   */
  async type(options: TypeOptions): Promise<void> {
    const client = this.getRealmClient();
    if (!client) throw new Error('No active session');

    await client.post('/type', {
      text: options.text,
      ...(options.replace ? { replace: true } : {}),
    });
  }

  /**
   * Press a key or key combination via Realm.
   */
  async keyPress(options: KeyPressOptions): Promise<void> {
    const client = this.getRealmClient();
    if (!client) throw new Error('No active session');

    await client.post('/key', {
      keys: typeof options.keys === 'string' ? options.keys : options.keys.join(','),
    });
  }

  /**
   * Scroll via Realm.
   */
  async scroll(options: ScrollOptions): Promise<void> {
    const client = this.getRealmClient();
    if (!client) throw new Error('No active session');

    await client.post('/scroll', {
      deltaX: options.deltaX ?? 0,
      deltaY: options.deltaY ?? 0,
    });
  }

  /**
   * Move the mouse to coordinates via Realm.
   */
  async mouseMove(x: number, y: number, _duration?: number): Promise<void> {
    const client = this.getRealmClient();
    if (!client) throw new Error('No active session');

    await client.post('/mouse/move', { x, y });
  }

  // ── Convenience: execute a high-level step ──────────────────────────

  /**
   * Execute a high-level plan step. This is the entry point used by
   * the CU controller's adaptive loop, matching the LocalMacOSRuntime pattern.
   */
  async executeStep(
    action: string,
    target?: string,
    options?: {
      text?: string;
      x?: number;
      y?: number;
      keys?: string | string[];
      windowName?: string;
      displayIndex?: number;
      clickCount?: number;
    },
    _sessionId?: string,
  ): Promise<ComputerActionResult> {
    const a = action.toLowerCase();

    if (a === 'screenshot' || a === 'read_screen') {
      const img = await this.getScreenImage();
      const result: ComputerActionResult = { output: 'Screen captured' };
      if (img !== undefined) result.screenshot = img;
      return result;
    }

    if (a === 'click' && options?.x !== undefined && options?.y !== undefined) {
      const clickOpts: ClickOptions = { x: options.x, y: options.y };
      if (options.clickCount !== undefined) clickOpts.clickCount = options.clickCount;
      await this.click(clickOpts);
      return { output: `Clicked at (${options.x}, ${options.y})` };
    }

    if ((a === 'type' || a === 'type_text') && options?.text) {
      await this.type({ text: options.text });
      return { output: `Typed "${options.text.slice(0, 60)}"` };
    }

    if (a === 'key_press' && options?.keys) {
      await this.keyPress({ keys: options.keys });
      return { output: `Pressed key: ${options.keys}` };
    }

    if (a === 'scroll') {
      const scrollOpts: ScrollOptions = {};
      if (options?.x !== undefined) scrollOpts.deltaX = options.x;
      if (options?.y !== undefined) scrollOpts.deltaY = options.y;
      await this.scroll(scrollOpts);
      return { output: 'Scrolled' };
    }

    if (a === 'wait') {
      await new Promise((r) => setTimeout(r, 1000));
      return { output: 'Waited 1 second' };
    }

    if (a === 'focus_window' && options?.windowName) {
      await this.focusWindow(options.windowName);
      return { output: `Focused window: ${options.windowName}` };
    }

    if (a === 'open_app' && target) {
      await this.openApplication(target);
      return { output: `Opened app: ${target}` };
    }

    return { output: `Action "${action}" not supported by YggdrasilRuntime` };
  }

  // ── YggdrasilRuntime-specific methods ─────────────────────────────────

  /**
   * Start a session: creates a session via Yggdrasil and sets up the Realm client.
   */
  async start(): Promise<SessionDescriptor> {
    const { data } = await this.yggdrasilClient.post<CreateSessionResponse>('/api/v1/sessions', {
      type: this.config.sessionType,
      ...(this.config.ownerId !== undefined ? { ownerId: this.config.ownerId } : {}),
      ...(this.config.participantIds !== undefined ? { participantIds: this.config.participantIds } : {}),
      ...(this.config.capabilities !== undefined ? { capabilities: this.config.capabilities } : {}),
    });

    this.session = data.descriptor;
    this._running = true;

    // Create a direct Realm client using the observation endpoint base URL
    const realmBase = this.config.realmUrl ?? this.getRealmBaseUrl(this.session.observationEndpoint);
    const realmHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.config.apiKey) realmHeaders['x-api-key'] = this.config.apiKey;
    this.realmClient = axios.create({
      baseURL: realmBase,
      headers: realmHeaders,
      timeout: ACTION_TIMEOUT_MS,
    });

    return this.session;
  }

  /**
   * Stop the session: terminates it via Yggdrasil and cleans up.
   */
  async stop(): Promise<void> {
    if (!this.session) return;

    try {
      await this.yggdrasilClient.delete(`/api/v1/sessions/${this.session.id}`);
    } catch {
      // Best-effort cleanup
    }

    this.session = null;
    this.realmClient = null;
    this._running = false;
  }

  /**
   * Get the current session descriptor.
   */
  getSession(): SessionDescriptor | null {
    return this.session;
  }

  /**
   * Whether the runtime has an active session.
   */
  get running(): boolean {
    return this._running;
  }

  // ── Overlay & interference (not supported via Realm) ──────────────────

  async launchOverlay(): Promise<void> {
    // Not supported via Realm
  }

  async startInterferenceDetection(): Promise<void> {
    // Not supported via Realm
  }

  async stopInterferenceDetection(): Promise<void> {
    // Not supported via Realm
  }

  // ── Private helpers ─────────────────────────────────────────

  private getRealmClient(): AxiosInstance | null {
    return this.realmClient;
  }

  /**
   * Extract the base URL from a full observation endpoint path.
   * e.g. "http://realm:8542/api/v1/realms/abc123/capture" → "http://realm:8542/api/v1/realms/abc123"
   */
  private getRealmBaseUrl(observationEndpoint: string): string {
    if (!observationEndpoint) return '';
    // Strip trailing /capture (or any path segment) to get the realm base
    const url = new URL(observationEndpoint);
    const pathParts = url.pathname.split('/').filter(Boolean);
    // Keep everything up to and including the realmId (/api/v1/realms/:realmId)
    const captureIdx = pathParts.indexOf('capture');
    if (captureIdx !== -1) {
      const basePath = '/' + pathParts.slice(0, captureIdx).join('/');
      return `${url.protocol}//${url.host}${basePath}`;
    }
    return observationEndpoint.replace(/\/+$/, '');
  }
}
