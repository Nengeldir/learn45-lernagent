// Learning with the AI: tutor, role play or prompt lab. Replies come from the model, or prepared ones without it.
import { useEffect, useRef, useState } from 'react';
import type { AiChatLesson, Answer, ChatTurn } from '@l45/shared';
import { SOURCE_LABEL } from '@l45/shared';
import { api } from '../lib/api.ts';
import { LessonProgress } from './LessonActivity.tsx';

const KIND_NOTE: Record<AiChatLesson['content']['kind'], string> = {
  tutor: 'Die KI stellt Fragen und verrät keine fertige Lösung.',
  roleplay: 'Die KI spielt eine Rolle. Schreib so, wie du es bei der Arbeit tun würdest.',
  'prompt-lab': 'Die KI führt deinen Auftrag wörtlich aus. Was du offen lässt, füllt sie mit Annahmen.',
};

export function AiChat({ lesson, sessionId, nodeId, onComplete }: { lesson: AiChatLesson; sessionId: string; nodeId: string; onComplete: (a: Answer) => Promise<void> }) {
  const c = lesson.content;
  const [turns, setTurns] = useState<ChatTurn[]>([{ role: 'ai', text: c.opening, source: 'prepared' }]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const log = useRef<HTMLDivElement>(null);
  const learnerTurns = turns.filter((t) => t.role === 'learner').length;

  useEffect(() => {
    if (log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [turns.length]);

  const send = async () => {
    const msg = text.trim();
    if (!msg || busy) return;
    const next: ChatTurn[] = [...turns, { role: 'learner', text: msg }];
    setTurns(next);
    setText('');
    setBusy(true);
    try {
      const reply = await api.chat(sessionId, nodeId, next);
      setTurns([...next, { role: 'ai', text: reply.text, source: reply.source }]);
    } catch (e) {
      setTurns([...next, { role: 'ai', text: `Keine Antwort: ${e instanceof Error ? e.message : String(e)}`, source: 'prepared' }]);
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    setBusy(true);
    try {
      await onComplete({ type: 'ai-chat', turns });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <LessonProgress completed={learnerTurns} total={c.minTurns} label="Deine Beiträge" detail={`${Math.min(learnerTurns, c.minTurns)} / ${c.minTurns}`} />
      <div className="goal"><strong>Dein Ziel:</strong> {c.goal}</div>
      <details className="chat-how"><summary>So funktioniert das Gespräch</summary><p>{KIND_NOTE[c.kind]}</p></details>
      <div className={c.material ? 'two-col chat-layout' : 'chat-layout'}>
        {c.material && (
          <details className="card source chat-material"><summary>Unterlagen ansehen</summary>
            <h3>{c.material.title} {lesson.source === 'model' && <span className="tag model">Beispiel erfunden</span>}</h3>
            <ul>{c.material.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
          </details>
        )}
        <div className="chat">
          <div className="chat-log" ref={log} role="log" aria-label="Gespräch mit der KI" aria-live="polite">
            {turns.map((t, i) => (
              <div key={i} className={`bubble ${t.role}`}>
                <span className="who">{t.role === 'ai' ? 'KI' : 'Du'}</span>
                <span className="txt">{t.text}</span>
                {t.role === 'ai' && t.source && t.source !== 'model' && i > 0 && <span className={`tag ${t.source}`}>{SOURCE_LABEL[t.source]}</span>}
              </div>
            ))}
            {busy && <div className="bubble ai typing">…</div>}

          </div>
          <form className="composer" onSubmit={(e) => { e.preventDefault(); send(); }}>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder={c.kind === 'prompt-lab' ? 'Dein Auftrag an die KI …' : 'Deine Antwort …'}
              aria-label="Nachricht"
              rows={2}
              disabled={busy}
            />
            <button className="btn primary" disabled={busy || !text.trim()}>Senden</button>
          </form>
        </div>
      </div>
      <div className="actions activity-actions">
        <button className="btn primary" disabled={busy || learnerTurns < c.minTurns} onClick={finish}>Fertig</button>
      </div>
    </>
  );
}
