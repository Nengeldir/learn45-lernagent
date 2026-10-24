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
  { code: 'de', short: 'DE', name: 'Deutsch', locale: 'de-CH', title: 'Owl for Learn45' },
  { code: 'fr', short: 'FR', name: 'Français', locale: 'fr-CH', title: 'Owl for Learn45' },
  { code: 'it', short: 'IT', name: 'Italiano', locale: 'it-CH', title: 'Owl for Learn45' },
  { code: 'rm', short: 'RM', name: 'Rumantsch', locale: 'rm-CH', title: 'Owl for Learn45' },
  { code: 'en', short: 'EN', name: 'English', locale: 'en-GB', title: 'Owl for Learn45' },
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
  Lernagent: 'Owl for Learn45',
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
  'Ohne KI kommen Gesprächsantworten und Hinweise aus vorbereiteten Texten.':
    'Without AI, chat replies and hints come from prepared texts.',
  'KI an': 'AI on',
  'Ohne KI': 'No AI',
  'KI simuliert aus': 'AI simulated off',
  Einklappen: 'Collapse',
  'Nächster Schritt': 'Next step',
  Details: 'Details',
  Sprache: 'Language',
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
  Zurück: 'Back',
  'Gipfel erreicht': 'Summit reached',
  'Demo mit Beispieldaten': 'Demo with sample data',
  'Lektion abschliessen': 'Finish lesson',
  'Berg zurücksetzen': 'Reset this mountain',
  'Alle Lektionen auf {name} erledigt.': 'Every lesson on {name} is done.',
  'Das ist die Alternative zur Empfehlung «{label}». Wenn du sie startest, merkt sich der Agent, dass du die Empfehlung abgelehnt hast.':
    'This is the alternative to the suggestion “{label}”. If you start it, the agent remembers that you declined the suggestion.',
  Datei: 'file',
  'Dein Ziel:': 'Your goal:',
  'KI-Zusammenfassung': 'AI summary',
  'Satz {n}': 'Sentence {n}',
  'Der Aufstieg geht nach oben. Leichtere Übungen liegen tiefer, schwierigere näher am Gipfel.':
    'The climb goes up. Easier exercises sit lower, harder ones nearer the summit.',
  'DCC dieser Linie: {level}. Die Meter ändern sie nicht.':
    'DCC for this line: {level}. The metres do not change it.',
  'Du stehst auf {here} m. Der Gipfel dieser Linie ist bei {summit} m. Die Fahne gibt es, wenn jede Übung dieses Wegs gelöst ist.':
    'You are at {here} m. The summit of this line is {summit} m. The flag is there once every exercise on this route is solved.',
  Weiter: 'Continue',
  'Im Gipfelbuch, nicht im DCC.': 'In the summit book, not in the DCC.',
  'Jede Linie ist ein Wissensbereich. Ein Klick öffnet den Bergweg. Die Tiefe dort folgt der Schwierigkeit der Übung, nicht der DCC-Stufe.':
    'Each line is one area of knowledge. A click opens the mountain route. Depth there follows the difficulty of the exercise, not the DCC level.',
  'Auf diesem Netz gibt es noch keinen Schritt «{mode}».': 'This network has no “{mode}” step yet.',
  '{mountain}, {metres} m. Der Weg führt nach oben. Die Meter gehören zu diesem Übungsweg und ändern das DCC nicht.':
    '{mountain}, {metres} m. The route leads up. The metres belong to this exercise route and do not change the DCC.',
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
  'Beispiel erfunden': 'Invented example',
  'Alles erledigt': 'All done',
  'Gestützt auf:': 'Based on:',
  'Gestützt auf': 'Based on',
  'Neu im Bereich «{name}»': 'New in «{name}»',
  'Wofür brauchst du das?': 'What do you need this for?',
  'Der Agent richtet die Beispiele danach aus. Du kannst die Mission später in den Einstellungen unter «Profil» ändern.': 'The agent shapes the examples around it. You can change the mission later in Settings under «Profile».',
  'Oder in eigenen Worten': 'Or in your own words',
  'Ich … und will …': 'I … and want to …',
  'Überspringen': 'Skip',
  'Ohne Angabe nimmt der Agent: «{goal}»': 'Without an answer the agent uses: «{goal}»',
  'allgemeines Ziel': 'general goal',
  'Video pausiert': 'Video paused',
  'Frage {n} von {total} wartet auf dich.': 'Question {n} of {total} is waiting for you.',
  'Beantworte die Frage unten.': 'Answer the question below.',
  'Erklärvideo wird geladen …': 'Loading the explainer video …',
  'Storyboard ansehen': 'View the storyboard',
  'Videosteuerung': 'Video controls',
  'Zur Frage': 'Go to the question',
  'Nochmals abspielen': 'Play again',
  'Ton einschalten': 'Turn sound on',
  'Ton ausschalten': 'Turn sound off',
  'Untertitel': 'Subtitles',
  'Videoposition': 'Video position',
  '{a} von {b}': '{a} of {b}',
  'Frage {n}': 'Question {n}',
  'Video pausiert · Frage {n} von {total}': 'Video paused · question {n} of {total}',
  'Wähle eine Antwort. Danach kannst du die Lektion abschliessen.': 'Pick an answer. Then you can finish the lesson.',
  'Wähle eine Antwort. Danach läuft das Video automatisch weiter.': 'Pick an answer. Then the video carries on by itself.',
  'Wird geprüft …': 'Checking …',
  'Text zum Mitlesen': 'Transcript',
  'Von der KI erstellt: ein kurzes Storyboard mit Fragen.': 'Made by the AI: a short storyboard with questions.',
  'eigenes Thema': 'own topic',
  'Lektion wird erstellt …': 'Creating the lesson …',
  'Neue Lektion in «{name}»': 'New lesson in «{name}»',
  'Agent-Plan': 'Agent plan',
  'vorläufig': 'provisional',
  'Plan nach Regeln': 'Plan by rules',
  'Ergebnis «{label}»': 'Result «{label}»',
  'Agent plant … Bis dahin gilt der vorläufige Vorschlag nach Regeln.': 'The agent is planning … Until then the provisional rule-based suggestion applies.',
  'Plan nach Regeln: Ohne KI plant der Agent mit den Regeln und den vorbereiteten Lektionen.': 'Plan by rules: without the AI the agent plans with the rules and the prepared lessons.',
  'Von der KI erstellt': 'Made by the AI',
  'Quelle:': 'Source:',
  '(von der KI vorgeschlagen)': '(suggested by the AI)',
  'Los geht\'s': 'Let’s go',
  'Was willst du lernen?': 'What do you want to learn?',
  'Deine Karte ist noch leer. Wähle ein eigenes Thema, zum Beispiel «Security+ Prüfung bestehen», oder einen vorbereiteten Bereich.': 'Your map is still empty. Pick your own topic, for example «Pass the Security+ exam», or a prepared area.',
  'Bereich hinzufügen': 'Add an area',
  'Für ein eigenes Thema plant der Agent mit der KI, was du können musst, sucht Quellen und erstellt einen Einstieg.': 'For your own topic the agent uses the AI to plan what you need to know, finds sources and creates a first lesson.',
  'Ohne KI stehen die vorbereiteten Bereiche zur Wahl. Eigene Themen plant der Agent nur mit KI.': 'Without the AI you can pick the prepared areas. The agent plans own topics only with the AI.',
  'Nächster Schritt wird geplant': 'Planning the next step',
  'Mit KI startet jeder Bereich mit einem Einstieg. Nach jeder Lektion erzeugt der Agent die nächste passende Lektion. Vorbereitete Lektionen nimmt er nur, wenn das nicht klappt.': 'With the AI every area starts with an introduction. After each lesson the agent creates the next fitting lesson. It only uses prepared lessons if that fails.',
  'Ohne KI: Die Karte zeigt die vorbereiteten Lektionen, die Regeln wählen den nächsten Schritt.': 'Without the AI: the map shows the prepared lessons, and the rules choose the next step.',
  'Eigenes Thema: «{topic}». Vorwissen nach deiner Angabe: {level}.': 'Own topic: «{topic}». Prior knowledge as you stated: {level}.',
  'Kriterien und Quellen hat die KI vorgeschlagen.': 'The AI suggested the criteria and sources.',
  'Mission:': 'Mission:',
  'noch offen, wird beim ersten Start gefragt': 'still open, asked at the first start',
  'Lernstand (aus dem Lernen, kein DCC)': 'Learning progress (from learning, not DCC)',
  'Quellen': 'Sources',
  'Von der KI vorgeschlagen und beim Anlegen erreichbar, aber nicht von Menschen geprüft.': 'Suggested by the AI and reachable when created, but not checked by people.',
  'Kompetenzbereiche nach DigComp 2.2. Die Stufen kommen aus deinem DCC-Profil.': 'Competence areas according to DigComp 2.2. The levels come from your DCC profile.',
  'Deine eigenen Themen. Der Agent hat sie mit der KI geplant und erzeugt die Lektionen dazu.': 'Your own topics. The agent planned them with the AI and creates the lessons for them.',
  'Bereich ohne DCC-Position. Der Agent plant hier nur aus deinem Lernverlauf.': 'Area without a DCC position. Here the agent plans only from your learning history.',
  'Der Agent plant nur für Bereiche, die du wählst. Du kannst später weitere hinzufügen.': 'The agent only plans for areas you choose. You can add more later.',
  'Eigenes Thema': 'Own topic',
  'Der Agent plant den Bereich mit der KI: was du können musst, passende Quellen und einen ersten Einstieg.': 'The agent plans the area with the AI: what you need to know, fitting sources and a first introduction.',
  'Thema': 'Topic',
  'z. B. Security+ Prüfung bestehen': 'e.g. Pass the Security+ exam',
  'Beispiele': 'Examples',
  'Wofür brauchst du es? (freiwillig, wird deine Mission)': 'What do you need it for? (optional, becomes your mission)',
  'Vorwissen': 'Prior knowledge',
  'Bereich planen': 'Plan the area',
  'Der Agent plant «{topic}» und erstellt einen Einstieg. Das dauert bis zu einer Minute.': 'The agent is planning «{topic}» and creating an introduction. This takes up to a minute.',
  'Eigene Bereiche plant der Agent mit KI. Gerade ist keine KI verbunden. Ein vorbereiteter Bereich geht auch ohne.': 'The agent plans own areas with the AI. No AI is connected right now. A prepared area works without it.',
  'An die KI gehen Thema, Wofür und Vorwissen, dein Name nicht. Die Quellen schlägt die KI vor. Behalten werden nur Adressen, die beim Anlegen erreichbar sind.': 'The AI receives the topic, the purpose and your prior knowledge, not your name. The AI suggests the sources. Only addresses reachable at creation are kept.',
  'Vorbereitete Bereiche': 'Prepared areas',
  'Mit geprüften Quellen und vorbereiteten Lektionen. Geht auch ohne KI.': 'With checked sources and prepared lessons. Works without the AI too.',
  'Alle vorbereiteten Bereiche sind schon auf deiner Karte.': 'All prepared areas are already on your map.',
  'Alle {n} hinzufügen': 'Add all {n}',
  'ohne DCC-Position': 'no DCC position',
  '{n} Kriterien': '{n} criteria',
  'Du wählst, was du lernen willst: ein eigenes Thema wie «Security+ Prüfung bestehen» oder einen vorbereiteten Bereich. Der Agent plant die Lektionen, schlägt den nächsten Schritt vor und sagt, warum.': 'You choose what you want to learn: your own topic like «Pass the Security+ exam» or a prepared area. The agent plans the lessons, suggests the next step and says why.',
  'DCC-Profil (freiwillig)': 'DCC profile (optional)',
  'Nur für die vorbereiteten Bereiche der Digitalen Kompetenz. Für eigene Themen brauchst du es nicht.': 'Only for the prepared digital competence areas. You don’t need it for your own topics.',
  'Es gibt schon einen Verlauf für «{name}».': 'There is already a history for «{name}».',
  'Seit {date}, {n} {lessons} erledigt.': 'Since {date}, {n} {lessons} done.',
  'Lektionen': 'lessons',
  'Weitermachen': 'Continue',
  'Neu beginnen': 'Start over',
  'Weitermachen: Karte, Lerneinträge und Missionen bleiben. Ein neues DCC-Resultat wird als neuer Stand gespeichert. Neu beginnen: eine neue Karte, der alte Verlauf wird nicht gelöscht.': 'Continue: map, learning records and missions stay. A new DCC result is saved as a new state. Start over: a new map, the old history is not deleted.',
  'Der Agent hat deinen Plan angepasst': 'The agent has adjusted your plan',
  'Standard (übersprungen)': 'Default (skipped)',
  'noch offen': 'still open',
  'Wird beim ersten Start einer Lektion gefragt.': 'Asked when you first start a lesson.',
  'Ändern': 'Change',
  'Festlegen': 'Set',
  'Mission für {name}': 'Mission for {name}',
  'Neue Mission übernehmen? Der Agent plant ab jetzt danach.': 'Use the new mission? From now on the agent plans with it.',
  'Ja, ändern': 'Yes, change it',
  'Abbrechen': 'Cancel',
  'Noch keine. Ein Eintrag entsteht erst, wenn du etwas ohne Hilfe gezeigt hast. Behandelt ist nicht gelernt.': 'None yet. A record only appears once you have shown something without help. Covered is not learned.',
  'vom Agenten': 'by the agent',
  'nach Regel': 'by rule',
  'ersetzt durch': 'replaced by',
  'Belege:': 'Evidence:',
  'Ersetzt': 'Replaced',
  'Bereiche der Einstellungen': 'Settings sections',
  'Status': 'Status',
  'KI-Verbindung für die Demo trennen': 'Disconnect the AI for the demo',
  'Die App nutzt dann vorbereitete Inhalte und kennzeichnet sie.': 'The app then uses prepared content and marks it.',
  'Konto': 'Account',
  'Sitzung {n} · seit {date}': 'Session {n} · since {date}',
  'Lektionen erledigt': 'Lessons done',
  'Bereiche': 'Areas',
  'Lerneinträge': 'Learning records',
  'DCC-Stände:': 'DCC states:',
  'von Hand': 'by hand',
  'Es gilt der neueste.': 'The newest one applies.',
  'Aus deinen Lerneinträgen. «unbekannt» heisst: noch keine Belege, nicht: schwach. Die DCC-Stufen oben bleiben davon unberührt.': 'From your learning records. «unknown» means: no evidence yet, not: weak. The DCC levels above stay untouched.',
  'Noch keine Bereiche auf deiner Karte.': 'No areas on your map yet.',
  '{known} von {total} mit Belegen': '{known} of {total} with evidence',
  'Mission pro Bereich': 'Mission per area',
  'Eine Mission gehört zu einem Bereich. Füge zuerst einen hinzu.': 'A mission belongs to an area. Add one first.',
  'Merkblatt': 'Cheat sheet',
  'Wächst mit dem, was du ohne Hilfe zeigst.': 'Grows with what you show without help.',
  'Begriff': 'term',
  'Notizen des Agenten zu deinen Vorlieben': 'The agent’s notes on your preferences',
  'Noch keine. Füge einen Bereich hinzu.': 'None yet. Add an area.',
  'Kein nächster Schritt': 'No next step',
  'Läufe des Planer-Agenten': 'Planner agent runs',
  'Plan übernommen': 'Plan adopted',
  'läuft': 'running',
  '{n} Schritte': '{n} steps',
  'Werkzeuge:': 'Tools:',
  'KI-Aufrufe in dieser Sitzung: {calls}, davon {fallback} mit Rückfall auf vorbereitete Inhalte oder Regeln.': 'AI calls in this session: {calls}, of which {fallback} fell back to prepared content or rules.',
  'Deine Mission und deine Antworten in den Lektionen gehen an die KI, dein Name nicht.': 'Your mission and your answers in the lessons go to the AI, your name doesn’t.',
  'Video nicht erreichbar.': 'Video not reachable.',
  'Das Erklärvideo konnte nicht geladen werden. Du kannst die Lektion als Storyboard ansehen.': 'The explainer video could not be loaded. You can view the lesson as a storyboard.',
  'Das Videoformat ist ungültig.': 'The video format is invalid.',
  'Wiedergabe nicht möglich. Bitte versuche es nochmals.': 'Playback not possible. Please try again.',
  'Die Wiedergabe wurde unterbrochen. Bitte starte sie erneut.': 'Playback was interrupted. Please start it again.',
  'Keine Verbindung zum Server. Läuft das Backend?': 'No connection to the server. Is the backend running?',
  'Keins oder wenig': 'None or little',
  'Etwas': 'Some',
  'Viel': 'A lot',
  'Security+ Prüfung bestehen': 'Pass the Security+ exam',
  'Excel-Formeln für Auswertungen': 'Excel formulas for reports',
  'Spanisch für die Reise': 'Spanish for travelling',
  'Allgemein': 'General',
  'KI-Verbindung und Konto.': 'AI connection and account.',
  'Profil': 'Profile',
  'DCC-Profil, Lernstand und deine Missionen.': 'DCC profile, learning progress and your missions.',
  'Lernen': 'Learning',
  'Was du gezeigt und erledigt hast.': 'What you have shown and done.',
  'Agent': 'Agent',
  'Wie der Agent entschieden hat und warum.': 'How the agent decided and why.',
  'Ohne Hilfe gezeigt': 'Shown without help',
  'Fehlvorstellung korrigiert': 'Misconception corrected',
  'Mission geändert': 'Mission changed',
  'unbekannt': 'unknown',
  'am Üben': 'practising',
  'sicher': 'secure',
  'Termine und Fristen': 'Dates and deadlines',
  'Zahlen und Mengen': 'Numbers and amounts',
  'Entscheide und Status': 'Decisions and status',
  'Personen und Zuständigkeiten': 'People and responsibilities',
  'Bedingungen': 'Conditions',
  'Quelle prüfen': 'Check the source',
  'Was erledigt ist': 'What is done',
  'Was offen ist': 'What is open',
  'Wer beteiligt ist': 'Who is involved',
  'Termine': 'Dates',
  'Ton und Klarheit': 'Tone and clarity',
  'Für wen': 'For whom',
  'Umfang und Format': 'Length and format',
  'Was hinein muss': 'What must be in it',
  'Umgang mit fehlenden Angaben': 'Handling missing details',
  'Ergebnis prüfen': 'Check the result',
  'Absender-Adresse': 'Sender address',
  'Zeitdruck und Drohung': 'Time pressure and threats',
  'Unpersönliche Anrede': 'Impersonal greeting',
  'Linkziel': 'Link target',
  'Adresse der Webseite': 'Website address',
  'Abfrage sensibler Daten': 'Request for sensitive data',
  'Was du getan hast': 'What you did',
  'Fehlermeldung wörtlich': 'Exact error message',
  'Was du erwartet hast': 'What you expected',
  'Was du schon versucht hast': 'What you already tried',
  'Gerät und Programm': 'Device and program',
  'Anforderungen klären': 'Clarify the requirements',
  'Steigung der Tangente': 'Slope of the tangent',
  'Sekante wird Tangente': 'Secant becomes tangent',
  'Masse und Fallzeit': 'Mass and fall time',
  'Luftwiderstand': 'Air resistance',
  'Weiter im Lernweg': 'Next on the learning path',
  'Wiederholte Schwierigkeit': 'Repeated difficulty',
  'Unterfordert': 'Not challenged enough',
  'Start nach DCC-Profil': 'Start from the DCC profile',
  'Alternative gewählt': 'Alternative chosen',
  'Hilfe in der Aufgabe': 'Help in the exercise',
  'Bereich abgeschlossen': 'Area completed',
  'Bereich gewählt': 'Area chosen',
  'Mit KI klären: {0}': 'Clarify with the AI: {0}',
  '«{0}» ist neu auf deiner Karte.': '«{0}» is new on your map.',
  'Neue Lektion in «{0}» angefordert.': 'New lesson requested in «{0}».',
  'Du hast «{0}» eben hinzugefügt. Der Einstieg zeigt, wo du anfängst.': 'You just added «{0}». The introduction shows where you start.',
  'Weiter in «{0}» mit dem, was als Nächstes dran ist.': 'On in «{0}» with what comes next.',
  'Ein kurzer Einstieg sammelt erste Belege. Danach plant der Agent die nächsten Schritte nach deinen Ergebnissen.': 'A short introduction collects first evidence. Then the agent plans the next steps from your results.',
  'Die Regeln haben das Ziel aus deinen letzten Ergebnissen gewählt: was zuletzt gefehlt hat, sonst etwas ohne Belege.': 'The rules chose the goal from your latest results: what was missing last time, otherwise something without evidence.',
  'Noch kein Bereich auf der Karte.': 'No area on the map yet.',
  'Füge einen Bereich hinzu: ein eigenes Thema oder einen vorbereiteten Bereich.': 'Add an area: your own topic or a prepared area.',
  'Der Agent plant nur für Bereiche, die du gewählt hast.': 'The agent only plans for areas you have chosen.',
  '«{0}» hat keine DCC-Position.': '«{0}» has no DCC position.',
  'Start mit dem Einstieg in «{0}».': 'Start with the introduction to «{0}».',
  'Ein kurzer Einstieg sammelt erste Belege. Danach plant der Agent nach deinen Ergebnissen.': 'A short introduction collects first evidence. Then the agent plans from your results.',
  'Für «{0}» gibt es kein DCC-Resultat.': 'There is no DCC result for «{0}».',
  'DCC-Profil: {0} in «{1}».': 'DCC profile: {0} in «{1}».',
  'Für «{0}» fehlt ein DCC-Resultat. Ein kurzer Einstieg zeigt, wo du anfängst.': '«{0}» has no DCC result. A short introduction shows where you start.',
  'Laut DCC-Profil liegt in «{0}» dein grösster Entwicklungsbedarf.': 'According to your DCC profile, «{0}» is where you have the most to develop.',
  'Fehlende Werte heissen nicht geringe Kompetenz. Deshalb ein kurzer Einstieg statt eines ganzen Grundkurses.': 'Missing values don’t mean low competence. So a short introduction instead of a full basic course.',
  'Die Lektionen passen zu deiner DCC-Stufe. Die DCC-Position selbst ändert sich durch das Lernen hier nicht.': 'The lessons fit your DCC level. Learning here does not change the DCC position itself.',
  'Du hast «{0}» {1}× übersehen.': 'You missed «{0}» {1}×.',
  'Wenn derselbe Fehler wiederholt auftritt, fehlt meist ein Begriff, nicht Übung. Ein kurzes Gespräch mit Rückfragen klärt, woran man es erkennt. Danach übst du wieder alleine.': 'When the same mistake keeps happening, it’s usually a missing concept, not practice. A short conversation with questions clarifies how to spot it. Then you practise alone again.',
  'Die letzten zwei Lektionen in «{0}» ohne Hilfe gelöst.': 'Solved the last two lessons in «{0}» without help.',
  'Das klappt schon gut. Der Agent fügt eine anspruchsvollere Lektion ({0}) hinzu.': 'That already works well. The agent adds a harder lesson ({0}).',
  'Aufgaben, die zu leicht sind, bringen wenig. Eine Stufe höher bleibt es lehrreich. Die DCC-Stufe ändert sich dadurch nicht.': 'Exercises that are too easy teach little. One level up keeps it useful. This does not change the DCC level.',
  '«{0}» mit Hinweis gefunden.': 'Found «{0}» with a hint.',
  '«{0}» zuletzt übersehen.': 'Missed «{0}» last time.',
  'Bei «{0}» hast du einen Hinweis gebraucht.': 'You needed a hint for «{0}».',
  '«{0}» ist dir zuletzt entgangen.': 'You missed «{0}» last time.',
  'Ein weiteres Beispiel zur gleichen Sache zeigt, ob es jetzt alleine klappt.': 'Another example of the same thing shows whether it now works on your own.',
  'Letzte Lektion vollständig gelöst.': 'Last lesson fully solved.',
  'Letzte Lektion abgeschlossen.': 'Last lesson finished.',
  'Weiter in «{0}».': 'On in «{0}».',
  'Im gleichen Bereich weiterzumachen hilft, das Gelernte zu festigen.': 'Carrying on in the same area helps to consolidate what you learned.',
  'Alle geplanten Lektionen in «{0}» erledigt.': 'All planned lessons in «{0}» done.',
  'Weiter mit «{0}», dem nächsten Bereich nach deinem DCC-Profil.': 'On to «{0}», the next area according to your DCC profile.',
  'Die Reihenfolge folgt deinem DCC-Profil: zuerst die Bereiche mit dem grössten Bedarf.': 'The order follows your DCC profile: the areas with the most need first.',
  'Alle geplanten Lektionen erledigt.': 'All planned lessons done.',
  'Du hast alles auf deiner Karte erledigt.': 'You have done everything on your map.',
  'Füge einen neuen Bereich hinzu, oder lass in einem eigenen Bereich eine neue Lektion erzeugen.': 'Add a new area, or have a new lesson created in one of your own areas.',
  'Ich fasse Sitzungen mit KI zusammen und will keine erfundenen Termine verschicken': 'I summarise meetings with AI and don’t want to send out invented dates',
  'Ich lese viele Berichte und will Zahlen schnell an der Quelle prüfen': 'I read a lot of reports and want to check figures against the source quickly',
  'Ich recherchiere für die Arbeit und will wissen, welchen Angaben ich trauen kann': 'I research for work and want to know which information I can trust',
  'Ich will KI-Zusammenfassungen sicher gegen die Quelle prüfen.': 'I want to check AI summaries reliably against the source.',
  'Ich schreibe Status-Updates fürs Team und will, dass nichts untergeht': 'I write status updates for the team and want nothing to get lost',
  'Ich übergebe Arbeit an Kolleginnen und will klar sagen, was offen ist': 'I hand work over to colleagues and want to say clearly what is open',
  'Ich antworte Kundinnen per Mail und will freundlich und klar bleiben': 'I answer customers by email and want to stay friendly and clear',
  'Ich will Nachrichten schreiben, in denen Stand, Offenes und Termine klar sind.': 'I want to write messages where status, open points and dates are clear.',
  'Ich lasse die KI Protokolle schreiben und will brauchbare Ergebnisse': 'I have the AI write minutes and want usable results',
  'Ich erstelle Texte für Kundinnen und will der KI klare Aufträge geben': 'I write texts for customers and want to give the AI clear instructions',
  'Ich mache Präsentationen und will Inhalte mit KI schneller vorbereiten': 'I make presentations and want to prepare content faster with AI',
  'Ich will der KI Aufträge geben, die zum gewünschten Ergebnis führen.': 'I want to give the AI instructions that lead to the result I want.',
  'Ich beantworte Kundenmails und will Phishing sicher erkennen': 'I answer customer emails and want to spot phishing reliably',
  'Ich mache E-Banking und will gefälschte Login-Seiten erkennen': 'I use e-banking and want to recognise fake login pages',
  'Ich bekomme oft Paket-SMS und will wissen, welche echt sind': 'I often get parcel text messages and want to know which ones are real',
  'Ich will Phishing-Mails und gefälschte Webseiten sicher erkennen.': 'I want to spot phishing emails and fake websites reliably.',
  'Ich melde IT-Probleme und will, dass der Support schnell helfen kann': 'I report IT problems and want support to be able to help quickly',
  'Ich wähle neue Tools fürs Team und will die Anforderungen klären': 'I choose new tools for the team and want to clarify the requirements',
  'Ich helfe Kolleginnen bei Computerproblemen und will strukturiert vorgehen': 'I help colleagues with computer problems and want to work in a structured way',
  'Ich will technische Probleme so beschreiben, dass andere schnell helfen können.': 'I want to describe technical problems so that others can help quickly.',
  'Ich bereite mich auf eine Prüfung vor und will Ableitungen verstehen': 'I’m preparing for an exam and want to understand derivatives',
  'Ich will in der Arbeit Änderungsraten richtig deuten': 'I want to interpret rates of change correctly at work',
  'Ich helfe meinem Kind bei den Hausaufgaben in Mathe': 'I help my child with maths homework',
  'Ich will verstehen, was eine Ableitung bedeutet.': 'I want to understand what a derivative means.',
  'Ich will Alltagsbeobachtungen zum Fallen richtig erklären': 'I want to explain everyday observations about falling correctly',
  'Ich bereite mich auf eine Physikprüfung vor': 'I’m preparing for a physics exam',
  'Ich will meinem Kind erklären, warum alles gleich schnell fällt': 'I want to explain to my child why everything falls at the same speed',
  'Ich will verstehen, wovon die Fallzeit abhängt.': 'I want to understand what the fall time depends on.',
  'Schritte': 'Steps',
  'Satz {n} von {total}': 'Sentence {n} of {total}',
  'Steht das so in der Notiz?': 'Does the note say this?',
  'Übersicht': 'Overview',
  'Alles markiert. Prüfe deine Antworten oder ändere sie.': 'All marked. Check your answers or change them.',
  'Hinweise finden': 'Find the clues',
  'Entscheiden': 'Decide',
  'Tippe alles an, was dir verdächtig vorkommt.': 'Tap everything that looks suspicious to you.',
  'Weiter zum Entscheid': 'On to the decision',
  'Ist diese Nachricht echt oder Phishing?': 'Is this message real or phishing?',
  'Zurück zu den Hinweisen': 'Back to the clues',
  '{n} von {total} richtig': '{n} of {total} right',
  'Warum dieser Schritt?': 'Why this step?',
  'Erklärvideo erstellen': 'Create an explainer video',
  'Was möchtest du zuerst?': 'What would you like first?',
  'Ein Erklärvideo mit Fragen': 'An explainer video with questions',
  'Der Agent wählt eine passende Übung': 'The agent picks a suitable exercise',
  'Erklärvideo noch nicht verfügbar': 'Explainer video not available yet',
  'Dein Erklärvideo wird vorbereitet': 'Your explainer video is being prepared',
  'Sprache und Animation: {n} von {total} Szenen fertig.': 'Voice and animation: {n} of {total} scenes ready.',
  'Beim ersten Öffnen kann das etwas dauern. Danach ist das Video gespeichert.': 'The first time can take a moment. After that the video is saved.',
  'Die Vertonung ist gerade nicht möglich. Du kannst die Lektion als Storyboard ansehen.': 'The voice-over isn’t possible right now. You can view the lesson as a storyboard.',
  'Erklärvideo wird vorbereitet …': 'Preparing the explainer video …',
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

