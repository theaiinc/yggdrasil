/**
 * @theaiinc/yggdrasil-runtime — ComputerUseRuntime implementation that bridges
 * Cognition to Yggdrasil + Realm for remote desktop automation.
 */

export { YggdrasilRuntime } from './yggdrasil-runtime.js';

export type {
  YggdrasilRuntimeConfig,
  SessionDescriptor,
  CreateSessionResponse,
  ScreenInfo,
  ScreenshotOptions,
  ClickOptions,
  TypeOptions,
  KeyPressOptions,
  ScrollOptions,
  ComputerActionResult,
  OcrResult,
  PageTextResult,
  HealthInfo,
  WindowBounds,
  UIDetection,
  RuntimeCapabilities,
} from './types.js';
