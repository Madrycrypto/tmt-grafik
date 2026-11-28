import { useCallback, useEffect, useState } from 'react';
import { useApp } from './AppContext';

const DEMO_KEY = 'tmt-demo-rcp-locks';
const KIND = 'rcp_locks';

/** Zamknięte miesiące rozliczenia RCP (RRRR-MM). Blokada działa w aplikacji: chroni przed przypadkową zmianą, nie przed bazą. */
export function useMonthLocks(): { locked: Set<string>; lock: (month: string) => Promise<void>; unlock: (month: string) => Promise<void> } {
  const { backend, user } = useApp();
  const [locked, setLocked] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    const db = backend.client;
    if (!db) {
      try {
        setLocked(new Set(JSON.parse(localStorage.getItem(DEMO_KEY) ?? '[]') as string[]));
      } catch {
        setLocked(new Set());
      }
      return;
    }
    const { data } = await db.from('records').select('id').eq('kind', KIND);
    setLocked(new Set((data ?? []).map((r: { id: string }) => r.id)));
  }, [backend]);

  useEffect(() => {
    void load();
  }, [load]);

  const lock = useCallback(
    async (month: string) => {
      const db = backend.client;
      if (!db) {
        const next = new Set(locked).add(month);
        localStorage.setItem(DEMO_KEY, JSON.stringify([...next]));
      } else {
        const { error } = await db.from('records').upsert({ kind: KIND, id: month, data: { month, at: new Date().toISOString(), by: user ?? '' } });
        if (error) throw error;
      }
      await load();
    },
    [backend, locked, user, load],
  );

  const unlock = useCallback(
    async (month: string) => {
      const db = backend.client;
      if (!db) {
        const next = new Set(locked);
        next.delete(month);
        localStorage.setItem(DEMO_KEY, JSON.stringify([...next]));
      } else {
        const { error } = await db.from('records').delete().eq('kind', KIND).eq('id', month);
        if (error) throw error;
      }
      await load();
    },
    [backend, locked, load],
  );

  return { locked, lock, unlock };
}
