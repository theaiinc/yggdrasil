/**
 * Computer Use handler — desktop automation via Realm ubuntu engine.
 */

import { createAutomationHandler, buildAutomationConfig } from './automation-loop.js';

export const computerUseHandler = createAutomationHandler(
  buildAutomationConfig('ubuntu'),
);
