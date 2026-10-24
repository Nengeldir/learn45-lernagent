// "Wie geht es weiter?": the learner picks the next topic of a track, then how to learn it. Tapping a format starts the
// lesson; a topic with only one format starts right away. Topics are cheap previews; only the choice makes a lesson.
import { useEffect, useRef, useState } from 'react';
import type { LessonType, NextTopic, TopicChoices } from '@l45/shared';
import { api, ApiError } from '../lib/api.ts';
import { useI18n } from '../lib/i18n.tsx';
import { Icon, type IconName } from '../lib/icons.tsx';
import { useStore } from '../lib/store.tsx';

export const FORMAT_HELP: Record<LessonType, string> = {
  video: 'Ein kurzes Erklärvideo mit Fragen.',
  podcast: 'Zwei Stimmen erklären es dir im Gespräch. Danach ein paar Fragen.',
  'ai-chat': 'Du schreibst mit der KI und übst dabei.',
  'mark-evidence': 'Du vergleichst eine Zusammenfassung mit einer Notiz.',
  'mock-site': 'Du prüfst eine Beispiel-Mail oder -Webseite.',
};
export const FORMAT_ICON: Record<LessonType, IconName> = {
  video: 'play', podcast: 'headphones', 'ai-chat': 'chat', 'mark-evidence': 'book', 'mock-site': 'globe',
};

export function NextTopics({ trackId, initialTopicId, onStart, onFocus }: {
  trackId: string;
  initialTopicId?: string;
  onStart: (nodeId: string) => void;
  onFocus: (nodeId: string | null) => void;
}) {
  const { view, setView } = useStore();
  const { t, type } = useI18n();
  const [choices, setChoices] = useState<TopicChoices | null>(null);
  const [selected, setSelected] = useState<NextTopic | null>(null);
  const [own, setOwn] = useState(false);
  const [topic, setTopic] = useState('');
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

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setChoices(null);
    setSelected(null);
    setError(null);
    setStale(false);
    if (planning) return;
    api.topics(sessionId, trackId).then((r) => {
      if (cancelled) return;
      setChoices(r.choices);
      setView(r.view);
      const initial = initialTopicId && r.choices.topics.find((tp) => tp.id === initialTopicId);
      if (initial) setSelected(initial);
    }).catch((e) => {
      if (!cancelled) setError(e instanceof Error ? e.message : String(e));
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [sessionId, trackId, lastEvent, simulation, planning, retry, initialTopicId, setView]);

  useEffect(() => {
    if (selected || own) heading.current?.focus();
  }, [selected, own]);

  const fail = (e: unknown) => {
    setError(e instanceof Error ? e.message : String(e));
    setStale(e instanceof ApiError && e.status === 409);
  };
  const start = async (tp: NextTopic, format: LessonType) => {
    if (!choices || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      const r = await api.chooseTopic(sessionId, { choiceSetId: choices.id, topicId: tp.id, format });
      setView(r.view, r.generated);
      onFocus(r.nodeId);
      onStart(r.nodeId);
    } catch (e) { fail(e); }
    finally { submitting.current = false; setBusy(false); }
  };
  const pick = (tp: NextTopic) => {
    setError(null);
    if (tp.formats.length === 1) void start(tp, tp.formats[0]);
    else setSelected(tp);
  };
  const suggest = async () => {
    if (!choices || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      const r = await api.suggestTopic(sessionId, { choiceSetId: choices.id, topic: topic.trim() });
      setView(r.view);
      setOwn(false);
      pick(r.topic);
    } catch (e) { fail(e); }
    finally { submitting.current = false; setBusy(false); }
  };
  // Formats in a stable order, the one chosen last time first.
  const formats = selected ? [...selected.formats].sort((a, b) => Number(b === preferred) - Number(a === preferred)) : [];

  return (
    <section className="next-topics" aria-label={t('Wie geht es weiter?')} aria-busy={loading || busy}>
      {loading ? (
        <p className="planning" role="status"><span className="dot-pulse" aria-hidden="true" />{planning ? t('Einen Moment …') : t('Der Agent sucht passende nächste Schritte …')}</p>
      ) : busy && !own ? (
        <p className="planning" role="status"><span className="dot-pulse" aria-hidden="true" />{t('Deine Lektion wird vorbereitet. Das kann bis zu einer Minute dauern.')}</p>
      ) : selected ? (
        <>
          <h2 ref={heading} tabIndex={-1}>{t('Wie möchtest du lernen?')}</h2>
          <p><strong>{t(selected.title)}</strong></p>
          <div className="format-options">
            {formats.map((f) => (
              <button key={f} className="format-option" disabled={busy || stale} onClick={() => void start(selected, f)}>
                <span className="format-icon" aria-hidden="true"><Icon name={FORMAT_ICON[f]} size={24} /></span>
                <span className="format-text">
                  <strong>{type(f)}{preferred === f && <span className="format-preferred">{t('Zuletzt gewählt')}</span>}</strong>
                  <span className="small muted">{t(FORMAT_HELP[f])}</span>
                </span>
              </button>
            ))}
          </div>
          <button className="btn quiet small back" disabled={busy} onClick={() => { setSelected(null); setError(null); }}><Icon name="back" size={18} />{t('Anderes Thema')}</button>
        </>
      ) : own ? (
        <form className="own-topic" onSubmit={(e) => { e.preventDefault(); void suggest(); }}>
          <h2 ref={heading} tabIndex={-1}>{t('Was möchtest du als Nächstes lernen?')}</h2>
          <label className="field"><span>{t('Dein Wunsch')}</span><textarea autoFocus rows={3} minLength={3} maxLength={120} required value={topic} onChange={(e) => setTopic(e.target.value)} placeholder={t('Ich möchte verstehen, wie …')} disabled={busy} /></label>
          <button className="btn primary" disabled={busy || topic.trim().length < 3 || stale}>{busy ? t('Einen Moment …') : t('Weiter')}</button>
          <button className="btn quiet small back" type="button" disabled={busy} onClick={() => { setOwn(false); setError(null); }}><Icon name="back" size={18} />{t('Zurück')}</button>
        </form>
      ) : choices ? (
        <>
          <h2>{t('Wie geht es weiter?')}</h2>
          {choices.topics.length ? (
            <div className="topic-options">
              {choices.topics.map((tp) => (
                <button key={tp.id} className={`topic-option${tp.recommended ? ' recommended' : ''}`} disabled={stale} onClick={() => pick(tp)}>
                  {tp.recommended && <span className="topic-recommended"><Icon name="sparkle" size={16} />{t('Empfohlen')}</span>}
                  <strong>{t(tp.title)}</strong>
                  <span className="small muted">{t(tp.reason)}</span>
                </button>
              ))}
              {choices.canSuggestOwn && (
                <button className="topic-option own" disabled={stale} onClick={() => setOwn(true)}>
                  <strong><Icon name="plus" size={18} />{t('Etwas anderes vorschlagen')}</strong>
                </button>
              )}
            </div>
          ) : (
            <p>{t('Du hast alle Lektionen in diesem Thema geschafft. Wähle ein anderes Thema.')}</p>
          )}
        </>
      ) : null}
      {error && <p className="error small" role="alert">{t(error)}</p>}
      {(!loading && !choices || stale) && <button className="btn secondary" disabled={busy} onClick={() => setRetry((n) => n + 1)}>{t('Nochmals versuchen')}</button>}
    </section>
  );
}
