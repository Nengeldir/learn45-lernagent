// Schema check for every lesson type. The same check runs for data/lessons/*.json at startup
// and for lessons the model generates. Returns a list of problems; empty = valid.
import type { Lesson, PodcastQuestion, Track } from '@l45/shared';
import { DCC_LEVELS } from '@l45/shared';

export const MAX_LESSON_MIN = 5;

const TYPES = ['video', 'ai-chat', 'mock-site', 'mark-evidence', 'podcast'];
const MODES = ['alone', 'ai', 'peer'];
const VISUALS = ['next-word', 'invented-detail', 'secant-tangent', 'slope-zoom', 'steps', 'falling', 'url-parts'];
/** Generated videos may only use the generic visuals; the others are hand-made animations for one topic. */
const GENERATED_VISUALS = ['steps', 'url-parts'];
const PART_KINDS = ['from', 'subject', 'greeting', 'paragraph', 'link', 'signature', 'url', 'logo', 'heading', 'field', 'button', 'footer'];
const CHAT_KINDS = ['tutor', 'roleplay', 'prompt-lab'];

/** Real brands that must never appear in a practice mail or site. Not complete; .example domains are the main guard. */
const REAL_BRANDS = [
  'postfinance', 'ubs', 'raiffeisen', 'swisscom', 'die post', 'post.ch', 'migros', 'coop', 'microsoft', 'apple', 'google', 'paypal',
  'amazon', 'netflix', 'dhl', 'sbb', 'sunrise', 'salt mobile', 'twint', 'credit suisse', 'zkb', 'kantonalbank', 'visa', 'mastercard',
  'galaxus', 'digitec', 'ricardo', 'tutti', 'facebook', 'instagram', 'whatsapp', 'linkedin', 'booking.com', 'swiss pass', 'swisspass',
  'dpd', 'ups', 'fedex', 'zalando', 'spotify', 'outlook', 'office 365', 'icloud', 'yahoo', 'bluewin',
];

export interface ValidateOpts {
  track?: Track;
  /** Allowed primary source urls; required for generated lessons */
  sourceUrls?: string[];
}

const isStr = (v: unknown, max = 2000): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => strings(x, out));
  return out;
}

/** Answers of one question may differ by this many words. More, and the right answer often gives itself away by its length. */
const MAX_WORD_GAP = 2;

/** Quiz questions of videos and podcasts: 2 to 4 answers of about equal length, the right one not always in the same place. */
function quizErrors(questions: PodcastQuestion[], knownCrit: (id: unknown) => boolean, extra?: (q: PodcastQuestion, n: string) => string[]): string[] {
  const e: string[] = [];
  questions.forEach((q, i) => {
    const n = `Frage ${i + 1}`;
    if (!isStr(q?.prompt, 300)) e.push(`${n}: Frage fehlt`);
    if (!Array.isArray(q?.options) || q.options.length < 2 || q.options.length > 4 || !q.options.every((o) => isStr(o, 120))) {
      e.push(`${n}: 2 bis 4 Antworten nötig`);
      return;
    }
    if (new Set(q.options.map((o) => o.trim().toLowerCase())).size !== q.options.length) e.push(`${n}: Antworten doppelt`);
    const counts = q.options.map(words);
    if (Math.max(...counts) - Math.min(...counts) > MAX_WORD_GAP) e.push(`${n}: die Antworten dürfen sich um höchstens ${MAX_WORD_GAP} Wörter unterscheiden (jetzt ${counts.join('/')})`);
    if (!Number.isInteger(q.correct) || q.correct < 0 || q.correct >= q.options.length) e.push(`${n}: richtige Antwort fehlt`);
    e.push(...(extra?.(q, n) ?? []));
    if (!isStr(q.explanation, 400)) e.push(`${n}: Erklärung fehlt`);
    if (q.criterion !== undefined && !knownCrit(q.criterion)) e.push(`${n}: unbekanntes Kriterium ${q.criterion}`);
  });
  const positions = questions.map((q) => q?.correct);
  if (questions.length >= 2 && new Set(positions).size === 1) e.push('Die richtige Antwort steht in jeder Frage an derselben Stelle');
  return e;
}

