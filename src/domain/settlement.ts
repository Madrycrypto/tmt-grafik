import { absenceOn, plannedShift } from './coverage';
import { monthDays } from './dates';
import { dayEntry } from './hrExport';
import { monthNorm } from './norm';
import type { AppState, Pattern, Worker } from './types';

export const SETTLEMENT_OPTIONS = [1, 3, 4, 6, 12] as const;

export function addMonths(month: string, k: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + k, 1));
  return d.toISOString().slice(0, 7);
}

function monthIndex(month: string): number {
  const [y, m] = month.split('-').map(Number);
  return y * 12 + (m - 1);
}

/**
 * Miesiące okresu rozliczeniowego, w którym leży `month`.
 * Okresy liczą się co `n` miesięcy od `start` (domyślnie od stycznia: I–III, IV–VI…).
 */
export function periodMonths(month: string, n = 1, start?: string): string[] {
  const len = Math.max(1, Math.min(12, Math.round(n)));
  const anchor = monthIndex(start ?? `${month.slice(0, 4)}-01`);
  const off = (((monthIndex(month) - anchor) % len) + len) % len;
  const first = addMonths(month, -off);
  return Array.from({ length: len }, (_, i) => addMonths(first, i));
}

export function patternPeriod(p: Pattern | undefined, month: string): string[] {
  return periodMonths(month, p?.settlementMonths ?? 1, p?.settlementStart);
}

/** Krótki opis okresu, np. „XI 2026 – I 2027”. */
export function periodLabel(months: string[]): string {
  const roman = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
  const f = (m: string) => `${roman[Number(m.slice(5)) - 1]} ${m.slice(0, 4)}`;
  return months.length === 1 ? f(months[0]) : `${f(months[0])} – ${f(months[months.length - 1])}`;
}

export interface MonthBalance {
  month: string;
  /** godziny zaplanowane (z dodatkowymi zmianami i należnymi bez pracy) */
  hours: number;
  /** w tym należne bez pracy (postój) */
  credit: number;
  /** wymiar pracownika: wymiar miesiąca minus godziny grafiku przypadające na urlop, L4 itp. */
  norm: number;
  diff: number;
}

/** Godziny pracownika względem jego wymiaru w każdym miesiącu okresu i łącznie. */
export function workerPeriod(state: AppState, w: Worker, months: string[]): { months: MonthBalance[]; hours: number; credit: number; norm: number; diff: number } {
  const out = months.map((month) => {
    let hours = 0;
    let credit = 0;
    let excused = 0;
    for (const d of monthDays(month)) {
      if (absenceOn(state, w.id, d)) {
        // usprawiedliwiona nieobecność obniża wymiar o godziny, które były w grafiku (KP art. 130 § 3)
        const s = plannedShift(state, w, d);
        if (s) excused += s.end - s.start;
        continue;
      }
      const e = dayEntry(state, w, d);
      hours += e.hours + e.credit;
      credit += e.credit;
    }
    const norm = Math.max(0, monthNorm(month).hours - excused);
    return { month, hours, credit, norm, diff: hours - norm };
  });
  const hours = out.reduce((s, m) => s + m.hours, 0);
  const norm = out.reduce((s, m) => s + m.norm, 0);
  const credit = out.reduce((s, m) => s + m.credit, 0);
  return { months: out, hours, credit, norm, diff: hours - norm };
}

export function workerPattern(state: AppState, w: Worker): Pattern | undefined {
  return state.patterns.find((p) => p.id === w.patternId);
}
