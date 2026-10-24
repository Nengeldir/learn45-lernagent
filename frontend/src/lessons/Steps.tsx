// A short step bar for lessons: one question at a time, with dots to jump back to an answered step.
import type { CSSProperties } from 'react';

export function StepBar({ steps, at, done, onJump, label }: {
  steps: string[];
  at: number;
  done: (i: number) => boolean;
  onJump: (i: number) => void;
  label: string;
}) {
  const progress = steps.length > 1 ? at / (steps.length - 1) : 1;
  return (
    <nav className="stepbar" aria-label={label} style={{ '--step-progress': progress } as CSSProperties}>
      <ol>
        {steps.map((s, i) => {
          const reachable = i <= at || done(i) || (i > 0 && done(i - 1));
          return (
            <li key={i} className={`${i === at ? 'is-at' : ''}${done(i) ? ' is-done' : ''}`}>
              <button type="button" disabled={!reachable} aria-current={i === at ? 'step' : undefined} onClick={() => onJump(i)}>
                <span className="step-dot" aria-hidden="true">{done(i) && i !== at ? '✓' : i + 1}</span>
                <span className="step-label">{s}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
