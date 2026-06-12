/**
 * Android handler — session-based mobile automation via Realm VM engine (Android emulator + ADB).
 *
 * Creates a "phone-use" session: observe → decide → act → repeat.
 * Streaming is an internal Realm implementation detail.
 *
 * Requires @theaiinc/realm-api with VMEngine registered and an Android SDK/AVD
 * configured on the host running the Realm server.
 */

import { createAutomationHandler, buildAutomationConfig } from './automation-loop.js';

function androidEnvironment(): Record<string, string> {
  const env: Record<string, string> = {};
  if (process.env.REALM_AVD) env.REALM_AVD = process.env.REALM_AVD;
  if (process.env.ANDROID_HOME) env.ANDROID_HOME = process.env.ANDROID_HOME;
  if (process.env.REALM_HTTP_PROXY) env.REALM_HTTP_PROXY = process.env.REALM_HTTP_PROXY;
  return env;
}

export const androidHandler = createAutomationHandler(
  buildAutomationConfig('vm', androidEnvironment()),
);
