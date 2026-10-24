// Lessons with a first check: after a first mistake the learner chooses a hint or looks again (rule R6).
import { useState, type ReactNode } from 'react';
import type { Answer, MarkEvidenceLesson, MockPart, MockSiteLesson, PartialCheck, Source } from '@l45/shared';
import { api } from '../lib/api.ts';
import { useI18n } from '../lib/i18n.tsx';

type Mark = 'belegt' | 'erfunden';

interface Ctx {
  sessionId: string;
  nodeId: string;
  onComplete: (a: Answer) => Promise<void>;
}

function useCheckFlow({ sessionId, nodeId, onComplete }: Ctx) {
  const [check, setCheck] = useState<PartialCheck | null>(null);
  const [checks, setChecks] = useState(0);
  const [hint, setHint] = useState<{ text: string; source: Source } | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (answer: Answer) => {
    setBusy(true);
    try {
      if (checks === 0) {
        const c = await api.check(sessionId, nodeId, answer);
        if (!c.complete) {
          setCheck(c);
          setChecks(1);
          return;
        }
      }
      await onComplete(answer);
    } finally {
      setBusy(false);
    }
  };
  const askHint = async (answer: Answer) => {
    setBusy(true);
    try {
      setHint(await api.hint(sessionId, nodeId, answer));
    } finally {
      setBusy(false);
    }
  };
  return { check, checks, hint, busy, run, askHint, dismiss: () => setCheck(null) };
}

function HelpBox({ check, hint, onHint, onRetry, busy }: { check: PartialCheck; hint: { text: string; source: Source } | null; onHint: () => void; onRetry: () => void; busy: boolean }) {
  const { t, source } = useI18n();
  return (
    <div className="helpbox" role="status">
      <p><strong>{check.message}</strong></p>
      {!hint ? (
        <>
          <p className="small muted">{t('Möchtest du einen kurzen Hinweis der KI, oder suchst du nochmals selbst?')}</p>
          <div className="row">
            <button className="btn secondary" onClick={onHint} disabled={busy}>{t('Hinweis der KI')}</button>
            <button className="btn quiet" onClick={onRetry}>{t('Selbst nochmals suchen')}</button>
          </div>
        </>
      ) : (
        <p className="bubble ai">{hint.text} <span className={`tag ${hint.source}`}>{source(hint.source)}</span></p>
      )}
    </div>
  );
}

// --- Check an AI summary ---------------------------------------------------------------------

