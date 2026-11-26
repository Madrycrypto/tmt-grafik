import { absenceOn, plannedShift } from './coverage';
import { addDays, daysBetween } from './dates';
import type { Absence, AppState, Worker } from './types';
import type { WorkerShift } from './coverage';

/** Odbicie RCP; date i min to czas lokalny (Europe/Warsaw) nadany przez serwer. */
export interface Punch {
  id: string;
  workerId: string;
  at: string;
  date: string;
  /** minuty od północy dnia date */
  min: number;
  /** private_out = wyjście prywatne; powrót z niego to zwykłe 'in' z ret = true */
  dir: 'in' | 'out' | 'private_out';
  ret?: boolean;
  source: 'qr' | 'badge' | 'manual' | 'plan' | 'tna';
  kiosk?: string;
  note?: string;
}

/** Ile minut spóźnienia / wcześniejszego wyjścia jeszcze nie liczymy. */
export const TOLERANCE_MIN = 5;
/** Odbicia do tylu godzin przed i po zmianie należą do tej zmiany. */
const MARGIN_H = 4;

export type DayStatus = 'ok' | 'late' | 'early' | 'late_early' | 'no_in' | 'no_out' | 'missing' | 'unplanned' | 'absent' | 'off' | 'pending';

export interface DayCheck {
  worker: Worker;
  date: string;
  plan: WorkerShift | null;
  absence?: Absence;
  punches: Punch[];
  /** godziny względem północy dnia date (noc może dać > 24) */
  firstIn?: number;
  lastOut?: number;
  lateMin: number;
  earlyMin: number;
  /** czas pracy w godzinach: suma odcinków wejście → wyjście, bez wyjść prywatnych */
  worked: number;
  /** łączny czas wyjść prywatnych w minutach */
  privateMin: number;
  status: DayStatus;
}

/** Godzina odbicia względem północy dnia day. */
export function relHour(p: Punch, day: string): number {
  return daysBetween(day, p.date) * 24 + p.min / 60;
}

/**
 * Porównuje grafik z odbiciami pracownika na zmianę zaczynającą się danego dnia.
 * now = bieżąca chwila w tej samej skali (godziny względem północy dnia date); służy do
 * rozróżnienia „jeszcze trwa” od „brak odbicia”.
 */
export function checkDay(state: AppState, w: Worker, date: string, all: Punch[], now?: number): DayCheck {
  const plan = plannedShift(state, w, date);
  const absence = absenceOn(state, w.id, date);
  const mine = all.filter((p) => p.workerId === w.id);
  const prevPlan = plannedShift(state, w, addDays(date, -1));
  const nextPlan = plannedShift(state, w, addDays(date, 1));
  // odbicia należące do sąsiednich zmian nie wchodzą do tego dnia
  const belongsToPrev = (h: number) => !!prevPlan && h < prevPlan.end - 24 + MARGIN_H && (!plan || h < plan.start - MARGIN_H);
  const belongsToNext = (h: number) => !!nextPlan && h >= nextPlan.start + 24 - MARGIN_H && (!plan || h > plan.end + MARGIN_H);
  const from = plan ? plan.start - MARGIN_H : 0;
  const to = plan ? plan.end + MARGIN_H : 24;
  const punches = mine
    .filter((p) => {
      const h = relHour(p, date);
      return h >= from && h < to && !belongsToPrev(h) && !belongsToNext(h);
    })
    .sort((a, b) => a.at.localeCompare(b.at));

  const ins = punches.filter((p) => p.dir === 'in').map((p) => relHour(p, date));
  const outs = punches.filter((p) => p.dir === 'out').map((p) => relHour(p, date));
  const firstIn = ins.length ? Math.min(...ins) : undefined;
  const lastOut = outs.length ? Math.max(...outs) : undefined;
  const { worked, privateMin } = segments(punches, date);
  const tol = TOLERANCE_MIN / 60;
  const lateMin = plan && firstIn !== undefined && firstIn > plan.start + tol ? Math.round((firstIn - plan.start) * 60) : 0;
  const earlyMin = plan && lastOut !== undefined && lastOut < plan.end - tol ? Math.round((plan.end - lastOut) * 60) : 0;

  let status: DayStatus;
  if (absence) status = punches.length ? 'unplanned' : 'absent';
  else if (!plan) status = punches.length ? 'unplanned' : 'off';
  else if (!punches.length) status = now !== undefined && now < plan.start + tol ? 'pending' : 'missing';
  else if (firstIn === undefined) status = 'no_in';
  else if (lastOut === undefined || lastOut < firstIn) status = now !== undefined && now < plan.end + MARGIN_H ? (lateMin ? 'late' : 'pending') : 'no_out';
  else if (lateMin && earlyMin) status = 'late_early';
  else if (lateMin) status = 'late';
  else if (earlyMin) status = 'early';
  else status = 'ok';
  return { worker: w, date, plan, absence, punches, firstIn, lastOut, lateMin, earlyMin, worked, privateMin, status };
}

