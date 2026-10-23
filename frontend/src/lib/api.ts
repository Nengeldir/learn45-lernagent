import type { Answer, ChatTurn, ContentBundle, DccLevel, Lesson, LessonResult, PartialCheck, SessionView, Source } from '@l45/shared';

export class ApiError extends Error {
  constructor(public status: number, message: string, public body: Record<string, unknown> = {}) {
    super(message);
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'Keine Verbindung zum Server. Läuft das Backend?');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error ?? `Fehler ${res.status}`, data as Record<string, unknown>);
  return data as T;
}

const s = (id: string) => `/api/sessions/${id}`;
const n = (id: string, node: string) => `${s(id)}/nodes/${encodeURIComponent(node)}`;

export interface LoginBody {
  name: string;
  timeBudgetMin: number;
  dccFile?: unknown;
  fileName?: string;
  levels?: Record<string, DccLevel | null>;
  /** After a 409 for an existing name: continue that learner or start a new one */
  resume?: 'continue' | 'new';
}

export const api = {
  health: () => call<{ ok: boolean; provider: string }>('GET', '/api/health'),
  content: () => call<ContentBundle>('GET', '/api/content'),
  login: (body: LoginBody) => call<SessionView>('POST', '/api/login', body),
  session: (id: string) => call<SessionView>('GET', s(id)),
  generated: (id: string) => call<Lesson[]>('GET', `${s(id)}/lessons`),
  patch: (id: string, body: Record<string, unknown>) => call<SessionView>('PATCH', s(id), body),
  mission: (id: string, trackId: string, body: { text?: string; skip?: boolean; confirm?: boolean }) =>
    call<SessionView>('PUT', `${s(id)}/missions/${encodeURIComponent(trackId)}`, body),
  start: (id: string, node: string) => call<{ lesson: Lesson; switched?: string; view: SessionView }>('POST', `${n(id, node)}/start`, {}),
  check: (id: string, node: string, answer: Answer) => call<PartialCheck>('POST', `${n(id, node)}/check`, { answer }),
  hint: (id: string, node: string, answer: Answer) => call<{ text: string; source: Source }>('POST', `${n(id, node)}/hint`, { answer }),
  chat: (id: string, node: string, turns: ChatTurn[]) => call<{ text: string; source: Source }>('POST', `${n(id, node)}/chat`, { turns }),
  complete: (id: string, node: string, answer: Answer, durationMin: number) =>
    call<{ result: LessonResult; view: SessionView; generated: Lesson[] }>('POST', `${n(id, node)}/complete`, { answer, durationMin }),
};
