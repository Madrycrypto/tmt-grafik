import { norm } from './workerImport';
import type { Punch } from './punches';
import type { AppState, Worker } from './types';

type Cell = string | number;

/** Rozpoznane kolumny pliku. */
export interface Columns {
  header: number;
  name?: number;
  first?: number;
  last?: number;
  email?: number;
  datetime?: number;
  date?: number;
  time?: number;
  dir?: number;
  inCol?: number;
  outCol?: number;
}

export interface TnaResult {
  columns: Columns | null;
  format: 'events' | 'daily' | null;
  punches: Punch[];
  /** nazwy (albo e-maile) z pliku bez pasującego pracownika */
  unmatched: string[];
  matched: number;
  skipped: number;
  from?: string;
  to?: string;
}

const H = {
  datetime: ['data i godzina', 'data i czas', 'czas zdarzenia', 'data zdarzenia', 'znacznik czasu', 'timestamp', 'data/godzina', 'data godzina'],
  email: ['e-mail', 'email', 'adres e-mail', 'login'],
  name: ['imie i nazwisko', 'nazwisko i imie', 'pracownik', 'osoba', 'employee', 'imie nazwisko'],
  first: ['imie'],
  last: ['nazwisko'],
  inCol: ['wejscie', 'pierwsze wejscie', 'godzina wejscia', 'rozpoczecie pracy', 'poczatek pracy'],
  outCol: ['wyjscie', 'ostatnie wyjscie', 'godzina wyjscia', 'zakonczenie pracy', 'koniec pracy'],
  dir: ['typ zdarzenia', 'rodzaj zdarzenia', 'zdarzenie', 'typ', 'rodzaj', 'kierunek', 'akcja', 'status'],
  date: ['data', 'dzien', 'date', 'data dnia'],
  time: ['godzina', 'czas', 'time', 'godz'],
};

/** Szuka wiersza nagłówka i przypisuje kolumny po nazwach (bez polskich znaków, bez wielkości liter). */
export function detectColumns(rows: Cell[][]): Columns | null {
  for (let r = 0; r < Math.min(rows.length, 20); r++) {
    const hs = rows[r].map((c) => norm(c).replace(/[:.]$/, ''));
    const used = new Set<number>();
    const find = (aliases: string[], exact = false) => {
      for (const a of aliases) {
        const i = hs.findIndex((h, j) => !used.has(j) && (exact ? h === a : h === a || h.startsWith(a + ' ') || h.endsWith(' ' + a)));
        if (i >= 0) {
          used.add(i);
          return i;
        }
      }
      return undefined;
    };
    const c: Columns = { header: r };
    c.datetime = find(H.datetime);
    c.email = find(H.email);
    c.name = find(H.name);
    if (c.name === undefined) {
      c.first = find(H.first, true);
      c.last = find(H.last, true);
    }
    c.inCol = find(H.inCol);
    c.outCol = find(H.outCol);
    c.dir = find(H.dir, true);
    if (c.datetime === undefined) {
      c.date = find(H.date);
      c.time = find(H.time, true);
    }
    const who = c.name !== undefined || c.last !== undefined || c.email !== undefined;
    const when = c.datetime !== undefined || c.date !== undefined;
    const what = c.datetime !== undefined || c.time !== undefined || (c.inCol !== undefined && c.outCol !== undefined);
    if (who && when && what) return c;
  }
  return null;
}

/** Data jako RRRR-MM-DD z tekstu (2026-11-26, 26.11.2026, 26/11/2026) albo z liczby dni Excela. */
export function parseDate(v: Cell): string | null {
  if (typeof v === 'number' && v > 20000) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86_400_000);
    return d.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[-./](\d{1,2})[-./](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}

