// Home: every Bereich with its topics as a plain list. Tapping a topic opens its lessons; a topic the learner has not
// started yet is added first. Own topics sit in their own section, with the way to make a new one.
import { useState, type CSSProperties } from 'react';
import type { SessionView, Skill } from '@l45/shared';
import { CUSTOM_SKILL } from '@l45/shared';
import { api } from '../lib/api.ts';
import { Icon } from '../lib/icons.tsx';
import { useStore } from '../lib/store.tsx';
import { TRACK_COLOR, trackColors } from '../map/layout.ts';

export function Topics({ view, onOpen, onOwnTopic, onShowMap }: {
  view: SessionView;
  onOpen: (trackId: string) => void;
  onOwnTopic: () => void;
  onShowMap: () => void;
}) {
  const { content, setView } = useStore();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!content) return null;
  const { session } = view;
  const mine = new Set(view.skills.flatMap((s) => s.tracks.map((t) => t.id)));
  const colors = trackColors(session.nodes);
  const own = view.skills.find((s) => s.id === CUSTOM_SKILL.id);
  const sections: Skill[] = [...content.skills, { ...CUSTOM_SKILL, tracks: own?.tracks ?? [] } as Skill];
  const doneIn = (trackId: string) => session.nodes.filter((n) => n.kind === 'lesson' && n.trackId === trackId && n.state === 'done').length;
  const lastTrack = view.skills.flatMap((s) => s.tracks).find((t) => t.id === session.events.at(-1)?.trackId);

  const open = async (trackId: string) => {
    if (mine.has(trackId)) return onOpen(trackId);
    setBusy(trackId);
    setError(null);
    try {
      const r = await api.addTracks(session.id, [trackId]);
      setView(r.view, r.generated);
      onOpen(trackId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="home">
      <h1 className="home-title">Was möchtest du lernen?</h1>
      {lastTrack && (
        <button className="continue-card" style={{ ['--tc' as string]: colors.get(lastTrack.id) } as CSSProperties} onClick={() => onOpen(lastTrack.id)}>
          <span className="continue-icon" aria-hidden="true"><Icon name="play" size={24} /></span>
          <span className="topic-row-text">
            <span className="eyebrow next">Weiterlernen</span>
            <strong>{lastTrack.name}</strong>
          </span>
          <Icon name="chevron" size={22} />
        </button>
      )}
      {error && <p className="error" role="alert">{error}</p>}

      {sections.map((skill) => (
        <section key={skill.id} className="area" aria-labelledby={`area-${skill.id}`}>
          <h2 id={`area-${skill.id}`} className="area-title">{skill.name}</h2>
          <ul className="topic-list">
            {skill.tracks.map((t) => {
              const done = doneIn(t.id);
              return (
                <li key={t.id}>
                  <button
                    className="topic-row"
                    style={{ ['--tc' as string]: colors.get(t.id) ?? TRACK_COLOR[t.id] ?? 'var(--ink-3)' } as CSSProperties}
                    disabled={Boolean(busy)}
                    onClick={() => void open(t.id)}
                  >
                    <span className="topic-dot" aria-hidden="true" />
                    <span className="topic-row-text">
                      <strong>{t.name}</strong>
                      {busy === t.id
                        ? <span className="small muted">Wird vorbereitet …</span>
                        : mine.has(t.id) && <span className="small muted">{done ? `${done} ${done === 1 ? 'Lektion' : 'Lektionen'} geschafft` : 'Angefangen'}</span>}
                    </span>
                    <Icon name="chevron" size={22} />
                  </button>
                </li>
              );
            })}
            {skill.id === CUSTOM_SKILL.id && (
              <li>
                <button className="topic-row new" disabled={Boolean(busy) || !view.canCreateTracks} onClick={onOwnTopic}>
                  <span className="topic-plus" aria-hidden="true"><Icon name="plus" size={20} /></span>
                  <span className="topic-row-text">
                    <strong>Eigenes Thema anlegen</strong>
                    <span className="small muted">{view.canCreateTracks ? 'Du sagst, was du lernen willst. Die KI plant es für dich.' : 'Geht nur, wenn die KI verbunden ist.'}</span>
                  </span>
                </button>
              </li>
            )}
          </ul>
        </section>
      ))}

      <button className="linkbtn path-map" onClick={onShowMap}><Icon name="map" size={18} />Alles als Karte ansehen</button>
    </div>
  );
}
