/**
 * Types for the YggdrasilRuntime — mirrors the ComputerUseRuntime interface
 * from oasis-cognition so that @theaiinc/yggdrasil-runtime can be a drop-in
 * replacement for LocalMacOSRuntime without depending on the Cognition codebase.
 *
 * These are structurally identical to the types in:
 *   apps/api-gateway/src/computer-use/computer-use-runtime.interface.ts
 */

export interface ScreenInfo {
  index: number;
  width: number;
  height: number;
  x: number;
  y: number;
  name?: string;
}

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ScreenshotOptions {
  /** Device pixel ratio scaling (default 2 for retina). */
  scale?: number;
  /** Optional region to capture in CSS pixels. */
  region?: { x: number; y: number; width: number; height: number };
}

export interface ClickOptions {
  x: number;
  y: number;
  clickCount?: number;
  button?: 'left' | 'right' | 'middle';
}

export interface ScrollOptions {
  deltaX?: number;
  deltaY?: number;
}

export interface TypeOptions {
  text: string;
  replace?: boolean;
}

export interface KeyPressOptions {
  keys: string | string[];
}

export interface ComputerActionResult {
  output: string;
  screenshot?: string;
}

export interface OcrResult {
  text: string;
  elements?: Array<{
    text: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
}

export interface PageTextResult {
  text: string;
  url?: string;
  title?: string;
}

export interface HealthInfo {
  platform: 'darwin' | 'linux' | 'windows' | 'unknown';
  version?: string;
  screens?: ScreenInfo[];
}

export interface UIDetection {
  elements: Array<{
    id?: number;
    type: string;
    text: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
  ocr_text?: string;
}

export interface RuntimeCapabilities {
  canObserve: boolean;
  canInput: boolean;
  screenshotMaxWidth?: number;
  supportsChromeBridge: boolean;
  supportsOcr: boolean;
  supportsInterferenceDetection: boolean;
}

/**
 * Session descriptor returned by Yggdrasil's POST /api/v1/sessions.
 */
export interface SessionDescriptor {
  id: string;
  type: 'computer-use' | 'phone-use';
  state: string;
  observationEndpoint: string;
  inputEndpoint: string;
  capabilities: string[];
  observationMethod: string;
  realmId: string;
  ownerId?: string;
  participantIds?: string[];
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

/**
 * Response from createSession.
 */
export interface CreateSessionResponse {
  sessionId: string;
  descriptor: SessionDescriptor;
}

/**
 * Configuration for YggdrasilRuntime.
 */
export interface YggdrasilRuntimeConfig {
  /** Yggdrasil server URL (control plane — session create/terminate). */
  yggdrasilUrl: string;
  /** API key for Yggdrasil authentication. */
  apiKey?: string;
  /** Realm URL (data plane — observation/input). If not provided, derived from session descriptor. */
  realmUrl?: string;
  /** Session type to create. Defaults to 'computer-use'. */
  sessionType?: 'computer-use' | 'phone-use';
  /** Owner identity for this session. */
  ownerId?: string;
  /** Participant identities for this session. */
  participantIds?: string[];
  /** Requested capabilities. If omitted, type-based defaults apply. */
  capabilities?: string[];
}