// The agent's texts come from the backend in German, filled in with names. These are their templates:
// a text that matches one is translated as a whole, and each {0} part on its own.
const AGENT_TEMPLATES = [
  "Mit KI klären: {0}",
  "«{0}» ist neu auf deiner Karte.",
  "Neue Lektion in «{0}» angefordert.",
  "Du hast «{0}» eben hinzugefügt. Der Einstieg zeigt, wo du anfängst.",
  "Weiter in «{0}» mit dem, was als Nächstes dran ist.",
  "«{0}» hat keine DCC-Position.",
  "Start mit dem Einstieg in «{0}».",
  "Für «{0}» gibt es kein DCC-Resultat.",
  "DCC-Profil: {0} in «{1}».",
  "Für «{0}» fehlt ein DCC-Resultat. Ein kurzer Einstieg zeigt, wo du anfängst.",
  "Laut DCC-Profil liegt in «{0}» dein grösster Entwicklungsbedarf.",
  "Du hast «{0}» {1}× übersehen.",
  "Die letzten zwei Lektionen in «{0}» ohne Hilfe gelöst.",
  "Das klappt schon gut. Der Agent fügt eine anspruchsvollere Lektion ({0}) hinzu.",
  "«{0}» mit Hinweis gefunden.",
  "«{0}» zuletzt übersehen.",
  "Bei «{0}» hast du einen Hinweis gebraucht.",
  "«{0}» ist dir zuletzt entgangen.",
  "Weiter in «{0}».",
  "Alle geplanten Lektionen in «{0}» erledigt.",
  "Weiter mit «{0}», dem nächsten Bereich nach deinem DCC-Profil.",
].map((key) => {
  const parts = key.split(/\{\d\}/).map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return { key, re: new RegExp(`^${parts.join('(.+?)')}$`) };
});

function translate(dict: Record<string, string>, de: string): string {
  const hit = dict[de];
  if (hit !== undefined) return hit;
  for (const { key, re } of AGENT_TEMPLATES) {
    const m = re.exec(de);
    if (m && dict[key]) return dict[key].replace(/\{(\d)\}/g, (_, i: string) => translate(dict, m[Number(i) + 1]));
  }
  return de;
}

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
    document.title = LANGS.find((l) => l.code === lang)?.title ?? 'Owl for Learn45';
  }, [lang]);

  const value = useMemo<I18n>(() => {
    // A string without a translation stays German, the source language.
    const dict = DICT[lang];
    const t = (de: string, vars?: Record<string, string | number>) => fill(dict ? translate(dict, de) : de, vars);
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
