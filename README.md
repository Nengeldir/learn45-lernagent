# AIthena für Learn45

AIthena ist ein Lernagent als PWA, ein Prototyp für den Zentral Hack 2026 (Challenge CoreTeam AG). Die Person sagt, was sie lernen will. Der Agent plant dazu kurze Lektionen: Videos, Podcasts, Übungen und Gespräche mit der KI. Er merkt sich, was die Person schon kann, und schlägt den nächsten Schritt vor.

- Läuft auch ohne KI, mit vorbereiteten Inhalten.
- Mit KI (Anthropic oder OpenAI) entstehen eigene Bereiche und neue Lektionen, die der Server vor der Anzeige prüft.
- Der Fortschritt liegt pro Person auf der Festplatte und übersteht einen Neustart.
- Lektionen geben Erfahrungspunkte, Level und Abzeichen, ohne Punkteverlust bei Pausen oder Fehlern.
- Alle Daten sind synthetisch.

Die Lernenden sind oft wenig vertraut mit Computern. Darum hat jede Ansicht eine klare Hauptaktion mit grossem Knopf, die Texte sind einfach und gross, und Fachbegriffe (DCC, Lernstand, Regeln, Lerneinträge) stehen erst in den Einstellungen.

**Inhalt:** [Starten](#starten) · [Die App](#die-app) · [Fortschritt und Belohnungen](#fortschritt-und-belohnungen) · [Anmeldung und DCC](#anmeldung-und-dcc) · [Bereiche hinzufügen](#bereiche-hinzufügen) · [Nächstes Thema und Format](#nächstes-thema-und-format-wählen) · [Lektionsarten](#lektionsarten) · [Im Lektionsfenster](#im-lektionsfenster) · [Videos und Podcasts erzeugen](#videos-und-podcasts-erzeugen) · [Wie der Agent entscheidet](#wie-der-agent-entscheidet) · [Lernumgebung pro Person](#lernumgebung-pro-person) · [Datenschutz](#datenschutz) · [Aufbau](#aufbau) · [Grenzen](#grenzen)

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

Ohne Schlüssel läuft alles mit vorbereiteten Inhalten. Vorbereitete Antworten und Hinweise sind in der App als «Vorbereitet» gekennzeichnet.

Für echte KI-Antworten `backend/.env.example` nach `backend/.env` kopieren und ausfüllen. Mit Anthropic (Messages API):

```dotenv
MODEL_PROVIDER=anthropic
ANTHROPIC_API_KEY=...
ANTHROPIC_MODEL=claude-haiku-5-5          # Chat, Hinweise, Beurteilung
ANTHROPIC_PLANNER_MODEL=claude-opus-5-5   # Planung, neue Bereiche, Lektionen
```

Oder mit OpenAI (Responses API; ein reiner Chat-Completions-Endpunkt reicht nicht):

```dotenv
MODEL_PROVIDER=openai
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-6-luna                   # Chat, Hinweise, Beurteilung
OPENAI_PLANNER_MODEL=gpt-6-sol            # Planung, neue Bereiche, Lektionen
OPENAI_REASONING_EFFORT=low
OPENAI_PLANNER_REASONING_EFFORT=low
```

Ohne `OPENAI_PLANNER_MODEL` nimmt die App `OPENAI_MODEL`. Beide Denkstufen sind standardmässig `low`.

Der Schlüssel bleibt im Backend. Der Browser spricht nie direkt mit einem Modell. Antwortet das Modell nicht innerhalb von 8 Sekunden, nimmt die App die vorbereitete Antwort und kennzeichnet sie. Scheitert ein Plan, übernehmen die Regeln. Was an das Modell geht, steht unter [Datenschutz](#datenschutz).

### Weitere Einstellungen

Alle in `backend/.env`, alle optional:

| Variable | Standard | Wofür |
|---|---|---|
| `PORT` | `8787` | Port des Servers |
| `ACCESS_USERS` | leer (keine Anmeldung) | Anmeldung für eine öffentliche Instanz, `name:passwort` durch Kommas getrennt (siehe [Online stellen](#online-stellen)) |
| `MODEL_TIMEOUT_MS` | `8000` | Wartezeit pro Modellaufruf, danach vorbereitete Inhalte |
| `PLANNER_TOTAL_MS`, `PLANNER_CALL_MS` | `45000`, `20000` | Zeitgrenzen des Planer-Agenten: ganzer Lauf und pro Aufruf |
| `LEARNER_DIR` | `backend/var/learners` | Ordner der Lernumgebungen |
| `VIDEO_SPEECH_PROVIDER` | `local` | `local` (macOS `say` und `ffmpeg`) oder `elevenlabs` |
| `VIDEO_LOCAL_VOICE`, `VIDEO_LOCAL_SECOND_VOICE` | `Anna`, `Markus` | lokale Stimmen; die zweite für Podcasts |
| `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`, `ELEVENLABS_SECOND_VOICE_ID`, `ELEVENLABS_MODEL_ID` | Modell `eleven_multilingual_v2` | Sprache mit ElevenLabs, auf jeder Plattform |
| `FFMPEG_PATH` | `ffmpeg` im Suchpfad | für die lokale Sprache |
| `VIDEO_CACHE_DIR`, `VIDEO_SPEECH_CACHE_DIR`, `PODCAST_CACHE_DIR` | unter `backend/var/` | Speicherorte für erzeugte Videos, Sprache und Podcasts |

Die mitgelieferten Lektionen laufen ohne Sprachdienst. Einen braucht es nur für neue Videos und Podcasts.

### Online stellen

`railway.json` beschreibt den Betrieb auf Railway: `npm run build`, dann `npm start`, mit `/api/health` als Gesundheitsprüfung. Ein Server liefert API und Oberfläche aus.

- **Anmeldung.** Ohne Anmeldung kann jede Person mit dem Link die App nutzen, auf Kosten des eigenen Modellschlüssels. Deshalb `ACCESS_USERS` setzen, etwa `owner:langes-geheimnis,jury:anderes-geheimnis`. Der Browser fragt dann nach Name und Passwort. Offen bleibt nur `/api/health`. Wer einen eigenen Eintrag hat, behält den Zugang, wenn ein anderer Eintrag entfernt wird.
- **Speicher.** Das Dateisystem von Railway wird bei jedem Deploy geleert. Ein Volume anhängen, etwa unter `/data`, und `LEARNER_DIR=/data/learners`, `VIDEO_CACHE_DIR=/data/videos`, `VIDEO_SPEECH_CACHE_DIR=/data/video-speech` und `PODCAST_CACHE_DIR=/data/podcasts` setzen.
- **Sprache.** `local` braucht macOS. Für neue Videos und Podcasts `VIDEO_SPEECH_PROVIDER=elevenlabs` mit den ElevenLabs-Schlüsseln setzen.
- **Zugang entziehen.** Den Eintrag aus `ACCESS_USERS` löschen; Railway startet neu, und das alte Passwort gilt nicht mehr.

## Die App

**Startseite.** «Was möchtest du lernen?» listet die Bereiche (Digitale Kompetenz, Mathematik, Naturwissenschaften, Eigene Themen) mit ihren Themen, etwa «Kommunikation und Zusammenarbeit». Ein Tipp auf ein Thema öffnet es; ist es noch nicht dabei, kommt es dazu. Oben stehen XP, Level, Tages- und Wochenziel und «Weiterlernen» mit dem zuletzt bearbeiteten Thema, unten die Abzeichen.

**Ein Thema** ist ein Aufstieg über Berge. Jede geschaffte Lektion ist ein Schritt, sechs Schritte führen auf einen Gipfel, danach beginnt der nächste Berg (`frontend/src/path/mountains.ts`). Die Schritte stehen in der Reihenfolge, in der sie geschafft wurden (`frontend/src/path/order.ts`). Der sechste Schritt ist die Gipfelprüfung (siehe unten). Danach steht der Berg unter «Geschaffte Berge» und heisst nach dem Kriterium, das seine Lektionen am meisten geübt haben; der nächste Berg beginnt leer. Unter den Schritten steht «Wie geht es weiter?» mit der Wahl von Thema und Format (siehe [Nächstes Thema und Format wählen](#nächstes-thema-und-format-wählen)).

**Lernkarte.** «Alles als Karte ansehen» zeigt alles als Mindmap mit der Person in der Mitte. Sie beginnt leer und wächst mit jedem Bereich und jeder Lektion. Geplante Lektionen sind blass. Ein Tipp auf einen Knoten öffnet den Seitenbereich mit der Lektion, dem Vorschlag des Agenten und seiner Begründung.

**Sprachen und Erscheinungsbild.** Die Oberfläche gibt es auf Deutsch, Französisch, Italienisch, Rätoromanisch und Englisch, hell, dunkel oder nach dem System. Deutsch ist die Ausgangssprache; gespeicherte DCC-Stufen bleiben deutsch.

**Einstellungen.** «Mein Konto» oben rechts öffnet sie, mit vier Reitern:

- **Allgemein**: Sprache, Erscheinungsbild, KI-Verbindung für die Demo trennen, Abmelden.
- **Profil**: DCC-Profil (nur lesen), Lernstand aus dem Lernen, persönliches Ziel (Mission) pro Bereich.
- **Lernen**: Lerneinträge, Merkblatt, Notizen des Agenten zu den Vorlieben, Lernverlauf, Beobachtungen.
- **Agent**: Entscheidungen des Agenten und Läufe des Planer-Agenten.

## Fortschritt und Belohnungen

Abgeschlossene Lektionen geben Erfahrungspunkte (XP): 40 XP für den ersten Abschluss einer Lektion und bis zu 60 XP für erreichte Lernziele. Jedes Format zählt gleich viel; Tipps und Lerntempo ändern die Punkte nicht. Bei Wiederholungen zählt nur die Verbesserung gegenüber dem bisher besten Ergebnis derselben Lektion. Alle 200 XP steigt das Gesamtlevel und das Level im jeweiligen Thema. Diese Spiellevel sind unabhängig vom DCC-Profil.

Die Startseite zeigt XP, Themenlevel, vier verdienbare Abzeichen, ein Tagesziel (eine Lektion) und ein Wochenziel (an drei Tagen lernen). Tag und Woche folgen dem Schweizer Kalender (`Europe/Zurich`, Wochenbeginn Montag). Wiederholungen zählen als Lerntag, geben aber nur bei Verbesserung zusätzliche XP. Es gibt keinen Punkteverlust bei Pausen oder Fehlern. Beim Abschluss erscheinen die verdienten XP, neue Level und neue Abzeichen.

Alles wird aus den gespeicherten Lerneinträgen abgeleitet. Bestehende Lernende erhalten ihren bisherigen Fortschritt automatisch und behalten ihn nach Neustarts und erneutem Anmelden. Die Punkteberechnung liegt in `shared/src/rewards.ts`; der Server liefert sie in `SessionView.rewards` und als `reward` beim Abschluss.

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

## Bereiche hinzufügen

Nach der Anmeldung ist die Karte leer. Von der Startseite kommt dazu:

- **Vorbereiteter Bereich**: aus `data/skills.json`, mit geprüften Quellen und vorbereiteten Lektionen: die fünf DigComp-Bereiche, Mathematik oder Naturwissenschaften. Das geht auch ohne KI, auch mehrere auf einmal.
- **Eigenes Thema**, zum Beispiel «Security+ Prüfung bestehen», nur mit KI. Die Person gibt Thema und Vorwissen an. Der Agent plant den Bereich: einen Namen, 3 bis 6 Kriterien mit Faustregeln, drei Missionsvorschläge, die passenden Lektionsarten und 2 bis 5 Quellen. Der Server prüft den Entwurf. Von den Quellen bleiben nur Adressen, die beim Anlegen antworten (404 und 410 fallen weg). Erst ein gültiger Entwurf kommt auf die Karte. Die erste Lektion entsteht, wenn die Person Thema und Format wählt.

Nach der Wahl von Thema und Format öffnet die Lektion direkt. Ein persönliches Ziel (Mission) lässt sich freiwillig unter «Mein Konto» festlegen; ohne eigenes Ziel verwendet der Agent das Standardziel des Bereichs.

Eigene Bereiche haben keine vorbereiteten Lektionen; jede Lektion erzeugt die KI. Ist im Bereich nichts mehr offen, gibt es den Knopf «Neue Lektion in …».

## Nächstes Thema und Format wählen

Ein geöffnetes Thema (und auf der Lernkarte der Seitenbereich) bietet unter «Wie geht es weiter?» drei kurze Themenvorschläge, einen davon empfohlen, und «Etwas anderes vorschlagen». Auf der Karte erscheinen sie als mögliche Verzweigungen. Die Vorschläge zielen zuerst auf das zuletzt verpasste Kriterium, dann auf fällige Wiederholungen, dann auf Kriterien, die noch nicht «sicher» sind. Mission und Vorlieben fliessen mit ein.

Zuerst wird das Thema gewählt, danach eines der Formate, die der Themenplan dafür als passend nennt: Video, Mit der KI, Text prüfen oder Webseite prüfen; mit KI ist immer auch Podcast dabei. Ein Tipp auf das Format startet die Lektion; hat ein Thema nur ein Format, startet es gleich. Bei erzeugten Lektionen gibt es auch Formate, für die der Bereich noch kein vorbereitetes Beispiel hat.

**Gipfelprüfung.** Sind fünf Schritte eines Bergs geschafft, bietet «Wie geht es weiter?» nur die Gipfelprüfung an. Sie prüft bis zu drei Kriterien, die die fünf Lektionen dieses Bergs am meisten geübt haben, jedes mit einer eigenen Aufgabe an einem neuen Beispiel. Die Person wählt das Format wie sonst. Technisch ist sie eine gemischte Wiederholung (`reviewOf`), markiert mit `provenance.exam`. Auch mit Lücken ist der Berg danach bestiegen; was gefehlt hat, schlägt der nächste Berg zuerst vor. Ohne KI ist der sechste Schritt eine gewöhnliche vorbereitete Lektion. Eine Feier am Gipfel gibt es noch nicht.

Die Vorschläge sind reine Vorschauen. Sie erzeugen weder Lektionsdateien noch dauerhafte Knoten. Erst «Lektion starten» erzeugt genau die gewählte Lektion im gewählten Format oder nimmt eine passende vorhandene. Auch nach einer abgeschlossenen Lektion entsteht keine Folgelektion von selbst.

Das zuletzt gewählte Format wird gespeichert und beim nächsten Mal vorausgewählt, sofern es verfügbar ist, auch nach einem Serverneustart. Ein anderes Thema als das empfohlene zu wählen, wird neutral als «andere Richtung gewählt» vermerkt.

Ohne KI stehen nur vorbereitete Lektionen zur Auswahl, gegebenenfalls weniger als drei. Eigene Themenwünsche brauchen eine KI-Verbindung und müssen zu den Lernzielen des Bereichs passen; für andere Ziele lässt sich ein neuer Bereich hinzufügen. Scheitert die Themenplanung, bleiben drei Vorschläge nach Regeln. Lehnt der Validator die erzeugte Lektion ab, bekommt die KI die Fehler und einen zweiten Versuch. Scheitert auch dieser oder antwortet das Modell nicht, bleibt die Auswahl für einen neuen Versuch stehen.

API:

| Aufruf | Was er tut |
|---|---|
| `POST /api/sessions/:id/tracks/:track/topics` | liefert und speichert die Vorschauen |
| `POST /api/sessions/:id/topics/custom` | prüft einen eigenen Themenwunsch |
| `POST /api/sessions/:id/topics/choose` | erzeugt die gewählte Lektion |

Veraltete oder doppelte Auswahlen werden zurückgewiesen.

## Lektionsarten

| Art | Beispiel | Bewertung |
|---|---|---|
| Video | «Warum erfindet eine KI Angaben?» | Fragen unterwegs, Regel |
| Podcast | Gespräch zwischen Mira und Jonas | Fragen danach, Regel |
| Text prüfen | KI-Zusammenfassung mit der Notiz vergleichen | Regel |
| Webseite prüfen | Phishing-Mail und gefälschte Login-Seite | Regel |
| Mit der KI | Tutor, Rollenspiel, Auftrag an die KI formulieren | Modell, sonst Stichworte |

Lösungen bleiben im Backend. Der Browser bekommt die Lektionen ohne Lösungen.

### Video

Sieben vorbereitete Video-Lektionen sind dabei, mit deutscher ElevenLabs-Sprachausgabe, animierten Szenen, zeitlich passenden Untertiteln und Fragen. Die Ableitung (Mathematik → Ableitung) hat eine eigens geprüfte Animation; die übrigen verwenden wiederverwendbare Szenenvorlagen.

Abspielen, Pause, Zurückspulen, Ton und Untertitel funktionieren im Lektionsfenster. Fragen pausieren das Video, wenn es sie zum ersten Mal erreicht. Danach bleiben Wiedergabe und Spulen frei; offene Fragen bleiben sichtbar und werden vor dem Abschluss beantwortet. Kann das Video nicht geladen werden, lässt sich auf das Storyboard wechseln. Die Videos sind Animationen, die der Browser mit Ton abspielt, keine MP4-Dateien. Dafür nutzt die App eine eigene, versionierte Kopie der animlib aus OwlYouNeed in `packages/animlib`; das andere Repository wird weder gebraucht noch verändert.

Für eigene Themen und erzeugte Lektionen liefert die KI strukturierte Szenen und Beschriftungen, keinen ausführbaren Animationscode. Beim ersten Öffnen erzeugt der Server Sprache und Animation, zeigt den Fortschritt und speichert das Ergebnis. Fragenpausen, Untertitel, Spulen und Bewertung funktionieren gleich.

### Podcast

Wer bei «Wie geht es weiter?» ein Thema wählt, kann es als Podcast lernen (mit KI, für jedes Thema). Die KI schreibt ein kurzes Gespräch zwischen Mira und Jonas über genau dieses Thema, nur aus Kriterium, Faustregel und Quellen des Bereichs, und zwei bis drei Fragen dazu. Der Server prüft Länge (6 bis 16 Beiträge, höchstens 3000 Zeichen), beide Stimmen und die Fragen wie beim Video.

Beim ersten Öffnen wird das Gespräch vertont. Die Abschrift lässt sich mitlesen; ein Klick auf einen Beitrag springt an diese Stelle. Danach kommen die Fragen. Fällt die Vertonung aus, bleibt das Gespräch lesbar und die Fragen gehen trotzdem. Der Planer-Agent wählt Podcasts nie von sich aus, nur die Person.

### Im Lektionsfenster

Kopfzeile und Abschlussaktion bleiben sichtbar. Ausführliche Aufgabenhinweise, Quellen und die abschliessende Antwortübersicht lassen sich bei Bedarf öffnen.

- **Video**: Fragen erscheinen neben dem Player, auf schmalen Bildschirmen darunter, auch im Storyboard. Wiedergabe und Zurückspulen bleiben während einer Frage verfügbar.
- **Antworten**: Ein Klick auf eine Antwort zeigt direkt geprüftes Feedback mit Erklärung, ohne zusätzlichen Prüfen-Knopf. Richtige Antworten bekommen grünes Feedback mit einem kurzen Sterneffekt, Fehler eine freundliche Erklärung und die richtige Antwort. Der gewählte Versuch bleibt danach gesperrt; nur bei einem Verbindungsfehler lässt er sich erneut senden. Bewertet wird der ursprüngliche Versuch, nicht die danach angezeigte Lösung.
- **Podcasts und Text prüfen** zeigen eine Frage beziehungsweise einen Satz nach dem anderen, mit Fortschrittsanzeige.
- **Webseite prüfen** führt durch Mail, Webseite und Urteil; die Wahl eines Urteils prüft direkt. Markierungen geben sichtbares Feedback, ohne sie vorzeitig als richtig zu bewerten.
- **Mit der KI** zeigt die Anzahl eigener Beiträge. Neue Nachrichten scrollen nur das Gespräch.
- Animationen beachten die Systemeinstellung für reduzierte Bewegung.

`POST /api/sessions/:id/nodes/:node/answer-feedback` prüft eine einzelne Video- oder Podcast-Antwort (`type: quiz`, `questionIndex`, `option`) oder einen Textsatz (`type: mark-evidence`, `itemId`, `mark`). Er ändert weder das Ergebnis noch die XP; beides entsteht erst beim Abschluss der Lektion. Die Endpunkte für Inhalte und Lektionsstart enthalten weiterhin keine Lösungen.

## Videos und Podcasts erzeugen

Neue Inhalte brauchen ein Textmodell (siehe [KI-Anbindung](#ki-anbindung-optional)). Der Sprachdienst liefert nur die Stimme und ersetzt das Textmodell nicht. Ohne Textmodell bleiben neue Themen gesperrt; die mitgelieferten Lektionen lassen sich trotzdem abspielen.

Für die Sprache gibt es zwei Wege:

- **Lokal** (Standard, nur macOS): `say` mit den Stimmen Anna und Markus, dazu `ffmpeg` im Suchpfad oder unter `FFMPEG_PATH`.
- **ElevenLabs** (jede Plattform):

  ```dotenv
  VIDEO_SPEECH_PROVIDER=elevenlabs
  ELEVENLABS_API_KEY=...
  ELEVENLABS_VOICE_ID=...
  ELEVENLABS_SECOND_VOICE_ID=...       # zweite Stimme für Podcasts
  ELEVENLABS_MODEL_ID=eleven_multilingual_v2
  ```

Die Länge jeder erzeugten Sprachpassage bestimmt Untertitel und Animation.

### Vorbereitete Videos neu bauen

```bash
npm run videos:build -- --all        # alle vorbereiteten Videos
npm run videos:build -- info-v1      # ein einzelnes
npm run build
```

Bereits aktuelle Videos werden ohne Sprachaufruf übersprungen. `--force` baut neu und nimmt vorhandene Sprache aus dem Cache. Die Ableitungsanimation bleibt erhalten; nur `--replace-custom` ersetzt sie durch die allgemeinen Vorlagen.

Die Ableitung hat einen eigenen Befehl. Ihr Drehbuch steht in `data/videos/derivative.json`, die Szenen in `scripts/video/derivative-scenes.ts`:

```bash
npm run video:build                  # mit neuer Sprache
npm run video:build -- --visuals-only  # nur die Darstellung, ohne Sprachdienst
npm run build
```

### Wo die Dateien liegen

| Was | Wo |
|---|---|
| fertige Katalogvideos (WAV und Manifest) | `frontend/public/videos/<lesson-id>/` |
| neu erzeugte Videos | `backend/var/videos/<content-hash>/` |
| fertige Sprachpassagen | `backend/var/video-speech/` |
| vertonte Podcasts | `backend/var/podcasts/<hash>/` |

Änderungen am Lektionsinhalt ergeben eine neue Version. Fragenlösungen und die zufällige Reihenfolge der Antworten gehören nicht zum Sprachcache. Fertige Sprache wird wiederverwendet: beim erneuten Öffnen, bei gleichzeitigem Öffnen und nach einem Neustart. Die gleichen Podcast-Beiträge mit den gleichen Stimmen werden nur einmal vertont.

### Kostenpflichtige Aufrufe

Ein fehlgeschlagener oder unklar beendeter Sprachaufruf wird nicht automatisch wiederholt. Fertige Passagen bleiben erhalten. Nach Prüfung des Fehlers löst `npm run videos:build -- <lesson-id> --retry-failed` einen gezielten neuen Versuch aus. Ein Manifest wird erst veröffentlicht, wenn alle Szenen vertont, kompiliert und als renderbar geprüft sind. Es enthält keine Lösungen. Schlüssel bleiben lokal; die App enthält nur fertige Audiodateien.

`npm test` prüft auch Szenen- und Audiodauer, Renderbarkeit, Fragenpausen, Spulen, Wiederabspielen und die Übergabe an den Lernverlauf. `npm run typecheck` prüft auch den Videogenerator.

## Wie der Agent entscheidet

Mit KI arbeitet der Agent wie eine Lehrperson, nach dem Skill «teach» von mattpocock/skills. Pro Bereich kennt er die Mission, schreibt Lerneinträge mit Belegen und erzeugt kurze Lektionen, die zur Person passen. Regeln prüfen jeden Schritt und springen ein, wenn die KI fehlt oder scheitert.

> **Zwei Abläufe.** Die heutige Oberfläche nutzt immer die [Themenauswahl](#nächstes-thema-und-format-wählen): Die Person wählt, der Agent erzeugt. Lerneinträge, Lernstand und Wiederholung gelten dort wie unten beschrieben. Die Regeln R0 bis R8 und der Planer-Agent (A1), der nach jeder Lektion selbst plant, gelten nur für ältere API-Clients, solange sie die Themenauswahl nie abgerufen haben.

### Regeln

Die Regeln antworten sofort. Mit KI plant danach der Planer-Agent, und die Regeln prüfen seinen Plan. Ohne KI gelten die Regeln allein, angeschrieben als «Plan nach Regeln».

| Regel | Wann | Was |
|---|---|---|
| R8 Bereich gewählt | eben einen Bereich hinzugefügt oder eine neue Lektion verlangt | der Einstieg oder die neue Lektion in diesem Bereich |
| R3 Start nach DCC-Profil | noch nichts gelernt | zuerst Bereiche in der Grundstufe, dann nicht erhobene (kurzer Einstieg), dann höhere Stufen, dann Bereiche ohne DCC |
| R0 Weiter im Lernweg | nach jeder Lektion | nächste Lektion im Bereich, zielt auf das, was gefehlt hat |
| R1 Wiederholte Schwierigkeit | gleiches Kriterium zweimal verpasst | neuer Knoten «Mit KI klären: …» plus eine Alternative zum Alleine-Üben |
| R2 Unterfordert | die letzten zwei Lektionen im Bereich ohne Hilfe gelöst | neuer Knoten mit einer Lektion eine Stufe höher |
| R7 Bereich abgeschlossen | Bereich fertig | weiter zum nächsten Bereich; ist nichts mehr offen oder die Karte leer: einen Bereich hinzufügen |
| A1 Agent-Plan | nach jeder Lektion, wenn der Planer-Agent läuft | Plan des Agenten, von den Regeln geprüft, Tags «KI» und «Regel» |

In eigenen Bereichen ohne laufenden Agenten nehmen die Regeln eine gültige Lektion, die der Agent schon erzeugt hat. Gibt es keine, wählen sie das Ziel selbst: das zuletzt verpasste Kriterium, sonst eines ohne Belege. Fällige Wiederholungen werden beigemischt. Nach zwei glatten Lektionen geht es eine Stufe höher.

### Der Planer-Agent (A1)

Nach jeder Lektion zeigt die App sofort den Vorschlag der Regeln, markiert als «vorläufig». Im Hintergrund startet der Agent; das Frontend fragt alle 1,5 Sekunden nach. Ist sein Plan fertig und gültig, ersetzt er den vorläufigen Vorschlag.

Der Agent arbeitet in einer Schleife mit Werkzeugen, mit Anthropic oder OpenAI: höchstens 6 Schritte, 45 Sekunden gesamt und 20 Sekunden pro Aufruf.

| Werkzeug | Was es tut |
|---|---|
| `get_learner_state(trackId)` | Mission, DCC-Stufe nur dieses Bereichs, aktive Lerneinträge, letzte 5 Ergebnisse, fällige Wiederholungen, Karte des Bereichs |
| `list_pool_lessons(trackId, criterion?)` | vorbereitete und schon erzeugte Lektionen |
| `generate_lesson({type, trackId, criterion, level, contextHint, reviewOf?})` | erzeugt und prüft eine Lektion; Fehler kommen zurück, ein zweiter Versuch ist erlaubt |
| `add_to_map(lessonId, parentNodeId)` | neuer Knoten, höchstens 2 pro Lauf |
| `write_learning_record({...})` | Lerneintrag; der Server prüft die Belege |
| `update_reference(trackId, entry)` | Merkblatt, nur für ohne Hilfe Gezeigtes |
| `note_preference(text)` | Vorliebe in `notes.md` |
| `recommend({nodeId, alternativeNodeId, reason, basedOn})` | beendet die Schleife |

Der Systemprompt enthält die Grundsätze aus «teach»: Zone der nächsten Entwicklung, eine Sache pro Lektion, Wissen leicht und Übung fordernd, jede Lektion hängt an der Mission, Abrufen, Abstand und Mischen, kein eigenes Wissen ausserhalb der Quellen.

Bevor A1 gilt, prüfen die Regeln (`backend/src/guard.ts`):

- Der Knoten existiert und ist erreichbar.
- Es gibt eine erreichbare Alternative, sobald ausser der Empfehlung ein anderer Knoten erreichbar ist. Mit nur einem Bereich und einem neuen Knoten bleibt sie leer.
- Die Begründung nennt mindestens einen Lerneintrag (`LR-…`) oder ein Ereignis (`ev-…`), und alle genannten IDs gibt es.

Fällt eine Prüfung durch, gilt der Plan der Regeln. Das gilt auch, wenn das Modell ausfällt, die Zeit abläuft oder beide Versuche einer Lektion ungültig sind. Der Grund steht in den Einstellungen unter Agent → «Läufe des Planer-Agenten». Hat die Person inzwischen schon eine Lektion gestartet, verwirft die App den Plan.

Grenzen: 1 Lauf pro abgeschlossene Lektion, höchstens 10 erzeugte Lektionen pro Sitzung.

**KI zuerst, vorbereitete Lektionen als Rückfall:**

- Mit KI startet jeder vorbereitete Bereich mit einem Einstieg nach DCC-Stufe. Die weiteren Lektionen erzeugt der Agent.
- Eine vorbereitete Lektion darf der Agent erst anhängen, wenn die Erzeugung gescheitert ist oder die Grenze von 10 erreicht ist.
- Nimmt der vorläufige Plan der Regeln eine vorbereitete Lektion auf die Karte, verschwindet dieser Knoten wieder, sobald der Plan des Agenten gilt, ausser der Agent hat ihn selbst gewählt.
- Scheitert der Agent, holen die Regeln die vorbereiteten Lektionen dieses Bereichs auf die Karte und planen damit.
- Ohne KI zeigt die Karte für jeden vorbereiteten Bereich den ganzen Plan aus vorbereiteten Lektionen.

Wer statt der Empfehlung die Alternative («Lieber etwas anderes») startet, lehnt sie ab. Das wird im Verlauf festgehalten, und der Agent plant danach neu.

### Erzeugte Lektionen

Der Agent erfindet keine neuen Lektionsarten, er füllt nur die bestehenden. Jede erzeugte Lektion geht durch denselben Validator wie die Dateien in `data/lessons/` (`backend/src/validate.ts`):

- Schema pro Art, höchstens 5 Minuten, Schweizer Schreibweise ohne ß.
- Text prüfen: mindestens ein erfundener Satz mit einem Kriterium des Bereichs.
- Webseite prüfen: nur erfundene Marken und `.example`-Adressen. Entscheid und Warnzeichen passen zusammen.
- Fragen: Die Antworten einer Frage unterscheiden sich um höchstens 2 Wörter, damit die richtige nicht an ihrer Länge auffällt. Der Server setzt die richtige Antwort in jeder Frage an eine andere Stelle; steht sie überall an derselben, lehnt der Validator ab.
- Videos nur mit den wiederverwendbaren Vorlagen «steps» und «url-parts».
- Eine Primärquelle aus `data/resources/<trackId>.md`, bei eigenen Bereichen aus den Quellen des Bereichs.
- Bei eigenen Bereichen nur die Lektionsarten, die der Bereich nennt.

Ungültige Lektionen werden verworfen und protokolliert. In der App tragen erzeugte Lektionen die Marken «Von der KI erstellt» und «Beispiel erfunden».

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

Der Lernstand pro Kriterium kommt nur aus den Lerneinträgen und steht getrennt vom DCC unter «Lernstand (aus dem Lernen, kein DCC)»:

- «unbekannt»: kein Eintrag.
- «am Üben»: Fehlvorstellung korrigiert, oder nach «sicher» wieder verpasst.
- «sicher»: ohne Hilfe gezeigt.

Wird ein Kriterium «demonstrated», kommt es in die Wiederholung. Sie ist fällig nach 2 weiteren Lektionen oder in der nächsten Sitzung. Dann kann eine kurze gemischte Wiederholung entstehen (`reviewOf`).

Hilfe innerhalb einer Lektion (Hinweis nach dem Prüfen) wird vermerkt. Eine Beobachtung wie «Termine und Fristen 2× übersehen» gilt erst als erledigt, wenn das Kriterium ohne Hilfe gelöst wurde.

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
- **Mission**: Ein persönliches Ziel lässt sich freiwillig unter «Mein Konto» festlegen, mit drei Vorschlägen oder eigenen Worten. Ohne eigenes Ziel gilt das Standardziel. Die Änderung eines gespeicherten Ziels braucht eine Bestätigung und wird als `mission-shift` festgehalten.

## Datenschutz

- Das Modell bekommt nie den Namen und nie die ID der Person.
- Der Agent bekommt nur die DCC-Stufe des Bereichs, den er plant, nie das ganze Profil. Knoten anderer Bereiche sieht er nur als ID, ohne Titel.
- An die KI gehen: die Übung, die Antworten der Person, die Mission und die Vorlieben aus `notes.md`, bei einem eigenen Bereich ausserdem Thema und Vorwissen. Die App sagt das bei der Mission, in den Einstellungen und beim Anlegen.
- Eigene Bereiche gehören nur der Person, die sie angelegt hat. Andere Sitzungen können sie nicht ansprechen.
- Kein Werkzeug und kein Code ändert DCC-Stufen. Lernen, Transfer und DCC bleiben getrennt.
- Schlüssel liegen nur in `backend/.env`, nie im Frontend oder im Repo.

Jede Empfehlung sagt in einem Satz, warum sie jetzt hilft. Im Seitenbereich steht ausserdem, was der Agent gesehen hat, sein Vorschlag, worauf er sich stützt und die Regel.

## Aufbau

```
shared/            gemeinsame Typen und Punkteberechnung (rewards.ts)
backend/           Express-API, Agent, Bewertung, Modell-Anbindung
  src/app.ts         HTTP-API
  src/content.ts     Inhalte aus data/ laden und prüfen
  src/sessions.ts    Anmelden, Lektionen, Missionen
  src/nextTopics.ts  «Wie geht es weiter?»: Themenvorschläge und gewählte Lektion
  src/agent.ts       Plan aus dem DCC, Regeln R0 bis R8, neue Knoten
  src/planner.ts     Planer-Agent (A1): Werkzeuge, Schleife, Rückfall
  src/guard.ts       Prüfung des Agenten-Plans durch die Regeln
  src/tracks.ts      Bereiche einer Person: vorbereitete und eigene
  src/designer.ts    eigenen Bereich mit der KI planen, Entwurf und Quellen prüfen
  src/ownlessons.ts  Lektionen für eigene Bereiche: Einstieg und Ziel nach Regeln
  src/generator.ts   Lektionen erzeugen, Fragen mischen
  src/validate.ts    Validator für alle Lektionen
  src/resources.ts   geprüfte Quellen pro Bereich
  src/records.ts     Lerneinträge, Belege, Lernstand, Wiederholung, Merkblatt
  src/workspace.ts   Ordner pro Person auf der Festplatte
  src/dcc.ts         DCC-Datei und Eingabe prüfen
  src/judge.ts       Bewertung nach Regeln
  src/services.ts    Chat, Hinweise, Bewertung mit Modell oder Rückfall
  src/provider.ts    Anthropic, OpenAI, Mock oder keine; Werkzeuge für den Agenten
  src/video/         Videos vertonen, kompilieren und speichern
  src/podcast/       Podcasts vertonen und speichern
  test/              Tests mit Mock-Modell
data/              Bereiche, Kriterien, Missionsvorschläge, Lektionen (JSON), Quellen (resources/*.md), Drehbücher
frontend/          React-PWA: Anmeldung, Startseite mit Belohnungen, Berge, Lernkarte, Lektionen, Übersetzungen
packages/animlib/  Animationsbibliothek für die Videos (Kopie aus OwlYouNeed)
scripts/           Videos bauen
```

Neue vorbereitete Lektionen kommen als JSON nach `data/lessons/`. Beim Start prüft das Backend alle Dateien mit demselben Validator wie erzeugte Lektionen. Ungültige werden verworfen und protokolliert.

## Grenzen

- Keine echte Anmeldung: Name und DCC-Resultat reichen. Wer den Namen kennt, kann weitermachen.
- Eigene Bereiche nur mit KI. Ihre Quellen schlägt die KI vor. Geprüft wird nur, ob die Adresse antwortet, nicht der Inhalt. Die App sagt das bei jeder Lektion und im Bereich.
- Höchstens 8 eigene Bereiche. Bereiche lassen sich noch nicht entfernen.
- Kein Lernen mit anderen Personen. Die Modi sind «Alleine» und «Mit KI». Der Teil «Wisdom/Community» aus «teach» kommt mit diesem Modus.
- Erzeugte Videos verwenden wiederverwendbare Animationen, keine frei erfundenen Animationsprogramme.
- Lokale Sprache nur unter macOS. Auf anderen Systemen braucht es ElevenLabs für neue Videos und Podcasts.
- Der Speicher ist ein Ordner pro Person, ohne Datenbank und ohne Sperren für mehrere Server.
- Ein neues DCC-Resultat plant nur Bereiche neu, in denen noch nichts erledigt ist.
- Die Liste echter Marken im Validator ist nicht vollständig. Der Hauptschutz sind die `.example`-Adressen.
