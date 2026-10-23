// The only place that talks to a language model. API keys stay on the server.
// Every call has a timeout and is logged; callers fall back to prepared content on failure.
import type { ModelCall, ModelStatus } from '@l45/shared';

type ModelPurpose = ModelCall['purpose'];
import { nowIso } from './util.ts';

export interface ModelMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ModelRequest {
  purpose: ModelPurpose;
  system: string;
  messages: ModelMessage[];
  maxTokens?: number;
}

export type ModelReply = { ok: true; text: string; call: ModelCall } | { ok: false; error: string; call: ModelCall };

type Provider = 'anthropic' | 'openai' | 'mock' | 'none';

export function providerName(): Provider {
  const p = (process.env.MODEL_PROVIDER ?? 'none').toLowerCase();
  if (p === 'anthropic' && process.env.ANTHROPIC_API_KEY) return 'anthropic';
  if (p === 'openai' && process.env.OPENAI_API_KEY && process.env.OPENAI_MODEL) return 'openai';
  if (p === 'mock') return 'mock';
  return 'none';
}

export function modelStatus(simulation: boolean): ModelStatus {
  if (simulation) return 'simulation';
  return providerName() === 'none' ? 'offline' : 'online';
}

/** Global log of model calls (no content, only purpose, timing and outcome). */
export const modelLog: ModelCall[] = [];

/** Test hook: replaces the mock provider's answer. */
let mockHandler: ((req: ModelRequest) => string | Promise<string>) | null = null;
export function setMockHandler(fn: typeof mockHandler) {
  mockHandler = fn;
}

export async function callModel(req: ModelRequest): Promise<ModelReply> {
  const provider = providerName();
  const started = Date.now();
  const timeoutMs = Number(process.env.MODEL_TIMEOUT_MS ?? 8000);
  const finish = (ok: boolean, error?: string): ModelCall => {
    const call: ModelCall = { at: nowIso(), purpose: req.purpose, ok, fallback: !ok, ms: Date.now() - started };
    if (error) console.warn(`model call failed (${provider}, ${req.purpose}): ${error}`);
    modelLog.push(call);
    if (modelLog.length > 500) modelLog.shift();
    return call;
  };

  try {
    let text: string;
    if (provider === 'none') throw new Error('no model configured');
    if (provider === 'mock') {
      if (!mockHandler) throw new Error('mock provider without handler');
      text = await mockHandler(req);
    } else if (provider === 'anthropic') {
      text = await callAnthropic(req, timeoutMs);
    } else {
      text = await callOpenAI(req, timeoutMs);
    }
    if (!text.trim()) throw new Error('empty reply');
    return { ok: true, text, call: finish(true) };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { ok: false, error, call: finish(false, error) };
  }
}

async function callAnthropic(req: ModelRequest, timeoutMs: number): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY ?? '',
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || 'claude-haiku-5-5',
      max_tokens: req.maxTokens ?? 700,
      system: req.system,
      messages: req.messages,
    }),
  });
  if (!res.ok) throw new Error(`anthropic ${res.status}`);
  const data = (await res.json()) as { content?: { type: string; text?: string }[] };
  return (data.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('');
}

async function callOpenAI(req: ModelRequest, timeoutMs: number): Promise<string> {
  const base = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    signal: AbortSignal.timeout(timeoutMs),
    headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.OPENAI_API_KEY ?? ''}` },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL,
      messages: [{ role: 'system', content: req.system }, ...req.messages],
    }),
  });
  if (!res.ok) throw new Error(`openai ${res.status}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return data.choices?.[0]?.message?.content ?? '';
}
