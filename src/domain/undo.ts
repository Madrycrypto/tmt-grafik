import { COLLECTIONS } from './types';
import type { AppState, CollectionName } from './types';

type Item = { id?: string; code?: string };
const keyOf = (x: Item) => String(x.id ?? x.code);

/** Zmiana jednego rekordu: stan przed i po (undefined = rekord nie istniał). */
export interface RecordChange {
  kind: CollectionName;
  id: string;
  before?: unknown;
  after?: unknown;
}

export interface UndoEntry {
  label: string;
  changes: RecordChange[];
}

/** Rekordy zmienione jedną operacją (bez historii, która zostaje jako ślad). */
export function diffState(prev: AppState, next: AppState): RecordChange[] {
  const out: RecordChange[] = [];
  for (const kind of COLLECTIONS) {
    if (kind === 'history' || prev[kind] === next[kind]) continue;
    const before = new Map((prev[kind] as Item[]).map((x) => [keyOf(x), x]));
    const after = new Map((next[kind] as Item[]).map((x) => [keyOf(x), x]));
    for (const [id, a] of after) {
      const b = before.get(id);
      if (JSON.stringify(a) !== JSON.stringify(b)) out.push({ kind, id, before: b, after: a });
    }
    for (const [id, b] of before) if (!after.has(id)) out.push({ kind, id, before: b });
  }
  return out;
}

/**
 * Cofa (dir = 'undo') albo ponawia (dir = 'redo') zmiany na szkicu stanu.
 * Rekord, który ktoś zmienił w międzyczasie, zostaje nietknięty; zwraca ich liczbę.
 */
export function applyChanges(draft: AppState, changes: RecordChange[], dir: 'undo' | 'redo'): number {
  let conflicts = 0;
  for (const c of changes) {
    const expected = dir === 'undo' ? c.after : c.before;
    const target = dir === 'undo' ? c.before : c.after;
    const list = draft[c.kind] as Item[];
    const i = list.findIndex((x) => keyOf(x) === c.id);
    const current = i >= 0 ? list[i] : undefined;
    if (JSON.stringify(current) !== JSON.stringify(expected)) {
      conflicts++;
      continue;
    }
    if (i >= 0) list.splice(i, 1);
    if (target !== undefined) list.push(structuredClone(target) as Item);
  }
  return conflicts;
}
