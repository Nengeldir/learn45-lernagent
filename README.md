# Lernagent für Learn45

Prototyp für den Zentral Hack 2026 (Challenge CoreTeam AG). Eine PWA mit Frontend und Backend.

Die Lernkarte ist eine Mindmap mit dir in der Mitte. Sie beginnt leer: Du wählst, was du lernen willst. Das kann ein eigenes Thema sein, zum Beispiel «Security+ Prüfung bestehen». Dann plant der Agent den Bereich mit der KI. Oder du nimmst einen vorbereiteten Bereich: die fünf DigComp-Bereiche, Mathematik oder Naturwissenschaften. Geplante Lektionen sind blass. Der Agent hebt den nächsten Schritt hervor, begründet ihn und bietet eine Alternative an. Während du lernst, wächst die Karte: Der Agent hängt neue Knoten an, wenn etwas zweimal schwierig war oder zu leicht ist.

Mit KI arbeitet der Agent wie eine Lehrperson (nach dem Skill «teach» von mattpocock/skills). Pro Bereich kennt er deine Mission, schreibt Lerneinträge mit Belegen und erzeugt kurze Lektionen, die zu dir passen. Die Regeln bleiben als Prüfung und als Rückfall. Dein Fortschritt liegt auf der Festplatte und übersteht einen Neustart.

Die Spielmechanik kommt später. Alle Daten sind synthetisch.

## Starten

Voraussetzung: Node.js 22.9 oder neuer.

```bash
npm install
npm run build     # baut das Frontend
npm start         # http://localhost:8787
```

Zum Entwickeln mit Hot Reload:

```bash
npm run dev       # Frontend http://localhost:5173, API auf 8787
```

Tests und Typprüfung:

```bash
npm test
npm run typecheck
```

### KI-Anbindung (optional)

Ohne Schlüssel läuft alles mit vorbereiteten Inhalten. Diese sind in der App als «Vorbereitet» gekennzeichnet.

Für echte KI-Antworten `backend/.env.example` nach `backend/.env` kopieren und ausfüllen:

```
MODEL_PROVIDER=anthropic
ANTHROPIC_API_KEY=...
ANTHROPIC_MODEL=claude-haiku-5-5
```

Der Schlüssel bleibt im Backend. Der Browser spricht nie direkt mit einem Modell. Antwortet das Modell im Chat nicht innerhalb von 8 Sekunden, nimmt die App die vorbereitete Antwort und kennzeichnet sie. Was an das Modell geht, steht unter «Datenschutz».

Der Planer-Agent läuft nur mit `MODEL_PROVIDER=anthropic` (Werkzeuge über die Messages API). Er nutzt `ANTHROPIC_PLANNER_MODEL` (Standard `claude-opus-5-5` mit tiefer Denkstufe, damit ein Schritt in 20 Sekunden passt). Mit `openai` oder ohne Anbieter planen nur die Regeln.

## Anmeldung und DCC

Zur Anmeldung reicht ein Name. Das DCC-Profil ist freiwillig. Es bestimmt nur die Stufen der vorbereiteten Bereiche der Digitalen Kompetenz. Zwei Wege:

1. **Resultat laden**: eine JSON-Datei im Format unten. Drei Beispiele liegen in `frontend/public/dcc-beispiele/` und lassen sich auf der Anmeldeseite herunterladen.
2. **Stufen eingeben**: pro Bereich Grundstufe, Mittelstufe, Fortgeschritten oder «nicht erhoben».

```json
{
  "type": "dcc-result",
  "version": 1,
  "synthetic": true,
  "assessedOn": "2026-09-14",
  "areas": [
    { "area": "1", "name": "Informations- und Datenkompetenz", "level": "Grundstufe" },
    { "area": "2", "name": "Kommunikation und Zusammenarbeit", "level": "Mittelstufe" },
    { "area": "3", "name": "Erstellung digitaler Inhalte", "level": "Grundstufe" },
    { "area": "4", "name": "Sicherheit", "level": "Mittelstufe" },
    { "area": "5", "name": "Problemlösen", "level": null }
  ]
}
```

Das DCC ist die einzige Quelle für Stufen. Lernen in der App ändert das DCC-Profil nie. Ein fehlender Wert heisst «nicht erhoben», nicht «tief».

## Bereiche wählen

