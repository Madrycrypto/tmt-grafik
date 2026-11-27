import { absenceOn, lineStatus, plannedShift } from './coverage';
import { addDays, periodDays } from './dates';
import { shiftDef } from './rota';
import type { Absence, AppState, Worker } from './types';

/** Czy pracownik ma na ten dzień urlop wypoczynkowy (UW). */
export function hasLeave(state: AppState, workerId: string, date: string): boolean {
  return absenceOn(state, workerId, date)?.reason === 'UW';
}

/**
 * Włącza lub wyłącza urlop (UW) na jeden dzień. Wyłączenie dzieli szerszy zakres urlopu,
 * zamiast kasować go w całości. Inne powody nieobecności (L4, NN) zostają nietknięte.
 */
export function setLeaveDay(abs: Absence[], workerId: string, date: string, on: boolean, newId: () => string, note?: string): Absence[] {
  const covers = (a: Absence) => a.workerId === workerId && a.reason === 'UW' && a.from <= date && date <= a.to;
  if (on) {
    if (abs.some(covers)) return abs;
    return [...abs, { id: newId(), workerId, from: date, to: date, reason: 'UW', ...(note ? { note } : {}) }];
  }
  const out: Absence[] = [];
  for (const a of abs) {
    if (!covers(a)) {
      out.push(a);
      continue;
    }
    if (a.from < date) out.push({ ...a, to: addDays(date, -1) });
    if (date < a.to) out.push({ ...a, id: newId(), from: addDays(date, 1) });
  }
  return out;
}

/** Dni urlopu wypadające w dni pracy według grafiku (tylko te pomniejszają pulę). */
export function leaveWorkDays(state: AppState, w: Worker, dates: string[]): number {
  let n = 0;
  for (const d of dates) if (hasLeave(state, w.id, d) && plannedShift(state, w, d)) n++;
  return n;
}

/** Urlop na żądanie: tyle dni z puli zostaje poza planem, aż do grudnia. */
export const ON_DEMAND_DAYS = 4;
/** Znacznik urlopu na żądanie w polu notatki nieobecności (to nadal UW, więc pomniejsza pulę). */
export const ON_DEMAND_NOTE = 'na żądanie';

export function isOnDemandDay(state: AppState, workerId: string, date: string): boolean {
  const a = absenceOn(state, workerId, date);
  return a?.reason === 'UW' && a.note === ON_DEMAND_NOTE;
}

export interface LeaveBalance {
  /** pula przed planem; undefined = nie wpisano */
  pool: number | undefined;
  planned: number;
  left: number | undefined;
  /** ile jeszcze można zaplanować do listopada (pula minus plan minus dni na żądanie); w grudniu rezerwa się zwalnia */
  plannable: number | undefined;
  /** ile z 4 dni na żądanie jeszcze zostało */
  onDemandLeft: number;
}

export function leaveBalance(state: AppState, w: Worker, period: string): LeaveBalance {
  const planned = leaveWorkDays(state, w, periodDays(period));
  const left = w.leaveDays === undefined ? undefined : w.leaveDays - planned;
  const workUw = periodDays(period).filter((d) => hasLeave(state, w.id, d) && plannedShift(state, w, d));
  const used = workUw.filter((d) => isOnDemandDay(state, w.id, d)).length;
  const onDemandLeft = Math.max(ON_DEMAND_DAYS - used, 0);
  const decStart = period.length === 4 ? `${period}-12-01` : undefined;
  // plan z grudnia może korzystać z rezerwy, więc do limitu „do listopada” liczy się tylko zaplanowany urlop sprzed grudnia
  const planBeforeDec = workUw.filter((d) => !isOnDemandDay(state, w.id, d) && (!decStart || d < decStart)).length;
  const reserve = decStart ? Math.max(ON_DEMAND_DAYS, used) : 0;
  const plannable = w.leaveDays === undefined ? undefined : Math.max(w.leaveDays - reserve, 0) - planBeforeDec;
  return { pool: w.leaveDays, planned, left, plannable, onDemandLeft };
}

export interface DayLoad {
  date: string;
  /** osoby na urlopie w dniu, w którym miały pracować */
  onLeave: number;
  /** stanowiska bez wymaganej obsady kwalifikowanej, zsumowane po liniach i zmianach tego dnia */
  gaps: number;
}

