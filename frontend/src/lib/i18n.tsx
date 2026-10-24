// German is the source language. French, Italian, Romansh and English are display layers. Stored DCC levels stay German.
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { DccLevel, LessonType, Mode, Source } from '@l45/shared';
import { MODE_LABEL, SOURCE_LABEL, TYPE_LABEL } from '@l45/shared';
import { FR } from './lang-fr.ts';
import { IT } from './lang-it.ts';
import { RM } from './lang-rm.ts';
import { FoldMenu } from './fold.tsx';

export type Lang = 'de' | 'fr' | 'it' | 'rm' | 'en';

/** The four national languages first, then English. */
export const LANGS: { code: Lang; short: string; name: string; locale: string; title: string }[] = [
  { code: 'de', short: 'DE', name: 'Deutsch', locale: 'de-CH', title: 'Lernagent' },
  { code: 'fr', short: 'FR', name: 'Français', locale: 'fr-CH', title: 'Agent d’apprentissage' },
  { code: 'it', short: 'IT', name: 'Italiano', locale: 'it-CH', title: 'Agente di apprendimento' },
  { code: 'rm', short: 'RM', name: 'Rumantsch', locale: 'rm-CH', title: 'Agent d’emprender' },
  { code: 'en', short: 'EN', name: 'English', locale: 'en-GB', title: 'Learning agent' },
];

const KEY = 'lernagent.lang';

const stored = (): Lang => {
  try {
    const v = localStorage.getItem(KEY);
    return LANGS.some((l) => l.code === v) ? (v as Lang) : 'de';
  } catch {
    return 'de';
  }
};

/** Locale for dates and times in the chosen language. */
export const localeOf = (lang: Lang = stored()) => LANGS.find((l) => l.code === lang)?.locale ?? 'de-CH';

