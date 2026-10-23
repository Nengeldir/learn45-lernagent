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
  /** Overrides MODEL_TIMEOUT_MS */
  timeoutMs?: number;
  /** Use the planner model (generator calls) instead of the chat model */
  planner?: boolean;
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

const chatModel = () => process.env.ANTHROPIC_MODEL || 'claude-haiku-5-5';
const plannerModel = () => process.env.ANTHROPIC_PLANNER_MODEL || 'claude-opus-5-5';

/** Name of the model the planner and generator use, for the provenance of generated lessons. */
export function plannerModelName(): string {
  const provider = providerName();
  return provider === 'anthropic' ? plannerModel() : provider;
}

/** The mock provider honours timeouts too, so tests can simulate a slow model. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout after ${ms} ms`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

function logCall(purpose: ModelPurpose, started: number, ok: boolean, error?: string): ModelCall {
  const call: ModelCall = { at: nowIso(), purpose, ok, fallback: !ok, ms: Date.now() - started };
  if (error) console.warn(`model call failed (${providerName()}, ${purpose}): ${error}`);
  modelLog.push(call);
  if (modelLog.length > 500) modelLog.shift();
  return call;
}

export async function callModel(req: ModelRequest): Promise<ModelReply> {
  const provider = providerName();
  const started = Date.now();
  const timeoutMs = req.timeoutMs ?? Number(process.env.MODEL_TIMEOUT_MS ?? 8000);
  const finish = (ok: boolean, error?: string) => logCall(req.purpose, started, ok, error);

  try {
    let text: string;
    if (provider === 'none') throw new Error('no model configured');
    if (provider === 'mock') {
      if (!mockHandler) throw new Error('mock provider without handler');
      text = await withTimeout(Promise.resolve(mockHandler(req)), timeoutMs);
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
      model: req.planner ? plannerModel() : chatModel(),
      max_tokens: req.maxTokens ?? 700,
      ...(req.planner ? { output_config: { effort: 'low' } } : {}),
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

// --- Tool use for the planner agent ---------------------------------------------------------------
// Messages API with client tools. The caller runs the loop; this sends one step.

export interface AgentTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export type AgentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }
  /** Other blocks (thinking) are passed back unchanged */
  | { type: 'thinking' | 'redacted_thinking'; [key: string]: unknown };

export interface AgentMessage {
  role: 'user' | 'assistant';
  content: string | AgentBlock[];
}

export interface AgentRequest {
  system: string;
  messages: AgentMessage[];
  tools: AgentTool[];
  maxTokens?: number;
  timeoutMs: number;
}

export type AgentReply =
  | { ok: true; content: AgentBlock[]; stopReason: string; call: ModelCall }
  | { ok: false; error: string; call: ModelCall };

let mockAgent: ((req: AgentRequest) => AgentBlock[] | Promise<AgentBlock[]>) | null = null;
/** Test hook: scripts the planner's model. Returns the content blocks of one assistant turn. */
export function setMockAgentHandler(fn: typeof mockAgent) {
  mockAgent = fn;
}

export async function callAgent(req: AgentRequest): Promise<AgentReply> {
  const provider = providerName();
  const started = Date.now();
  try {
    let content: AgentBlock[];
    let stopReason: string;
    if (provider === 'mock') {
      if (!mockAgent) throw new Error('mock provider without agent handler');
      content = await withTimeout(Promise.resolve(mockAgent(structuredClone(req))), req.timeoutMs);
      stopReason = content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn';
    } else if (provider === 'anthropic') {
      ({ content, stopReason } = await callAnthropicTools(req));
    } else {
      throw new Error(`no tool use with provider ${provider}`);
    }
    if (stopReason === 'refusal') throw new Error('refusal');
    return { ok: true, content, stopReason, call: logCall('plan', started, true) };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { ok: false, error, call: logCall('plan', started, false, error) };
  }
}

async function callAnthropicTools(req: AgentRequest): Promise<{ content: AgentBlock[]; stopReason: string }> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    signal: AbortSignal.timeout(req.timeoutMs),
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY ?? '',
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: plannerModel(),
      max_tokens: req.maxTokens ?? 4000,
      // Low effort keeps each step within the per-call limit; the rules are the safety net.
      output_config: { effort: 'low' },
      system: req.system,
      tools: req.tools,
      tool_choice: { type: 'auto' },
      messages: req.messages,
    }),
  });
  if (!res.ok) throw new Error(`anthropic ${res.status}`);
  const data = (await res.json()) as { content?: AgentBlock[]; stop_reason?: string };
  return { content: data.content ?? [], stopReason: data.stop_reason ?? 'end_turn' };
}
