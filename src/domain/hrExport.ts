import { absenceOn, placement, plannedShift } from './coverage';
import { addDays, fmtHour, monthDays, weekday } from './dates';
import { holidayName } from './holidays';
import type { AppState, Worker } from './types';
import { TYPE_LABEL } from './types';

export interface HrFilter {
  month: string;
  lineId: string | 'all';
  /** 'all', typ pracownika albo `ag:<nazwa agencji>` */
  who: string;
  includeInactive: boolean;
}

export interface DayEntry {
  date: string;
  code: string;
  start?: number;
  end?: number;
  hours: number;
  /** godziny należne bez pracy (postój) — do wymiaru, nie do przepracowanych */
  credit: number;
  night: number;
  sunday: number;
  extra: boolean;
  absence?: string;
  stationId?: string | null;
  /** stanowiska obsługiwane równocześnie z głównym */
  alsoStationIds?: string[];
}

/** Pora nocna 22:00–06:00 (do ustalenia z kadrami; zmień w jednym miejscu). */
export const NIGHT: [number, number][] = [
  [-2, 6],
  [22, 30],
];

function overlap(a: number, b: number, c: number, d: number): number {
  return Math.max(0, Math.min(b, d) - Math.max(a, c));
}

export function dayEntry(state: AppState, w: Worker, date: string): DayEntry {
  const ab = absenceOn(state, w.id, date);
  const shift = plannedShift(state, w, date);
  if (ab) return { date, code: ab.reason, hours: 0, credit: 0, night: 0, sunday: 0, extra: false, absence: ab.reason };
  if (!shift) return { date, code: holidayName(date) ? 'ŚW' : 'W', hours: 0, credit: 0, night: 0, sunday: 0, extra: false };
  const credit = shift.extra || !shift.code ? 0 : (state.shiftDefs.find((d) => d.code === shift.code)?.credit ?? 0);
  const { start, end } = shift;
  const night = NIGHT.reduce((s, [a, b]) => s + overlap(start, end, a, b), 0);
  const sunday = (weekday(date) === 0 ? overlap(start, end, 0, 24) : 0) + (weekday(addDays(date, 1)) === 0 ? overlap(start, end, 24, 48) : 0);
  const range = `${fmtHour(start).slice(0, 2)}-${fmtHour(end).slice(0, 2)}`;
  const pl = placement(state, w, date);
  return {
    date,
    code: shift.extra ? `${range}*` : range,
    start,
    end,
    hours: end - start,
    credit,
    night,
    sunday,
    extra: shift.extra,
    stationId: pl.stationId,
    ...(pl.also.length ? { alsoStationIds: pl.also } : {}),
  };
}

export function hrWorkers(state: AppState, f: HrFilter): Worker[] {
  return state.workers
    .filter((w) => f.includeInactive || w.active)
    .filter((w) => f.lineId === 'all' || w.lineId === f.lineId)
    .filter((w) => {
      if (f.who === 'all') return true;
      if (f.who.startsWith('ag:')) return w.type === 'AG' && (w.agency ?? '') === f.who.slice(3);
      return w.type === f.who;
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'pl'));
}

export interface HrSummary {
  worker: Worker;
  days: DayEntry[];
  workDays: number;
  hours: number;
  night: number;
  sunday: number;
  extraHours: number;
  absences: Record<string, number>;
  /** godziny przepracowane na każdym stanowisku (id → h), null = rezerwa */
  byStation: Record<string, number>;
  /** godziny na stanowiskach specjalnych (★) */
  specialHours: number;
  /** godziny należne bez pracy (postój, np. maintenance) */
  credit: number;
}

export function hrSummary(state: AppState, f: HrFilter): HrSummary[] {
  const dates = monthDays(f.month);
  return hrWorkers(state, f).map((worker) => {
    const days = dates.map((d) => dayEntry(state, worker, d));
    const absences: Record<string, number> = {};
    const byStation: Record<string, number> = {};
    for (const d of days) {
      if (d.absence) absences[d.absence] = (absences[d.absence] ?? 0) + 1;
      if (d.hours > 0) {
        // przy łączeniu stanowisk godziny zmiany dzielone są po równo
        const keys = d.stationId ? [d.stationId, ...(d.alsoStationIds ?? [])] : [''];
        for (const k of keys) byStation[k] = (byStation[k] ?? 0) + d.hours / keys.length;
      }
    }
    const sum = (k: 'hours' | 'night' | 'sunday') => days.reduce((s, d) => s + d[k], 0);
    return {
      worker,
      days,
      workDays: days.filter((d) => d.hours > 0).length,
      hours: sum('hours'),
      night: sum('night'),
      sunday: sum('sunday'),
      extraHours: days.filter((d) => d.extra).reduce((s, d) => s + d.hours, 0),
      absences,
      byStation,
      credit: days.reduce((h, d) => h + d.credit, 0),
      specialHours: Object.entries(byStation).reduce((h, [id, v]) => h + (state.stations.find((x) => x.id === id)?.special ? v : 0), 0),
    };
  });
}