const EN: Record<string, string> = {
  Erscheinungsbild: 'Appearance',
  Hell: 'Light',
  Dunkel: 'Dark',
  Automatisch: 'Automatic (follows the system)',
  'Wird geladen …': 'Loading …',
  'Neu laden': 'Reload',
  Lernagent: 'Learning agent',
  'Dein DCC-Profil wird zu einer Lernkarte. Der Agent plant Lektionen in allen fünf Bereichen, schlägt den nächsten Schritt vor und sagt, warum.':
    'Your DCC profile becomes a learning map. The agent plans lessons across all five areas, suggests the next step, and says why.',
  'Prototyp für Learn45. Anmeldung ohne Passwort, nur erfundene Daten.':
    'Prototype for Learn45. Sign-in without a password, invented data only.',
  Anmelden: 'Sign in',
  'Dein Name': 'Your name',
  'Zeit für heute': 'Time for today',
  Minuten: 'minutes',
  'DCC-Profil': 'DCC profile',
  'Resultat laden': 'Load a result',
  'Stufen eingeben': 'Enter levels',
  'DCC-Resultat (JSON) hierher ziehen oder auswählen': 'Drop a DCC result (JSON) here, or choose a file',
  Beispieldateien: 'Sample files',
  Gemischt: 'Mixed',
  'Eher fortgeschritten': 'Mostly advanced',
  'Nur teilweise erhoben': 'Only partly assessed',
  'nicht erhoben': 'not assessed',
  Grundstufe: 'Foundation',
  Mittelstufe: 'Intermediate',
  Fortgeschritten: 'Advanced',
  'Die DCC-Werte bleiben unverändert. Lernen in der App stuft nichts hoch. «Nicht erhoben» heisst nicht geringe Kompetenz.':
    'DCC levels stay as they are. Learning in this app does not raise them. “Not assessed” does not mean low competence.',
  'Lernkarte wird erstellt …': 'Building your map …',
  'Lernkarte erstellen': 'Create learning map',
  '«{name}» ist keine gültige DCC-Resultatdatei. Nimm eine der Beispieldateien als Vorlage.':
    '“{name}” is not a valid DCC result file. Use one of the sample files as a template.',
  'kein DCC-Resultat': 'not a DCC result',
  Abmelden: 'Sign out',
  'Profil und Verlauf': 'Profile and history',
  'Noch {n} Min.': '{n} min left',
  Alle: 'All',
  'Ohne KI kommen Gesprächsantworten und Hinweise aus vorbereiteten Texten.':
    'Without AI, chat replies and hints come from prepared texts.',
  'KI an': 'AI on',
  'Ohne KI': 'No AI',
  'KI simuliert aus': 'AI simulated off',
  Einklappen: 'Collapse',
  'Nächster Schritt': 'Next step',
  Details: 'Details',
  Wissensknoten: 'Knowledge knot',
  Bergwege: 'Mountain lines',
  'Ansicht der Lernkarte': 'Learning map view',
  Sprache: 'Language',
  Lernform: 'Way of learning',
  'Digitale Kompetenz': 'Digital competence',
  Mathematik: 'Mathematics',
  Naturwissenschaften: 'Science',
  'Informations- und Datenkompetenz': 'Information and data literacy',
  'Kommunikation und Zusammenarbeit': 'Communication and collaboration',
  'Erstellung digitaler Inhalte': 'Digital content creation',
  Sicherheit: 'Safety',
  Problemlösen: 'Problem solving',
  Ableitung: 'Derivative',
  'Freier Fall': 'Free fall',
  'Warum erfindet eine KI Angaben?': 'Why does an AI invent details?',
  'Wann trifft sich das Team?': 'When does the team meet?',
  'Die neuen Bildschirme': 'The new screens',
  'Budget und Frist': 'Budget and deadline',
  'Wer macht was?': 'Who does what?',
  'Das Pilotprojekt': 'The pilot project',
  'Woher stammt diese Zahl?': 'Where does this number come from?',
  'Ein klarer Auftrag an die KI': 'A clear brief for the AI',
  'Was in einen guten Auftrag gehört': 'What belongs in a good brief',
  'Das Ergebnis prüfen': 'Check the result',
  'Übergabe an Petra': 'Handover to Petra',
  'Was in eine gute Übergabe gehört': 'What belongs in a good handover',
  'Heikle Mail an eine Kundin': 'A delicate email to a customer',
  'Fallen schwere Dinge schneller?': 'Do heavy things fall faster?',
  'Warum fallen alle gleich schnell?': 'Why does everything fall at the same speed?',
  'Fehler an den Support melden': 'Report a fault to support',
  'Ein Problem so beschreiben, dass andere helfen können': 'Describe a problem so others can help',
  'Das passende Werkzeug finden': 'Find the right tool',
  'Webadressen richtig lesen': 'Read web addresses properly',
  'Konto gesperrt?': 'Account locked?',
  'Nur CHF 1.95 Gebühr?': 'Only a CHF 1.95 fee?',
  'Echt oder nicht?': 'Real or not?',
  'Was ist eine Ableitung?': 'What is a derivative?',
  'Erklär mir die Ableitung': 'Explain the derivative to me',
  Oberfläche: 'Surface',
  Hang: 'Slope',
  Tiefe: 'Depth',
  Bergweg: 'mountain route',
  'ohne DCC': 'no DCC',
  'DCC {level}': 'DCC {level}',
  'noch keine Übung': 'no exercise yet',
  Zurück: 'Back',
  'Zurück zum Netz': 'Back to the lines',
  'Gipfel erreicht': 'Summit reached',
  'Zum Gipfel': 'To the summit',
  'Demo mit Beispieldaten': 'Demo with sample data',
  'Lektion abschliessen': 'Finish lesson',
  'Berg zurücksetzen': 'Reset this mountain',
  'Alle Lektionen auf {name} erledigt.': 'Every lesson on {name} is done.',
  'Berg {name} öffnen, {here} von {summit} m': 'Open {name}, {here} of {summit} m',
  '{name} · {here} / {summit} m': '{name} · {here} / {summit} m',
  'Zurück zu den Wissensknoten': 'Back to the knowledge knot',
  'Auf dem Berg {name} zeigen': 'Show on {name}',
  'Berg {name} öffnen': 'Open {name}',
  'Im Wissensknoten zeigen': 'Show in the knowledge knot',
  'Mit Freund lernen': 'Learn with a friend',
  Lernpartner: 'Learning partner',
  'Dein Freund': 'Your friend',
  'Aufstieg nochmals zeigen': 'Replay the climb',
  'Zu zweit nehmt ihr die Seilbahn. {friend} fährt mit. Die Meter gehören euch beiden, das DCC bleibt, wo es war.':
    'Together you take the cable car. {friend} rides along. The metres belong to you both, the DCC stays where it was.',
  '{done} von {total} Stationen': '{done} of {total} stops',
  'Weiter: {title}': 'Next: {title}',
  'Ganz oben. Setz die Fahne!': 'You made it. Plant the flag!',
  'Gipfel!': 'Summit!',
  'Du, {here} m': 'You, {here} m',
  'Du und {friend}, {here} m': 'You and {friend}, {here} m',
  'Fahne setzen': 'Plant the flag',
  '{here} m von {summit} m': '{here} m of {summit} m',
  '{here} m von {summit} m · nächster Aufstieg {next} m': '{here} m of {summit} m · next pitch {next} m',
  '{here} m von {summit} m · Gipfel erreicht': '{here} m of {summit} m · summit reached',
  'Du steigst auf. Leichtere Übungen liegen tiefer, schwierigere näher am Gipfel.':
    'You climb up. Easier exercises sit lower, harder ones nearer the summit.',
  'Drei Sicherungen, dann steht die Fahne. Das ist ein Spiel am Gipfel, keine Bewertung.':
    'Three anchors, then the flag stands. This is a game at the summit, not a grade.',
  'Im Gipfelbuch, nicht im DCC. Die Stufe bleibt, wo sie war.':
    'In the summit book, not in the DCC. The level stays where it was.',
  'Du stehst auf {here} m. Schliesse die Aufstiege ab, dann setzt du die Fahne. Drei Sicherungen, ein Satz ins Gipfelbuch.':
    'You are at {here} m. Finish the pitches, then plant the flag. Three anchors, one sentence in the summit book.',
  '{mountain}, {metres} m. Der Weg führt nach oben. Die Meter gehören zur Übung, nicht zur DCC-Stufe.':
    '{mountain}, {metres} m. The route leads up. The metres belong to the exercise, not to the DCC level.',
  'Das ist die Alternative zur Empfehlung «{label}». Wenn du sie startest, merkt sich der Agent, dass du die Empfehlung abgelehnt hast.':
    'This is the alternative to the suggestion “{label}”. If you start it, the agent remembers that you declined the suggestion.',
  Datei: 'file',
  'Dein Ziel:': 'Your goal:',
  'KI-Zusammenfassung': 'AI summary',
  'Satz {n}': 'Sentence {n}',
  'Gipfel {name}': 'Summit {name}',
  'Der Aufstieg geht nach oben. Leichtere Übungen liegen tiefer, schwierigere näher am Gipfel.':
    'The climb goes up. Easier exercises sit lower, harder ones nearer the summit.',
  'DCC dieser Linie: {level}. Die Meter ändern sie nicht.':
    'DCC for this line: {level}. The metres do not change it.',
  'Auf diesem Bergweg ist noch keine Übung geplant.': 'No exercise is planned on this mountain route yet.',
  'Auf diesem Weg gibt es keinen Schritt «{mode}». Der Agent ruft weiter den nächsten Schritt auf.':
    'This route has no “{mode}” step. The agent still calls the next step.',
  'Noch nicht oben': 'Not at the top yet',
  'Du stehst auf {here} m. Der Gipfel dieser Linie ist bei {summit} m. Die Fahne gibt es, wenn jede Übung dieses Wegs gelöst ist.':
    'You are at {here} m. The summit of this line is {summit} m. The flag is there once every exercise on this route is solved.',
  'Weiter steigen': 'Keep climbing',
  Gipfel: 'Summit',
  '{holds} von 3 Sicherungen': '{holds} of 3 anchors',
  'Sicherung {n} setzen': 'Place anchor {n}',
  'Die Fahne steht auf {metres} m.': 'The flag stands at {metres} m.',
  'Du hast den geplanten Weg dieser Linie geschafft.': 'You have finished the planned route of this line.',
  Weiter: 'Continue',
  'Fahne gesetzt.': 'Flag planted.',
  'Trag einen Satz ins Gipfelbuch ein.': 'Write one sentence in the summit book.',
  'Ins Gipfelbuch': 'Into the summit book',
  'Im Gipfelbuch, nicht im DCC.': 'In the summit book, not in the DCC.',
  'Jede Linie ist ein Wissensbereich. Ein Klick öffnet den Bergweg. Die Tiefe dort folgt der Schwierigkeit der Übung, nicht der DCC-Stufe.':
    'Each line is one area of knowledge. A click opens the mountain route. Depth there follows the difficulty of the exercise, not the DCC level.',
  'Auf diesem Netz gibt es noch keinen Schritt «{mode}».': 'This network has no “{mode}” step yet.',
  '{mountain}, {metres} m. Der Weg führt nach oben. Die Meter gehören zu diesem Übungsweg und ändern das DCC nicht.':
    '{mountain}, {metres} m. The route leads up. The metres belong to this exercise route and do not change the DCC.',
  'Der Wissensknoten. In der Mitte stehst du, aussen die Bereiche. Ein Klick öffnet den Schritt. Bergwege ist die andere Ansicht.':
    'The knowledge knot. You are in the centre, the areas sit around you. A click opens the step. Mountain lines is the other view.',
  'Was der Agent gesehen hat': 'What the agent saw',
  Vorschlag: 'Suggestion',
  'Warum das jetzt hilft': 'Why this helps now',
  Regel: 'Rule',
  Starten: 'Start',
  'Alternative ansehen': 'See the alternative',
  'Für heute fertig': 'Done for today',
  'Mit 10 Minuten mehr gäbe es noch einen Schritt.': 'With 10 more minutes there would be another step.',
  '10 Minuten mehr': '10 more minutes',
  'Zurück zum nächsten Schritt': 'Back to the next step',
  'Diesen Knoten hat der Agent nach deinen Ergebnissen neu hinzugefügt.':
    'The agent added this knot after your results.',
  'Geplant. Du kannst sie freiwillig jederzeit starten.': 'Planned. You can start it whenever you like.',
  Gelöst: 'Solved',
  'Mit Lücken': 'With gaps',
  ', mit Hinweis': ', with a hint',
  'Alternative starten': 'Start the alternative',
  Nochmals: 'Again',
  'Lieber etwas anderes': 'Something else instead',
  'DCC-Position:': 'DCC level:',
  '(aus dem DCC, wird hier nicht verändert)': '(from the DCC, not changed here)',
  'Kein DCC-Bereich. Der Agent plant hier nur aus deinem Lernverlauf.':
    'No DCC area. The agent plans here only from your learning history.',
  Übungen: 'Exercises',
  'Die fünf Kompetenzbereiche nach DigComp 2.2. Die Stufen kommen aus deinem DCC-Profil.':
    'The five competence areas from DigComp 2.2. The levels come from your DCC profile.',
  'Zusätzlicher Bereich ohne DCC-Position. Er zeigt, dass der Lernagent auch für andere Lernziele funktioniert.':
    'An extra area with no DCC level. It shows the learning agent also works for other goals.',
  'DCC-Profil {source}': 'DCC profile {source}',
  'aus «{file}»': 'from “{file}”',
  'von Hand eingegeben': 'entered by hand',
  ', erhoben am {date}': ', assessed on {date}',
  'nächster Schritt': 'next step',
  Alternative: 'Alternative',
  gelöst: 'solved',
  'mit Lücken': 'with gaps',
  übersprungen: 'skipped',
  geplant: 'planned',
  erledigt: 'done',
  neu: 'new',
  Legende: 'Legend',
  '{mountain} · {metres} m · {level}. Die Meter sind dieser Übungsweg. Sie ändern das DCC nicht.':
    '{mountain} · {metres} m · {level}. The metres are this exercise route. They do not change the DCC.',
  'keine DCC-Position': 'no DCC level',
  'DCC: {level}': 'DCC: {level}',
  'DCC: nicht erhoben': 'DCC: not assessed',
  'Lernkarte als Mindmap. Ziehen zum Verschieben, Mausrad zum Zoomen.':
    'Learning map as a mind map. Drag to move, scroll to zoom.',
  Hineinzoomen: 'Zoom in',
  Herauszoomen: 'Zoom out',
  'Ganze Karte': 'Whole map',
  'Start: {label}': 'Start: {label}',
  'Bereich {label}': 'Area {label}',
  Schliessen: 'Close',
  'Nur aus dem DCC. Lernen in dieser App verändert diese Werte nicht.':
    'From the DCC only. Learning in this app does not change these values.',
  Einstellungen: 'Settings',
  'Zeit für heute in Minuten ({used} verbraucht)': 'Time for today in minutes ({used} used)',
  Übernehmen: 'Apply',
  'KI-Verbindung für die Demo trennen (vorbereitete Inhalte, gekennzeichnet)':
    'Disconnect AI for the demo (prepared content, labelled)',
  'Entscheidungen des Agenten': 'The agent’s decisions',
  offen: 'open',
  angenommen: 'accepted',
  abgelehnt: 'declined',
  Lernverlauf: 'Learning history',
  'Noch keine Lektion abgeschlossen.': 'No lesson finished yet.',
  'mit Hinweis': 'with a hint',
  Beobachtungen: 'Observations',
  ', überholt': ', outdated',
  'KI-Aufrufe: {calls}, davon {fallback} mit Rückfall auf vorbereitete Inhalte.':
    'AI calls: {calls}, of which {fallback} fell back to prepared content.',
  'Transfer in den Arbeitsalltag': 'Transfer into everyday work',
  'Nach jeder Lektion erscheint hier ein Hinweis für die Arbeit.':
    'After each lesson a note for your work appears here.',
  Lektion: 'Lesson',
  'Lektion wird geladen …': 'Loading the lesson …',
  'Zur Karte': 'Back to the map',
  'Noch nicht ganz': 'Not quite yet',
  'Geprüft durch: {by}': 'Checked by: {by}',
  KI: 'AI',
  'Stichwörter (ohne KI)': 'Keywords (no AI)',
  'Merksatz:': 'Remember:',
  'Für deine Arbeit:': 'For your work:',
  'Der Agent passt deine Karte an': 'The agent updates your map',
  'Nächster Schritt: {label}': 'Next step: {label}',
  'Auf der Karte ansehen': 'See it on the map',
  'Min.': 'min',
  'Die Aufgabe bleibt auf Deutsch. Die Prüfung erkennt die deutschen Formulierungen.':
    'The task stays in German. The check recognises the German wording.',
  'Die KI stellt Fragen und verrät keine fertige Lösung.': 'The AI asks questions and does not give away a finished solution.',
  'Die KI spielt eine Rolle. Schreib so, wie du es bei der Arbeit tun würdest.':
    'The AI plays a role. Write as you would at work.',
  'Die KI führt deinen Auftrag wörtlich aus. Was du offen lässt, füllt sie mit Annahmen.':
    'The AI follows your brief literally. What you leave open, it fills with assumptions.',
  'Die KI bekommt nur diese Übung und deine Nachrichten, nicht deinen Namen.':
    'The AI only receives this exercise and your messages, not your name.',
  Du: 'You',
  Nachricht: 'Message',
  'Dein Auftrag an die KI …': 'Your brief to the AI …',
  'Deine Antwort …': 'Your answer …',
  Senden: 'Send',
  'Noch {n} Antwort bis zum Abschluss': '{n} more answer before you can finish',
  'Noch {n} Antworten bis zum Abschluss': '{n} more answers before you can finish',
  'Du kannst abschliessen oder weiterschreiben.': 'You can finish or keep writing.',
  'Abschliessen und auswerten': 'Finish and review',
  'Keine Antwort: {msg}': 'No reply: {msg}',
  'Möchtest du einen kurzen Hinweis der KI, oder suchst du nochmals selbst?':
    'Do you want a short hint from the AI, or will you look again yourself?',
  'Hinweis der KI': 'Hint from the AI',
  'Selbst nochmals suchen': 'Look again myself',
  'Markiere jeden Satz.': 'Mark every sentence.',
  Abschliessen: 'Finish',
  Prüfen: 'Check',
  'E-Mail': 'Email',
  'Webseite nach dem Klick': 'Page after the click',
  Posteingang: 'Inbox',
  'Von:': 'From:',
  'Betreff:': 'Subject:',
  'Linkziel ausblenden': 'Hide the link target',
  'Linkziel anzeigen (wie mit der Maus darüberfahren)': 'Show the link target (as if you hovered)',
  'Linkziel:': 'Link target:',
  'Dein Entscheid': 'Your decision',
  Entscheid: 'Decision',
  Phishing: 'Phishing',
  Echt: 'Real',
  'Markiert: {n}': 'Marked: {n}',
  belegt: 'supported',
  erfunden: 'invented',
  'Platzhalter-Storyboard. Das fertige Video wird vorab mit der Aha-Engine erzeugt und hier eingebunden.':
    'Placeholder storyboard. The finished video is produced in advance with the Aha engine and embedded here.',
  Pause: 'Pause',
  Abspielen: 'Play',
  'Weiter abspielen': 'Keep playing',
  Alleine: 'Alone',
  'Mit KI': 'With AI',
  'Mit anderen': 'With others',
  Video: 'Video',
  'Mit der KI': 'With the AI',
  'Webseite prüfen': 'Check a website',
  'Text prüfen': 'Check a text',
  Vorbereitet: 'Prepared',
  Simulation: 'Simulation',
};

