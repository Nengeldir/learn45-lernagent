// The podcast script: two hosts talk through one track. The model writes it from the track's criteria, sources and
// lessons only; without a model the rules put a plainer one together from the same material.
import type { Lesson, ModelCall, PodcastLine, PodcastSpeaker, Track, TrackSource } from '@l45/shared';
import { callModel } from '../provider.ts';
import { extractJson } from '../util.ts';

export const HOSTS: Record<PodcastSpeaker, string> = { a: 'Mira', b: 'Jonas' };
/** Bounds the paid speech per podcast: about three to four minutes. */
const MAX_LINES = 24, MAX_LINE = 500, MAX_TOTAL = 5000;
const SCRIPT_TIMEOUT_MS = 60000;

export interface PodcastInput {
  track: Track;
  mission?: string;
  sources: TrackSource[];
  /** The learner's lessons of this track on the map */
  lessons: Lesson[];
}
export interface PodcastScript { by: 'model' | 'rule'; lines: PodcastLine[] }

const swiss = (text: string) => text.replace(/ß/g, 'ss').replace(/\s+/g, ' ').trim();

/** What the hosts may talk about. No quiz solutions: the podcast must not give away the lessons. */
export function material(input: PodcastInput) {
  return {
    track: input.track.name,
    mission: input.mission,
    criteria: input.track.criteria.map((c) => ({ label: c.label, ruleOfThumb: c.ruleOfThumb })),
    sources: input.sources.map((s) => ({ title: s.title, note: s.note })),
    lessons: input.lessons.map((l) => ({ title: l.title, intro: l.intro, transfer: l.transfer })),
  };
}

/** Accepts a script only if it fits the speech budget and both hosts speak. */
export function parseScript(raw: unknown): PodcastLine[] | null {
  const lines = (raw as { lines?: unknown })?.lines;
  if (!Array.isArray(lines) || lines.length < 6 || lines.length > MAX_LINES) return null;
  const out: PodcastLine[] = [];
  for (const line of lines as { speaker?: unknown; text?: unknown }[]) {
    if ((line?.speaker !== 'a' && line?.speaker !== 'b') || typeof line.text !== 'string') return null;
    const text = swiss(line.text);
    if (!text || text.length > MAX_LINE) return null;
    out.push({ speaker: line.speaker, text });
  }
  if (!out.some((l) => l.speaker === 'a') || !out.some((l) => l.speaker === 'b')) return null;
  if (out.reduce((n, l) => n + l.text.length, 0) > MAX_TOTAL) return null;
  return out;
}

export async function modelScript(input: PodcastInput, onCall: (c: ModelCall) => void): Promise<PodcastScript | null> {
  const m = material(input);
  const system = [
    'Du schreibst das Skript für einen kurzen Podcast in einer Lern-App. Zwei Moderierende sprechen über einen Lernbereich. Antworte NUR mit JSON, ohne Text davor oder danach.',
    'Regeln:',
    '- Schweizer Hochdeutsch: immer ss, nie ß. Gesprochene Sprache: kurze Sätze, keine Aufzählungen, keine Klammern, keine Abkürzungen, keine Adressen.',
    `- ${HOSTS.a} (speaker "a") führt durch das Gespräch und stellt die Fragen, die sich Lernende stellen. ${HOSTS.b} (speaker "b") erklärt mit konkreten Beispielen.`,
    '- Beide sprechen die zuhörende Person mit du an.',
    '- Nutze nur die genannten Kriterien, Faustregeln, Quellen und Lektionen. Kein Wissen darüber hinaus, keine Zahlen, Studien oder Zitate.',
    '- Beispiele passen zur Mission der Person. Namen, Firmen und Adressen darin sind erfunden.',
    '- Verrate keine Lösungen der Lektionen. Nenne Lektionen höchstens als Übungsmöglichkeit.',
    '- 12 bis 20 Beiträge, zusammen höchstens 3500 Zeichen (etwa drei Minuten). Jeder Beitrag höchstens drei Sätze.',
    '- Schluss: die wichtigste Faustregel in einem Satz und ein Vorschlag, was die Person als Nächstes übt.',
  ].join('\n');
  const user = [
    `Bereich: ${m.track}`,
    m.mission ? `Mission der Person: ${m.mission}` : '',
    'Kriterien mit Faustregel:',
    ...m.criteria.map((c) => `- ${c.label}: ${c.ruleOfThumb}`),
    m.sources.length ? 'Quellen:' : '',
    ...m.sources.map((s) => `- ${s.title}: ${s.note}`),
    m.lessons.length ? 'Lektionen auf der Karte der Person:' : '',
    ...m.lessons.map((l) => `- ${l.title}: ${l.intro}${l.transfer ? ` Transfer: ${l.transfer}` : ''}`),
    '',
    'Antwortformat:',
    '{"lines":[{"speaker":"a","text":"..."},{"speaker":"b","text":"..."}]}',
  ].filter(Boolean).join('\n');
  const reply = await callModel({ purpose: 'podcast', system, messages: [{ role: 'user', content: user }], maxTokens: 3000, timeoutMs: SCRIPT_TIMEOUT_MS, planner: true });
  onCall(reply.call);
  if (!reply.ok) return null;
  const lines = parseScript(extractJson(reply.text));
  if (!lines) console.warn(`Podcast-Skript verworfen (${input.track.id}): Format oder Länge passt nicht.`);
  return lines && { by: 'model', lines };
}

/** Without a model: the criteria with their rules of thumb, then where to practise them. */
export function ruleScript(input: PodcastInput): PodcastScript {
  const { track, mission, lessons } = input;
  const a = (text: string): PodcastLine => ({ speaker: 'a', text: swiss(text) });
  const b = (text: string): PodcastLine => ({ speaker: 'b', text: swiss(text) });
  const titles = lessons.slice(0, 3).map((l) => `«${l.title}»`);
  return {
    by: 'rule',
    lines: [
      a(`Willkommen zum Podcast über «${track.name}». Ich bin ${HOSTS.a}.`),
      b(`Und ich bin ${HOSTS.b}. Wir gehen kurz durch, worauf es in diesem Bereich ankommt.`),
      ...(mission ? [a(`Deine Mission hier lautet: «${mission}». Behalte sie im Kopf, während wir reden.`)] : []),
      ...track.criteria.slice(0, 6).flatMap((c, i) => [
        a(`${i === 0 ? 'Erster Punkt' : 'Nächster Punkt'}: ${c.label}. Worauf achte ich da?`),
        b(`Die Faustregel lautet: ${c.ruleOfThumb}`),
      ]),
      ...(titles.length ? [a('Und wo kann ich das üben?'), b(`Auf deiner Karte, zum Beispiel mit ${titles.length > 1 ? `${titles.slice(0, -1).join(', ')} und ${titles.at(-1)}` : titles[0]}.`)] : []),
      a(`Danke, ${HOSTS.b}. Das war der Überblick zu «${track.name}».`),
      b('Bis zum nächsten Mal, und viel Erfolg beim Üben.'),
    ],
  };
}
