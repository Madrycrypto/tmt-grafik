import { addDays, daysBetween, mod, monthDays, weekday } from './dates';
import { OFF, patternBrigades } from './types';
import type { AppState, BrigadeId, Pattern, ShiftDef } from './types';

export type CellStatus = 'work' | 'off' | 'excluded' | 'trimmed';

export interface RotaCell {
  date: string;
  /** kod zmiany, którą brygada miałaby według cyklu lub ręcznej zmiany */
  code: string;
  status: CellStatus;
  overridden: boolean;
}

export function baseCode(p: Pattern, brigade: BrigadeId, date: string): string {
  if (p.sequence.length === 0) return OFF;
  return p.sequence[mod(daysBetween(p.anchor, date) + (p.offsets[brigade] ?? 0), p.sequence.length)];
}

export function isExcluded(state: AppState, date: string, code: string): boolean {
  const wd = weekday(date);
  return state.exclusions.some(
    (e) =>
      e.shiftCodes.includes(code) &&
      ((e.kind === 'weekly' && e.weekday === wd) || (e.kind === 'date' && e.date === date)),
  );
}

const cache = new WeakMap<AppState, Map<string, RotaCell[]>>();

/**
 * Grafik jednej brygady na miesiąc. Nadwyżkę ponad docelową liczbę dni
 * zamienia na dodatkowe wolne rozłożone równomiernie, żeby brygada
 * przepracowała dokładnie zadaną liczbę dni.
 */
export function brigadeMonth(state: AppState, patternId: string, brigade: BrigadeId, month: string): RotaCell[] {
  let byState = cache.get(state);
  if (!byState) {
    byState = new Map();
    cache.set(state, byState);
  }
  const key = `${patternId}|${brigade}|${month}`;
  const hit = byState.get(key);
  if (hit) return hit;

  const p = state.patterns.find((x) => x.id === patternId);
  const cells: RotaCell[] = monthDays(month).map((date) => {
    if (!p) return { date, code: OFF, status: 'off', overridden: false };
    const ov = state.rotaOverrides.find((o) => o.patternId === patternId && o.brigade === brigade && o.date === date);
    const code = ov ? ov.code : baseCode(p, brigade, date);
    let status: CellStatus = code === OFF ? 'off' : 'work';
    if (status === 'work' && !ov && isExcluded(state, date, code)) status = 'excluded';
    return { date, code, status, overridden: !!ov };
  });

  const target = state.targets.find((t) => t.patternId === patternId && t.month === month)?.days[brigade];
  if (target !== undefined && target >= 0) {
    const worked = cells.filter((c) => c.status === 'work');
    const trimmable = worked.filter((c) => !c.overridden);
    const extra = Math.min(worked.length - target, trimmable.length);
    for (let i = 0; i < extra; i++) {
      trimmable[Math.floor(((i + 0.5) * trimmable.length) / extra)].status = 'trimmed';
    }
  }
  byState.set(key, cells);
  return cells;
}

export function rotaCell(state: AppState, patternId: string, brigade: BrigadeId, date: string): RotaCell {
  const cells = brigadeMonth(state, patternId, brigade, date.slice(0, 7));
  return cells[Number(date.slice(8, 10)) - 1];
}

export function shiftDef(state: AppState, code: string): ShiftDef | undefined {
  return state.shiftDefs.find((s) => s.code === code);
}

export function patternShiftCodes(p: Pattern): string[] {
  return [...new Set(p.sequence.filter((c) => c !== OFF))];
}

export interface BrigadeSummary {
  brigade: BrigadeId;
  days: number;
  hours: number;
  target?: number;
  /** tygodnie (od poniedziałku) bez nieprzerwanych 35 h odpoczynku, z najdłuższą przerwą w godzinach */
  weeksWithoutRest: { week: string; rest: number }[];
}

function workIntervals(state: AppState, patternId: string, brigade: BrigadeId, from: string, to: string) {
  const out: [number, number][] = [];
  for (let d = from, i = 0; daysBetween(d, to) >= 0; d = addDays(d, 1), i++) {
    const c = rotaCell(state, patternId, brigade, d);
    const def = shiftDef(state, c.code);
    if (c.status === 'work' && def) out.push([i * 24 + def.start, i * 24 + def.start + def.hours]);
  }
  return out;
}

export function longestRest(intervals: [number, number][], from: number, to: number): number {
  let best = 0;
  let cursor = from;
  for (const [s, e] of intervals) {
    if (e <= from) continue;
    if (s >= to) break;
    best = Math.max(best, Math.max(0, s - cursor));
    cursor = Math.max(cursor, e);
  }
  return Math.max(best, to - cursor);
}

export function summarize(state: AppState, patternId: string, month: string): BrigadeSummary[] {
  const days = monthDays(month);
  const first = days[0];
  const last = days[days.length - 1];
  const target = state.targets.find((t) => t.patternId === patternId && t.month === month);
  const pattern = state.patterns.find((p) => p.id === patternId);
  return patternBrigades(pattern).map((brigade) => {
    const cells = brigadeMonth(state, patternId, brigade, month);
    let hours = 0;
    let n = 0;
    for (const c of cells) {
      if (c.status !== 'work') continue;
      n++;
      hours += shiftDef(state, c.code)?.hours ?? 0;
    }
    // tygodnie poniedziałek–niedziela, które zaczynają się w tym miesiącu
    const weeksWithoutRest: { week: string; rest: number }[] = [];
    const startPad = addDays(first, -7);
    const intervals = workIntervals(state, patternId, brigade, startPad, addDays(last, 8));
    for (const d of days) {
      if (weekday(d) !== 1) continue;
      const offset = daysBetween(startPad, d) * 24;
      const rest = longestRest(intervals, offset, offset + 168);
      if (rest < 35) weeksWithoutRest.push({ week: d, rest });
    }
    return { brigade, days: n, hours, target: target?.days[brigade], weeksWithoutRest };
  });
}

/** Zmiany, które według cyklu powinny być danego dnia obsadzone, a nie ma na nich żadnej brygady. */
export function gapsOnDay(state: AppState, patternId: string, date: string): string[] {
  const p = state.patterns.find((x) => x.id === patternId);
  if (!p) return [];
  const brigades = patternBrigades(p);
  const expected = new Set(brigades.map((b) => baseCode(p, b, date)).filter((c) => c !== OFF && !isExcluded(state, date, c)));
  return patternShiftCodes(p).filter(
    (code) =>
      expected.has(code) &&
      !brigades.some((b) => {
        const c = rotaCell(state, patternId, b, date);
        return c.status === 'work' && c.code === code;
      }),
  );
}
