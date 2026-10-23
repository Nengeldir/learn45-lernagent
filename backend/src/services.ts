// Model-backed services, each with a prepared fallback. Only the lesson material and the learner's
// own messages are sent; never the name or the DCC profile.
import type { AiChatLesson, ChatTurn, CriterionResult, LessonResult, MarkEvidenceLesson, MockSiteLesson, ModelCall, Source } from '@l45/shared';
import { chatResult, judgeChatKeywords, learnerText } from './judge.ts';
import { callModel } from './provider.ts';
import { extractJson } from './util.ts';

const STYLE = 'Schreibe in Schweizer Hochdeutsch ohne ß (immer ss), duze die Person, höchstens drei kurze Sätze.';

export interface Opts {
  offline: boolean;
  onCall: (c: ModelCall) => void;
}

// --- Chat lessons ---------------------------------------------------------------------------

export async function chatReply(lesson: AiChatLesson, turns: ChatTurn[], opts: Opts): Promise<{ text: string; source: Source }> {
  const learnerTurns = turns.filter((t) => t.role === 'learner').length;
  const replies = lesson.content.fallbackReplies;
  const fallback = { text: replies[Math.min(Math.max(learnerTurns - 1, 0), replies.length - 1)], source: 'prepared' as Source };
  if (opts.offline) return fallback;

  const c = lesson.content;
  const system = [
    c.aiRole,
    `Ziel der Person: ${c.goal}`,
    c.material ? `Material (erfunden), das die Person sieht:\n${c.material.title}\n${c.material.lines.join('\n')}` : '',
    'Regeln:',
    `- ${STYLE}`,
    '- Stelle höchstens eine Frage pro Antwort.',
    c.kind === 'prompt-lab'
      ? '- Wenn die Person einen Auftrag schreibt: Führe ihn wörtlich aus. Wo der Auftrag etwas offen lässt, fülle die Lücke sichtbar mit einer plausiblen Annahme und markiere sie mit [Annahme]. Frag danach, was sie am Auftrag verbessern möchte.'
      : '- Verrate keine fertige Lösung. Hilf mit Rückfragen, damit die Person selbst darauf kommt.',
    `- Nach ${c.minTurns} Antworten der Person: Fasse kurz zusammen und sag, dass sie die Lektion abschliessen kann.`,
  ].filter(Boolean).join('\n');
  const messages = [
    { role: 'user' as const, content: '(Gesprächsbeginn)' },
    { role: 'assistant' as const, content: c.opening },
    ...turns.map((t) => ({ role: t.role === 'ai' ? ('assistant' as const) : ('user' as const), content: t.text })),
  ];
  const reply = await callModel({ purpose: 'chat', system, messages, maxTokens: c.kind === 'prompt-lab' ? 600 : 250 });
  opts.onCall(reply.call);
  if (!reply.ok || reply.text.trim().length > 2000) return fallback;
  return { text: reply.text.trim(), source: 'model' };
}

export async function judgeChat(lesson: AiChatLesson, turns: ChatTurn[], opts: Opts): Promise<LessonResult> {
  const text = learnerText(turns);
  if (opts.offline || !text.trim()) return judgeChatKeywords(lesson, turns);
  const system = [
    'Du beurteilst in einer Lern-App, was eine Person in einem Übungsgespräch geschrieben hat.',
    'Ein Kriterium ist nur erfüllt, wenn die Person es selbst ausdrücklich geschrieben hat (nicht die KI).',
    `Begründe jedes Urteil in einem kurzen Satz. Schweizer Hochdeutsch ohne ß.`,
    'Antworte NUR mit JSON: {"criteria":[{"id":"...","met":true,"reason":"..."}]}',
  ].join('\n');
  const user = [
    `Ziel: ${lesson.content.goal}`,
    'Kriterien:',
    ...lesson.content.criteria.map((c) => `- ${c.id}: ${c.label} (${c.hint})`),
    'Gesprächsverlauf:',
    ...turns.map((t) => `${t.role === 'ai' ? 'KI' : 'Person'}: ${t.text}`),
  ].join('\n');
  const reply = await callModel({ purpose: 'judge', system, messages: [{ role: 'user', content: user }], maxTokens: 500 });
  opts.onCall(reply.call);
  if (!reply.ok) return judgeChatKeywords(lesson, turns);
  const parsed = extractJson<{ criteria?: { id: string; met: boolean; reason?: string }[] }>(reply.text);
  const byId = new Map((parsed?.criteria ?? []).map((c) => [c.id, c]));
  if (!lesson.content.criteria.every((c) => typeof byId.get(c.id)?.met === 'boolean')) return judgeChatKeywords(lesson, turns);
  const criteria: CriterionResult[] = lesson.content.criteria.map((c) => ({
    key: c.id,
    label: c.label,
    status: byId.get(c.id)!.met ? 'met' : 'missed',
    note: (byId.get(c.id)!.reason ?? '').slice(0, 240),
  }));
  return chatResult(lesson, criteria, 'model');
}

