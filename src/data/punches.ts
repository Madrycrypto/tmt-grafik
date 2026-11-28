import { useCallback, useEffect, useState } from 'react';
import { useApp } from './AppContext';
import type { Punch } from '../domain/punches';

const DEMO_KEY = 'tmt-demo-punches';

function demoAll(): Punch[] {
  try {
    return JSON.parse(localStorage.getItem(DEMO_KEY) ?? '[]') as Punch[];
  } catch {
    return [];
  }
}

/** Odbicia z dni [from, to] (daty lokalne), odświeżane na żywo. Pracownik dostaje tylko swoje (RLS). */
export function usePunches(from: string, to: string, workerId?: string): { punches: Punch[]; loading: boolean; error: string | null; reload: () => Promise<void> } {
  const { backend } = useApp();
  const [punches, setPunches] = useState<Punch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const db = backend.client;
    if (!db) {
      setPunches(demoAll().filter((p) => p.date >= from && p.date <= to && (!workerId || p.workerId === workerId)));
      setLoading(false);
      return;
    }
    const out: Punch[] = [];
    for (let i = 0; ; i += 1000) {
      let q = db.from('records').select('data').eq('kind', 'punches').gte('data->>date', from).lte('data->>date', to);
      if (workerId) q = q.eq('data->>workerId', workerId);
      const { data, error: e } = await q.range(i, i + 999);
      if (e) {
        setError(e.message);
        setLoading(false);
        return;
      }
      out.push(...(data ?? []).map((r: { data: Punch }) => r.data));
      if (!data || data.length < 1000) break;
    }
    setError(null);
    setPunches(out);
    setLoading(false);
  }, [backend, from, to, workerId]);

  useEffect(() => {
    setLoading(true);
    void reload();
    const db = backend.client;
    if (!db) return;
    const ch = db
      .channel(`punches-${from}-${to}-${Math.random().toString(36).slice(2, 7)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'records', filter: 'kind=eq.punches' }, (payload) => {
        // widok jednego pracownika nie przeładowuje się przy każdym cudzym odbiciu z kiosku
        const rec = (payload.new as { data?: { workerId?: string } } | undefined)?.data;
        if (workerId && payload.eventType !== 'DELETE' && rec?.workerId !== workerId) return;
        void reload();
      })
      .subscribe();
    return () => {
      void db.removeChannel(ch);
    };
  }, [backend, from, to, workerId, reload]);

  return { punches, loading, error, reload };
}

/** Ręczne odbicie dodane przez kierownika (np. ktoś zapomniał telefonu). */
export async function savePunch(client: ReturnType<typeof useApp>['backend']['client'], p: Punch): Promise<void> {
  if (!client) {
    localStorage.setItem(DEMO_KEY, JSON.stringify([...demoAll().filter((x) => x.id !== p.id), p]));
    return;
  }
  const { error } = await client.from('records').upsert({ kind: 'punches', id: p.id, data: p });
  if (error) throw error;
}

export async function deletePunch(client: ReturnType<typeof useApp>['backend']['client'], id: string): Promise<void> {
  if (!client) {
    localStorage.setItem(DEMO_KEY, JSON.stringify(demoAll().filter((x) => x.id !== id)));
    return;
  }
  const { error } = await client.from('records').delete().eq('kind', 'punches').eq('id', id);
  if (error) throw error;
}

/** Zapis wielu odbić naraz (import z pliku); te same identyfikatory nadpisują się, nie dublują. */
export async function savePunches(client: ReturnType<typeof useApp>['backend']['client'], list: Punch[]): Promise<void> {
  if (!client) {
    const ids = new Set(list.map((p) => p.id));
    localStorage.setItem(DEMO_KEY, JSON.stringify([...demoAll().filter((x) => !ids.has(x.id)), ...list]));
    return;
  }
  for (let i = 0; i < list.length; i += 500) {
    const { error } = await client.from('records').upsert(list.slice(i, i + 500).map((p) => ({ kind: 'punches', id: p.id, data: p })));
    if (error) throw error;
  }
}