function csv(rows: (string | number)[][]): string {
  const cell = (v: string | number) => {
    const s = String(v);
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + rows.map((r) => r.map(cell).join(';')).join('\r\n');
}

const lineOf = (state: AppState, w: Worker) => state.lines.find((l) => l.id === w.lineId)?.name ?? '';
const systemOf = (state: AppState, w: Worker) => state.patterns.find((p) => p.id === w.patternId)?.name ?? '';

/** Tabela miesięczna: wiersz = pracownik, kolumna = dzień, na końcu sumy. */
export function hrMonthlyCsv(state: AppState, f: HrFilter): string {
  const dates = monthDays(f.month);
  const DOW = ['nd', 'pn', 'wt', 'śr', 'cz', 'pt', 'so'];
  const head = [
    'Nazwisko i imię',
    'Typ',
    'Agencja',
    'Linia',
    'Brygada',
    'System',
    ...dates.map((d) => `${d.slice(8)} ${DOW[weekday(d)]}`),
    'Dni pracy',
    'Godziny',
    'w tym nocne 22-6',
    'w tym niedziela',
    'w tym dodatkowe',
    'w tym na stanowiskach ★',
    'Należne bez pracy (postój)',
    'L4 (dni)',
    'Urlop (dni)',
    'Inne nieob. (dni)',
  ];
  const rows = hrSummary(state, f).map((s) => [
    s.worker.name,
    TYPE_LABEL[s.worker.type],
    s.worker.agency ?? '',
    lineOf(state, s.worker),
    s.worker.brigade,
    systemOf(state, s.worker),
    ...s.days.map((d) => d.code),
    s.workDays,
    s.hours,
    s.night,
    s.sunday,
    s.extraHours,
    Math.round(s.specialHours * 100) / 100,
    s.credit,
    s.absences.L4 ?? 0,
    s.absences.UW ?? 0,
    (s.absences.NN ?? 0) + (s.absences.INNE ?? 0),
  ]);
  const legend = [
    [],
    ['Legenda: 07-15 = zmiana od 7:00 do 15:00 · * = dodatkowa zmiana (poza grafikiem) · W = wolne · ŚW = święto ustawowe · L4 · UW = urlop · NN = nieobecność nieusprawiedliwiona'],
    [`Wygenerowano: ${new Date().toLocaleString('pl-PL')} · TMT Grafik`],
  ];
  return csv([head, ...rows, ...legend]);
}

/** Lista dzienna: wiersz = pracownik × dzień pracy lub nieobecności (do wczytania w systemie kadrowym). */
export function hrDailyCsv(state: AppState, f: HrFilter): string {
  const head = ['Data', 'Dzień', 'Nazwisko i imię', 'Typ', 'Agencja', 'Linia', 'Brygada', 'Stanowisko', 'Od', 'Do', 'Godziny', 'Nocne 22-6', 'Status'];
  const rows: (string | number)[][] = [];
  for (const s of hrSummary(state, f)) {
    for (const d of s.days) {
      if (d.code === 'W' || d.code === 'ŚW') continue;
      rows.push([
        d.date,
        ['niedziela', 'poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota'][weekday(d.date)],
        s.worker.name,
        TYPE_LABEL[s.worker.type],
        s.worker.agency ?? '',
        lineOf(state, s.worker),
        s.worker.brigade,
        d.absence ? '' : d.stationId ? [d.stationId, ...(d.alsoStationIds ?? [])].map((id) => state.stations.find((x) => x.id === id)?.name ?? '?').join(' + ') : 'rezerwa',
        d.start !== undefined ? fmtHour(d.start) : '',
        d.end !== undefined ? fmtHour(d.end) : '',
        d.hours,
        d.night,
        d.absence ?? (d.extra ? 'dodatkowa zmiana' : 'praca wg grafiku'),
      ]);
    }
  }
  rows.sort((a, b) => String(a[0]).localeCompare(String(b[0])) || String(a[2]).localeCompare(String(b[2]), 'pl'));
  return csv([head, ...rows]);
}

/** Godziny na stanowiskach (do premii): wiersz = pracownik × stanowisko, na którym pracował w miesiącu. */
export function hrStationsCsv(state: AppState, f: HrFilter): string {
  const head = ['Nazwisko i imię', 'Typ', 'Agencja', 'Linia (macierzysta)', 'Brygada', 'Stanowisko macierzyste', 'Stanowisko', 'Linia stanowiska', 'Godziny', 'Udział %', 'Godziny razem'];
  const rows: (string | number)[][] = [];
  for (const s of hrSummary(state, f)) {
    const home = state.stations.find((x) => x.id === s.worker.homeStationId)?.name ?? 'rezerwa';
    const entries = Object.entries(s.byStation).sort((a, b) => b[1] - a[1]);
    for (const [stId, h] of entries) {
      const st = state.stations.find((x) => x.id === stId);
      rows.push([
        s.worker.name,
        TYPE_LABEL[s.worker.type],
        s.worker.agency ?? '',
        lineOf(state, s.worker),
        s.worker.brigade,
        home,
        st ? `${st.name}${st.special ? ' ★' : ''}` : 'rezerwa',
        st ? (state.lines.find((l) => l.id === st.lineId)?.name ?? '') : '',
        Math.round(h * 100) / 100,
        s.hours ? Math.round((h / s.hours) * 1000) / 10 : 0,
        s.hours,
      ]);
    }
  }
  return csv([head, ...rows]);
}
