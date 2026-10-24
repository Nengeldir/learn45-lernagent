// Helpers for tests with the mock provider: login, finishing lessons, and a scripted planner agent.
import request from 'supertest';
import { expect } from 'vitest';
import type { MapNode, SessionView } from '@l45/shared';
import type { Express } from 'express';
import type { AgentBlock, AgentRequest } from '../src/provider.ts';

/** Sicherheit is the only track in the Grundstufe, so the map starts there (R3). */
export const levels = { 't-info': 'Fortgeschritten', 't-komm': 'Fortgeschritten', 't-inhalte': 'Fortgeschritten', 't-sicherheit': 'Grundstufe', 't-problem': 'Fortgeschritten' };

/** All prepared tracks of the catalog (data/skills.json). */
export const catalog = ['t-info', 't-komm', 't-inhalte', 't-sicherheit', 't-problem', 't-analysis', 't-physik'];

/** Login. The map starts empty; unless it has tracks already (resume), all prepared tracks are added in one go. */
export async function login(app: Express, body: Record<string, unknown> = {}, status = 201): Promise<SessionView> {
  const res = await request(app).post('/api/login').send({ name: 'Test', levels, ...body });
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  if (status !== 201 || res.body.session.nodes.some((n: MapNode) => n.kind === 'track')) return res.body;
  return addTracks(app, res.body, catalog);
}

export async function addTracks(app: Express, v: SessionView, trackIds: string[]): Promise<SessionView> {
  const res = await request(app).post(`/api/sessions/${v.session.id}/tracks`).send({ trackIds });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.view;
}

export const node = (v: SessionView, lessonId: string) => v.session.nodes.find((n) => n.lessonId === lessonId)!;

export async function finish(app: Express, v: SessionView, n: MapNode, answer: unknown): Promise<SessionView> {
  const id = v.session.id;
  await request(app).post(`/api/sessions/${id}/nodes/${n.id}/start`).expect(200);
  const res = await request(app).post(`/api/sessions/${id}/nodes/${n.id}/complete`).send({ answer });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.view;
}

export async function session(app: Express, id: string): Promise<SessionView> {
  return (await request(app).get(`/api/sessions/${id}`).expect(200)).body;
}

/** sich-v1, the starter of Sicherheit: both questions right (adresse, link). */
export const v1Right = { type: 'video', answers: { 0: 1, 1: 2 } };
/** sich-v1 with the link question wrong. */
export const v1MissLink = { type: 'video', answers: { 0: 1, 1: 0 } };

/** All warning signs of sich-s1 found, verdict right: every criterion met without help. */
export const s1Right = { type: 'mock-site', marked: ['m-from', 'm-subject', 'm-greeting', 'm-link', 'w-url', 'w-fields'], verdict: 'phishing' };
/** Link and address missed. */
export const s1MissLink = { type: 'mock-site', marked: ['m-from', 'm-subject', 'm-greeting', 'w-fields'], verdict: 'phishing' };

// --- Scripted agent -----------------------------------------------------------------------------------

export interface Turn {
  req: AgentRequest;
  /** Results of the previous turn's tools, parsed where JSON */
  results: { content: unknown; isError: boolean }[];
  /** The parsed result of get_learner_state, once called */
  state: LearnerStateLike | undefined;
}

export interface LearnerStateLike {
  activeRecords: { id: string; kind: string; criterion?: string }[];
  lastResults: { eventId: string; met: string[]; missed: string[] }[];
  map: { nodeId: string; lessonId: string; state: string }[];
  rulePlan: { nodeId: string; alternativeNodeId?: string } | null;
  trackNodeId: string;
  dccLevel: string;
}

const parse = (s: string) => {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
};

function turnOf(req: AgentRequest): Turn {
  const users = req.messages.filter((m) => m.role === 'user' && Array.isArray(m.content));
  const blocks = (m: (typeof users)[number]) => (m.content as AgentBlock[]).filter((b): b is Extract<AgentBlock, { type: 'tool_result' }> => b.type === 'tool_result');
  const last = users.at(-1);
  const results = last ? blocks(last).map((b) => ({ content: parse(b.content), isError: Boolean(b.is_error) })) : [];
  const state = users.flatMap(blocks).map((b) => parse(b.content)).find((c) => c && typeof c === 'object' && 'rulePlan' in c) as LearnerStateLike | undefined;
  return { req, results, state };
}

let n = 0;
export const use = (name: string, input: Record<string, unknown>): AgentBlock => ({ type: 'tool_use', id: `tu-${++n}`, name, input });

/** Agent handler that plays the given steps in order, one per model call. */
export function scripted(steps: ((t: Turn) => AgentBlock[])[], seen?: AgentRequest[]) {
  return (req: AgentRequest) => {
    seen?.push(req);
    const step = req.messages.filter((m) => m.role === 'assistant').length;
    const fn = steps[Math.min(step, steps.length - 1)];
    return fn(turnOf(req));
  };
}

/** A valid generated mock-site lesson for "Linkziel", as the model would answer. */
export function mockSiteJson(overrides: { domain?: string } = {}) {
  const d = overrides.domain ?? 'kundenportal-muster.example';
  return JSON.stringify({
    title: 'Kundenmail mit Link prüfen',
    intro: 'Prüfe, wohin der Link in der Kundenmail wirklich führt.',
    durationMin: 3,
    transfer: 'Fahre bei jeder Mail mit Link zuerst über den Link und lies das Ziel.',
    primarySourceUrl: 'https://www.bacs.admin.ch/de/phishing-de',
    content: {
      disclaimer: 'Übungsbeispiel mit erfundener Firma «Kundenportal Muster» und Adressen auf .example. Alles ist erfunden.',
      mail: [
        { id: 'm-from', kind: 'from', text: `Kundenportal Muster <service@${d}>`, harmless: 'Die Domain passt zur Firma.' },
        { id: 'm-subject', kind: 'subject', text: 'Ihre Rechnung ist bereit', harmless: 'Ein normaler Betreff.' },
        { id: 'm-p1', kind: 'paragraph', text: 'Ihre neue Rechnung steht im Portal bereit.', harmless: 'Allein kein Hinweis.' },
        { id: 'm-link', kind: 'link', text: 'Rechnung öffnen', linkTarget: 'https://rechnung-sofort.example/login', signal: { criterion: 'link', explanation: 'Der Link führt zu «rechnung-sofort.example», nicht zum Portal.' } },
      ],
      site: [
        { id: 'w-url', kind: 'url', text: 'https://rechnung-sofort.example/login', signal: { criterion: 'adresse', explanation: 'Die Domain ist nicht die des Portals.' } },
        { id: 'w-fields', kind: 'field', text: 'Benutzername · Passwort', harmless: 'Ein Login allein ist kein Hinweis.' },
      ],
      correctVerdict: 'phishing',
      verdictExplanation: 'Link und Webseite führen auf eine fremde Domain.',
    },
  });
}