Nach der Anmeldung ist die Karte leer. Mit «Bereich hinzufügen» kommt dazu:

- **Eigenes Thema**: Thema, wofür du es brauchst (freiwillig) und dein Vorwissen. Der Agent plant den Bereich mit der KI: einen Namen, 3 bis 6 Kriterien mit Faustregeln, drei Missionsvorschläge, die passenden Lektionsarten und 2 bis 5 Quellen. Der Server prüft den Entwurf. Von den Quellen bleiben nur Adressen, die beim Anlegen antworten (404 und 410 fallen weg). Danach erzeugt der Generator den ersten Einstieg, auf der Stufe deines Vorwissens. Erst wenn Entwurf und Einstieg gültig sind, kommt der Bereich auf die Karte. Was du unter «Wofür» schreibst, wird deine Mission.
- **Vorbereiteter Bereich**: aus `data/skills.json`, mit geprüften Quellen und vorbereiteten Lektionen. Das geht auch ohne KI. Mehrere auf einmal sind möglich, zum Beispiel alle fünf DigComp-Bereiche.

Eigene Bereiche haben keine vorbereiteten Lektionen. Der Agent erzeugt jede weitere Lektion. Läuft er nicht oder scheitert er, nehmen die Regeln eine gültige Lektion, die der Agent im Lauf schon erzeugt hat. Gibt es keine, wählen sie selbst das Ziel: das zuletzt verpasste Kriterium, sonst eines ohne Belege. Fällige Wiederholungen werden beigemischt. Nach zwei glatten Lektionen geht es eine Stufe höher. Ist im Bereich nichts mehr offen, gibt es den Knopf «Neue Lektion in …».

## Lektionsarten

| Art | Beispiel | Bewertung |
|---|---|---|
| Video | «Warum erfindet eine KI Angaben?» | Fragen unterwegs, Regel |
| Text prüfen | KI-Zusammenfassung mit der Notiz vergleichen | Regel |
| Webseite prüfen | Phishing-Mail und gefälschte Login-Seite | Regel |
| Mit der KI | Tutor, Rollenspiel, Auftrag an die KI formulieren | Modell, sonst Stichworte |

«Was ist eine Ableitung?» ist als gesprochenes Erklärvideo mit vier animierten Szenen umgesetzt. Es enthält deutsche Sprachausgabe, zeitlich passende Untertitel und die beiden bisherigen Fragen nach Szene 2 und 4. Die übrigen Videos bleiben Storyboards.

Die Ableitungslektion liegt unter Mathematik → Ableitung auf der Lernkarte. Abspielen, Pause, Zurückspulen, Ton und Untertitel funktionieren im Lektionsfenster. Unbeantwortete Fragen lassen sich nicht überspringen. Die Antworten werden wie bisher im Backend bewertet. Kann das Video nicht geladen werden, lässt sich auf das Storyboard wechseln.

### Ableitungsvideo neu erzeugen

Die mitgelieferte Lektion enthält deutsche ElevenLabs-Sprachausgabe (Lily, `eleven_multilingual_v2`) und läuft ohne API-Schlüssel. Sie nutzt ein geprüftes Drehbuch und feste Szenenvorlagen; freie Themengenerierung ist noch nicht umgesetzt. Die Darstellung verwendet eine eigenständige, versionierte Kopie der animlib aus OwlYouNeed in `packages/animlib`. Das andere Repository wird weder zur Laufzeit benötigt noch verändert.

```bash
npm run video:build
```

Nur die Darstellung nach einer Änderung an den Szenenvorlagen aktualisieren, ohne neue Sprache zu erzeugen oder einen Sprachdienst aufzurufen:

```bash
npm run video:build -- --visuals-only
```

Ohne Sprachdienst-Konfiguration erzeugen macOS `say` (deutsche Stimme Anna) und `ffmpeg` die Sprache lokal. Dafür muss `ffmpeg` im Suchpfad liegen; alternativ `FFMPEG_PATH` setzen. Die Länge jeder tatsächlich erzeugten Sprachpassage bestimmt Untertitel und Animation. Zum Abspielen der vorhandenen Lektion werden diese Werkzeuge nicht benötigt.

Zum erneuten Erzeugen mit ElevenLabs in `backend/.env` konfigurieren:

