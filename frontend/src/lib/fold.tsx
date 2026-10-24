// A small fold-out menu: one button shows the current choice, a click opens the options.
import { useEffect, useRef, useState, type ReactNode } from 'react';

export interface FoldOption<T extends string> {
  value: T;
  label: string;
  icon: ReactNode;
  lang?: string;
}

export function FoldMenu<T extends string>({ label, value, options, onChoose, className = '' }: { label: string; value: T; options: FoldOption<T>[]; onChoose: (v: T) => void; className?: string }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', key);
    };
  }, [open]);

  return (
    <div className={`fold ${className}`} ref={box}>
      <button type="button" className="btn quiet small fold-trigger" aria-haspopup="true" aria-expanded={open} aria-label={`${label}: ${current.label}`} title={label} onClick={() => setOpen((o) => !o)}>
        <span className="fold-icon">{current.icon}</span>
        <svg className="fold-caret" viewBox="0 0 10 10" width="10" height="10" aria-hidden="true">
          <path d="M2 3.5 L5 6.5 L8 3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div className="fold-menu" role="group" aria-label={label}>
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              className="fold-item"
              lang={o.lang}
              aria-pressed={o.value === value}
              onClick={() => {
                onChoose(o.value);
                setOpen(false);
              }}
            >
              <span className="fold-icon">{o.icon}</span>
              <span>{o.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
