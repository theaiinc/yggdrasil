/**
 * LLM handler — calls an OpenAI-compatible API.
 * Registered for the 'llm' task type.
 */

import type { TaskHandler } from '../types/index.js';
import axios from 'axios';

const LLM_MODEL = process.env.LLM_MODEL || 'google/gemma-4-26b-a4b-qat';
const LLM_BASE_URL = (process.env.LLM_BASE_URL || 'http://host.docker.internal:1234/v1').replace(/\/$/, '');
const LLM_API_KEY = process.env.LLM_API_KEY || process.env.OASIS_OPENAI_API_KEY || '';
const MAX_TOKENS = parseInt(process.env.LLM_MAX_TOKENS || '4096', 10);
const TEMPERATURE = parseFloat(process.env.LLM_TEMPERATURE || '0.3');

export const llmHandler: TaskHandler = async (task) => {
  const prompt = (task.metadata?.prompt as string) || '';
  const system = (task.metadata?.system as string) || 'You are a helpful assistant.';

  if (!LLM_API_KEY) {
    return { status: 'failed', metadata: { error: 'LLM_API_KEY not configured' } };
  }

  try {
    const { data } = await axios.post(
      `${LLM_BASE_URL}/chat/completions`,
      {
        model: LLM_MODEL,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: prompt },
        ],
        max_tokens: MAX_TOKENS,
        temperature: TEMPERATURE,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${LLM_API_KEY}`,
        },
        timeout: 120_000,
      },
    );

    const content = data.choices?.[0]?.message?.content || '';
    const usage = data.usage || {};
    const inputTokens = usage.prompt_tokens || 0;
    const outputTokens = usage.completion_tokens || 0;
    return {
      status: 'completed',
      metadata: {
        response: content,
        model: data.model || LLM_MODEL,
        usage: { input: inputTokens, output: outputTokens },
      },
    };
  } catch (err: any) {
    return { status: 'failed', metadata: { error: err.message } };
  }
};
