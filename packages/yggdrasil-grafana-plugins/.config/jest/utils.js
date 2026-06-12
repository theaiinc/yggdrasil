const path = require('path');

const nodeModulesToTransform = (moduleNames: string[]) =>
  `node_modules\/(?!.*(${moduleNames.join('|')})\/.*)`;

const grafanaESModules = [
  '.pnpm',
  '@grafana/schema',
  '@wojtekmaj/date-utils',
  'd3',
  'd3-color',
  'd3-force',
  'd3-interpolate',
  'd3-scale-chromatic',
  'get-user-locale',
  'marked',
  'memoize',
  'mimic-function',
  'ol',
  'react-calendar',
  'react-colorful',
  'rxjs',
  'uuid',
];

module.exports = {
  nodeModulesToTransform,
  grafanaESModules,
};