// --- Hints after a first mistake (R6) -----------------------------------------------------------

const MOCK_HINTS: Record<string, string> = {
  absender: 'Schau dir die Adresse nach dem @ genau an. Gehört sie wirklich zur Firma?',
  druck: 'Was soll der Betreff bei dir auslösen?',
  anrede: 'Wie spricht dich eine Firma an, bei der du Kundin bist?',
  link: 'Wohin führt der Link wirklich? Zeig dir das Linkziel an.',
  adresse: 'Welcher Teil der Webadresse steht direkt vor der Endung?',
  daten: 'Welche Daten würde eine seriöse Firma nie über einen Link abfragen?',
};

export async function hintMarkEvidence(lesson: MarkEvidenceLesson, marks: Record<string, string>, opts: Opts): Promise<{ text: string; source: Source }> {
  const missed = lesson.content.summary.find((s) => s.verdict === 'erfunden' && marks[s.id] !== 'erfunden');
  const wrong = lesson.content.summary.find((s) => s.verdict === 'belegt' && marks[s.id] === 'erfunden');
  if (!missed) {
    return { text: wrong ? `Lies «${wrong.text}» noch einmal neben der Notiz. Steht es vielleicht doch so dort?` : 'Deine Markierungen stimmen.', source: 'prepared' };
  }
  const fallback = { text: missed.hint ?? 'Lies jeden Satz Wort für Wort und such die Stelle in der Notiz.', source: 'prepared' as Source };
  if (opts.offline) return fallback;
  const reply = await callModel({
    purpose: 'hint',
    system: `Du hilfst beim Prüfen einer KI-Zusammenfassung. Stelle genau EINE kurze Rückfrage, die zum genannten Satz führt, ohne zu verraten, was falsch ist. ${STYLE} Nur die Frage.`,
    messages: [{ role: 'user', content: `Notiz: ${lesson.content.note.join(' ')}\nZusammenfassung: ${lesson.content.summary.map((s) => s.text).join(' ')}\nSatz: ${missed.text}` }],
    maxTokens: 100,
  });
  opts.onCall(reply.call);
  const text = reply.ok ? reply.text.trim().replace(/^["«»„“]+|["«»„“]+$/g, '') : '';
  if (!text || text.length > 240 || (missed.correction && text.includes(missed.correction))) return fallback;
  return { text, source: 'model' };
}

export function hintMockSite(lesson: MockSiteLesson, marked: string[]): { text: string; source: Source } {
  const all = [...(lesson.content.mail ?? []), ...lesson.content.site];
  const missing = all.find((p) => p.signal && !marked.includes(p.id));
  if (missing?.signal) return { text: MOCK_HINTS[missing.signal.criterion] ?? 'Schau dir Absender und Linkziel noch einmal an.', source: 'prepared' };
  if (lesson.content.correctVerdict === 'echt') return { text: 'Prüf Absender, Linkziel und Webadresse: Passen sie zur echten Domain? Hast du das selbst angefordert?', source: 'prepared' };
  return { text: 'Du hast alle Warnzeichen gefunden. Prüfe noch deinen Entscheid.', source: 'prepared' };
}
