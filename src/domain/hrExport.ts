import { absenceOn, assignmentOn, plannedShift } from './coverage';
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
  night: number;
  sunday: number;
  extra: boolean;
  absence?: string;
  stationId?: string | null;
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
  if (ab) return { date, code: ab.reason, hours: 0, night: 0, sunday: 0, extra: false, absence: ab.reason };
  if (!shift) return { date, code: holidayName(date) ? 'ŚW' : 'W', hours: 0, night: 0, sunday: 0, extra: false };
  const { start, end } = shift;
  const night = NIGHT.reduce((s, [a, b]) => s + overlap(start, end, a, b), 0);
  const sunday = (weekday(date) === 0 ? overlap(start, end, 0, 24) : 0) + (weekday(addDays(date, 1)) === 0 ? overlap(start, end, 24, 48) : 0);
  const range = `${fmtHour(start).slice(0, 2)}-${fmtHour(end).slice(0, 2)}`;
  const asg = assignmentOn(state, w.id, date);
  return {
    date,
    code: shift.extra ? `${range}*` : range,
    start,
    end,
    hours: end - start,
    night,
    sunday,
    extra: shift.extra,
    stationId: asg ? asg.stationId : w.homeStationId,
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
}

export function hrSummary(state: AppState, f: HrFilter): HrSummary[] {
  const dates = monthDays(f.month);
  return hrWorkers(state, f).map((worker) => {
    const days = dates.map((d) => dayEntry(state, worker, d));
    const absences: Record<string, number> = {};
    for (const d of days) if (d.absence) absences[d.absence] = (absences[d.absence] ?? 0) + 1;
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
        d.absence ? '' : (state.stations.find((x) => x.id === d.stationId)?.name ?? 'rezerwa'),
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