```dotenv
VIDEO_SPEECH_PROVIDER=elevenlabs
ELEVENLABS_API_KEY=...
ELEVENLABS_VOICE_ID=...
ELEVENLABS_MODEL_ID=eleven_multilingual_v2
```

Danach `npm run video:build` und `npm run build` ausführen. Schlüssel bleiben lokal; die App enthält nur fertige Audiodateien. Ein abgebrochener kostenpflichtiger Aufruf wird nicht automatisch wiederholt. Erst wenn alle vier Szenen erzeugt und geprüft sind, wird das neue Manifest veröffentlicht.

Das Drehbuch steht in `data/videos/derivative.json`, die Vorlagen in `scripts/video/derivative-scenes.ts`. Die fertigen WAV-Dateien und das Manifest liegen in `frontend/public/videos/math-v1/`. Das Manifest enthält keine Lösungen. Dies sind browsergerenderte Animationen mit Ton, keine MP4-Dateien. Renderer und Sprachdateien werden bei Bedarf aus dem Netz geladen; bei einem Ladefehler bleibt der Storyboard-Wechsel verfügbar.

`npm test` prüft zusätzlich die Szenen- und Audiodauer, Renderbarkeit, Fragenpausen, Spulen, Wiederabspielen und die Übergabe an den Lernverlauf. `npm run typecheck` prüft auch den Videogenerator.

Lösungen bleiben im Backend. Der Browser bekommt die Lektionen ohne Lösungen.

## Wie der Agent entscheidet

Die Regeln antworten sofort. Mit KI plant danach der Planer-Agent (A1), und die Regeln prüfen seinen Plan. Ohne KI gelten die Regeln allein, angeschrieben als «Plan nach Regeln».

| Regel | Wann | Was |
|---|---|---|
| R8 Bereich gewählt | du hast eben einen Bereich hinzugefügt oder eine neue Lektion verlangt | der Einstieg oder die neue Lektion in diesem Bereich |
| R3 Start nach DCC-Profil | noch nichts gelernt | zuerst Bereiche in der Grundstufe, dann nicht erhobene (kurzer Einstieg), dann höhere Stufen, dann Bereiche ohne DCC |
| R0 Weiter im Lernweg | nach jeder Lektion | nächste Lektion im Bereich, zielt auf das, was gefehlt hat |
| R1 Wiederholte Schwierigkeit | gleiches Kriterium zweimal verpasst | neuer Knoten «Mit KI klären: ...» plus eine Alternative zum Alleine-Üben |
| R2 Unterfordert | die letzten zwei Lektionen im Bereich ohne Hilfe gelöst | neuer Knoten mit einer Lektion eine Stufe höher |
| R4 Wenig Zeit | Lektion passt nicht in die Restzeit | kürzerer Schritt, der längere bleibt Alternative |
| R7 Bereich abgeschlossen | Bereich fertig | weiter zum nächsten Bereich; ist nichts mehr offen oder die Karte leer: einen Bereich hinzufügen |
| A1 Agent-Plan | nach jeder Lektion, wenn der Planer-Agent läuft | Plan des Agenten, von den Regeln geprüft (siehe unten), Tags «KI» und «Regel» |

### Der Planer-Agent (A1)

Nach jeder Lektion zeigt die App sofort den Vorschlag der Regeln, markiert als «vorläufig». Im Hintergrund startet der Agent. Das Frontend fragt alle 1,5 Sekunden nach. Ist der Agent fertig und sein Plan gültig, ersetzt dieser den vorläufigen Vorschlag. Die App meldet dann «Der Agent hat deinen Plan angepasst».

Der Agent arbeitet in einer Schleife mit Werkzeugen: höchstens 6 Schritte, 45 Sekunden gesamt und 20 Sekunden pro Aufruf.

