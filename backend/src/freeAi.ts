// Shared by Eule and lesson generation. This anonymous endpoint needs no API key.
export const FREE_AI_ENDPOINT = 'https://oai.endpoints.kepler.ai.cloud.ovh.net/v1/chat/completions';
export const FREE_AI_MODEL = 'Qwen2.5-VL-72B-Instruct';

export class FreeAiError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export function freeReply(payload: unknown): string {
  const message = (payload as { choices?: { message?: { content?: unknown }; finish_reason?: string }[] })?.choices?.[0];
  if (message?.finish_reason === 'length') throw new FreeAiError(502, 'free AI reply truncated');
  const content = message?.message?.content;
  return typeof content === 'string' ? content.replace(/<think>[\s\S]*?<\/think>/g, '').trim() : '';
}

export async function callFreeAi(input: {
  system: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  maxTokens: number;
  timeoutMs: number;
  temperature?: number;
}): Promise<string> {
  const res = await fetch(FREE_AI_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: FREE_AI_MODEL,
      messages: [{ role: 'system', content: input.system }, ...input.messages],
      max_tokens: input.maxTokens,
      temperature: input.temperature ?? 0.3,
    }),
    signal: AbortSignal.timeout(input.timeoutMs),
  });
  if (!res.ok) throw new FreeAiError(res.status, `free AI ${res.status}`);
  const text = freeReply(await res.json());
  if (!text) throw new FreeAiError(502, 'empty free AI reply');
  return text;
}
