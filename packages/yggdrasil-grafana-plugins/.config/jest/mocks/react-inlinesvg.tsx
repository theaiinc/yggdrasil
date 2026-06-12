// Due to the grafana/ui Icon component making fetch requests to
// `/public/img/icon/.svg` we need to mock react-inlinesvg to prevent
// the failed fetch requests from displaying errors in console.

import React from 'react';

type Callback = (...args: any[]) => void;

export interface StorageItem {
  content: string;
  queue: Callback[];
  status: string;
}

export const cacheStore: { [key: string]: StorageItem } = Object.create(null);

const SVG_FILE_NAME_REGEX = /(.+)\/(.+)\.svg$/;

const InlineSVG = ({ src }: { src: string }) => {
  const testId = src.replace(SVG_FILE_NAME_REGEX, '$2');
  return React.createElement('div', { 'data-testid': testId });
};

export default InlineSVG;