| Werkzeug | Was es tut |
|---|---|
| `get_learner_state(trackId)` | Mission, DCC-Stufe nur dieses Bereichs, aktive Lerneinträge, letzte 5 Ergebnisse, fällige Wiederholungen, Restzeit, Karte des Bereichs |
| `list_pool_lessons(trackId, criterion?)` | vorbereitete und schon erzeugte Lektionen |
| `generate_lesson({type, trackId, criterion, level, contextHint, reviewOf?})` | erzeugt und prüft eine Lektion; bei Fehlern kommen sie zurück, ein zweiter Versuch ist erlaubt |
| `add_to_map(lessonId, parentNodeId)` | neuer Knoten, höchstens 2 pro Lauf |
| `write_learning_record({...})` | Lerneintrag; der Server prüft die Belege |
| `update_reference(trackId, entry)` | Merkblatt, nur für ohne Hilfe Gezeigtes |
| `note_preference(text)` | Vorliebe in `notes.md` |
| `recommend({nodeId, alternativeNodeId, reason, basedOn})` | beendet die Schleife |

Der Systemprompt enthält die Grundsätze aus «teach»: Zone der nächsten Entwicklung, eine Sache pro Lektion, Wissen leicht und Übung fordernd, jede Lektion hängt an der Mission, Abrufen, Abstand und Mischen, kein eigenes Wissen ausserhalb der Quellen.

Bevor A1 gilt, prüfen die Regeln:

- Der Knoten existiert und ist erreichbar.
- Die Lektion passt in die Restzeit (R4).
- Es gibt eine erreichbare Alternative, sobald ausser der Empfehlung ein anderer Knoten erreichbar ist. Mit nur einem Bereich und einem neuen Knoten bleibt sie leer.
- Die Begründung nennt mindestens einen Lerneintrag (`LR-…`) oder ein Ereignis (`ev-…`), und alle genannten IDs gibt es.

Fällt eine Prüfung durch, gilt der Plan der Regeln. Das gilt auch, wenn das Modell ausfällt, die Zeit abläuft oder beide Versuche einer Lektion ungültig sind. Der Grund steht im Verlauf unter «Läufe des Planer-Agenten». Hat die Person inzwischen schon eine Lektion gestartet, verwirft die App den Plan des Agenten.

Grenzen: 1 Lauf pro abgeschlossene Lektion, höchstens 10 erzeugte Lektionen pro Sitzung.

### KI zuerst, vorbereitete Lektionen als Rückfall

- **Mit KI** startet jeder vorbereitete Bereich mit einem Einstieg (die erste Lektion nach DCC-Stufe). Die weiteren Lektionen erzeugt der Agent.
- Der Agent darf eine vorbereitete Lektion erst anhängen, wenn die Erzeugung gescheitert ist oder die Grenze von 10 erreicht ist.
- Nimmt der vorläufige Plan der Regeln eine vorbereitete Lektion auf die Karte, verschwindet dieser Knoten wieder, sobald der Plan des Agenten gilt. Ausnahme: Der Agent hat ihn selbst gewählt.
- Scheitert der Agent, holen die Regeln die vorbereiteten Lektionen dieses Bereichs auf die Karte und planen damit.
- **Ohne KI** zeigt die Karte für jeden vorbereiteten Bereich den ganzen Plan aus vorbereiteten Lektionen. Eigene Bereiche gibt es ohne KI nicht.

### Erzeugte Lektionen

Der Agent erfindet keine neuen Lektionsarten. Er füllt nur Inhalte in die vier bestehenden Arten. Jede erzeugte Lektion geht durch denselben Validator wie die Dateien in `data/lessons/` (`backend/src/validate.ts`):

- Schema pro Art, höchstens 5 Minuten, Schweizer Schreibweise ohne ß.
- Text prüfen: mindestens ein erfundener Satz mit einem Kriterium des Bereichs.
- Webseite prüfen: nur erfundene Marken und `.example`-Adressen. Entscheid und Warnzeichen passen zusammen.
- Quiz: Alle Antworten einer Frage haben gleich viele Wörter. Der Server setzt die richtige Antwort in jeder Frage an eine andere Stelle. Steht sie in jeder Frage an derselben Stelle, lehnt der Validator die Lektion ab.
- Eine Primärquelle aus `data/resources/<trackId>.md`, bei eigenen Bereichen aus den Quellen des Bereichs.
- Bei eigenen Bereichen nur die Lektionsarten, die der Bereich nennt.

Ungültige Lektionen werden verworfen und protokolliert. In der App heissen erzeugte Lektionen «Von der KI erstellt», ihre Beispiele «Beispiel erfunden». Vorbereitete Lektionen heissen weiter «Vorbereitet».