/** Host names in a text: anything like name.tld, also after an @. */
function hosts(text: string): string[] {
  return [...text.toLowerCase().matchAll(/(?:[a-z0-9-]+\.)+[a-z]{2,}(?![a-z0-9-])/g)].map((m) => m[0]);
}

export function validateLesson(input: unknown, opts: ValidateOpts = {}): string[] {
  const e: string[] = [];
  const l = input as Lesson;
  if (!l || typeof l !== 'object') return ['Lektion ist kein Objekt'];
  const track = opts.track;
  const crit = new Set(track?.criteria.map((c) => c.id) ?? []);
  const knownCrit = (id: unknown) => !track || (typeof id === 'string' && crit.has(id));
  const generated = l.source === 'model';

  if (!isStr(l.id, 120)) e.push('id fehlt');
  if (!isStr(l.trackId)) e.push('trackId fehlt');
  else if (track && l.trackId !== track.id) e.push(`trackId ${l.trackId} passt nicht zum Bereich ${track.id}`);
  if (!TYPES.includes(l.type)) e.push(`unbekannter Typ ${String(l.type)}`);
  if (!(DCC_LEVELS as string[]).includes(l.level)) e.push(`unbekannte Stufe ${String(l.level)}`);
  if (!isStr(l.title, 80)) e.push('Titel fehlt oder ist länger als 80 Zeichen');
  if (!isStr(l.intro, 400)) e.push('Einleitung fehlt');
  if (typeof l.durationMin !== 'number' || l.durationMin < 1 || l.durationMin > MAX_LESSON_MIN) e.push(`Dauer muss 1 bis ${MAX_LESSON_MIN} Minuten sein`);
  if (!MODES.includes(l.mode)) e.push(`unbekannter Modus ${String(l.mode)}`);
  if (!Array.isArray(l.targets) || l.targets.length === 0) e.push('targets fehlen');
  else for (const t of l.targets) if (!knownCrit(t)) e.push(`unbekanntes Kriterium ${String(t)}`);
  if (l.source !== 'prepared' && l.source !== 'model') e.push('source muss prepared oder model sein');
  if (strings(l).some((s) => s.includes('ß'))) e.push('Schweizer Schreibweise: ss statt ß');

  if (generated) {
    if (!l.provenance || l.provenance.by !== 'model') e.push('Herkunft (provenance) fehlt');
    if (!l.primarySource || !isStr(l.primarySource.title) || !isStr(l.primarySource.url)) e.push('Primärquelle fehlt');
    else if (opts.sourceUrls && !opts.sourceUrls.includes(l.primarySource.url)) e.push(`Primärquelle ${l.primarySource.url} steht nicht in den Quellen des Bereichs`);
  }

  const c = (l as { content?: unknown }).content as Record<string, unknown> | undefined;
  if (!c || typeof c !== 'object') return [...e, 'content fehlt'];

  switch (l.type) {
    case 'video': {
      const { scenes, questions } = l.content;
      if (!Array.isArray(scenes) || scenes.length === 0 || scenes.length > 8) e.push('Video braucht 1 bis 8 Szenen');
      else {
        scenes.forEach((s, i) => {
          if (!isStr(s?.caption, 300)) e.push(`Szene ${i + 1}: Text fehlt`);
          if (!VISUALS.includes(s?.visual)) e.push(`Szene ${i + 1}: unbekanntes Bild ${String(s?.visual)}`);
          else if (generated && !GENERATED_VISUALS.includes(s.visual)) e.push(`Szene ${i + 1}: erzeugte Videos nutzen nur ${GENERATED_VISUALS.join(' oder ')}`);
          if ((s?.visual === 'steps' || s?.visual === 'url-parts') && (!Array.isArray(s.items) || s.items.length < 2 || s.items.length > 6 || !s.items.every((x) => isStr(x, 60)))) {
            e.push(`Szene ${i + 1}: braucht 2 oder mehr kurze Stichworte (items)`);
          }
          if (typeof s?.seconds !== 'number' || s.seconds < 2 || s.seconds > 30) e.push(`Szene ${i + 1}: Dauer 2 bis 30 Sekunden`);
        });
      }
      if (!Array.isArray(questions) || questions.length === 0) e.push('Video ohne Fragen');
      else {
        e.push(...quizErrors(questions, knownCrit, (q, n) => {
          const afterScene = (q as { afterScene?: unknown }).afterScene;
          return !Array.isArray(scenes) || !Number.isInteger(afterScene) || (afterScene as number) < 0 || (afterScene as number) >= scenes.length ? [`${n}: afterScene ausserhalb der Szenen`] : [];
        }));
      }
      break;
    }
    case 'podcast': {
      // Every line is paid speech: about two minutes at most, and both hosts speak.
      const { lines, questions } = l.content;
      if (!Array.isArray(lines) || lines.length < 6 || lines.length > 16) e.push('Podcast braucht 6 bis 16 Beiträge');
      else {
        lines.forEach((x, i) => {
          if (x?.speaker !== 'a' && x?.speaker !== 'b') e.push(`Beitrag ${i + 1}: Sprecher muss a oder b sein`);
          if (!isStr(x?.text, 400)) e.push(`Beitrag ${i + 1}: Text fehlt oder ist länger als 400 Zeichen`);
        });
        if (!lines.some((x) => x?.speaker === 'a') || !lines.some((x) => x?.speaker === 'b')) e.push('Im Podcast sprechen beide');
        if (lines.reduce((n, x) => n + String(x?.text ?? '').length, 0) > 3000) e.push('Podcast ist länger als 3000 Zeichen');
      }
      if (!Array.isArray(questions) || questions.length === 0 || questions.length > 4) e.push('Podcast braucht 1 bis 4 Fragen');
      else e.push(...quizErrors(questions, knownCrit));
      break;
    }
    case 'ai-chat': {
      const k = l.content;
      if (!CHAT_KINDS.includes(k.kind)) e.push(`unbekannte Chat-Art ${String(k.kind)}`);
      if (!isStr(k.goal, 400)) e.push('Ziel fehlt');
      if (!isStr(k.aiRole, 2000)) e.push('Rolle der KI fehlt');
      if (!isStr(k.opening, 500)) e.push('Eröffnung fehlt');
      if (k.material !== undefined && (!isStr(k.material.title) || !Array.isArray(k.material.lines) || !k.material.lines.every((x) => isStr(x, 400)))) e.push('Material unvollständig');
      if (!Array.isArray(k.criteria) || k.criteria.length === 0) e.push('Chat ohne Kriterien');
      else {
        for (const cr of k.criteria) {
          if (!knownCrit(cr?.id)) e.push(`unbekanntes Kriterium ${String(cr?.id)}`);
          if (!isStr(cr?.label) || !isStr(cr?.hint, 400)) e.push(`Kriterium ${String(cr?.id)}: Name oder Hinweis fehlt`);
          if (!Array.isArray(cr?.patterns) || cr.patterns.length === 0) e.push(`Kriterium ${String(cr?.id)}: Stichworte fehlen`);
          else {
            for (const p of cr.patterns) {
              try {
                new RegExp(p, 'i');
              } catch {
                e.push(`Kriterium ${cr.id}: ungültiges Muster ${p}`);
              }
            }
          }
        }
      }
      if (!Array.isArray(k.fallbackReplies) || k.fallbackReplies.length === 0 || !k.fallbackReplies.every((x) => isStr(x, 500))) e.push('vorbereitete Antworten fehlen');
      if (!Number.isInteger(k.minTurns) || k.minTurns < 1 || k.minTurns > 6) e.push('minTurns muss 1 bis 6 sein');
      break;
    }
    case 'mock-site': {
      const k = l.content;
      const all = [...(Array.isArray(k.mail) ? k.mail : []), ...(Array.isArray(k.site) ? k.site : [])];
      if (!isStr(k.disclaimer, 500)) e.push('Hinweis «erfunden» fehlt');
      else if (generated && !/erfunden/i.test(k.disclaimer)) e.push('Der Hinweis muss sagen, dass Marke und Adressen erfunden sind');
      if (!Array.isArray(k.site) || k.site.length === 0) e.push('Webseite fehlt');
      if (k.mail !== undefined && !Array.isArray(k.mail)) e.push('mail muss eine Liste sein');
      const ids = new Set<string>();
      for (const p of all) {
        if (!isStr(p?.id)) e.push('Teil ohne id');
        else if (ids.has(p.id)) e.push(`Teil ${p.id} doppelt`);
        else ids.add(p.id);
        if (!PART_KINDS.includes(p?.kind)) e.push(`Teil ${String(p?.id)}: unbekannte Art ${String(p?.kind)}`);
        if (!isStr(p?.text, 400)) e.push(`Teil ${String(p?.id)}: Text fehlt`);
        if (p?.signal && (!knownCrit(p.signal.criterion) || !isStr(p.signal.explanation))) e.push(`Teil ${p.id}: Warnzeichen mit unbekanntem Kriterium ${String(p.signal.criterion)}`);
        if (p?.kind === 'link' && !isStr(p.linkTarget)) e.push(`Teil ${p.id}: Linkziel fehlt`);
      }
      const text = strings(k).join(' \n ');
      const real = [...new Set(hosts(text).filter((h) => !h.endsWith('.example')))];
      if (real.length) e.push(`nur erfundene .example-Adressen erlaubt, gefunden: ${real.join(', ')}`);
      const lower = text.toLowerCase();
      const brands = REAL_BRANDS.filter((b) => new RegExp(`(^|[^a-z0-9äöü])${escapeRe(b)}([^a-z0-9äöü]|$)`).test(lower));
      if (brands.length) e.push(`echte Marken sind nicht erlaubt: ${brands.join(', ')}`);
      const signals = all.filter((p) => p?.signal).length;
      if (k.correctVerdict !== 'phishing' && k.correctVerdict !== 'echt') e.push('Entscheid muss phishing oder echt sein');
      else if (k.correctVerdict === 'phishing' && signals === 0) e.push('Entscheid «phishing», aber kein Warnzeichen markiert');
      else if (k.correctVerdict === 'echt' && signals > 0) e.push('Entscheid «echt», aber Warnzeichen markiert');
      if (!isStr(k.verdictExplanation, 600)) e.push('Erklärung zum Entscheid fehlt');
      break;
    }
    case 'mark-evidence': {
      const k = l.content;
      if (!isStr(k.noteTitle)) e.push('Titel der Notiz fehlt');
      if (!Array.isArray(k.note) || k.note.length === 0 || !k.note.every((x) => isStr(x, 400))) e.push('Notiz fehlt');
      if (!Array.isArray(k.summary) || k.summary.length < 2) e.push('Zusammenfassung braucht 2 oder mehr Sätze');
      else {
        const ids = new Set<string>();
        for (const s of k.summary) {
          if (!isStr(s?.id) || ids.has(s.id)) e.push(`Satz ${String(s?.id)}: id fehlt oder doppelt`);
          else ids.add(s.id);
          if (!isStr(s?.text, 400)) e.push(`Satz ${String(s?.id)}: Text fehlt`);
          if (s?.verdict !== 'belegt' && s?.verdict !== 'erfunden') e.push(`Satz ${String(s?.id)}: Urteil muss belegt oder erfunden sein`);
          if (!isStr(s?.explanation, 400)) e.push(`Satz ${String(s?.id)}: Erklärung fehlt`);
          if (s?.verdict === 'erfunden' && s.criterion !== undefined && !knownCrit(s.criterion)) e.push(`Satz ${s.id}: unbekanntes Kriterium ${s.criterion}`);
        }
        if (!k.summary.some((s) => s?.verdict === 'erfunden' && isStr(s.criterion) && knownCrit(s.criterion))) {
          e.push('mindestens ein Satz muss «erfunden» sein, mit einem Kriterium des Bereichs');
        }
      }
      break;
    }
  }
  return e;
}
