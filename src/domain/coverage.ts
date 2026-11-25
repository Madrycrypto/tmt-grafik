import { addDays } from './dates';
import { rotaCell, shiftDef } from './rota';
import type { Absence, AppState, Assignment, Station, Worker } from './types';

/** Przedział w godzinach liczonych od północy danego dnia (noc może wyjść poza 24). */
export interface Interval {
  start: number;
  end: number;
}

export interface WorkerShift extends Interval {
  /** dzień, w którym zmiana się zaczyna */
  date: string;
  code: string | null;
  extra: boolean;
}

export function absenceOn(state: AppState, workerId: string, date: string): Absence | undefined {
  return state.absences.find((a) => a.workerId === workerId && a.from <= date && date <= a.to);
}

export function assignmentOn(state: AppState, workerId: string, date: string): Assignment | undefined {
  return state.assignments.find((a) => a.workerId === workerId && a.date === date);
}

/** Zmiana pracownika rozpoczynająca się danego dnia (bez sprawdzania nieobecności). */
export function plannedShift(state: AppState, w: Worker, date: string): WorkerShift | null {
  const asg = assignmentOn(state, w.id, date);
  if (asg?.extraShift) {
    return { date, start: asg.extraShift.start, end: asg.extraShift.start + asg.extraShift.hours, code: null, extra: true };
  }
  const cell = rotaCell(state, w.patternId, w.brigade, date);
  if (cell.status !== 'work') return null;
  const def = shiftDef(state, cell.code);
  if (!def) return null;
  if (asg?.shift) return { date, start: asg.shift.start, end: asg.shift.start + asg.shift.hours, code: def.code, extra: false };
  const [start, end] = stretch(def.start, def.hours, w.shiftHours);
  return { date, start, end, code: def.code, extra: false };
}

/**
 * Zmiana o innej długości niż w systemie linii: zmiana zaczynająca się przed południem
 * zachowuje początek (07–15 → 07–19), późniejsza zachowuje koniec (15–23 → 11–23, 23–07 → 19–07).
 */
export function stretch(start: number, hours: number, target?: number): [number, number] {
  if (!target || target === hours) return [start, start + hours];
  if (start < 12) return [start, start + target];
  const end = start + hours;
  return [end - target, end];
}

/** Linia i stanowisko pracownika na zmianę zaczynającą się danego dnia. */
export function placement(state: AppState, w: Worker, date: string): { lineId: string; stationId: string | null; moved: boolean; also: string[] } {
  const asg = assignmentOn(state, w.id, date);
  if (asg) {
    const moved = asg.lineId !== w.lineId || asg.stationId !== w.homeStationId;
    // stałe łączenie stanowisk obowiązuje tylko na własnym stanowisku
    const also = asg.alsoStationIds ?? (moved ? [] : (w.alsoStationIds ?? []));
    return { lineId: asg.lineId, stationId: asg.stationId, moved, also: asg.stationId ? also : [] };
  }
  return { lineId: w.lineId, stationId: w.homeStationId, moved: false, also: w.homeStationId ? (w.alsoStationIds ?? []) : [] };
}

/** Wszystkie stanowiska, które osoba obsługuje na tej zmianie (główne pierwsze). */
export function servedStations(e: { stationId: string | null; also: string[] }): string[] {
  return e.stationId ? [e.stationId, ...e.also.filter((x) => x !== e.stationId)] : [];
}

export interface RosterEntry {
  worker: Worker;
  shift: WorkerShift;
  /** przedział względem północy oglądanego dnia */
  rel: Interval;
  lineId: string;
  stationId: string | null;
  moved: boolean;
  /** dodatkowe stanowiska obsługiwane równocześnie */
  also: string[];
  absence?: Absence;
}

export function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}

export function covers(a: Interval, b: Interval): boolean {
  return a.start <= b.start && a.end >= b.end;
}

/** Wszyscy, którzy pracują (lub powinni pracować) w danym oknie danego dnia. */
export function roster(state: AppState, date: string, window: Interval, lineId?: string): RosterEntry[] {
  const out: RosterEntry[] = [];
  for (const w of state.workers) {
    if (!w.active) continue;
    for (const [day, shiftBy] of [
      [addDays(date, -1), -24],
      [date, 0],
    ] as const) {
      const shift = plannedShift(state, w, day);
      if (!shift) continue;
      const rel = { start: shift.start + shiftBy, end: shift.end + shiftBy };
      if (!overlaps(rel, window)) continue;
      const pl = placement(state, w, day);
      if (lineId && pl.lineId !== lineId) continue;
      out.push({ worker: w, shift, rel, ...pl, absence: absenceOn(state, w.id, day) });
    }
  }
  return out;
}

export function level(w: Worker, stationId: string): number {
  return w.skills[stationId]?.level ?? 0;
}

export function qualified(w: Worker, st: Station): boolean {
  return level(w, st.id) >= st.minLevel;
}

export interface StationStatus {
  station: Station;
  people: RosterEntry[];
  /** liczba kwalifikowanych obecnych w kolejnych godzinach okna */
  perHour: number[];
  min: number;
  ok: boolean;
  /** na całej zmianie linii jest tylko jedna obecna osoba z wymaganym poziomem — brak zastępcy */
  soleQualified: boolean;
}

export function hoursOf(window: Interval): number[] {
  const hs: number[] = [];
  for (let h = window.start; h < window.end; h++) hs.push(h);
  return hs;
}

export function stationStatus(st: Station, entries: RosterEntry[], window: Interval): StationStatus {
  const people = entries.filter((e) => e.stationId === st.id || e.also.includes(st.id));
  const perHour = hoursOf(window).map(
    (h) => people.filter((e) => !e.absence && qualified(e.worker, st) && e.rel.start <= h && h < e.rel.end).length,
  );
  const min = perHour.length ? Math.min(...perHour) : 0;
  const presentQualified = new Set(entries.filter((e) => !e.absence && qualified(e.worker, st)).map((e) => e.worker.id)).size;
  return { station: st, people, perHour, min, ok: min >= st.required, soleQualified: presentQualified === 1 };
}

export function lineStatus(state: AppState, lineId: string, date: string, window: Interval) {
  const entries = roster(state, date, window, lineId);
  const stations = state.stations.filter((s) => s.lineId === lineId).sort((a, b) => a.order - b.order);
  const statuses = stations.map((st) => stationStatus(st, entries, window));
  const reserve = entries.filter((e) => e.stationId === null || !stations.some((s) => s.id === e.stationId || e.also.includes(s.id)));
  return { entries, statuses, reserve };
}