`data/resources/<trackId>.md` listet geprüfte Quellen, zum Beispiel BACS, S-U-P-E-R.ch, «eBanking – aber sicher!» und DigComp 2.2. Jeder Link wurde am 24.10.2026 geöffnet. Was sich nicht prüfen liess, steht unter `## Gaps`.

### Lerneinträge, Lernstand und Wiederholung

Ein Lerneintrag ist eine Erkenntnis mit Belegen, kein Protokoll. Behandelt ist nicht gelernt. Es gibt vier Arten:

| Art | Beleg, den der Server verlangt |
|---|---|
| `demonstrated` | In allen genannten Ereignissen ist das Kriterium alleine, ohne Hinweis und beim ersten Prüfen erfüllt |
| `misconception` | ein Ereignis mit verpasstem Kriterium und ein späteres, in dem es ohne Hinweis erfüllt ist |
| `prior-knowledge` | ein Ereignis in diesem Bereich |
| `mission-shift` | eine von der Person bestätigte Missionsänderung (`mi-…`) |

Einträge haben `status: active` oder `superseded by LR-n`. Die Regeln schreiben `demonstrated` und `misconception` selbst, auch ohne KI. Der Agent kann weitere schreiben.

Der Lernstand pro Kriterium kommt nur aus den Lerneinträgen:

- «unbekannt»: kein Eintrag.
- «am Üben»: Fehlvorstellung korrigiert, oder nach «sicher» wieder verpasst.
- «sicher»: ohne Hilfe gezeigt.

Er steht getrennt vom DCC unter «Lernstand (aus dem Lernen, kein DCC)».

Wird ein Kriterium «demonstrated», kommt es in die Wiederholung. Sie ist fällig nach 2 weiteren Lektionen oder in der nächsten Sitzung. Der Agent kann dann eine kurze gemischte Wiederholung erzeugen (`reviewOf`).

## Lernumgebung pro Person

Jede Person hat einen Ordner unter `backend/var/learners/<learnerId>/` (nicht in git). Jede Datei wird zuerst als Temp-Datei geschrieben und dann umbenannt.

```
profile.json                       Name, Erstellt am, DCC-Stände (Datum, Quelle)
state.json                         Karte, Ereignisse, Empfehlungen, Beobachtungen, Wiederholung, Läufe des Agenten
tracks/<trackId>.json              eigene Bereiche: Kriterien, Missionsvorschläge, Quellen, Lektionsarten, Thema, Vorwissen
missions/<trackId>.md              Mission pro Bereich
learning-records/0001-<slug>.md    Lerneinträge mit Frontmatter (track, criterion, kind, status, evidence)
lessons/0001-<slug>.json           erzeugte Lektionen mit Herkunft (Modell, Zeit, basedOn, Quelle)
reference/<trackId>.md             Merkblatt pro Bereich
notes.md                           Vorlieben, zum Beispiel «mag kurze Lektionen»
```

- **Anmelden mit einem bekannten Namen** (Gross- und Kleinschreibung egal): «Weitermachen» setzt die bestehende Person fort, «Neu beginnen» legt eine neue an. Nichts wird gelöscht.
- **Neues DCC-Resultat**: Es kommt als neuer Stand dazu, wenn es sich vom letzten unterscheidet. Lerneinträge bleiben. Bereiche ohne erledigte Lektion bekommen einen neuen Plan.
- **Mission**: Beim ersten Öffnen eines Bereichs fragt die App nach der Mission: drei Vorschläge oder eigene Worte. Überspringen geht auch, dann gilt ein Standard. Eine Änderung im Profil braucht eine Bestätigung und wird als `mission-shift` festgehalten.

## Datenschutz

- Das Modell bekommt nie den Namen und nie die ID der Person.
- Der Agent bekommt nur die DCC-Stufe des Bereichs, den er plant, nie das ganze Profil. Knoten anderer Bereiche sieht er nur als ID, ohne Titel.
- An die KI gehen: die Übung, die Antworten der Person, die Mission und die Vorlieben aus `notes.md`. Bei einem eigenen Bereich ausserdem Thema, Wofür und Vorwissen. Die App sagt das bei der Mission, im Profil und beim Anlegen.
- Eigene Bereiche gehören nur der Person, die sie angelegt hat. Andere Sitzungen können sie nicht ansprechen.
- Kein Werkzeug und kein Code ändert DCC-Stufen. Lernen, Transfer und DCC bleiben getrennt.
- Schlüssel liegen nur in `backend/.env`, nie im Frontend oder im Repo.

