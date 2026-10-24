// Eule, the learning companion. Talks through OVHcloud's anonymous Qwen tier: no API key.
import { HttpError } from './sessions.ts';

import { callFreeAi, freeReply, FreeAiError } from './freeAi.ts';

export type OwlLang = 'de' | 'en' | 'fr' | 'it' | 'rm';

const LANG_NAME: Record<OwlLang, string> = {
  de: 'Deutsch',
  en: 'English',
  fr: 'Français',
  it: 'Italiano',
  rm: 'Rumantsch',
};

const MENTOR = [
  'Du bist der Mentor. In einem Gespräch übernimmst du alles: den Weg durch die Website, das Erklären und den nächsten Lernschritt.',
  'Wenn die Person nicht weiterweiss, sagst du, welchen Knopf sie drückt.',
  'Wenn die Person etwas lernen will, erklärst du es einfach, gibst ein kurzes Beispiel und stellst eine kleine Frage.',
  'Du bist ruhig und ermutigend. Du nennst einen kleinen nächsten Schritt.',
  'Du erfindest keine Menüs, änderst nichts selbst und markierst keine Lektion als geschafft.',
  'Die ganze Antwort ist in genau einer Sprache. Kein Wort und kein Name aus einer anderen Sprache.',
].join(' ');

const LABELS: Record<OwlLang, string> = {
  de: 'Beschriftungen nur auf Deutsch: «Was möchtest du lernen?», «Digitale Kompetenz», «Mathematik», «Naturwissenschaften», «Eigene Themen», «Wie geht es weiter?», «Empfohlen», «Bereich hinzufügen», «Los geht\'s», «Mein Konto».',
  en: 'Labels only in English: "What would you like to learn?", "Digital competence", "Mathematics", "Science", "Your own topics", "What comes next?", "Recommended", "Add an area", "Let\'s go", "My account".',
  fr: 'Libellés seulement en français. Ne mélange pas avec l\'allemand ou l\'anglais.',
  it: 'Etichette solo in italiano. Non mescolare con il tedesco o l\'inglese.',
  rm: 'Mo ils nums mo en rumantsch. Betg maschadar cun tudestg u englais.',
};

function askedLang(text: string, fallback: OwlLang): OwlLang {
  const count = (re: RegExp) => text.match(re)?.length ?? 0;
  const de = count(/\b(ich|du|dir|mir|und|der|die|das|ein|eine|nicht|wie|was|wo|warum|bitte|für|mit|ist|sind|einfach|erklär|möchte|lernen|thema|noch|auf|zum)\b/gi);
  const en = count(/\b(i|you|the|and|what|where|why|how|please|explain|would|like|this|with|from|topic|learn|next|simply)\b/gi);
  const fr = count(/\b(je|tu|vous|les|des|une|que|quoi|où|comment|expliquer|apprendre|sujet)\b/gi);
  const it = count(/\b(io|tu|che|cosa|dove|come|per|spiega|imparare|argomento)\b/gi);
  const best = Math.max(de, en, fr, it);
  if (best < 1) return fallback;
  if (de === best && de > en) return 'de';
  if (en === best && en > de) return 'en';
  if (fr === best && fr > de && fr > en) return 'fr';
  if (it === best && it > de && it > en) return 'it';
  return fallback;
}

export interface OwlTurn {
  role: 'user' | 'assistant';
  text: string;
}

export interface OwlAsk {
  turns: OwlTurn[];
  lang: OwlLang;
  where: string;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

export function owlMessages(body: unknown): OwlAsk {
  const raw = (body as { messages?: unknown; lang?: unknown; where?: unknown }) ?? {};
  if (!Array.isArray(raw.messages) || raw.messages.length === 0) throw new HttpError(400, 'Schreib Eule eine Nachricht.');
  const turns: OwlTurn[] = [];
  for (const item of raw.messages.slice(-10)) {
    if (!item || typeof item !== 'object') continue;
    const role = (item as { role?: string }).role;
    const text = String((item as { text?: string }).text ?? '').trim().slice(0, 800);
    if ((role !== 'user' && role !== 'assistant') || !text) continue;
    turns.push({ role, text });
  }
  if (!turns.some((t) => t.role === 'user')) throw new HttpError(400, 'Schreib Eule eine Nachricht.');
  return {
    turns,
    lang: oneOf(raw.lang, ['de', 'en', 'fr', 'it', 'rm'] as const, 'de'),
    where: String(raw.where ?? '').replace(/\s+/g, ' ').trim().slice(0, 180),
  };
}

export function owlReply(payload: unknown): string {
  return freeReply(payload);
}

export async function askOwl({ turns, lang, where }: OwlAsk): Promise<string> {
  const last = [...turns].reverse().find((t) => t.role === 'user')?.text ?? '';
  const replyLang = askedLang(last, lang);
  const system = [
    'Du bist Eule von AIthena. Höchstens vier kurze Sätze.',
    `Antworte nur auf ${LANG_NAME[replyLang]}.`,
    LABELS[replyLang],
    MENTOR,
    where ? `Die Person ist gerade hier: ${where}.` : '',
    'Wenn du etwas nicht weisst, sagst du das in derselben Sprache.',
  ].filter(Boolean).join(' ');
  try {
    return await callFreeAi({
      system, messages: turns.map(t => ({ role: t.role, content: t.text })),
      maxTokens: 220, temperature: 0.7, timeoutMs: 40_000,
    });
  } catch (err) {
    if (err instanceof FreeAiError) {
      if (err.status === 429) throw new HttpError(429, 'Eule braucht einen kurzen Moment. Frag gleich noch einmal.');
      throw new HttpError(502, 'Qwen hat gerade nicht geantwortet.');
    }
    throw new HttpError(503, 'Eule erreicht Qwen gerade nicht. Versuch es gleich noch einmal.');
  }
}
