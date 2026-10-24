import { afterEach, expect, it, vi } from 'vitest';
import { callAgent, callModel, plannerModelName, type AgentMessage } from '../src/provider.ts';

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

function setup(provider = 'openai') {
  vi.stubEnv('MODEL_PROVIDER', provider);
  vi.stubEnv('OPENAI_API_KEY', 'test-key');
  vi.stubEnv('OPENAI_MODEL', 'gpt-6-luna');
  vi.stubEnv('OPENAI_PLANNER_MODEL', 'gpt-6-sol');
  vi.stubEnv('OPENAI_REASONING_EFFORT', '');
  vi.stubEnv('OPENAI_PLANNER_REASONING_EFFORT', '');
  vi.stubEnv('ANTHROPIC_API_KEY', 'test-key');
  vi.stubEnv('ANTHROPIC_MODEL', 'claude-haiku-5-5');
  vi.stubEnv('ANTHROPIC_PLANNER_MODEL', 'claude-opus-5-5');
  const bodies: Record<string, any>[] = [];
  const replies: unknown[] = [];
  const fetch = vi.fn(async (_url, init) => {
    bodies.push(JSON.parse(init.body));
    return Response.json(replies.shift());
  });
  vi.stubGlobal('fetch', fetch);
  return { bodies, replies, fetch };
}
const text = (value: string) => ({ status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: value }] }] });
const request = { purpose: 'generate' as const, system: 'Write a lesson.', messages: [{ role: 'user' as const, content: 'Photosynthese' }], maxTokens: 3000 };
const tool = { name: 'get_learner_state', description: 'Read state', input_schema: { type: 'object', properties: { trackId: { type: 'string' } }, required: ['trackId'] } };

it('routes ordinary calls to Luna and new lessons to Sol with explicit low reasoning and bounded output', async () => {
  const { bodies, replies, fetch } = setup();
  replies.push(text('ordinary'), text('lesson'));
  expect(await callModel(request)).toMatchObject({ ok: true, text: 'ordinary' });
  expect(await callModel({ ...request, planner: true })).toMatchObject({ ok: true, text: 'lesson' });
  expect(fetch.mock.calls.every(([url]) => String(url).endsWith('/responses'))).toBe(true);
  expect(bodies.map(b => b.model)).toEqual(['gpt-6-luna', 'gpt-6-sol']);
  expect(bodies.every(b => b.reasoning.effort === 'low' && b.store === false && b.max_output_tokens === 5000)).toBe(true);
  expect(plannerModelName()).toBe('gpt-6-sol');
});

it('replays Sol reasoning and tool calls exactly once, with matching tool outputs on the next step', async () => {
  const { bodies, replies } = setup();
  const output = [
    { type: 'reasoning', id: 'rs-1', encrypted_content: 'opaque', summary: [] },
    { type: 'function_call', id: 'fc-1', call_id: 'call-1', name: tool.name, arguments: '{"trackId":"photosynthese"}' },
  ];
  replies.push({ status: 'completed', output }, text('done'));
  const messages: AgentMessage[] = [{ role: 'user', content: 'Plan next step' }];
  const first = await callAgent({ system: 'Plan', messages, tools: [tool], timeoutMs: 1000 });
  expect(first).toMatchObject({ ok: true, stopReason: 'tool_use' });
  if (!first.ok) throw new Error(first.error);
  expect(first.content).toContainEqual({ type: 'tool_use', id: 'call-1', name: tool.name, input: { trackId: 'photosynthese' } });
  messages.push({ role: 'assistant', content: first.content }, { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call-1', content: '{"state":"ready"}' }] });
  expect(await callAgent({ system: 'Plan', messages, tools: [tool], timeoutMs: 1000 })).toMatchObject({ ok: true, stopReason: 'end_turn' });
  expect(bodies[1].input).toEqual([messages[0], ...output, { type: 'function_call_output', call_id: 'call-1', output: '{"state":"ready"}' }]);
  expect(bodies[1]).toMatchObject({ model: 'gpt-6-sol', reasoning: { effort: 'low' }, tools: [{ type: 'function', name: tool.name, parameters: tool.input_schema, strict: false }] });
});

it('rejects incomplete or refused OpenAI output instead of accepting partial lessons', async () => {
  const { replies } = setup();
  replies.push({ ...text('{"partial":'), status: 'incomplete' }, { status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'No' }] }] });
  expect(await callModel(request)).toMatchObject({ ok: false, error: 'openai response incomplete' });
  expect(await callModel(request)).toMatchObject({ ok: false, error: 'refusal' });
});

it('reports a safe quota error code without exposing provider messages or retrying paid calls', async () => {
  setup();
  const fetch = vi.fn(async () => Response.json({ error: { code: 'credit_balance_exhausted', message: 'private provider detail' } }, { status: 429 }));
  vi.stubGlobal('fetch', fetch);
  const result = await callModel(request);
  expect(result).toMatchObject({ ok: false, error: 'openai 429 (credit_balance_exhausted)' });
  expect(JSON.stringify(result)).not.toContain('private provider detail');
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('allows separate reasoning levels while falling back to the ordinary model when no planner model is set', async () => {
  const { bodies, replies } = setup();
  vi.stubEnv('OPENAI_PLANNER_MODEL', '');
  vi.stubEnv('OPENAI_REASONING_EFFORT', 'none');
  vi.stubEnv('OPENAI_PLANNER_REASONING_EFFORT', 'medium');
  replies.push(text('ordinary'), text('lesson'));
  await callModel(request); await callModel({ ...request, planner: true });
  expect(bodies.map(b => [b.model, b.reasoning.effort])).toEqual([['gpt-6-luna', 'none'], ['gpt-6-luna', 'medium']]);
  expect(plannerModelName()).toBe('gpt-6-luna');
});

it('keeps Anthropic generation and multi-turn planner tools supported with low effort', async () => {
  const { bodies, replies, fetch } = setup('anthropic');
  const output = [{ type: 'tool_use', id: 'tu-1', name: tool.name, input: { trackId: 'photosynthese' } }];
  replies.push({ content: [{ type: 'text', text: 'lesson' }] }, { content: output, stop_reason: 'tool_use' }, { content: [{ type: 'text', text: 'done' }], stop_reason: 'end_turn' });
  expect(await callModel({ ...request, planner: true })).toMatchObject({ ok: true, text: 'lesson' });
  const messages: AgentMessage[] = [{ role: 'user', content: 'Plan next' }];
  const first = await callAgent({ system: 'Plan', messages, tools: [tool], timeoutMs: 1000 });
  if (!first.ok) throw new Error(first.error);
  messages.push({ role: 'assistant', content: first.content }, { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu-1', content: 'ready' }] });
  expect(await callAgent({ system: 'Plan', messages, tools: [tool], timeoutMs: 1000 })).toMatchObject({ ok: true, stopReason: 'end_turn' });
  expect(fetch.mock.calls.every(([url]) => String(url).endsWith('/v1/messages'))).toBe(true);
  expect(bodies.every(b => b.model === 'claude-opus-5-5' && b.output_config.effort === 'low')).toBe(true);
  expect(bodies[2].messages).toEqual(messages);
  expect(plannerModelName()).toBe('claude-opus-5-5');
});
