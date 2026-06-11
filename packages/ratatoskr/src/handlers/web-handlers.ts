/**
 * Web handlers — web search and web fetch.
 * Registered for 'web_search' and 'web_fetch' task types.
 */

import type { TaskHandler } from '../types/index.js';
import axios from 'axios';

const WEB_SEARCH_API = process.env.WEB_SEARCH_API || 'https://api.duckduckgo.com';

export const webSearchHandler: TaskHandler = async (task) => {
  const query = (task.metadata?.query as string) || '';
  if (!query) return { status: 'failed', metadata: { error: 'No query specified' } };

  try {
    const { data } = await axios.get(WEB_SEARCH_API, {
      params: { q: query, format: 'json' },
      timeout: 15_000,
    });
    const results = data.AbstractText ||
      (data.RelatedTopics || []).slice(0, 5).map((r: any) => r.Text || r.FirstURL).join('\n');
    return { status: 'completed', metadata: { results: results || 'No results found.', query } };
  } catch (err: any) {
    return { status: 'failed', metadata: { error: err.message, query } };
  }
};

export const webFetchHandler: TaskHandler = async (task) => {
  const url = (task.metadata?.url as string) || '';
  if (!url) return { status: 'failed', metadata: { error: 'No URL specified' } };

  try {
    const { data } = await axios.get(url, { timeout: 15_000 });
    const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    return { status: 'completed', metadata: { content: text.slice(0, 100_000), url } };
  } catch (err: any) {
    return { status: 'failed', metadata: { error: err.message, url } };
  }
};
