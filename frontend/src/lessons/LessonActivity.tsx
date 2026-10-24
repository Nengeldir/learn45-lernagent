import { ButtonLabel } from '../lib/ButtonLabel.tsx';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { LessonAnswerCheck, LessonAnswerFeedback } from '@l45/shared';
import { api } from '../lib/api.ts';
import { Icon } from '../lib/icons.tsx';

const Activity = createContext<{ sessionId: string; nodeId: string } | null>(null);

export function LessonActivityProvider({ sessionId, nodeId, children }: { sessionId: string; nodeId: string; children: ReactNode }) {
  return <Activity.Provider value={{ sessionId, nodeId }}>{children}</Activity.Provider>;
}

export function LessonProgress({ completed, total, label, detail }: { completed: number; total: number; label: string; detail?: string }) {
  const done = Math.min(completed, total);
  return <div className="lesson-progress">
    <div className="lesson-progress-label"><strong><Icon name={done === total && total > 0 ? 'check' : 'sparkle'} size={16} />{label}</strong><span>{detail ?? `${done} von ${total} geschafft`}</span></div>
    <div className="lesson-progress-track" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={Math.max(1, total)} aria-valuenow={done}>
      {Array.from({ length: total }, (_, index) => <span key={index} className={index < done ? 'complete' : index === done ? 'current' : ''} />)}
    </div>
  </div>;
}

/** A click commits the answer and requests feedback; the original response stays locked. */
export function QuestionCard({ prompt, options, index, total, check, onContinue, continueLabel = 'Weiter', onFeedback }: {
  prompt: string; options: string[]; index: number; total: number;
  check: (option: number) => LessonAnswerCheck;
  onContinue: (option: number) => void | Promise<void>;
  continueLabel?: string;
  onFeedback?: (feedback: LessonAnswerFeedback) => void;
}) {
  const activity = useContext(Activity);
  const [selected, setSelected] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<LessonAnswerFeedback | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const locked = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const continueButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, []);

  const submit = async (option: number) => {
    if (!activity || pending.current || locked.current) return;
    pending.current = true;
    setSelected(option);
    setBusy(true);
    setError('');
    try {
      const result = await api.answerFeedback(activity.sessionId, activity.nodeId, check(option));
      locked.current = true;
      setFeedback(result);
      onFeedback?.(result);
      requestAnimationFrame(() => continueButton.current?.focus({ preventScroll: true }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { pending.current = false; setBusy(false); }
  };
  const next = async () => {
    if (selected === null || !feedback || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try { await onContinue(selected); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { pending.current = false; setBusy(false); }
  };

  return <section className={`question-card${feedback ? feedback.correct ? ' answer-correct' : ' answer-learning' : ''}`} aria-label={`Wissens-Check ${index + 1} von ${total}`} aria-busy={busy && !feedback}>
    <div className="question-kicker"><span><Icon name="sparkle" size={15} />Frage</span><span>{index + 1} / {total}</span></div>
    <h3 ref={heading} tabIndex={-1}>{prompt}</h3>
    <div className="question-options" role="group" aria-label="Antwort auswählen">
      {options.map((option, i) => {
        const correct = feedback?.correctOption === i;
        const wrong = Boolean(feedback && selected === i && !correct);
        return <button key={i} className={`question-option${correct ? ' is-correct' : wrong ? ' is-missed' : ''}`} disabled={busy || Boolean(feedback)} aria-label={feedback ? `${correct ? 'Richtige Antwort: ' : selected === i ? 'Deine Antwort: ' : ''}${option}` : undefined} aria-pressed={selected === i} onClick={() => void submit(i)}>
          <span className="option-letter" aria-hidden="true">{correct || selected === i && !feedback ? <Icon name="check" size={17} /> : wrong ? <Icon name="back" size={16} /> : String.fromCharCode(65 + i)}</span>
          <span>{option}</span>
        </button>;
      })}
    </div>
    {feedback && <div className={`answer-feedback ${feedback.correct ? 'correct' : 'learning'}`} role="status">
      <span className="answer-feedback-icon"><Icon name={feedback.correct ? 'star' : 'book'} size={23} /></span>
      <div><strong>{feedback.correct ? 'Richtig!' : 'Richtige Antwort'}</strong>{(feedback.explanation || !feedback.correct) && <p>{feedback.explanation || options[feedback.correctOption]}</p>}</div>
      {feedback.correct && <span className="answer-spark" aria-hidden="true"><Icon name="sparkle" size={22} /></span>}
    </div>}
    {error && <p className="error small" role="alert">{error}</p>}
    {busy && !feedback && <p className="answer-pending small muted" role="status">Wird geprüft …</p>}
    {feedback ? <div className="question-actions"><button ref={continueButton} className="btn primary" disabled={busy} onClick={() => void next()}><ButtonLabel variants={['Weiter', 'Nächste Frage', 'Nächster Satz', 'Lektion abschliessen', 'Einen Moment …', continueLabel]}>{busy ? 'Einen Moment …' : continueLabel}</ButtonLabel><Icon name="chevron" size={17} /></button></div>
      : error && selected !== null && <div className="question-actions"><button className="btn secondary" disabled={busy} onClick={() => void submit(selected)}>Erneut versuchen</button></div>}
  </section>;
}
