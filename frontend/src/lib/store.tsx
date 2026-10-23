import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ContentBundle, Lesson, SessionView } from '@l45/shared';
import { api, ApiError } from './api.ts';

const KEY = 'lernagent.session';
const read = () => {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
};
const write = (id: string | null) => {
  try {
    if (id) localStorage.setItem(KEY, id);
    else localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable: the session lives only in memory */
  }
};

interface Store {
  content: ContentBundle | null;
  view: SessionView | null;
  loading: boolean;
  error: string | null;
  setView: (v: SessionView | null, generated?: Lesson[]) => void;
  logout: () => void;
  lessonOf: (id?: string) => Lesson | undefined;
}

const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [content, setContent] = useState<ContentBundle | null>(null);
  const [view, setViewState] = useState<SessionView | null>(null);
  const [generated, setGenerated] = useState<Lesson[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setContent(await api.content());
        const saved = read();
        if (saved) {
          try {
            setViewState(await api.session(saved));
            setGenerated(await api.generated(saved));
          } catch (e) {
            if (e instanceof ApiError && e.status === 404) write(null);
            else throw e;
          }
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const setView = useCallback((v: SessionView | null, gen?: Lesson[]) => {
    setViewState(v);
    if (gen) setGenerated(gen);
    write(v?.session.id ?? null);
  }, []);

  const value = useMemo<Store>(
    () => ({
      content,
      view,
      loading,
      error,
      setView,
      logout: () => {
        setView(null, []);
      },
      lessonOf: (id) => (id ? content?.lessons.find((l) => l.id === id) ?? generated.find((l) => l.id === id) : undefined),
    }),
    [content, view, loading, error, setView, generated],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore() {
  const c = useContext(Ctx);
  if (!c) throw new Error('StoreProvider fehlt');
  return c;
}
