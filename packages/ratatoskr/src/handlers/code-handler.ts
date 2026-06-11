/**
 * Code handler — generates code via LLM with a coding-optimised profile.
 *
 * Uses an LLM (default: gemma4:12b via Ollama) to write code for a given
 * task description. Returns the generated source code as the result.
 *
 * This is NOT a sandbox executor — code runs in the user's dev environment.
 */
import type { TaskHandler } from '../types/index.js';
import axios from 'axios';

const CODE_MODEL = process.env.CODE_LLM_MODEL || 'google/gemma-4-26b-a4b-qat';
const CODE_BASE_URL = (process.env.CODE_LLM_BASE_URL || 'http://host.docker.internal:1234/v1').replace(/\/$/, '');
const CODE_API_KEY = process.env.CODE_LLM_API_KEY || process.env.LLM_API_KEY || process.env.OASIS_OPENAI_API_KEY || '';
const TEMPERATURE = parseFloat(process.env.CODE_TEMPERATURE || '0.2');
const MAX_TOKENS = parseInt(process.env.CODE_MAX_TOKENS || '8192', 10);

const SYSTEM_PROMPT = `You are an expert coding assistant. Generate production-quality code.
Follow these rules:
1. Output ONLY the code file content — no explanations, no markdown fences.
2. Include necessary imports and dependencies.
3. Handle errors gracefully.
4. Add brief inline comments for complex logic.
5. Use modern idioms for the target language.
6. If the user asks for a file, include the file path as a comment on the first line.`;

export const codeHandler: TaskHandler = async (task) => {
  const prompt = (task.metadata?.prompt as string) || '';
  const language = (task.metadata?.language as string) || 'python';
  const system = (task.metadata?.system as string) || SYSTEM_PROMPT;

  if (!prompt) {
    return { status: 'failed', metadata: { error: 'No code generation prompt specified' } };
  }

  const fullPrompt = language
    ? `Generate ${language} code for: ${prompt}`
    : prompt;

  try {
    const { data } = await axios.post(
      `${CODE_BASE_URL}/chat/completions`,
      {
        model: CODE_MODEL,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: fullPrompt },
        ],
        max_tokens: MAX_TOKENS,
        temperature: TEMPERATURE,
        stream: false,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          ...(CODE_API_KEY ? { Authorization: `Bearer ${CODE_API_KEY}` } : {}),
        },
        timeout: 180_000,
      },
    );

    const content = data.choices?.[0]?.message?.content || '';
    return {
      status: 'completed',
      metadata: {
        code: content,
        language,
        model: data.model || CODE_MODEL,
        usage: data.usage || null,
      },
    };
  } catch (err: any) {
    return { status: 'failed', metadata: { error: err.message } };
  }
};
