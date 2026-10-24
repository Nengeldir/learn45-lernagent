// Generates one lesson with the model, using only the existing lesson types. The model fills content into
// the schema; the server sets ids, targets, labels and provenance, shuffles quiz answers and validates.
import { randomInt } from 'node:crypto';
import type { DccLevel, Lesson, LessonType, ModelCall, Track } from '@l45/shared';
import { DCC_LEVELS } from '@l45/shared';
import { keywordPatterns } from './agent.ts';
import { slug } from './md.ts';
import { callModel } from './provider.ts';
import { speechUnavailable } from './video/speech.ts';
import { sourcesOf } from './resources.ts';
import { extractJson, nowIso } from './util.ts';
import { validateLesson } from './validate.ts';

export const LESSON_TYPES: LessonType[] = ['video', 'mark-evidence', 'mock-site', 'ai-chat'];
/** Types a learner can choose for any topic. A podcast needs only criteria and sources, so it fits every track;
 *  the planner keeps to LESSON_TYPES and the track's own types, so only learners ask for podcasts. */
export const typesFor = (track: Track): LessonType[] => {
  const types = track.custom?.lessonTypes ?? LESSON_TYPES;
  // Older own tracks may only offer audio. Keep a conversation available without a speech service.
  return [...new Set([...types, ...(types.every(t => speechUnavailable(t)) ? ['ai-chat' as const] : []), 'podcast' as const])];
};
/** At most this many lessons per session come from the model (agent, rules and new tracks together). */
export const GENERATED_PER_SESSION = 10;

export interface GenerateInput {
  type: LessonType;
  /** A track of this learner: prepared, or their own with its own sources */
  track: Track;
  criterion: string;
  level: DccLevel;
  /** From the planner: what the example should be about, tied to the mission */
  contextHint?: string;
  /** Mixed review: further criteria of the same track to bring back */
  reviewOf?: string[];
  /** The exam on the peak of a mountain: one task per criterion, on a new example */
  exam?: boolean;
  mission: string;
  preferences: string[];
  basedOn: string[];
  sessionNo: number;
  timeoutMs: number;
  /** Validator errors of a rejected earlier draft, so a second attempt can fix them */
  previousErrors?: string[];
}

/** `rejected`: the model answered, but its lesson was not valid. Worth one more attempt with the errors. */
export type GenerateResult = { ok: true; lesson: Lesson } | { ok: false; errors: string[]; rejected?: true };

const SCHEMAS: Record<LessonType, string> = {
  video: `{"scenes":[{"caption":"Ein Satz, der erklärt","visual":"steps","items":["Stichwort","Stichwort","Stichwort"],"seconds":7}],
 "questions":[{"afterScene":0,"prompt":"Frage","options":["Antwort A","Antwort B","Antwort C"],"correct":0,"explanation":"Warum","criterion":"<kriterium-id>"}]}
Regeln: 2 bis 3 Szenen. visual ist immer "steps" (2 bis 4 Stichworte) oder "url-parts" (items genau: Schema, Vorsatz, Domain, Endung, Pfad, z. B. ["https://","login.","beispiel-shop",".example","/konto"]).
1 Frage pro Kriterium. Alle Antworten einer Frage sind gleich lang: gleich viele Wörter, höchstens 2 Wörter Unterschied. Die erste Antwort ist die richtige (correct: 0); der Server mischt die Reihenfolge.`,
  'mark-evidence': `{"noteTitle":"Titel der Notiz","note":["Zeile der Quelle","..."],
 "summary":[{"id":"s1","text":"Satz der KI-Zusammenfassung","verdict":"belegt","explanation":"Steht so in der Notiz."},
            {"id":"s2","text":"Satz mit erfundener Angabe","verdict":"erfunden","criterion":"<kriterium-id>","explanation":"Warum nicht belegt","hint":"Rückfrage ohne Lösung","correction":"Was korrekt wäre"}]}
Regeln: Notiz 3 bis 5 Zeilen, Zusammenfassung 3 bis 4 Sätze, davon 1 oder 2 erfunden, jeweils mit criterion.`,
  'mock-site': `{"disclaimer":"Übungsbeispiel mit erfundener Marke «...» und Adressen auf .example. Alles ist erfunden.",
 "mail":[{"id":"m-from","kind":"from","text":"Name <adresse@domain.example>","signal":{"criterion":"<kriterium-id>","explanation":"Warum verdächtig"}},
         {"id":"m-p1","kind":"paragraph","text":"...","harmless":"Warum harmlos"},
         {"id":"m-link","kind":"link","text":"Linktext","linkTarget":"https://...example/..."}],
 "site":[{"id":"w-url","kind":"url","text":"https://...example/..."},{"id":"w-fields","kind":"field","text":"Feld · Feld"}],
 "correctVerdict":"phishing","verdictExplanation":"..."}
kind ist eines von: from, subject, greeting, paragraph, link, signature, url, logo, heading, field, button, footer.
Regeln: nur erfundene Marken, nur Adressen auf .example, keine echten Firmen. Bei "phishing" hat mindestens ein Teil ein signal, bei "echt" keiner. 4 bis 6 Teile in der Mail, 3 bis 5 auf der Seite.`,
  'ai-chat': `{"kind":"tutor","goal":"Was die Person am Schluss kann","aiRole":"Wen die KI spielt und wie sie sich verhält","opening":"Erste Nachricht der KI",
 "material":{"title":"Erfundenes Material","lines":["..."]},
 "criteria":[{"id":"<kriterium-id>","label":"Name","hint":"Hinweis, falls es fehlt"}],
 "fallbackReplies":["Antwort ohne Modell 1","2","3"],"minTurns":3}
kind ist tutor (stellt Fragen), roleplay (spielt eine Rolle) oder prompt-lab (führt Aufträge wörtlich aus). material ist freiwillig.`,
  podcast: `{"lines":[{"speaker":"a","text":"Frage oder Überleitung"},{"speaker":"b","text":"Erklärung mit Beispiel"}],
 "questions":[{"prompt":"Frage","options":["Antwort A","Antwort B","Antwort C"],"correct":0,"explanation":"Warum","criterion":"<kriterium-id>"}]}
Regeln: Ein Gespräch zwischen Mira (speaker "a", stellt die Fragen, die sich Lernende stellen) und Jonas (speaker "b", erklärt mit einem konkreten Beispiel).
Gesprochene Sprache: kurze Sätze, keine Aufzählungen, keine Klammern, keine Abkürzungen, keine Adressen. Beide sprechen die zuhörende Person mit du an.
8 bis 14 Beiträge, zusammen höchstens 2500 Zeichen (etwa zwei Minuten), jeder Beitrag höchstens drei Sätze. Schluss: die Faustregel in einem Satz.
Danach 2 bis 3 Fragen zum Gehörten. Alle Antworten einer Frage sind gleich lang: gleich viele Wörter, höchstens 2 Wörter Unterschied. Die erste Antwort ist die richtige (correct: 0); der Server mischt die Reihenfolge.`,
};