/** Skutki urlopów dla obsady: dla każdego dnia liczba urlopów i luk na stanowiskach. */
export function leaveLoad(state: AppState, dates: string[], lineIds: string[]): DayLoad[] {
  return dates.map((date) => {
    let onLeave = 0;
    let gaps = 0;
    for (const lineId of lineIds) {
      const codes = new Set<string>();
      for (const w of state.workers) {
        if (!w.active || w.lineId !== lineId) continue;
        const sh = plannedShift(state, w, date);
        if (!sh) continue;
        if (sh.code) codes.add(sh.code);
        if (hasLeave(state, w.id, date)) onLeave++;
      }
      for (const code of codes) {
        const def = shiftDef(state, code);
        if (!def) continue;
        gaps += lineStatus(state, lineId, date, { start: def.start, end: def.start + def.hours }).statuses.filter((s) => !s.ok).length;
      }
    }
    return { date, onLeave, gaps };
  });
}

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ł/gi, 'l')
    .toLowerCase()
    .replace(/[^a-z0-9一-鿿 ]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .sort()
    .join(' ');

export interface LeaveImport {
  /** dopasowani pracownicy i dni z literą U */
  matched: { workerId: string; name: string; dates: string[] }[];
  unmatched: string[];
  /** dni z U, których nie ma w grafiku pracownika (np. wolne) — i tak zostaną wpisane jako urlop */
  days: number;
}

/**
 * Czyta arkusz wklejony z Excela: wiersz nagłówka z datami (m/d/rrrr lub rrrr-mm-dd),
 * dalej wiersze „lp, imię i nazwisko, stanowisko, komórki”. Komórka „U” = urlop w tym dniu.
 * Kolejność imienia i nazwiska nie ma znaczenia, a polskie znaki są pomijane przy dopasowaniu.
 */
export function parseLeaveSheet(text: string, workers: Worker[]): LeaveImport {
  const rows = text.split(/\r?\n/).map((r) => r.split('\t'));
  const iso = (c: string): string | null => {
    const v = c.trim();
    let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
    if (m) return v;
    m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v);
    if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
    m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(v);
    if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    return null;
  };
  const head = rows.find((r) => r.filter((c) => iso(c)).length >= 5);
  if (!head) return { matched: [], unmatched: [], days: 0 };
  const dateAt = head.map((c) => iso(c));
  const byName = new Map<string, Worker>();
  for (const w of workers) byName.set(fold(w.name), w);
  const matched: LeaveImport['matched'] = [];
  const unmatched: string[] = [];
  let days = 0;
  for (const r of rows) {
    if (r === head) continue;
    const dates = r.flatMap((c, i) => (dateAt[i] && c.trim().toUpperCase() === 'U' ? [dateAt[i] as string] : []));
    const nameCell = r.slice(0, 4).find((c) => /[A-Za-zÀ-ɏ一-鿿]{2,}/.test(c) && !/^(A|B|C|D)\s+\w+$/.test(c.trim()) && !/^\d+$/.test(c.trim()));
    if (!nameCell) continue;
    const w = byName.get(fold(nameCell));
    if (!w) {
      if (dates.length) unmatched.push(nameCell.trim());
      continue;
    }
    if (dates.length) {
      matched.push({ workerId: w.id, name: w.name, dates });
      days += dates.length;
    }
  }
  return { matched, unmatched, days };
}

/** Ile dni urlopu (UW) wpisano osobom z listy w podanych dniach — do podsumowania miesięcy w widoku rocznym. */
export function leaveDaysIn(state: AppState, workerIds: Set<string>, dates: string[]): number {
  let n = 0;
  for (const a of state.absences) {
    if (a.reason !== 'UW' || !workerIds.has(a.workerId)) continue;
    for (const d of dates) if (d >= a.from && d <= a.to) n++;
  }
  return n;
}

export type ReportResolution =
  | { kind: 'planned' }
  | { kind: 'from-plan'; planDate: string; onDemandLeft: number }
  | { kind: 'on-demand'; onDemandLeft: number };

/**
 * Pracownik zgłasza, że bierze urlop w dniu. Jeśli był zaplanowany — tylko potwierdzamy.
 * Jeśli nie — proponujemy zabrać najbliższy zaplanowany dzień (najpierw późniejszy, potem wcześniejszy),
 * a gdy planu brak, urlop idzie z puli na żądanie.
 */
export function resolveLeaveReport(state: AppState, w: Worker, date: string): ReportResolution {
  if (hasLeave(state, w.id, date)) return { kind: 'planned' };
  const onDemandLeft = leaveBalance(state, w, date.slice(0, 4)).onDemandLeft;
  const year = periodDays(date.slice(0, 4));
  const plan = year.filter((d) => d !== date && hasLeave(state, w.id, d) && plannedShift(state, w, d) && !isOnDemandDay(state, w.id, d));
  const planDate = plan.find((d) => d > date) ?? [...plan].reverse().find((d) => d < date);
  return planDate ? { kind: 'from-plan', planDate, onDemandLeft } : { kind: 'on-demand', onDemandLeft };
}

/** Wpisuje rozpatrzone zgłoszenie do nieobecności. */
export function applyLeaveReport(abs: Absence[], workerId: string, date: string, mode: 'planned' | 'from-plan' | 'on-demand', planDate: string | undefined, newId: () => string): Absence[] {
  if (mode === 'planned') return abs;
  if (mode === 'on-demand') return setLeaveDay(abs, workerId, date, true, newId, ON_DEMAND_NOTE);
  const without = planDate ? setLeaveDay(abs, workerId, planDate, false, newId) : abs;
  return setLeaveDay(without, workerId, date, true, newId);
}
