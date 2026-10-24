import { useEffect, useRef, useState } from 'react';
import type { LessonType, NextTopic, TopicChoices } from '@l45/shared';
import { TYPE_LABEL } from '@l45/shared';
import { api, ApiError } from '../lib/api.ts';
import { Icon } from '../lib/icons.tsx';
import { useStore } from '../lib/store.tsx';

const FORMAT_HELP: Record<LessonType, string> = {
  video: 'Eine kurze Erklärung mit Fragen unterwegs.',
  'ai-chat': 'Im Gespräch mit der KI verstehen und üben.',
  'mark-evidence': 'Eine Zusammenfassung mit einer Notiz vergleichen.',
  'mock-site': 'Eine Beispiel-Webseite oder Mail prüfen.',
};

export function NextTopics({ trackId, initialTopicId, onStart, onFocus }: {
  trackId: string;
  initialTopicId?: string;
  onStart: (nodeId: string) => void;
  onFocus: (nodeId: string | null) => void;
}) {
  const { view, setView } = useStore();
  const [choices, setChoices] = useState<TopicChoices | null>(null);
  const [selected, setSelected] = useState<NextTopic | null>(null);
  const [own, setOwn] = useState(false);
  const [topic, setTopic] = useState('');
  const [format, setFormat] = useState<LessonType | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [retry, setRetry] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const submitting = useRef(false);
  const sessionId = view!.session.id;
  const lastEvent = view!.session.events.at(-1)?.id;
  const simulation = view!.session.simulation;
  const planning = view!.session.planning;
  const preferred = view!.session.preferredLessonType;
  const track = view!.skills.flatMap(s => s.tracks).find(t => t.id === trackId);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setChoices(null);
    setSelected(null);
    setError(null);
    setStale(false);
    if (planning) return;
    api.topics(sessionId, trackId).then(r => {
      if (cancelled) return;
      setChoices(r.choices);
      setView(r.view);
      if (initialTopicId) {
        const initial = r.choices.topics.find(t => t.id === initialTopicId);
        if (initial) {
          setSelected(initial);
          setFormat(preferred && initial.formats.includes(preferred) ? preferred : initial.formats[0] ?? null);
        }
      }
    }).catch(e => {
      if (!cancelled) setError(e instanceof Error ? e.message : String(e));
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [sessionId, trackId, lastEvent, simulation, planning, retry, initialTopicId, setView]);

  useEffect(() => {
    if (selected || own) heading.current?.focus();
  }, [selected, own]);

  const pick = (t: NextTopic) => {
    setSelected(t);
    setFormat(preferred && t.formats.includes(preferred) ? preferred : t.formats[0] ?? null);
    setError(null);
  };
  const fail = (e: unknown) => {
    setError(e instanceof Error ? e.message : String(e));
    setStale(e instanceof ApiError && e.status === 409);
  };
  const suggest = async () => {
    if (!choices || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      const r = await api.suggestTopic(sessionId, { choiceSetId: choices.id, topic: topic.trim() });
      setView(r.view);
      pick(r.topic);
      setOwn(false);
    } catch (e) { fail(e); }
    finally { submitting.current = false; setBusy(false); }
  };
  const start = async () => {
    if (!choices || !selected || !format || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      const r = await api.chooseTopic(sessionId, { choiceSetId: choices.id, topicId: selected.id, format });
      setView(r.view, r.generated);
      onFocus(r.nodeId);
      onStart(r.nodeId);
    } catch (e) { fail(e); }
    finally { submitting.current = false; setBusy(false); }
  };

  return (
    <section className="next-topics" aria-label="Nächste Lektion wählen" aria-busy={loading || busy}>
      <p className="eyebrow next">{selected ? '2 · Format wählen' : '1 · Thema wählen'}</p>
      <h2 ref={heading} tabIndex={-1}>{selected ? 'Wie möchtest du lernen?' : own ? 'Was möchtest du als Nächstes lernen?' : 'Wohin geht’s als Nächstes?'}</h2>
      <p className="small muted">{track?.name}</p>
      {loading ? (
        <p className="planning" role="status"><span className="dot-pulse" aria-hidden="true" />{planning ? 'Der bisherige Plan wird noch abgeschlossen …' : 'Passende Themen werden vorgeschlagen …'}</p>
      ) : selected ? (
        <>
          <div className="topic-summary"><strong>{selected.title}</strong><p className="small muted">{selected.reason}</p></div>
          <fieldset className="format-options" disabled={busy}>
            <legend>Passende Formate für dieses Thema</legend>
            {selected.formats.map(t => (
              <label key={t} className={`format-option${format === t ? ' selected' : ''}`}>
                <input type="radio" name="lesson-format" value={t} checked={format === t} onChange={() => setFormat(t)} />
                <span><strong>{TYPE_LABEL[t]}</strong>{preferred === t && <span className="format-preferred">Deine Präferenz</span>}<span className="small muted">{FORMAT_HELP[t]}</span></span>
              </label>
            ))}
          </fieldset>
          {preferred && !selected.formats.includes(preferred) && <p className="small muted">Dein bevorzugtes Format «{TYPE_LABEL[preferred]}» ist für dieses Thema gerade nicht verfügbar.</p>}
          <p className="small muted">Wir merken uns das gewählte Format für deine nächsten Lektionen. Du kannst es jedes Mal ändern.</p>
          <button className="btn primary block" disabled={busy || !format || stale} onClick={start}><Icon name="play" size={16} />{busy ? 'Lektion wird vorbereitet …' : 'Lektion starten'}</button>
          <button className="linkbtn small back" disabled={busy} onClick={() => { setSelected(null); setError(null); }}><Icon name="back" size={16} />Anderes Thema wählen</button>
        </>
      ) : own ? (
        <form className="own-topic" onSubmit={e => { e.preventDefault(); void suggest(); }}>
          <label className="field"><span>Dein nächstes Thema in «{track?.name}»</span><textarea autoFocus rows={3} minLength={3} maxLength={120} required value={topic} onChange={e => setTopic(e.target.value)} placeholder="Ich möchte besser verstehen, wie …" disabled={busy} /></label>
          <p className="small muted">Für ein Thema ausserhalb dieses Bereichs kannst du einen neuen Bereich hinzufügen.</p>
          <button className="btn primary block" disabled={busy || topic.trim().length < 3 || stale}>{busy ? 'Thema wird geprüft …' : 'Weiter zum Format'}</button>
          <button className="linkbtn small back" type="button" disabled={busy} onClick={() => { setOwn(false); setError(null); }}><Icon name="back" size={16} />Zurück zu den Vorschlägen</button>
        </form>
      ) : choices ? (
        <>
          <div className="topic-options">
            {choices.topics.map(t => (
              <button key={t.id} className={`topic-option${t.recommended ? ' recommended' : ''}`} onClick={() => pick(t)}>
                {t.recommended && <span className="topic-recommended"><Icon name="sparkle" size={14} />Empfohlen</span>}
                <strong>{t.title}</strong><span className="small muted">{t.reason}</span>
              </button>
            ))}
            <button className="topic-option own" disabled={!choices.canSuggestOwn} onClick={() => setOwn(true)}><strong><Icon name="plus" size={16} />Eigenes Thema vorschlagen</strong><span className="small muted">{choices.canSuggestOwn ? 'Du bestimmst, was als Nächstes kommt.' : 'Eigene Themen sind mit KI-Verbindung verfügbar.'}</span></button>
          </div>
          {!choices.canSuggestOwn && <p className="small muted">Ohne KI stehen die noch offenen vorbereiteten Lektionen zur Wahl.</p>}
          {!choices.topics.length && <p>Alle vorbereiteten Lektionen in diesem Bereich sind erledigt. Du kannst einen anderen Bereich wählen oder eine Lektion auf der Karte wiederholen.</p>}
          <p className="small muted">Zuerst Thema und Format wählen – erst dann wird deine Lektion erstellt. Andere Richtungen bleiben offen.</p>
        </>
      ) : null}
      {error && <p className="error small" role="alert">{error}</p>}
      {(!loading && !choices || stale) && <button className="btn secondary block" disabled={busy} onClick={() => setRetry(n => n + 1)}>Themen neu laden</button>}
    </section>
  );
}
