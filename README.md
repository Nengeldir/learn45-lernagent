# Lernagent für Learn45

Prototyp für den Zentral Hack 2026 (Challenge CoreTeam AG). Eine PWA mit Frontend und Backend.

Du meldest dich mit deinem DCC-Resultat an. Daraus plant der Agent eine Lernkarte als Mindmap: in der Mitte du, oben «Digitale Kompetenz» mit den fünf DigComp-Bereichen, unten links Mathematik, unten rechts Naturwissenschaften. Geplante Lektionen sind blass. Der Agent hebt den nächsten Schritt hervor, begründet ihn und bietet eine Alternative an. Während du lernst, wächst die Karte: Der Agent hängt neue Knoten an, wenn etwas zweimal schwierig war oder zu leicht ist.

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

Der Schlüssel bleibt im Backend. Der Browser spricht nie direkt mit einem Modell. An das Modell gehen nur die Übung und die Texte der lernenden Person, nie der Name oder das DCC-Profil. Antwortet das Modell nicht innerhalb von 8 Sekunden, nimmt die App die vorbereitete Antwort und kennzeichnet sie.

## Anmeldung mit DCC

Zwei Wege:

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

## Lektionsarten

| Art | Beispiel | Bewertung |
|---|---|---|
| Video | «Warum erfindet eine KI Angaben?» | Fragen unterwegs, Regel |
| Text prüfen | KI-Zusammenfassung mit der Notiz vergleichen | Regel |
| Webseite prüfen | Phishing-Mail und gefälschte Login-Seite | Regel |
| Mit der KI | Tutor, Rollenspiel, Auftrag an die KI formulieren | Modell, sonst Stichworte |

Die Videos sind Platzhalter-Storyboards. Die fertigen Videos sollen vorab mit der Aha-Engine erzeugt werden.

Lösungen bleiben im Backend. Der Browser bekommt die Lektionen ohne Lösungen.

## Wie der Agent entscheidet

Regeln entscheiden, das Modell schreibt nur (Chat-Antworten, Hinweise, Bewertung von freiem Text).

| Regel | Wann | Was |
|---|---|---|
| R3 Start nach DCC-Profil | noch nichts gelernt | zuerst Bereiche in der Grundstufe, dann nicht erhobene (kurzer Einstieg), dann höhere Stufen |
| R0 Weiter im Lernweg | nach jeder Lektion | nächste Lektion im Bereich, zielt auf das, was gefehlt hat |
| R1 Wiederholte Schwierigkeit | gleiches Kriterium zweimal verpasst | neuer Knoten «Mit KI klären: ...» plus eine Alternative zum Alleine-Üben |
| R2 Unterfordert | die letzten zwei Lektionen im Bereich ohne Hilfe gelöst | neuer Knoten mit einer Lektion eine Stufe höher |
| R4 Wenig Zeit | Lektion passt nicht in die Restzeit | kürzerer Schritt, der längere bleibt Alternative |
| R7 Bereich abgeschlossen | Bereich fertig | weiter zum nächsten Bereich |

Jede Empfehlung zeigt: was der Agent gesehen hat, den Vorschlag, warum das jetzt hilft und die Regel. Wer die Alternative startet, lehnt die Empfehlung ab. Das wird im Verlauf festgehalten und der Agent plant danach neu.

Hilfe innerhalb einer Lektion (Hinweis nach dem Prüfen) wird vermerkt. Eine Beobachtung wie «Termine und Fristen 2× übersehen» gilt erst als erledigt, wenn das Kriterium ohne Hilfe gelöst wurde.

Unter «Profil und Verlauf» stehen getrennt: DCC-Profil (nur lesen), Entscheidungen des Agenten, Lernverlauf, Beobachtungen und Transfer-Hinweise für die eigene Arbeit.

## Aufbau

```
shared/      gemeinsame Typen
backend/     Express-API, Agent, Bewertung, Modell-Anbindung
  src/agent.ts      Plan aus dem DCC, Regeln, neue Knoten
  src/dcc.ts        DCC-Datei und Eingabe prüfen
  src/judge.ts      Bewertung nach Regeln
  src/services.ts   Chat, Hinweise, Bewertung mit Modell oder Rückfall
  src/provider.ts   Anthropic, OpenAI oder keine
  test/             API-Tests
data/        Bereiche, Kriterien und Lektionen als JSON
frontend/    React-PWA: Anmeldung, Mindmap, Lektionen
```

Neue Lektionen kommen als JSON nach `data/lessons/`. Beim Start prüft das Backend alle Dateien.

## Grenzen

- Keine Spielmechanik (kommt später).
- Kein Lernen mit anderen Personen. Die Modi sind «Alleine» und «Mit KI».
- Videos sind Storyboards, keine fertigen Videos.
- Sitzungen liegen nur im Speicher. Nach einem Neustart des Servers ist der Verlauf weg.
- Keine echte Anmeldung: Name und DCC-Resultat reichen.