function fill(s: string, vars?: Record<string, string | number>) {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));
}

const SKILL_EN: Record<string, string> = {
  digital: 'Digital competence',
  math: 'Mathematics',
  science: 'Science',
};

const TRACK_EN: Record<string, string> = {
  't-info': 'Information and data literacy',
  't-komm': 'Communication and collaboration',
  't-inhalte': 'Digital content creation',
  't-sicherheit': 'Safety',
  't-problem': 'Problem solving',
  't-analysis': 'Derivative',
  't-physik': 'Free fall',
};

const LESSON_EN: Record<string, string> = {
  'info-v1': 'Why does an AI invent details?',
  'info-m1': 'When does the team meet?',
  'info-m2': 'The new screens',
  'info-m3': 'Budget and deadline',
  'info-m4': 'Who does what?',
  'info-m5': 'The pilot project',
  'info-c1': 'Where does this number come from?',
  'inh-c1': 'A clear brief for the AI',
  'inh-v1': 'What belongs in a good brief',
  'inh-c2': 'Check the result',
  'komm-c1': 'Handover to Petra',
  'komm-v1': 'What belongs in a good handover',
  'komm-c2': 'A delicate email to a customer',
  'phys-v1': 'Do heavy things fall faster?',
  'phys-c1': 'Why does everything fall at the same speed?',
  'prob-c1': 'Report a fault to support',
  'prob-v1': 'Describe a problem so others can help',
  'prob-c2': 'Find the right tool',
  'sich-v1': 'Read web addresses properly',
  'sich-s1': 'Account locked?',
  'sich-s2': 'Only a CHF 1.95 fee?',
  'sich-s3': 'Real or not?',
  'math-v1': 'What is a derivative?',
  'math-c1': 'Explain the derivative to me',
};