/** Minuty od północy z „06:58”, „6:58:12”, „2026-11-26 06:58” albo z ułamka doby Excela. */
export function parseTime(v: Cell): number | null {
  if (typeof v === 'number') {
    const frac = v - Math.floor(v);
    if (v >= 0 && (v < 1 || v > 20000)) return Math.round(frac * 1440) % 1440;
    return null;
  }
  const m = String(v).match(/(\d{1,2}):(\d{2})(?::\d{2})?/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? h * 60 + min : null;
}

/** Rodzaj zdarzenia z tekstu TNA; null = zdarzenie, którego nie liczymy (np. wyjście służbowe). */
export function parseDir(v: Cell): { dir: Punch['dir']; ret?: boolean } | null | undefined {
  const s = norm(v);
  if (!s) return undefined;
  if (s.includes('sluzb')) return null;
  if (s.includes('przerw') || s.includes('prywat')) {
    if (s.includes('koniec') || s.includes('zakoncz') || s.includes('powrot')) return { dir: 'in', ret: true };
    return { dir: 'private_out' };
  }
  if (s.includes('powrot')) return { dir: 'in', ret: true };
  if (s.includes('wej') || s === 'in' || s.includes('przyj') || s.includes('rozpocz') || s.includes('start')) return { dir: 'in' };
  if (s.includes('wyj') || s === 'out' || s.includes('zakoncz') || s.includes('koniec')) return { dir: 'out' };
  return undefined;
}

function workerIndex(state: AppState) {
  const byKey = new Map<string, Worker>();
  for (const w of state.workers) {
    if (w.email) byKey.set(w.email.trim().toLowerCase(), w);
    const n = norm(w.name);
    byKey.set(n, w);
    byKey.set(n.split(' ').reverse().join(' '), w);
  }
  return byKey;
}

/**
 * Zamienia wiersze eksportu z Comarch TNA (np. „Raport aktywności pracowników”) na odbicia.
 * Identyfikator odbicia zależy od pracownika, chwili i kierunku, więc ponowny import
 * tego samego pliku niczego nie dubluje.
 */
export function importTna(state: AppState, rows: Cell[][], toIso: (date: string, min: number) => string): TnaResult {
  const columns = detectColumns(rows);
  const empty: TnaResult = { columns, format: null, punches: [], unmatched: [], matched: 0, skipped: 0 };
  if (!columns) return empty;
  const daily = columns.datetime === undefined && columns.inCol !== undefined && columns.outCol !== undefined;
  const index = workerIndex(state);
  const unmatched = new Set<string>();
  const matched = new Set<string>();
  const out = new Map<string, Punch>();
  const noDir: { w: Worker; date: string; min: number }[] = [];
  let skipped = 0;

  const cell = (r: Cell[], i?: number) => (i === undefined ? '' : (r[i] ?? ''));
  const add = (w: Worker, date: string, min: number, dir: Punch['dir'], ret?: boolean) => {
    const id = `tna-${w.id}-${date}-${min}-${dir}`;
    out.set(id, { id, workerId: w.id, at: toIso(date, min), date, min, dir, ...(ret ? { ret: true } : {}), source: 'tna' });
  };

  let lastWho = '';
  for (const r of rows.slice(columns.header + 1)) {
    if (!r.some((c) => String(c).trim() !== '')) continue;
    // raporty grupowane: nazwisko tylko w pierwszym wierszu osoby
    let who = String(cell(r, columns.email)).trim() || String(cell(r, columns.name)).trim() || [cell(r, columns.first), cell(r, columns.last)].map(String).join(' ').trim();
    if (!who) who = lastWho;
    lastWho = who;
    const w = index.get(who.toLowerCase()) ?? index.get(norm(who)) ?? (columns.email !== undefined && columns.name !== undefined ? index.get(norm(cell(r, columns.name))) : undefined);
    const date = parseDate(columns.datetime !== undefined ? cell(r, columns.datetime) : cell(r, columns.date));
    if (!w) {
      if (who && date) unmatched.add(who);
      continue;
    }
    if (!date) {
      skipped++;
      continue;
    }
    if (daily) {
      const a = parseTime(cell(r, columns.inCol));
      const b = parseTime(cell(r, columns.outCol));
      if (a === null && b === null) {
        skipped++;
        continue;
      }
      matched.add(w.id);
      if (a !== null) add(w, date, a, 'in');
      // wyjście wcześniejsze niż wejście = nocka, wyjście następnego dnia
      if (b !== null) add(w, a !== null && b < a ? nextDay(date) : date, b, 'out');
      continue;
    }
    const min = parseTime(columns.datetime !== undefined ? cell(r, columns.datetime) : cell(r, columns.time));
    if (min === null) {
      skipped++;
      continue;
    }
    matched.add(w.id);
    const d = columns.dir !== undefined ? parseDir(cell(r, columns.dir)) : undefined;
    if (d === null) {
      skipped++;
      continue;
    }
    if (d) add(w, date, min, d.dir, d.ret);
    else noDir.push({ w, date, min });
  }

  // bez kolumny rodzaju: kolejne odbicia osoby na zmianę wejście / wyjście
  const byWorker = new Map<string, { w: Worker; date: string; min: number }[]>();
  for (const e of noDir) byWorker.set(e.w.id, [...(byWorker.get(e.w.id) ?? []), e]);
  for (const list of byWorker.values()) {
    list.sort((a, b) => a.date.localeCompare(b.date) || a.min - b.min);
    let inside = false;
    let lastAbs = -Infinity;
    for (const e of list) {
      const abs = Date.parse(e.date) / 60_000 + e.min;
      if (abs - lastAbs > 16 * 60) inside = false;
      add(e.w, e.date, e.min, inside ? 'out' : 'in');
      inside = !inside;
      lastAbs = abs;
    }
  }

  const punches = [...out.values()].sort((a, b) => a.at.localeCompare(b.at));
  return {
    columns,
    format: daily ? 'daily' : 'events',
    punches,
    unmatched: [...unmatched].sort(),
    matched: matched.size,
    skipped,
    from: punches[0]?.date,
    to: punches.at(-1)?.date,
  };
}

function nextDay(d: string): string {
  const t = new Date(d + 'T00:00:00Z');
  t.setUTCDate(t.getUTCDate() + 1);
  return t.toISOString().slice(0, 10);
}
