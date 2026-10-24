// Designs a track from what the learner wants to learn ("Security+ Prüfung bestehen") with the model:
// name, 3 to 6 criteria with rules of thumb, mission suggestions, sources and the lesson types that fit.
// The server checks the design and keeps only sources whose address answers. Without a model there are no own tracks.
import type { DccLevel, LessonType, ModelCall, Track, TrackSource } from '@l45/shared';
import { CUSTOM_SKILL } from '@l45/shared';
import { LESSON_TYPES } from './generator.ts';
import { callModel, plannerModelName } from './provider.ts';
import { extractJson, newId, nowIso } from './util.ts';

export interface DesignInput {
  topic: string;
  /** Why the learner wants it; becomes the mission */
  goal?: string;
  selfLevel: DccLevel;
  timeoutMs: number;
}

export type DesignResult = { ok: true; track: Track } | { ok: false; errors: string[] };

interface RawDesign {
  error?: string;
  name?: string;
  criteria?: { id?: string; label?: string; ruleOfThumb?: string }[];
  mission?: { suggestions?: string[]; default?: string };
  sources?: { title?: string; url?: string; note?: string }[];
  lessonTypes?: string[];
}

const SYSTEM = `Du planst in einer Lern-App einen neuen Lernbereich zu einem Thema, das eine Person lernen will. Antworte NUR mit JSON, ohne Text davor oder danach.

Regeln:
- Schweizer Hochdeutsch: immer ss, nie ß. Kurze, klare Sätze.
- name: kurzer Name des Bereichs, höchstens 40 Zeichen.
- criteria: 3 bis 6 Dinge, die man für das Ziel können oder erkennen muss. Eng gefasst und in einer Übung prüfbar, vom Grundlegenden zum Anspruchsvollen. id: kurz, nur a-z, Ziffern und Bindestrich. label: höchstens 40 Zeichen. ruleOfThumb: eine Faustregel in einem Satz.
- mission: drei Vorschläge in der Ich-Form («Ich ... und will ...»), dazu ein default für Personen ohne eigene Angabe.
- sources: 2 bis 5 vertrauenswürdige Quellen, die es wirklich gibt: offizielle Stellen, die Organisation hinter einer Prüfung, Hochschulen, Standards. Keine Blogs, keine Foren. Nimm lieber eine Hauptseite als eine tiefe Unterseite, die es vielleicht nicht gibt. Nur https. note: wofür die Quelle taugt.
- lessonTypes: welche Lektionsarten zum Thema passen. video: kurze Erklärung mit Quizfragen. ai-chat: Gespräch mit einer KI als Tutor, Rollenspiel oder Auftrag an die KI. mark-evidence: eine KI-Zusammenfassung gegen eine Notiz prüfen. mock-site: eine erfundene Mail oder Webseite auf Warnzeichen prüfen, nur für Themen wie Phishing oder Betrug.
- Ist das Thema nicht lernbar, zu ungenau oder schädlich, antworte {"error":"Grund in einem Satz"}.

Format:
{"name":"...","criteria":[{"id":"...","label":"...","ruleOfThumb":"..."}],"mission":{"suggestions":["...","...","..."],"default":"..."},"sources":[{"title":"...","url":"https://...","note":"..."}],"lessonTypes":["video","ai-chat"]}`;

const LEVEL_TEXT: Record<DccLevel, string> = {
  Grundstufe: 'kein oder wenig Vorwissen',
  Mittelstufe: 'etwas Vorwissen',
  Fortgeschritten: 'viel Vorwissen',
};

const swiss = (s: unknown) => String(s ?? '').replace(/ß/g, 'ss').replace(/\s+/g, ' ').trim();
const fits = (s: string, min: number, max: number) => s.length >= min && s.length <= max;

/** Default check: the address answers. 404 and 410 mean the page does not exist; 401/403/429 often only block robots. */
async function answers(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(5000), headers: { 'user-agent': 'Lernagent-Quellenpruefung/1.0' } });
    await res.body?.cancel().catch(() => {});
    return res.status < 500 && res.status !== 404 && res.status !== 410;
  } catch {
    return false;
  }
}

let checkSource: (url: string) => Promise<boolean> = answers;
/** Test hook: replaces the check whether a source address answers. null = the real check. */
export function setSourceCheck(fn: typeof checkSource | null) {
  checkSource = fn ?? answers;
}