/** Suma odcinków pracy (wejście → wyjście lub wyjście prywatne) i czas wyjść prywatnych. */
export function segments(punches: Punch[], date: string): { worked: number; privateMin: number } {
  let worked = 0;
  let priv = 0;
  let inAt: number | undefined;
  let privAt: number | undefined;
  for (const p of [...punches].sort((a, b) => a.at.localeCompare(b.at))) {
    const h = relHour(p, date);
    if (p.dir === 'in') {
      if (privAt !== undefined) priv += h - privAt;
      privAt = undefined;
      if (inAt === undefined) inAt = h;
    } else {
      if (inAt !== undefined) worked += h - inAt;
      inAt = undefined;
      privAt = p.dir === 'private_out' ? h : undefined;
    }
  }
  return { worked, privateMin: Math.round(priv * 60) };
}

/** Okno, w którym kolejne zeskanowanie traktujemy jako pomyłkowe powtórzenie. */
export const DOUBLE_SCAN_MS = 60_000;
/** Po tylu godzinach od wejścia bez wyjścia następny skan to znowu wejście (zapomniane wyjście). */
const OPEN_SHIFT_H = 16;

export type PunchMode = 'normal' | 'private';
export type DecideResult = { dir: Punch['dir']; ret?: boolean } | { duplicate: Punch } | { error: 'not_in' };

/**
 * Co oznacza skan: serwer decyduje sam, pracownik nic nie wybiera.
 * Normalny kod: po wejściu → wyjście; po wyjściu prywatnym → powrót; inaczej → wejście.
 * Kod „wyjście prywatne”: tylko gdy pracownik jest na terenie.
 */
export function decideDir(last: Punch | undefined, mode: PunchMode, nowIso: string): DecideResult {
  const ago = last ? Date.parse(nowIso) - Date.parse(last.at) : Infinity;
  if (last && ago < DOUBLE_SCAN_MS) return { duplicate: last };
  const open = !!last && ago < OPEN_SHIFT_H * 3600_000 && last.dir !== 'out';
  if (mode === 'private') return open && last!.dir === 'in' ? { dir: 'private_out' } : { error: 'not_in' };
  if (open && last!.dir === 'private_out') return { dir: 'in', ret: true };
  return open ? { dir: 'out' } : { dir: 'in' };
}

/** Kierunek, który pracownik najpewniej chce odbić: po wejściu — wyjście. */
export function suggestDir(mine: Punch[], nowIso: string): 'in' | 'out' {
  const last = [...mine].sort((a, b) => b.at.localeCompare(a.at))[0];
  if (!last) return 'in';
  const hours = (Date.parse(nowIso) - Date.parse(last.at)) / 3600_000;
  return last.dir !== 'out' && hours < 16 ? 'out' : 'in';
}

export const DIR_LABEL: Record<Punch['dir'] | 'return', string> = {
  in: 'Wejście',
  out: 'Wyjście',
  private_out: 'Wyjście prywatne',
  return: 'Powrót',
};

export const STATUS_LABEL: Record<DayStatus, string> = {
  ok: 'OK',
  late: 'spóźnienie',
  early: 'wcześniejsze wyjście',
  late_early: 'spóźnienie i wcześniejsze wyjście',
  no_in: 'brak wejścia',
  no_out: 'brak wyjścia',
  missing: 'brak odbić',
  unplanned: 'poza grafikiem',
  absent: 'nieobecność',
  off: 'wolne',
  pending: 'w trakcie',
};

/** Statusy, przy których brakujące odbicia można uzupełnić jednym kliknięciem wg grafiku. */
export const FIXABLE: DayStatus[] = ['missing', 'no_in', 'no_out'];

/**
 * Brakujące odbicia wg grafiku: wejście o początku zmiany, wyjście o jej końcu
 * (nocka kończy się następnego dnia). Zwraca puste, gdy nic nie brakuje.
 */
export function planPunches(r: DayCheck): Omit<Punch, 'id' | 'at'>[] {
  if (!r.plan || r.absence || !FIXABLE.includes(r.status)) return [];
  const at = (h: number, dir: 'in' | 'out') => {
    const dayOff = Math.floor(h / 24);
    return { workerId: r.worker.id, date: addDays(r.date, dayOff), min: Math.round((h - dayOff * 24) * 60), dir, source: 'plan' as const };
  };
  const out: Omit<Punch, 'id' | 'at'>[] = [];
  if (r.firstIn === undefined) out.push(at(r.plan.start, 'in'));
  if (r.lastOut === undefined || (r.firstIn !== undefined && r.lastOut < r.firstIn)) out.push(at(r.plan.end, 'out'));
  return out;
}

export const STATUS_TONE: Record<DayStatus, string> = {
  ok: 'green',
  late: 'amber',
  early: 'amber',
  late_early: 'amber',
  no_in: 'red',
  no_out: 'red',
  missing: 'red',
  unplanned: 'blue',
  absent: '',
  off: '',
  pending: '',
};

export function fmtMin(min: number): string {
  const m = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
