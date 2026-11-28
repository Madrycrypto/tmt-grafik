import { checkDay, relHour, TOLERANCE_MIN } from './punches';
import type { DayCheck, Punch } from './punches';
import type { AppState, Worker } from './types';

/**
 * Rozliczenie dnia pracownika z odbić RCP (kontrola, nie płace).
 * Zasady: wcześniejsze wejście niż początek zmiany się nie liczy; spóźnienie i wcześniejsze wyjście
 * do tolerancji nie obniżają czasu; wyjście później niż koniec zmiany + tolerancja to nadgodziny
 * (cały nadmiar), a w granicach tolerancji nic nie dodaje. Wyjścia prywatne są odejmowane.
 */
export interface DayAccount {
  date: string;
  check: DayCheck;
  /** minuty z grafiku (0 poza grafikiem) */
  planMin: number;
  /** liczone minuty pracy po zasadach rozliczenia */
  workedMin: number;
  /** minuty przed początkiem zmiany, których nie liczymy */
  earlyIgnoredMin: number;
  /** liczone minus plan; dla dni problemowych, nieobecności i trwających 0 */
  balanceMin: number;
  absent: boolean;
  /** brak wejścia albo wyjścia: dzień do poprawy, nie wchodzi do bilansu */
  problem: boolean;
  /** dzień trwa albo jest w przyszłości */
  open: boolean;
}

/** Przerwy prywatne: od wyjścia prywatnego do kolejnego wejścia (godziny względem północy dnia date). */
function privateGaps(punches: Punch[], date: string): [number, number][] {
  const out: [number, number][] = [];
  let from: number | undefined;
  for (const p of [...punches].sort((a, b) => a.at.localeCompare(b.at))) {
    const h = relHour(p, date);
    if (p.dir === 'private_out') from = h;
    else if (p.dir === 'in' && from !== undefined) {
      out.push([from, h]);
      from = undefined;
    } else if (p.dir === 'out') from = undefined;
  }
  return out;
}

const overlap = (a0: number, a1: number, b0: number, b1: number) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));

export function accountDay(state: AppState, w: Worker, date: string, punches: Punch[], nowH?: number): DayAccount {
  const check = checkDay(state, w, date, punches, nowH);
  const { plan, firstIn, lastOut } = check;
  const planMin = plan ? Math.round((plan.end - plan.start) * 60) : 0;
  const base = { date, check, planMin, earlyIgnoredMin: 0, absent: false, problem: false, open: false };
  const complete = firstIn !== undefined && lastOut !== undefined && lastOut > firstIn;

  if (check.status === 'absent') return { ...base, workedMin: 0, balanceMin: 0, absent: true };
  if (!check.punches.length && !plan) return { ...base, workedMin: 0, balanceMin: 0 };
  if (!complete) {
    const problem = check.status === 'missing' || check.status === 'no_in' || check.status === 'no_out';
    return { ...base, workedMin: 0, balanceMin: 0, problem, open: !problem };
  }
  if (!plan) {
    // praca poza grafikiem: liczymy wszystko jako nadgodziny
    const workedMin = Math.round(check.worked * 60);
    return { ...base, workedMin, balanceMin: workedMin };
  }
  const tol = TOLERANCE_MIN / 60;
  const cStart = firstIn <= plan.start + tol ? plan.start : firstIn;
  const cEnd = lastOut > plan.end + tol ? lastOut : lastOut >= plan.end - tol ? plan.end : lastOut;
  const priv = privateGaps(check.punches, date).reduce((s, [a, b]) => s + overlap(a, b, cStart, cEnd), 0);
  const workedMin = Math.max(0, Math.round((cEnd - cStart - priv) * 60));
  const earlyIgnoredMin = firstIn < plan.start ? Math.round((plan.start - firstIn) * 60) : 0;
  return { ...base, workedMin, earlyIgnoredMin, balanceMin: workedMin - planMin };
}

export interface Totals {
  /** dni z policzoną pracą */
  workDays: number;
  absentDays: number;
  planMin: number;
  workedMin: number;
  balanceMin: number;
  overtimeMin: number;
  deficitMin: number;
  problems: number;
}

export function sumDays(list: DayAccount[]): Totals {
  const t: Totals = { workDays: 0, absentDays: 0, planMin: 0, workedMin: 0, balanceMin: 0, overtimeMin: 0, deficitMin: 0, problems: 0 };
  for (const d of list) {
    t.planMin += d.planMin;
    t.workedMin += d.workedMin;
    t.balanceMin += d.balanceMin;
    if (d.workedMin > 0) t.workDays++;
    if (d.absent) t.absentDays++;
    if (d.problem) t.problems++;
    if (d.balanceMin > 0) t.overtimeMin += d.balanceMin;
    else t.deficitMin -= d.balanceMin;
  }
  return t;
}

/** Godzina bieżąca względem północy dnia date: 99 dla przeszłości, -99 dla przyszłości (jak w widoku dnia RCP). */
export function nowFor(date: string, today: string, hour: number): number {
  return date === today ? hour : date > today ? -99 : 99;
}

/** Rozlicza listę dni; odbicia z sąsiednich dni (nocki) powinny być w `punches`. */
export function accountPeriod(state: AppState, w: Worker, dates: string[], punches: Punch[], today: string, hour: number): DayAccount[] {
  const mine = punches.filter((p) => p.workerId === w.id);
  return dates.map((d) => accountDay(state, w, d, mine, nowFor(d, today, hour)));
}

/** „8 h 05 min”, z opcjonalnym znakiem. */
export function fmtHM(min: number, signed = false): string {
  const a = Math.abs(Math.round(min));
  const s = `${Math.floor(a / 60)} h ${String(a % 60).padStart(2, '0')} min`;
  if (!signed) return min < 0 ? `−${s}` : s;
  return min > 0 ? `+${s}` : min < 0 ? `−${s}` : s;
}


const csvCell = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;

/** CSV do porównania z Comarch TNA: jeden wiersz na dzień, godziny jako minuty i h:mm. */
export function accountCsv(name: string, days: DayAccount[]): string {
  const hm = (m: number) => `${m < 0 ? '-' : ''}${Math.floor(Math.abs(m) / 60)}:${String(Math.abs(m) % 60).padStart(2, '0')}`;
  const head = ['Pracownik', 'Data', 'Wejście', 'Wyjście', 'Plan', 'Przepracowane', 'Bilans', 'Do poprawy'];
  const rows = days.map((d) => {
    const c = d.check;
    const f = (h: number | undefined) => (h === undefined ? '' : `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`);
    return [name, d.date, f(c.firstIn), f(c.lastOut), hm(d.planMin), hm(d.workedMin), hm(d.balanceMin), d.problem ? 'tak' : ''];
  });
  return '﻿' + [head, ...rows].map((r) => r.map(csvCell).join(';')).join('\r\n');
}
