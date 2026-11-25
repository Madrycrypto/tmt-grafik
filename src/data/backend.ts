import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { demoState, emptyState } from '../domain/seed';
import { COLLECTIONS } from '../domain/types';
import type { AppState, CollectionName } from '../domain/types';

export interface CloudConfig {
  url: string;
  anonKey: string;
}

const CONFIG_KEY = 'tmt-grafik-cloud';
const DEMO_KEY = 'tmt-grafik-demo';

/** Klucze z builda (sekrety GitHub) albo wpisane w Ustawieniach. */
export function readCloudConfig(): CloudConfig | null {
  try {
    const saved = localStorage.getItem(CONFIG_KEY);
    if (saved) return JSON.parse(saved) as CloudConfig;
  } catch {
    /* brak dostępu do localStorage: zostaje konfiguracja z builda */
  }
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  return url && anonKey ? { url, anonKey } : null;
}

/** Adres aplikacji, na który wracają linki z e-maili (potwierdzenie, reset hasła). */
export function appUrl(): string {
  return location.origin + location.pathname;
}

export function writeCloudConfig(cfg: CloudConfig | null): void {
  if (cfg) localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
  else localStorage.removeItem(CONFIG_KEY);
}

type Item = { id?: string; code?: string };
const keyOf = (item: Item): string => String(item.id ?? item.code);

export interface RemoteChange {
  kind: CollectionName;
  id: string;
  data: unknown | null;
}

export interface Backend {
  mode: 'demo' | 'cloud';
  client?: SupabaseClient;
  load(): Promise<AppState>;
  save(prev: AppState, next: AppState): Promise<void>;
  subscribe(onChange: (c: RemoteChange) => void): () => void;
}

export function normalize(s: Partial<AppState>): AppState {
  const base = emptyState();
  const out = { ...base } as AppState;
  for (const c of COLLECTIONS) {
    const v = s[c];
    (out as unknown as Record<string, unknown>)[c] = Array.isArray(v) && (v.length > 0 || !['shiftDefs', 'patterns'].includes(c)) ? v : base[c];
  }
  return out;
}

export function demoBackend(): Backend {
  return {
    mode: 'demo',
    async load() {
      try {
        const raw = localStorage.getItem(DEMO_KEY);
        if (raw) return normalize(JSON.parse(raw));
      } catch {
        /* uszkodzone dane demo: zaczynamy od nowa */
      }
      return demoState();
    },
    async save(_prev, next) {
      localStorage.setItem(DEMO_KEY, JSON.stringify(next));
    },
    subscribe() {
      return () => {};
    },
  };
}

export function resetDemo(): void {
  localStorage.removeItem(DEMO_KEY);
}

interface RecordRow {
  kind: string;
  id: string;
  data: unknown;
}

export function cloudBackend(cfg: CloudConfig): Backend {
  // PKCE: linki z e-maili wracają jako ?code=…, co nie koliduje z routingiem po #
  const client = createClient(cfg.url, cfg.anonKey, { auth: { flowType: 'pkce' } });
  return {
    mode: 'cloud',
    client,
    async load() {
      const rows: RecordRow[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await client.from('records').select('kind,id,data').range(from, from + 999);
        if (error) throw error;
        rows.push(...(data as RecordRow[]));
        if (!data || data.length < 1000) break;
      }
      const partial: Partial<Record<CollectionName, unknown[]>> = {};
      for (const r of rows) {
        if (!(COLLECTIONS as readonly string[]).includes(r.kind)) continue;
        (partial[r.kind as CollectionName] ??= []).push(r.data);
      }
      return normalize(partial as Partial<AppState>);
    },
    async save(prev, next) {
      const { data: auth } = await client.auth.getUser();
      const who = auth.user?.email ?? null;
      const upserts: (RecordRow & { updated_by: string | null })[] = [];
      const deletes: { kind: string; id: string }[] = [];
      for (const c of COLLECTIONS) {
        const before = new Map((prev[c] as Item[]).map((x) => [keyOf(x), JSON.stringify(x)]));
        const after = new Map((next[c] as Item[]).map((x) => [keyOf(x), x]));
        for (const [id, item] of after) {
          if (before.get(id) !== JSON.stringify(item)) upserts.push({ kind: c, id, data: item, updated_by: who });
        }
        for (const id of before.keys()) if (!after.has(id)) deletes.push({ kind: c, id });
      }
      for (let i = 0; i < upserts.length; i += 500) {
        const { error } = await client.from('records').upsert(upserts.slice(i, i + 500));
        if (error) throw error;
      }
      for (const d of deletes) {
        const { error } = await client.from('records').delete().eq('kind', d.kind).eq('id', d.id);
        if (error) throw error;
      }
    },
    subscribe(onChange) {
      const ch = client
        .channel('records')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'records' }, (p) => {
          const row = (p.eventType === 'DELETE' ? p.old : p.new) as Partial<RecordRow>;
          if (!row.kind || !row.id) return;
          onChange({ kind: row.kind as CollectionName, id: row.id, data: p.eventType === 'DELETE' ? null : row.data });
        })
        .subscribe();
      return () => {
        void client.removeChannel(ch);
      };
    },
  };
}

export function applyRemote(state: AppState, c: RemoteChange): AppState {
  if (!(COLLECTIONS as readonly string[]).includes(c.kind)) return state;
  const list = (state[c.kind] as Item[]).filter((x) => keyOf(x) !== c.id);
  if (c.data) list.push(c.data as Item);
  const current = (state[c.kind] as Item[]).find((x) => keyOf(x) === c.id);
  if (c.data && current && JSON.stringify(current) === JSON.stringify(c.data)) return state;
  if (!c.data && !current) return state;
  return { ...state, [c.kind]: c.kind === 'history' ? (list as AppState['history']).sort((a, b) => b.at.localeCompare(a.at)) : list };
}