/** Problems with a design, or the track it describes (without the sources check). */
export function checkDesign(raw: RawDesign | null, input: Pick<DesignInput, 'topic' | 'selfLevel'>): { errors: string[]; track?: Track } {
  if (!raw) return { errors: ['Antwort ist kein JSON'] };
  if (raw.error) return { errors: [swiss(raw.error)] };
  const e: string[] = [];
  const name = swiss(raw.name);
  if (!fits(name, 3, 40)) e.push('name braucht 3 bis 40 Zeichen');

  const criteria = (Array.isArray(raw.criteria) ? raw.criteria : []).map((c) => ({
    id: String(c?.id ?? '').trim().toLowerCase(),
    label: swiss(c?.label),
    ruleOfThumb: swiss(c?.ruleOfThumb),
  }));
  if (criteria.length < 3 || criteria.length > 6) e.push('3 bis 6 Kriterien nötig');
  const ids = new Set<string>();
  for (const c of criteria) {
    // «entscheid» is the verdict of a mock-site lesson, not a criterion of a track.
    if (!/^[a-z][a-z0-9-]{1,23}$/.test(c.id) || c.id === 'entscheid') e.push(`Kriterium «${c.id}»: id nur a-z, Ziffern und Bindestrich, 2 bis 24 Zeichen`);
    else if (ids.has(c.id)) e.push(`Kriterium «${c.id}» doppelt`);
    ids.add(c.id);
    if (!fits(c.label, 2, 60)) e.push(`Kriterium «${c.id}»: label fehlt oder ist zu lang`);
    if (!fits(c.ruleOfThumb, 5, 240)) e.push(`Kriterium «${c.id}»: Faustregel fehlt oder ist zu lang`);
  }

  const suggestions = (Array.isArray(raw.mission?.suggestions) ? raw.mission.suggestions : []).map(swiss).filter((x) => fits(x, 3, 300)).slice(0, 3);
  const fallback = swiss(raw.mission?.default);

  const seen = new Set<string>();
  const sources: TrackSource[] = [];
  for (const x of Array.isArray(raw.sources) ? raw.sources : []) {
    const url = String(x?.url ?? '').trim();
    if (!/^https:\/\/[^\s/]+\.[^\s/]+(\/\S*)?$/.test(url) || seen.has(url)) continue;
    seen.add(url);
    sources.push({ title: swiss(x?.title).slice(0, 120) || url, url, note: swiss(x?.note).slice(0, 300) });
  }
  if (!sources.length) e.push('keine Quelle mit https-Adresse');

  const lessonTypes = [...new Set((Array.isArray(raw.lessonTypes) ? raw.lessonTypes : []).filter((t): t is LessonType => (LESSON_TYPES as string[]).includes(t)))];
  if (e.length) return { errors: e };

  const track: Track = {
    id: newId('u'),
    skillId: CUSTOM_SKILL.id,
    name,
    criteria,
    mission: { suggestions, default: fits(fallback, 3, 300) ? fallback : `Ich will «${name}» lernen.` },
    custom: {
      topic: input.topic,
      createdAt: nowIso(),
      model: plannerModelName(),
      selfLevel: input.selfLevel,
      sources: sources.slice(0, 5),
      lessonTypes: lessonTypes.length ? lessonTypes : ['video', 'ai-chat'],
    },
  };
  return { errors: [], track };
}

export async function designTrack(input: DesignInput, onCall: (c: ModelCall) => void): Promise<DesignResult> {
  const user = [
    `Thema: ${input.topic}`,
    input.goal ? `Wofür die Person es braucht: ${input.goal}` : '',
    `Vorwissen (Selbsteinschätzung): ${LEVEL_TEXT[input.selfLevel]}`,
  ].filter(Boolean).join('\n');
  const reply = await callModel({ purpose: 'design', system: SYSTEM, messages: [{ role: 'user', content: user }], maxTokens: 2000, timeoutMs: input.timeoutMs, planner: true });
  onCall(reply.call);
  if (!reply.ok) return { ok: false, errors: [`Modell: ${reply.error}`] };
  const { errors, track } = checkDesign(extractJson<RawDesign>(reply.text), input);
  if (!track) {
    console.warn(`Bereich «${input.topic}» verworfen: ${errors.join('; ')}`);
    return { ok: false, errors };
  }
  // Models invent addresses. Only sources that answer are kept.
  const custom = track.custom!;
  const ok = await Promise.all(custom.sources.map((s) => checkSource(s.url)));
  custom.sources = custom.sources.filter((_, i) => ok[i]);
  if (!custom.sources.length) return { ok: false, errors: ['Keine der vorgeschlagenen Quellen war erreichbar'] };
  return { ok: true, track };
}