const DICT: Partial<Record<Lang, Record<string, string>>> = { en: EN, fr: FR, it: IT, rm: RM };

type I18n = {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (de: string, vars?: Record<string, string | number>) => string;
  level: (lv: DccLevel | null | undefined) => string;
  mode: (m: Mode) => string;
  type: (kind: LessonType) => string;
  source: (s: Source) => string;
  skillName: (id: string | undefined, fallback: string) => string;
  trackName: (id: string | undefined, fallback: string) => string;
  lessonTitle: (id: string | undefined, fallback: string) => string;
  nodeLabel: (node: { kind: string; label: string; lessonId?: string; trackId?: string; skillId?: string }) => string;
};

const Ctx = createContext<I18n | null>(null);

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(stored);
  const setLang = (next: Lang) => {
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* storage unavailable: the choice lives only in memory */
    }
    setLangState(next);
  };

  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = LANGS.find((l) => l.code === lang)?.title ?? 'Lernagent';
  }, [lang]);

  const value = useMemo<I18n>(() => {
    // A string without a translation stays German, the source language.
    const dict = DICT[lang];
    const t = (de: string, vars?: Record<string, string | number>) => fill(dict ? (dict[de] ?? de) : de, vars);
    const named = (id: string | undefined, fallback: string, map: Record<string, string>) =>
      lang === 'en' && id && map[id] ? map[id] : t(fallback);
    return {
      lang,
      setLang,
      t,
      level: (lv) => (lv ? t(lv) : t('nicht erhoben')),
      mode: (m) => t(MODE_LABEL[m]),
      type: (kind) => t(TYPE_LABEL[kind]),
      source: (s) => t(SOURCE_LABEL[s]),
      skillName: (id, fallback) => named(id, fallback, SKILL_EN),
      trackName: (id, fallback) => named(id, fallback, TRACK_EN),
      lessonTitle: (id, fallback) => named(id, fallback, LESSON_EN),
      nodeLabel: (node) => {
        if (node.lessonId) return named(node.lessonId, node.label, LESSON_EN);
        if (node.kind === 'track') return named(node.trackId, node.label, TRACK_EN);
        if (node.kind === 'skill') return named(node.skillId, node.label, SKILL_EN);
        return node.label;
      },
    };
  }, [lang]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useI18n outside LangProvider');
  return ctx;
}

/** Language buttons: DE · FR · IT · RM · EN. */
export function LangSwitch() {
  const { t, lang, setLang } = useI18n();
  const options = LANGS.map((l) => ({ value: l.code, label: l.name, lang: l.code, icon: <b className="fold-code">{l.short}</b> }));
  return <FoldMenu className="lang-switch" label={t('Sprache')} value={lang} options={options} onChoose={setLang} />;
}