export function MarkEvidence({ lesson, ...ctx }: { lesson: MarkEvidenceLesson } & Ctx) {
  const [marks, setMarks] = useState<Record<string, Mark>>({});
  const flow = useCheckFlow(ctx);
  const all = lesson.content.summary.every((s) => marks[s.id]);
  const answer: Answer = { type: 'mark-evidence', marks };
  const { t } = useI18n();
  return (
    <>
      <div className="two-col">
        <div className="card source">
          <h3>{lesson.content.noteTitle}</h3>
          <ul>{lesson.content.note.map((n, i) => <li key={i}>{n}</li>)}</ul>
        </div>
        <div className="card">
          <h3>{t('KI-Zusammenfassung')}</h3>
          {lesson.content.summary.map((s, i) => (
            <div key={s.id} className="claim">
              <p>{s.text}</p>
              <div className="toggle" role="group" aria-label={t('Satz {n}', { n: i + 1 })}>
                {(['belegt', 'erfunden'] as Mark[]).map((m) => (
                  <button key={m} aria-pressed={marks[s.id] === m} onClick={() => setMarks({ ...marks, [s.id]: m })}>{t(m)}</button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
      {flow.check && <HelpBox check={flow.check} hint={flow.hint} busy={flow.busy} onHint={() => flow.askHint(answer)} onRetry={flow.dismiss} />}
      <div className="actions">
        {!all && <span className="small muted">{t('Markiere jeden Satz.')}</span>}
        <button className="btn primary" disabled={!all || flow.busy} onClick={() => flow.run(answer)}>{flow.checks ? t('Abschliessen') : t('Prüfen')}</button>
      </div>
    </>
  );
}

// --- Inspect a website or mail ------------------------------------------------------------------

export function MockSite({ lesson, ...ctx }: { lesson: MockSiteLesson } & Ctx) {
  const mail = lesson.content.mail ?? [];
  const site = lesson.content.site;
  const [tab, setTab] = useState<'mail' | 'site'>(mail.length ? 'mail' : 'site');
  const [marked, setMarked] = useState<string[]>([]);
  const [verdict, setVerdict] = useState<'phishing' | 'echt' | null>(null);
  const [showTarget, setShowTarget] = useState(false);
  const flow = useCheckFlow(ctx);
  const { t } = useI18n();
  const answer: Answer = { type: 'mock-site', marked, verdict };
  const toggle = (id: string) => setMarked(marked.includes(id) ? marked.filter((x) => x !== id) : [...marked, id]);
  const of = (parts: MockPart[], kind: MockPart['kind']) => parts.filter((p) => p.kind === kind);
  const hot = (p: MockPart, cls = '', body: ReactNode = p.text) => (
    <button key={p.id} type="button" className={`hot ${cls}`} aria-pressed={marked.includes(p.id)} onClick={() => toggle(p.id)}>{body}</button>
  );

  return (
    <>
      <p className="note">{lesson.content.disclaimer}</p>
      {mail.length > 0 && (
        <div className="seg" role="tablist">
          <button role="tab" aria-selected={tab === 'mail'} onClick={() => setTab('mail')}>{t('E-Mail')}</button>
          <button role="tab" aria-selected={tab === 'site'} onClick={() => setTab('site')}>{t('Webseite nach dem Klick')}</button>
        </div>
      )}
      {tab === 'mail' ? (
        <div className="mock">
          <div className="mock-bar">{t('Posteingang')}</div>
          <div className="mock-body">
            {of(mail, 'from').map((p) => hot(p, '', <>{t('Von:')} {p.text}</>))}
            {of(mail, 'subject').map((p) => hot(p, 'subject', <>{t('Betreff:')} {p.text}</>))}
            <hr />
            {of(mail, 'greeting').map((p) => hot(p))}
            {of(mail, 'paragraph').map((p) => hot(p))}
            {of(mail, 'link').map((p) => (
              <div key={p.id}>
                {hot(p, 'linkpart')}
                <button type="button" className="linkbtn small" onClick={() => setShowTarget(!showTarget)}>
                  {showTarget ? t('Linkziel ausblenden') : t('Linkziel anzeigen (wie mit der Maus darüberfahren)')}
                </button>
                {showTarget && <div className="small target">{t('Linkziel:')} {p.linkTarget}</div>}
              </div>
            ))}
            {of(mail, 'signature').map((p) => hot(p))}
          </div>
        </div>
      ) : (
        <div className="mock">
          <div className="mock-bar"><span aria-hidden="true">🔒</span>{of(site, 'url').map((p) => hot(p, 'url'))}</div>
          <div className="mock-body">
            {of(site, 'logo').map((p) => hot(p, 'logo'))}
            {of(site, 'heading').map((p) => hot(p, '', <strong>{p.text}</strong>))}
            {of(site, 'field').map((p) => hot(p, '', <span className="fields">{p.text.split(' · ').map((f) => <span key={f}>{f}</span>)}</span>))}
            {of(site, 'button').map((p) => hot(p, '', <span className="mbutton">{p.text}</span>))}
            {of(site, 'footer').map((p) => hot(p, 'footer'))}
          </div>
        </div>
      )}
      <div className="card">
        <h3>{t('Dein Entscheid')}</h3>
        <div className="toggle" role="group" aria-label={t('Entscheid')}>
          <button aria-pressed={verdict === 'phishing'} onClick={() => setVerdict('phishing')}>{t('Phishing')}</button>
          <button aria-pressed={verdict === 'echt'} onClick={() => setVerdict('echt')}>{t('Echt')}</button>
        </div>
        <p className="small muted">{t('Markiert: {n}', { n: marked.length })}</p>
      </div>
      {flow.check && <HelpBox check={flow.check} hint={flow.hint} busy={flow.busy} onHint={() => flow.askHint(answer)} onRetry={flow.dismiss} />}
      <div className="actions">
        <button className="btn primary" disabled={!verdict || flow.busy} onClick={() => flow.run(answer)}>{flow.checks ? t('Abschliessen') : t('Prüfen')}</button>
      </div>
    </>
  );
}
