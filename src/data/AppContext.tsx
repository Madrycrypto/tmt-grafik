import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { log } from '../domain/actions';
import type { AppState } from '../domain/types';
import { applyRemote, cloudBackend, demoBackend, readCloudConfig } from './backend';
import type { Backend } from './backend';

type SyncStatus = 'idle' | 'saving' | 'error';
export type Role = 'admin' | 'editor' | 'viewer';

interface AppCtx {
  state: AppState;
  backend: Backend;
  user: string;
  session: Session | null;
  role: Role;
  canEdit: boolean;
  sync: SyncStatus;
  syncError: string | null;
  /** zmiana stanu na kopii roboczej; opcjonalny wpis do historii */
  update: (fn: (draft: AppState) => void, historyText?: string) => void;
  replaceAll: (next: AppState) => void;
  reload: () => Promise<void>;
}

const Ctx = createContext<AppCtx | null>(null);

export function useApp(): AppCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useApp poza AppProvider');
  return c;
}

export function AppProvider({
  children,
  login,
  recovery,
}: {
  children: ReactNode;
  login: (backend: Backend) => ReactNode;
  recovery: (backend: Backend, done: () => void) => ReactNode;
}) {
  const [recovering, setRecovering] = useState(false);
  const backend = useMemo<Backend>(() => {
    const cfg = readCloudConfig();
    return cfg ? cloudBackend(cfg) : demoBackend();
  }, []);
  const [state, setState] = useState<AppState | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [authChecked, setAuthChecked] = useState(backend.mode === 'demo');
  const [sync, setSync] = useState<SyncStatus>('idle');
  const [syncError, setSyncError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [role, setRole] = useState<Role | null | undefined>(backend.mode === 'demo' ? 'admin' : undefined);
  const stateRef = useRef<AppState | null>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    if (!backend.client) return;
    void backend.client.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthChecked(true);
    });
    const { data } = backend.client.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === 'PASSWORD_RECOVERY') setRecovering(true);
    });
    return () => data.subscription.unsubscribe();
  }, [backend]);

  useEffect(() => {
    if (!backend.client || !session) return;
    setRole(undefined);
    void backend.client.rpc('my_role').then(({ data, error }) => {
      if (error) setLoadError(`Nie można sprawdzić uprawnień: ${error.message}. Czy uruchomiono supabase/schema.sql?`);
      else setRole((data as Role | null) ?? null);
    });
  }, [backend, session]);

  const canLoad = backend.mode === 'demo' || (!!session && !!role);
  const canEdit = role === 'admin' || role === 'editor';

  const reload = useCallback(async () => {
    try {
      const s = await backend.load();
      stateRef.current = s;
      setState(s);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, [backend]);

  useEffect(() => {
    if (canLoad) void reload();
  }, [canLoad, reload]);

  useEffect(() => {
    if (!canLoad) return;
    return backend.subscribe((c) => {
      if (!stateRef.current) return;
      const next = applyRemote(stateRef.current, c);
      if (next !== stateRef.current) {
        stateRef.current = next;
        setState(next);
      }
    });
  }, [backend, canLoad]);

  const user = backend.mode === 'demo' ? 'demo' : (session?.user.email ?? '?');

  const persist = useCallback(
    (prev: AppState, next: AppState) => {
      setSync('saving');
      queue.current = queue.current
        .then(() => backend.save(prev, next))
        .then(() => {
          setSync('idle');
          setSyncError(null);
        })
        .catch((e: unknown) => {
          setSync('error');
          setSyncError(e instanceof Error ? e.message : String(e));
        });
    },
    [backend],
  );

  const update = useCallback(
    (fn: (draft: AppState) => void, historyText?: string) => {
      const prev = stateRef.current;
      if (!prev) return;
      if (!canEdit) {
        alert('Masz dostęp tylko do podglądu (rola: viewer).');
        return;
      }
      const draft = structuredClone(prev);
      fn(draft);
      if (historyText) log(draft, user, historyText);
      stateRef.current = draft;
      setState(draft);
      persist(prev, draft);
    },
    [persist, user, canEdit],
  );

  const replaceAll = useCallback(
    (next: AppState) => {
      const prev = stateRef.current;
      if (!prev) return;
      stateRef.current = next;
      setState(next);
      persist(prev, next);
    },
    [persist],
  );

  if (!authChecked) return <div className="splash">Łączenie z bazą…</div>;
  if (backend.mode === 'cloud' && !session) return <>{login(backend)}</>;
  if (recovering) return <>{recovery(backend, () => setRecovering(false))}</>;
  if (backend.mode === 'cloud' && role === null)
    return (
      <div className="splash">
        <h2>Brak dostępu</h2>
        <p>Konto {session?.user.email} nie jest na liście osób z dostępem. Poproś administratora o dodanie.</p>
        <button className="btn" type="button" onClick={() => void backend.client?.auth.signOut()}>
          Wyloguj
        </button>
      </div>
    );
  if (backend.mode === 'cloud' && role === undefined && !loadError) return <div className="splash">Sprawdzanie uprawnień…</div>;
  if (loadError)
    return (
      <div className="splash">
        <p>Nie udało się wczytać danych: {loadError}</p>
        <button className="btn primary" type="button" onClick={() => void reload()}>
          Spróbuj ponownie
        </button>
      </div>
    );
  if (!state) return <div className="splash">Wczytywanie…</div>;

  return (
    <Ctx.Provider value={{ state, backend, user, session, role: role ?? 'viewer', canEdit, sync, syncError, update, replaceAll, reload }}>
      {children}
    </Ctx.Provider>
  );
}
