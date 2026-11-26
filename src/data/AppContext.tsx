import { toast } from '../toast';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { log } from '../domain/actions';
import { todayIso } from '../domain/dates';
import { scheduleNotices } from '../domain/notify';
import { applyChanges, diffState } from '../domain/undo';
import type { UndoEntry } from '../domain/undo';
import type { AppState } from '../domain/types';
import { applyRemote, cloudBackend, demoBackend, readCloudConfig } from './backend';
import type { Backend } from './backend';
import { t } from '../i18n';

type SyncStatus = 'idle' | 'saving' | 'error';
export type Role = 'admin' | 'editor' | 'viewer' | 'employee' | 'kiosk';

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
  /** opis ostatniej zmiany do cofnięcia / ponowienia (tylko zmiany z tej sesji) */
  undoLabel: string | null;
  redoLabel: string | null;
  undo: () => void;
  redo: () => void;
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
  // powiadomienia zbierane przez chwilę, żeby kilka kliknięć dało jedno powiadomienie
  const notifyBase = useRef<AppState | null>(null);
  const notifyTimer = useRef<number | undefined>(undefined);
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
      if (error) setLoadError(t('Nie można sprawdzić uprawnień: {msg}. Czy uruchomiono supabase/schema.sql?', { msg: error.message }));
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

  const undoStack = useRef<UndoEntry[]>([]);
  const redoStack = useRef<UndoEntry[]>([]);
  const [undoLabel, setUndoLabel] = useState<string | null>(null);
  const [redoLabel, setRedoLabel] = useState<string | null>(null);
  const refreshUndo = () => {
    setUndoLabel(undoStack.current.at(-1)?.label ?? null);
    setRedoLabel(redoStack.current.at(-1)?.label ?? null);
  };

  const commit = useCallback(
    (fn: (draft: AppState) => void, historyText: string | undefined, mode: 'do' | 'undo' | 'redo') => {
      const prev = stateRef.current;
      if (!prev) return;
      if (!canEdit) {
        toast(t('Masz dostęp tylko do podglądu (rola: viewer).'), { tone: 'warn' });
        return;
      }
      const draft = structuredClone(prev);
      fn(draft);
      if (mode === 'do') {
        const changes = diffState(prev, draft);
        if (changes.length) {
          undoStack.current.push({ label: historyText ?? t('zmiana'), changes });
          if (undoStack.current.length > 50) undoStack.current.shift();
          redoStack.current = [];
          refreshUndo();
        }
      }
      if (historyText) log(draft, user, historyText);
      stateRef.current = draft;
      setState(draft);
      persist(prev, draft);
      if (backend.client) {
        notifyBase.current ??= prev;
        window.clearTimeout(notifyTimer.current);
        notifyTimer.current = window.setTimeout(() => {
          const base = notifyBase.current;
          const now = stateRef.current;
          notifyBase.current = null;
          if (!base || !now) return;
          const items = scheduleNotices(base, now, todayIso());
          if (items.length) {
            void queue.current.then(() => backend.client!.functions.invoke('tmt-api', { body: { action: 'notify', items } }));
          }
        }, 10_000);
      }
    },
    [persist, user, canEdit, backend],
  );

  const update = useCallback((fn: (draft: AppState) => void, historyText?: string) => commit(fn, historyText, 'do'), [commit]);

  const step = useCallback(
    (dir: 'undo' | 'redo') => {
      const from = dir === 'undo' ? undoStack.current : redoStack.current;
      const to = dir === 'undo' ? redoStack.current : undoStack.current;
      const entry = from.pop();
      if (!entry) return;
      let conflicts = 0;
      commit(
        (d) => {
          conflicts = applyChanges(d, entry.changes, dir);
        },
        `${dir === 'undo' ? 'Cofnięto' : 'Ponowiono'}: ${entry.label}`,
        dir,
      );
      to.push(entry);
      refreshUndo();
      if (conflicts) toast(t('Część danych zmienił w międzyczasie ktoś inny — tych nie ruszano ({n}).', { n: conflicts }), { tone: 'warn' });
    },
    [commit],
  );
  const undo = useCallback(() => step('undo'), [step]);
  const redo = useCallback(() => step('redo'), [step]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((k === 'z' && e.shiftKey) || k === 'y') {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

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

  if (!authChecked) return <div className="splash">{t('Łączenie z bazą…')}</div>;
  if (backend.mode === 'cloud' && !session) return <>{login(backend)}</>;
  if (recovering) return <>{recovery(backend, () => setRecovering(false))}</>;
  if (backend.mode === 'cloud' && role === null)
    return (
      <div className="splash">
        <h2>{t('Brak dostępu')}</h2>
        <p>{t('Konto {email} nie jest na liście osób z dostępem. Poproś administratora o dodanie.', { email: session?.user.email ?? '' })}</p>
        <button className="btn" type="button" onClick={() => void backend.client?.auth.signOut()}>
          {t('Wyloguj')}
        </button>
      </div>
    );
  if (backend.mode === 'cloud' && role === undefined && !loadError) return <div className="splash">{t('Sprawdzanie uprawnień…')}</div>;
  if (loadError)
    return (
      <div className="splash">
        <p>{t('Nie udało się wczytać danych: {msg}', { msg: loadError })}</p>
        <button className="btn primary" type="button" onClick={() => void reload()}>
          {t('Spróbuj ponownie')}
        </button>
      </div>
    );
  if (!state) return <div className="splash">{t('Wczytywanie…')}</div>;

  return (
    <Ctx.Provider value={{ state, backend, user, session, role: role ?? 'viewer', canEdit, sync, syncError, update, replaceAll, undoLabel, redoLabel, undo, redo, reload }}>
      {children}
    </Ctx.Provider>
  );
}
