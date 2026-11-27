import { absenceOn, plannedShift } from './coverage';
import { monthDays, weekday } from './dates';
import { holidayName } from './holidays';
import { monthNorm } from './norm';
import { brigadeMonth, shiftDef, summarize } from './rota';
import { OFF, TYPE_LABEL, patternBrigades } from './types';
import type { AppState, BrigadeId, Worker } from './types';
import { colName as colLetter, writeXlsx } from './xlsx';
import type { XCell, XSheet, XStyle } from './xlsx';

export const BRIGADE_COLOR: Record<BrigadeId, string> = { A: '#2457D6', B: '#E07A1F', C: '#0F8C7E', D: '#7A4FD0' };

const MONTHS = ['styczeń', 'luty', 'marzec', 'kwiecień', 'maj', 'czerwiec', 'lipiec', 'sierpień', 'wrzesień', 'październik', 'listopad', 'grudzień'];
const DOW = ['Nd', 'Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'So'];

export interface PrintOptions {
  patternId: string;
  month: string;
  /** zakres wyświetlany w tytule, np. „CFM” albo „Assembly” */
  scopeName: string;
  /** linie, których pracownicy trafiają do arkusza „Pracownicy” */
  lineIds: string[];
  generatedAt?: Date;
}

const C = {
  head: 'E9EDF3',
  weekend: 'D5DBE5',
  red: 'B42318',
  redBg: 'FDE2E2',
  off: 'F1F3F6',
  offText: '7A8496',
  R: { bg: 'FFF1C2', fg: '5A4300' },
  P: { bg: 'FFD9A8', fg: '5C3300' },
  N: { bg: '2B3445', fg: 'FFFFFF' },
};

function shiftColors(label: string): { bg: string; fg: string } {
  if (label.startsWith('N')) return C.N;
  if (label.startsWith('P')) return C.P;
  return C.R;
}

const cell = (v: string | number | null, s: XStyle = {}): XCell => ({ v, s: { border: true, align: 'center', ...s } });

/** Tekst i styl komórki jednego pracownika w jednym dniu. */
function workerDay(state: AppState, w: Worker, date: string): { cell: XCell; hours: number; code: string | null } {
  const ab = absenceOn(state, w.id, date);
  if (ab) return { cell: cell(ab.reason, { bold: true, bg: C.redBg, color: C.red }), hours: 0, code: null };
  const sh = plannedShift(state, w, date);
  if (sh) {
    const def = sh.code ? shiftDef(state, sh.code) : undefined;
    const label = sh.extra ? '+' : (def?.label ?? sh.code ?? '?');
    const col = shiftColors(sh.extra ? 'R' : label);
    return { cell: cell(label, { bold: true, bg: col.bg, color: col.fg }), hours: sh.end - sh.start + (sh.extra ? 0 : (def?.credit ?? 0)), code: sh.code };
  }
  const st = brigadeMonth(state, w.patternId, w.brigade, date.slice(0, 7))[Number(date.slice(8)) - 1]?.status;
  if (st === 'holiday') return { cell: cell('Ś', { bold: true, bg: C.redBg, color: C.red }), hours: 0, code: null };
  return { cell: cell(OFF, { bg: C.off, color: C.offText }), hours: 0, code: null };
}

function dayHeaders(days: string[]): { dow: (XCell | null)[]; num: (XCell | null)[] } {
  const style = (d: string): XStyle => {
    const hol = !!holidayName(d);
    const wd = weekday(d);
    return { bold: true, bg: wd === 0 || wd === 6 || hol ? C.weekend : C.head, color: wd === 0 || hol ? C.red : undefined, size: 9 };
  };
  return { dow: days.map((d) => cell(DOW[weekday(d)], style(d))), num: days.map((d) => cell(Number(d.slice(8)), style(d))) };
}

/** Plik .xlsx do wydrukowania na produkcję: przegląd brygad i listy pracowników po brygadach. */
export function buildPrintWorkbook(state: AppState, o: PrintOptions): Uint8Array {
  const pattern = state.patterns.find((p) => p.id === o.patternId);
  if (!pattern) throw new Error('Brak systemu zmianowego');
  const days = monthDays(o.month);
  const [y, m] = o.month.split('-').map(Number);
  const when = `${MONTHS[m - 1]} ${y}`;
  const stamp = (o.generatedAt ?? new Date()).toLocaleString('pl-PL');
  const norm = monthNorm(o.month);
  const brigades = patternBrigades(pattern);
  const workers = state.workers
    .filter((w) => w.active && w.patternId === pattern.id && o.lineIds.includes(w.lineId))
    .sort((a, b) => (state.lines.find((l) => l.id === a.lineId)?.name ?? '').localeCompare(state.lines.find((l) => l.id === b.lineId)?.name ?? '', 'pl') || a.name.localeCompare(b.name, 'pl'));
  const footerLeft = `TMT Grafik · ${o.scopeName} · ${when} · wygenerowano ${stamp}`;
  const hdr = dayHeaders(days);
  const title = (text: string, width: number): XCell[] => [{ v: text, s: { bold: true, size: 15, align: 'left' } }, ...Array(width - 1).fill(null)];
  const sub = (text: string, width: number): XCell[] => [{ v: text, s: { size: 10, color: '4A5568', align: 'left' } }, ...Array(width - 1).fill(null)];

  // ---- Arkusz 1: brygady ----
  const summary = summarize(state, pattern.id, o.month);
  const usedCodes = [...new Set(pattern.sequence.filter((c) => c !== OFF))];
  const width1 = 1 + days.length + 4;
  const rows1: (XCell | null)[][] = [
    title(`Grafik brygad — ${o.scopeName} — ${when}`, width1),
    sub(`System: ${pattern.name} · wymiar czasu pracy ${norm.hours} h (${norm.workdays} dni roboczych)`, width1),
    [],
    [cell('Brygada', { bold: true, bg: C.head, align: 'left' }), ...hdr.dow, cell('Dni', { bold: true, bg: C.head }), cell('Godz.', { bold: true, bg: C.head }), cell('Wymiar', { bold: true, bg: C.head }), cell('Osób', { bold: true, bg: C.head })],
    [cell('', { bg: C.head }), ...hdr.num, cell('', { bg: C.head }), cell('', { bg: C.head }), cell('', { bg: C.head }), cell('', { bg: C.head })],
  ];
  for (const b of brigades) {
    const cells = brigadeMonth(state, pattern.id, b, o.month);
    const s = summary.find((x) => x.brigade === b)!;
    rows1.push([
      cell(`Brygada ${b}`, { bold: true, align: 'left', color: 'FFFFFF', bg: BRIGADE_COLOR[b].slice(1), size: 11 }),
      ...cells.map((c): XCell => {
        if (c.status === 'holiday') return cell('Ś', { bold: true, bg: C.redBg, color: C.red });
        if (c.status === 'excluded') return cell('×', { bg: C.off, color: C.offText });
        if (c.status === 'work') {
          const label = shiftDef(state, c.code)?.label ?? c.code;
          const col = shiftColors(label);
          return cell(label, { bold: true, bg: col.bg, color: col.fg, size: 11 });
        }
        return cell(OFF, { bg: C.off, color: C.offText });
      }),
      cell(s.days, { bold: true }),
      cell(s.hours, { bold: true, bg: s.hours === norm.hours ? undefined : C.redBg, color: s.hours === norm.hours ? undefined : C.red }),
      cell(norm.hours),
      cell(workers.filter((w) => w.brigade === b).length),
    ]);
  }
  // ile osób na każdej zmianie w danym dniu (bez nieobecnych)
  rows1.push([]);
  for (const code of usedCodes) {
    const label = shiftDef(state, code)?.label ?? code;
    const col = shiftColors(label);
    rows1.push([
      cell(`Obsada ${label} (osób)`, { bold: true, align: 'left', bg: col.bg, color: col.fg }),
      ...days.map((d) => cell(workers.filter((w) => !absenceOn(state, w.id, d) && plannedShift(state, w, d)?.code === code).length || '', { size: 9 })),
      cell(null),
      cell(null),
      cell(null),
      cell(null),
    ]);
  }
  rows1.push([cell('Nieobecni (osób)', { bold: true, align: 'left', bg: C.redBg, color: C.red }), ...days.map((d) => cell(workers.filter((w) => absenceOn(state, w.id, d)).length || '', { size: 9, color: C.red })), cell(null), cell(null), cell(null), cell(null)]);
  rows1.push([]);
  const legend = usedCodes.map((c) => {
    const d = shiftDef(state, c);
    return d ? `${d.label} = ${String(d.start).padStart(2, '0')}:00–${String((d.start + d.hours) % 24).padStart(2, '0')}:00` : c;
  });
  rows1.push([{ v: `Legenda: ${legend.join(' · ')} · W = wolne · Ś = święto · × = zakład nie pracuje · L4 / UW / NN = nieobecność · + = dodatkowa zmiana`, s: { size: 9, italic: true, align: 'left' } }]);
  const sheet1: XSheet = {
    name: 'Brygady',
    rows: rows1,
    colWidths: [16, ...days.map(() => 4.2), 6, 7, 8, 6],
    rowHeights: { 1: 24 },
    merges: [`A1:${colLetter(width1 - 1)}1`, `A2:${colLetter(width1 - 1)}2`, `A${rows1.length}:${colLetter(width1 - 1)}${rows1.length}`],
    freeze: { rows: 5, cols: 1 },
    printTitleRows: [4, 5],
    footerLeft,
  };

  // ---- Arkusz 2: pracownicy po brygadach, każda brygada na osobnej stronie ----
  const width2 = 4 + days.length + 2;
  const rows2: (XCell | null)[][] = [
    title(`Grafik pracowników — ${o.scopeName} — ${when}`, width2),
    [],
    [cell('Nazwisko i imię', { bold: true, bg: C.head, align: 'left' }), cell('Typ', { bold: true, bg: C.head }), cell('Linia', { bold: true, bg: C.head }), cell('Stanowisko', { bold: true, bg: C.head }), ...hdr.dow, cell('Dni', { bold: true, bg: C.head }), cell('Godz.', { bold: true, bg: C.head })],
    [cell('', { bg: C.head }), cell('', { bg: C.head }), cell('', { bg: C.head }), cell('', { bg: C.head }), ...hdr.num, cell('', { bg: C.head }), cell('', { bg: C.head })],
  ];
  const merges2 = [`A1:${colLetter(width2 - 1)}1`];
  const breaks: number[] = [];
  const present = brigades.filter((b) => workers.some((w) => w.brigade === b));
  present.forEach((b, bi) => {
    const list = workers.filter((w) => w.brigade === b);
    rows2.push([
      { v: `Brygada ${b} — ${list.length} os.`, s: { bold: true, size: 12, color: 'FFFFFF', bg: BRIGADE_COLOR[b].slice(1), align: 'left' } },
      ...Array(width2 - 1).fill({ v: null, s: { bg: BRIGADE_COLOR[b].slice(1) } }),
    ]);
    merges2.push(`A${rows2.length}:${colLetter(width2 - 1)}${rows2.length}`);
    for (const w of list) {
      const per = days.map((d) => workerDay(state, w, d));
      const worked = per.filter((p) => p.hours > 0).length;
      rows2.push([
        cell(w.name, { align: 'left', bold: true }),
        cell(TYPE_LABEL[w.type] === 'Agencja' ? 'AG' : TYPE_LABEL[w.type], { size: 9 }),
        cell(state.lines.find((l) => l.id === w.lineId)?.name ?? '', { size: 9, align: 'left' }),
        cell(state.stations.find((s) => s.id === w.homeStationId)?.name ?? '', { size: 9 }),
        ...per.map((p) => p.cell),
        cell(worked, { bold: true }),
        cell(per.reduce((s, p) => s + p.hours, 0), { bold: true }),
      ]);
    }
    if (bi < present.length - 1) breaks.push(rows2.length);
  });
  rows2.push([]);
  rows2.push([{ v: 'Legenda: R = rano · P = popołudnie · N = noc · W = wolne · Ś = święto · L4 / UW / NN = nieobecność · + = dodatkowa zmiana', s: { size: 9, italic: true, align: 'left' } }]);
  const sheet2: XSheet = {
    name: 'Pracownicy',
    rows: rows2,
    colWidths: [28, 5, 11, 24, ...days.map(() => 3.9), 5, 6],
    rowHeights: { 1: 24 },
    merges: merges2,
    freeze: { rows: 4, cols: 1 },
    printTitleRows: [3, 4],
    pageBreaksAfter: breaks,
    footerLeft,
  };

  return writeXlsx([sheet1, sheet2]);
}

export function printFileName(scopeName: string, patternName: string, month: string): string {
  const slug = (s: string) => s.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');
  return `grafik-${slug(scopeName)}-${slug(patternName).slice(0, 24)}-${month}.xlsx`;
}
