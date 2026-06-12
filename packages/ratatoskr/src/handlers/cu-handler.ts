/**
 * Computer Use handler — session-based desktop automation via Realm ubuntu engine.
 *
 * Creates a "computer-use" session: observe → decide → act → repeat.
 * Streaming is an internal Realm implementation detail.
 */

import { createAutomationHandler, buildAutomationConfig } from './automation-loop.js';

export const computerUseHandler = createAutomationHandler(
  buildAutomationConfig('ubuntu'),
);