const swiss = <T,>(x: T): T => JSON.parse(JSON.stringify(x).replace(/ß/g, 'ss')) as T;

function shuffle<T>(xs: T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Moves the right answer to a random place, and to a different place in each question. */
export function shuffleQuiz<Q extends { options: string[]; correct: number }>(questions: Q[]): Q[] {
  const offset = randomInt(12);
  return questions.map((q, i) => {
    if (!Array.isArray(q.options) || q.options.length < 2 || !q.options[q.correct]) return q;
    const target = (offset + i) % q.options.length;
    const others = shuffle(q.options.filter((_, k) => k !== q.correct));
    others.splice(target, 0, q.options[q.correct]);
    return { ...q, options: others, correct: target };
  });
}

export async function generateLesson(input: GenerateInput, onCall: (c: ModelCall) => void): Promise<GenerateResult> {
  const { track } = input;
  const unavailable = speechUnavailable(input.type);
  if (unavailable) return { ok: false, errors: [unavailable] };
  const types = typesFor(track);
  if (!types.includes(input.type)) return { ok: false, errors: [`Typ muss in diesem Bereich einer von ${types.join(', ')} sein`] };
  if (!DCC_LEVELS.includes(input.level)) return { ok: false, errors: ['level muss Grundstufe, Mittelstufe oder Fortgeschritten sein'] };
  const targets = [...new Set([input.criterion, ...(input.reviewOf ?? [])])];
  const unknown = targets.filter((t) => !track.criteria.some((c) => c.id === t));
  if (unknown.length) return { ok: false, errors: [`unbekannte Kriterien: ${unknown.join(', ')}`] };
  const sources = sourcesOf(track);
  if (!sources.length) return { ok: false, errors: ['Für diesen Bereich gibt es keine geprüften Quellen'] };
  const review = targets.length > 1;

  const system = [
    'Du schreibst eine kurze Lektion für eine Lern-App. Antworte NUR mit JSON, ohne Text davor oder danach.',
    'Regeln:',
    '- Schweizer Hochdeutsch: immer ss, nie ß. Duze die Person. Kurze, klare Sätze.',
    '- Höchstens 5 Minuten, genau ein Lernziel, ein konkreter Erfolg am Schluss.',
    '- Wissen leicht halten, Übung darf fordern.',
    '- Das Beispiel passt zur Mission der Person. Alle Namen, Firmen, Adressen und Zahlen im Beispiel sind erfunden.',
    '- Nutze nur die genannten Quellen, Kriterien und Faustregeln. Kein eigenes Wissen darüber hinaus.',
    '- Wähle genau eine Primärquelle aus der Liste (primarySourceUrl).',
  ].join('\n');
  const user = [
    `Bereich: ${track.name}`,
    `Lektionsart: ${input.type}`,
    `Stufe der Lektion: ${input.level}`,
    input.exam
      ? 'Gipfelprüfung: Die Person hat auf diesem Berg fünf Lektionen zu diesen Kriterien geschafft. Prüfe jedes Kriterium mit einer eigenen Aufgabe, an einem neuen Beispiel. Der Rückblick bleibt kurz, der Schwerpunkt liegt auf den Aufgaben. Der Titel beginnt mit «Gipfelprüfung:». Kriterien:'
      : review ? `Gemischte Wiederholung (Abrufen aus dem Gedächtnis), Kriterien:` : 'Lernziel (Kriterium):',
    ...targets.map((id) => {
      const c = track.criteria.find((x) => x.id === id)!;
      return `- ${c.id}: ${c.label}. Faustregel: ${c.ruleOfThumb}`;
    }),
    `Mission der Person: ${input.mission}`,
    input.contextHint ? `Hinweis zum Beispiel: ${input.contextHint}` : '',
    input.preferences.length ? `Vorlieben: ${input.preferences.join('; ')}` : '',
    'Quellen:',
    ...sources.map((s) => `- ${s.title} (${s.url}): ${s.note}`),
    '',
    'Antwortformat:',
    '{"title":"höchstens 60 Zeichen","intro":"Ein Satz: was die Person tut","durationMin":3,"transfer":"Ein Satz für die Arbeit","primarySourceUrl":"<url aus der Liste>","content":<siehe unten>}',
    'content für diese Lektionsart:',
    SCHEMAS[input.type],
    `Kriterium-IDs genau übernehmen, nie übersetzen oder umbenennen: ${targets.join(', ')}.`,
    input.previousErrors?.length ? `\nDein letzter Entwurf wurde abgelehnt. Behebe genau diese Punkte:\n${input.previousErrors.map((e) => `- ${e}`).join('\n')}` : '',
  ].filter(Boolean).join('\n');

  const reply = await callModel({ purpose: 'generate', system, messages: [{ role: 'user', content: user }], maxTokens: 3000, timeoutMs: input.timeoutMs, planner: true });
  onCall(reply.call);
  if (!reply.ok) return { ok: false, errors: [`Modell: ${reply.error}`] };
  const raw = extractJson<{ title?: string; intro?: string; durationMin?: number; transfer?: string; primarySourceUrl?: string; content?: Record<string, unknown> }>(reply.text);
  if (!raw?.content) {
    console.warn(`Erzeugte Lektion verworfen (${track.id}, ${input.type}): Antwort ist kein JSON mit content`);
    return { ok: false, errors: ['Antwort ist kein JSON mit content'], rejected: true };
  }

  const source = sources.find((s) => s.url === raw.primarySourceUrl);
  const title = String(raw.title ?? '').trim();
  let content = swiss(raw.content) as Record<string, unknown>;
  if (input.type === 'video' && Array.isArray(content.questions)) {
    content = { scenes: content.scenes, questions: shuffleQuiz(content.questions as { options: string[]; correct: number }[]) };
  }
  if (input.type === 'podcast' && Array.isArray(content.questions)) {
    content = { lines: content.lines, questions: shuffleQuiz(content.questions as { options: string[]; correct: number }[]) };
  }
  if (input.type === 'ai-chat' && Array.isArray(content.criteria)) {
    // The app owns assessment IDs, labels and keyword patterns. Free models sometimes translate IDs
    // (e.g. "offen" to "openPoints"); this must not discard an otherwise usable conversation.
    const drafts = (content.criteria as { id?: string; hint?: string }[]).filter(c => c && typeof c === 'object');
    if (drafts.length) content = {
      ...content,
      criteria: targets.map(id => {
        const tc = track.criteria.find(c => c.id === id)!;
        const draft = drafts.find(c => c.id === id) ?? (targets.length === 1 && drafts.length === 1 ? drafts[0] : undefined);
        return { id, label: tc.label, hint: typeof draft?.hint === 'string' ? draft.hint : tc.ruleOfThumb, patterns: keywordPatterns(`${tc.label} ${tc.ruleOfThumb}`) };
      }),
    };
  }
  const lesson = swiss({
    id: `ki-${track.id.replace(/^t-/, '')}-${slug(title || input.criterion)}-${randomInt(1e6).toString(36)}`,
    trackId: track.id,
    type: input.type,
    level: input.level,
    title,
    intro: String(raw.intro ?? ''),
    durationMin: Number(raw.durationMin),
    mode: input.type === 'ai-chat' ? 'ai' : 'alone',
    targets,
    transfer: raw.transfer ? String(raw.transfer) : undefined,
    source: 'model',
    primarySource: source ? { title: source.title, url: source.url } : { title: 'unbekannt', url: String(raw.primarySourceUrl ?? '') },
    provenance: {
      by: 'model',
      model: reply.model,
      at: nowIso(),
      basedOn: input.basedOn,
      sessionNo: input.sessionNo,
      ...(review ? { reviewOf: targets } : {}),
      ...(input.exam ? { exam: true as const } : {}),
    },
    content,
  }) as Lesson;

  const errors = validateLesson(lesson, { track, sourceUrls: sources.map((s) => s.url) });
  if (errors.length) {
    console.warn(`Erzeugte Lektion verworfen (${track.id}, ${input.type}): ${errors.join('; ')}`);
    return { ok: false, errors, rejected: true };
  }
  return { ok: true, lesson };
}