Jede Empfehlung zeigt: was der Agent gesehen hat, den Vorschlag, warum das jetzt hilft und die Regel. Wer die Alternative startet, lehnt die Empfehlung ab. Das wird im Verlauf festgehalten und der Agent plant danach neu.

Hilfe innerhalb einer Lektion (Hinweis nach dem Prüfen) wird vermerkt. Eine Beobachtung wie «Termine und Fristen 2× übersehen» gilt erst als erledigt, wenn das Kriterium ohne Hilfe gelöst wurde.

Unter «Profil und Verlauf» stehen getrennt: DCC-Profil (nur lesen), Lernstand (aus dem Lernen, kein DCC), Mission pro Bereich, Lerneinträge (aktiv und ersetzt), Merkblatt, Entscheidungen des Agenten mit seinen Läufen, Lernverlauf, Beobachtungen und Transfer-Hinweise für die eigene Arbeit.

## Aufbau

```
shared/      gemeinsame Typen
backend/     Express-API, Agent, Bewertung, Modell-Anbindung
  src/agent.ts      Plan aus dem DCC, Regeln R0 bis R8, neue Knoten
  src/tracks.ts     Bereiche einer Person: vorbereitete auf ihrer Karte und eigene
  src/designer.ts   eigenen Bereich mit der KI planen, Entwurf und Quellen prüfen
  src/ownlessons.ts Lektionen für eigene Bereiche: Einstieg und Ziel nach Regeln
  src/planner.ts    Planer-Agent (A1): Werkzeuge, Schleife, Rückfall
  src/guard.ts      Prüfung des Agenten-Plans durch die Regeln
  src/generator.ts  Lektionen erzeugen, Quiz mischen
  src/validate.ts   Validator für alle Lektionen
  src/records.ts    Lerneinträge, Belege, Lernstand, Wiederholung, Merkblatt
  src/workspace.ts  Ordner pro Person auf der Festplatte
  src/sessions.ts   Anmelden, Lektionen, Missionen
  src/dcc.ts        DCC-Datei und Eingabe prüfen
  src/judge.ts      Bewertung nach Regeln
  src/services.ts   Chat, Hinweise, Bewertung mit Modell oder Rückfall
  src/provider.ts   Anthropic, OpenAI, Mock oder keine; Werkzeuge für den Agenten
  test/             Tests für API, Agent, Validator und Speicher (Mock-Modell)
data/        Bereiche, Kriterien, Missionsvorschläge, Lektionen (JSON) und Quellen (resources/*.md)
frontend/    React-PWA: Anmeldung, Mindmap, Lektionen
```

Neue Lektionen kommen als JSON nach `data/lessons/`. Beim Start prüft das Backend alle Dateien mit demselben Validator wie erzeugte Lektionen. Ungültige werden verworfen und protokolliert.

## Grenzen

- Keine Spielmechanik (kommt später).
- Eigene Bereiche nur mit KI. Ihre Quellen schlägt die KI vor. Geprüft wird nur, ob die Adresse antwortet, nicht der Inhalt. Die App sagt das bei jeder Lektion und im Bereich.
- Bereiche lassen sich noch nicht von der Karte entfernen. Höchstens 8 eigene Bereiche.
- Kein Lernen mit anderen Personen. Die Modi sind «Alleine» und «Mit KI». Der Teil «Wisdom/Community» aus «teach» kommt mit diesem Modus.
- Nur die Ableitungslektion hat ein fertiges Erklärvideo; die übrigen Videos sind Storyboards. Erzeugte Videos nutzen nur die einfachen Bilder «steps» und «url-parts».
- Keine echte Anmeldung: Name und DCC-Resultat reichen. Wer den Namen kennt, kann weitermachen.
- Der Speicher ist ein Ordner pro Person, ohne Datenbank und ohne Sperren für mehrere Server.
- Der Planer-Agent läuft nur mit Anthropic. Mit OpenAI planen die Regeln.
- Ein neues DCC-Resultat plant nur Bereiche neu, in denen noch nichts erledigt ist.
- Die Liste echter Marken im Validator ist nicht vollständig. Der Hauptschutz sind die `.example`-Adressen.
