import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { Player } from '@l45/animlib';
import type { Answer, NarratedVideoManifest, VideoLesson } from '@l45/shared';
import { useI18n } from '../lib/i18n.tsx';
import { VideoPlayback, type PlaybackState } from './videoPlayback.ts';
import { parseVideoManifest } from './videoManifest.ts';

const initial: PlaybackState = { scene: 0, time: 0, playing: false, asking: null, answers: {}, ended: false, error: '' };
const subscribeLoading = () => () => {};
const getLoading = () => initial;
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
const scrollTo = (element: Element | null) => element?.scrollIntoView({
  behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start',
});

export default function NarratedVideo({ lesson, onComplete, onFallback }: {
  lesson: VideoLesson; onComplete: (answer: Answer) => Promise<void>; onFallback: () => void;
}) {
  const { t } = useI18n();
  const host = useRef<HTMLDivElement>(null);
  const screen = useRef<HTMLDivElement>(null);
  const checkpoint = useRef<HTMLElement>(null);
  const questionHeading = useRef<HTMLHeadingElement>(null);
  const playButton = useRef<HTMLButtonElement>(null);
  const [controller, setController] = useState<VideoPlayback>();
  const [manifest, setManifest] = useState<NarratedVideoManifest>();
  const [error, setError] = useState('');
  const [captions, setCaptions] = useState(true);
  const [muted, setMuted] = useState(false);
  const [busy, setBusy] = useState(false);
  const engine = useRef<Player | undefined>(undefined);
  const state = useSyncExternalStore(controller?.subscribe ?? subscribeLoading, controller?.getState ?? getLoading);
  const questions = lesson.content.questions;
  const manifestUrl = lesson.content.narrated!.manifestUrl;

  useEffect(() => {
    const abort = new AbortController();
    let active = true;
    let player: Player | undefined;
    let playback: VideoPlayback | undefined;
    const container = host.current!;
    void (async () => {
      const response = await fetch(manifestUrl, { signal: abort.signal });
      if (!response.ok) throw new Error('Video nicht erreichbar.');
      const next = parseVideoManifest(await response.json(), lesson);
      const { createPlayer } = await import('@l45/animlib');
      if (!active) return;
      const canvas = document.createElement('canvas');
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', 'Animation: Sekante, Tangente und die lokale Steigung einer Kurve.');
      container.append(canvas);
      player = createPlayer({ canvas, assets: Object.fromEntries(next.scenes.map((scene, i) => [`narration-${i}`, { kind: 'audio' as const, url: scene.audioUrl }])) });
      engine.current = player;
      const loaded = await player.submit({ type: 'load', scenes: next.scenes.map(scene => ({ id: scene.id, source: scene.source })) });
      if (!loaded.ok) throw new Error(loaded.diagnostics.map(diagnostic => `${diagnostic.code}: ${diagnostic.message}`).join('\n'));
      if (!active) return;
      playback = new VideoPlayback(player, next.scenes, questions);
      setManifest(next);
      setController(playback);
    })().catch(cause => {
      if (active) {
        console.error('Erklärvideo konnte nicht geladen werden:', cause);
        player?.dispose();
        container.replaceChildren();
        engine.current = undefined;
        setError('Das Erklärvideo konnte nicht geladen werden. Du kannst die Lektion als Storyboard ansehen.');
      }
    });
    return () => {
      active = false; abort.abort();
      if (playback) playback.dispose(); else player?.dispose();
      engine.current = undefined;
      container.replaceChildren();
    };
  }, [manifestUrl, lesson, questions]);

  const showQuestion = useCallback(() => {
    questionHeading.current?.focus({ preventScroll: true });
    scrollTo(checkpoint.current);
  }, []);
  useEffect(() => { if (state.asking !== null) showQuestion(); }, [state.asking, showQuestion]);
  const answerQuestion = async (option: number) => {
    await controller!.answer(option);
    const next = controller!.getState();
    if (next.asking === null && !next.ended) {
      playButton.current?.focus({ preventScroll: true });
      scrollTo(screen.current);
    }
  };
  const scene = manifest?.scenes[state.scene];
  const caption = scene?.captions.find(cue => state.time >= cue.start && state.time < cue.end)?.text ?? '';
  const problem = error || state.error;
  const ready = Boolean(controller && manifest);
  const questionId = `checkpoint-${lesson.id}`;

  return (
    <div className="narrated-video" ref={screen}>
      <div className="narrated-stage" hidden={Boolean(error) && !ready}>
        <div className="narrated-canvas" ref={host} />
        {state.asking !== null && <div className="video-pause-notice" role="status">
          <strong>{t('Video pausiert')}</strong>
          <span>{t('Frage {n} von {total} wartet auf dich.', { n: state.asking + 1, total: questions.length })}</span>
          <span>{t('Beantworte die Frage unten.')}</span>
        </div>}
      </div>
      {!ready && !problem && <p role="status">{t('Erklärvideo wird geladen …')}</p>}
      {problem && <div className="note" role="alert"><p>{t(problem)}</p><button className="btn secondary" onClick={onFallback}>{t('Storyboard ansehen')}</button></div>}
      {ready && (
        <>
          <p className="video-scene-label">{state.scene + 1} / {manifest!.scenes.length} · {scene?.title}</p>
          <div className="video-controls" role="group" aria-label={t('Videosteuerung')}>
            <button ref={playButton} className="btn primary" aria-controls={state.asking !== null ? questionId : undefined}
              onClick={() => state.asking !== null ? showQuestion() : state.playing ? controller!.pause() : void controller!.play()}>
              {t(state.asking !== null ? 'Zur Frage' : state.playing ? 'Pause' : state.ended ? 'Nochmals abspielen' : 'Abspielen')}
            </button>
            <button className="btn quiet" aria-pressed={muted} onClick={() => { engine.current?.setMuted(!muted); setMuted(!muted); }}>{t(muted ? 'Ton einschalten' : 'Ton ausschalten')}</button>
            <button className="btn quiet" aria-pressed={captions} onClick={() => setCaptions(!captions)}>{t('Untertitel')}</button>
          </div>
          <div className="video-timeline">
            <label className="sr-only" htmlFor={`seek-${lesson.id}`}>{t('Videoposition')}</label>
            <input id={`seek-${lesson.id}`} type="range" min={0} max={controller!.duration} step="any" value={controller!.position}
              disabled={state.asking !== null} aria-valuetext={t('{a} von {b}', { a: clock(controller!.position), b: clock(controller!.duration) })}
              onChange={event => void controller!.seek(Number(event.target.value))} />
            <span>{clock(controller!.position)} / {clock(controller!.duration)}</span>
          </div>
          {captions && <p className="video-caption" lang="de">{caption || '\u00a0'}</p>}
          {state.asking !== null && (
            <section ref={checkpoint} id={questionId} className="panel video-checkpoint" aria-label={t('Frage {n}', { n: state.asking + 1 })}>
              <p className="video-checkpoint-label">{t('Video pausiert · Frage {n} von {total}', { n: state.asking + 1, total: questions.length })}</p>
              <h3 ref={questionHeading} tabIndex={-1}>{questions[state.asking].prompt}</h3>
              <p>{state.scene === manifest!.scenes.length - 1
                ? t('Wähle eine Antwort. Danach kannst du die Lektion abschliessen.')
                : t('Wähle eine Antwort. Danach läuft das Video automatisch weiter.')}</p>
              <div className="choices">
                {questions[state.asking].options.map((option, i) => <button className="choice" key={i} onClick={() => void answerQuestion(i)}>{option}</button>)}
              </div>
            </section>
          )}
          {state.ended && questions.every((_, i) => state.answers[i] !== undefined) && (
            <button className="btn primary block" disabled={busy} onClick={async () => {
              setBusy(true);
              try { await onComplete({ type: 'video', answers: state.answers }); }
              finally { setBusy(false); }
            }}>{busy ? t('Wird geprüft …') : t('Abschliessen')}</button>
          )}
          <details className="video-transcript"><summary>{t('Text zum Mitlesen')}</summary>
            {manifest!.scenes.map(scene => <section key={scene.id}><h3>{scene.title}</h3>{scene.captions.map((cue, i) => <p key={i}>{cue.text}</p>)}</section>)}
          </details>
        </>
      )}
    </div>
  );
}
