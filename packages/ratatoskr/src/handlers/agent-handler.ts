/**
 * Agent handler — full sub-agent loop (think-act-execute) with LLM + tools.
 *
 * Implements the 'agent' task type. Uses the LLM to plan and execute,
 * calling shell, file, and web tools as needed.
 */

import type { TaskHandler } from '../types/index.js';
import { execSync } from 'child_process';
import axios from 'axios';

const LLM_MODEL = process.env.LLM_MODEL || 'google/gemma-4-26b-a4b-qat';
const LLM_BASE_URL = (process.env.LLM_BASE_URL || 'http://host.docker.internal:1234/v1').replace(/\/$/, '');
const LLM_API_KEY = process.env.LLM_API_KEY || process.env.OASIS_OPENAI_API_KEY || '';
const MAX_TOOL_ITERATIONS = parseInt(process.env.AGENT_MAX_TOOL_ITERATIONS || '25', 10);

interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
}

const tools: Record<string, (...args: string[]) => Promise<ToolResult>> = {
  shell: async (command: string) => {
    try {
      const output = execSync(command, { encoding: 'utf-8', timeout: 30_000, maxBuffer: 10 * 1024 * 1024 });
      return { success: true, output: output.slice(0, 100_000) };
    } catch (err: any) {
      return { success: false, output: err.stdout || '', error: err.stderr || err.message };
    }
  },
  read_file: async (path: string) => {
    try {
      const fs = await import('fs');
      const content = fs.readFileSync(path, 'utf-8');
      return { success: true, output: content.slice(0, 100_000) };
    } catch (err: any) {
      return { success: false, output: '', error: err.message };
    }
  },
  write_file: async (path: string, content: string) => {
    try {
      const fs = await import('fs');
      const pathModule = await import('path');
      fs.mkdirSync(pathModule.dirname(path), { recursive: true });
      fs.writeFileSync(path, content, 'utf-8');
      return { success: true, output: `Written ${content.length} bytes to ${path}` };
    } catch (err: any) {
      return { success: false, output: '', error: err.message };
    }
  },
  web_search: async (query: string) => {
    try {
      const { data } = await axios.get(process.env.WEB_SEARCH_API || 'https://api.duckduckgo.com', {
        params: { q: query, format: 'json' }, timeout: 15_000,
      });
      const results = data.AbstractText || (data.RelatedTopics || []).slice(0, 5).map((r: any) => r.Text || r.FirstURL).join('\n');
      return { success: true, output: results || 'No results.' };
    } catch (err: any) {
      return { success: false, output: '', error: err.message };
    }
  },
  web_fetch: async (url: string) => {
    try {
      const { data } = await axios.get(url, { timeout: 15_000 });
      const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
      return { success: true, output: text.slice(0, 100_000) };
    } catch (err: any) {
      return { success: false, output: '', error: err.message };
    }
  },
  python: async (script: string) => {
    try {
      const { pythonHandler } = await import('./python-handler.js');
      const result = await pythonHandler({ script });
      return { success: result.code === 0, output: result.stdout.slice(0, 100_000), error: result.stderr || '' };
    } catch (err: any) {
      return { success: false, output: '', error: err.message };
    }
  },
  node: async (script: string) => {
    try {
      const { nodeHandler } = await import('./node-handler.js');
      const result = await nodeHandler({ script });
      return { success: result.code === 0, output: result.stdout.slice(0, 100_000), error: result.stderr || '' };
    } catch (err: any) {
      return { success: false, output: '', error: err.message };
    }
  },
  github: async (command: string, ...args: string[]) => {
    try {
      const { githubHandler } = await import('./github-handler.js');
      const result = await githubHandler({ command, args });
      return { success: result.code === 0, output: result.stdout.slice(0, 100_000), error: result.stderr || '' };
    } catch (err: any) {
      return { success: false, output: '', error: err.message };
    }
  },
};

const toolNames = Object.keys(tools);

async function callLlm(messages: Array<{ role: string; content: string }>): Promise<{ content: string; model: string; inputTokens: number; outputTokens: number }> {
  const { data } = await axios.post(
    `${LLM_BASE_URL}/chat/completions`,
    { model: LLM_MODEL, messages, max_tokens: 4096, temperature: 0.3 },
    { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${LLM_API_KEY}` }, timeout: 120_000 },
  );
  return {
    content: data.choices?.[0]?.message?.content || '',
    model: data.model || LLM_MODEL,
    inputTokens: data.usage?.prompt_tokens || 0,
    outputTokens: data.usage?.completion_tokens || 0,
  };
}

export const agentHandler: TaskHandler = async (task) => {
  const goal = (task.metadata?.goal as string) || task.type || 'agent task';
  if (!LLM_API_KEY) {
    return { status: 'completed', metadata: { final_message: `No LLM configured. Goal: "${goal.slice(0, 120)}"`, tokens: { input: 0, output: 0 } } };
  }

  const messages: Array<{ role: string; content: string }> = [
    {
      role: 'system',
      content: [
        'You are a capable sub-agent. Your job is to accomplish the given goal.',
        'Available tools:', ...toolNames.map((n) => `  - ${n}`),
        '',
        'To use a tool:',
        '```tool',
        '{"name": "<tool_name>", "arguments": {"arg1": "value", ...}}',
        '```',
        '',
        'When done:',
        '```final',
        '{"result": "your answer", "summary": "brief summary"}',
        '```',
      ].join('\n'),
    },
    { role: 'user', content: `Goal: ${goal}` },
  ];

  let totalInput = 0, totalOutput = 0, finalAnswer = '', lastModel = LLM_MODEL;
  for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
    const llm = await callLlm(messages);
    totalInput += llm.inputTokens;
    totalOutput += llm.outputTokens;
    lastModel = llm.model;
    const content = llm.content.trim();
    const finalMatch = content.match(/```final\n([\s\S]*?)```/);
    if (finalMatch) {
      const json = finalMatch[1];
      try { finalAnswer = json ? (JSON.parse(json).result || JSON.parse(json).summary || content) : content; } catch { finalAnswer = content; }
      break;
    }
    const toolMatch = content.match(/```tool\n([\s\S]*?)```/);
    if (toolMatch) {
      const match = toolMatch[1];
      let call: { name: string; arguments: Record<string, string> };
      if (!match) { messages.push({ role: 'assistant', content }, { role: 'user', content: 'Empty tool block.' }); continue; }
      try { call = JSON.parse(match); } catch { messages.push({ role: 'assistant', content }, { role: 'user', content: 'Invalid JSON. Use valid JSON.' }); continue; }
      const fn = tools[call.name];
      if (!fn) { messages.push({ role: 'assistant', content }, { role: 'user', content: `Unknown tool: ${call.name}. Available: ${toolNames.join(', ')}` }); continue; }
      const result = await fn(...Object.values(call.arguments));
      messages.push({ role: 'assistant', content }, { role: 'user', content: result.success ? `Output:\n${result.output}` : `Error: ${result.error || result.output}` });
      continue;
    }
    messages.push({ role: 'assistant', content }, { role: 'user', content: 'Respond with a `tool` or `final` block.' });
  }

  if (!finalAnswer) finalAnswer = 'Max iterations reached without final answer.';
  return {
    status: 'completed',
    metadata: { final_message: finalAnswer, model: lastModel, tokens: { input: totalInput, output: totalOutput } },
  };
};
