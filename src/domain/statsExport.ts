import type { Punch } from './punches';
import { attendanceRows, overtime, punctuality, shiftComparison, skillRisk, sumRows, topAbsences, transfers, weekdayAbsences } from './stats';
import type { LineScope } from './stats';
import type { AppState } from './types';
import { writeXlsx } from './xlsx';
import type { XCell, XSheet, XStyle } from './xlsx';

const DOW = ['Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'So', 'Nd'];
const head: XStyle = { bold: true, bg: 'E9EDF3', border: true, align: 'center', wrap: true };
const h = (v: string): XCell => ({ v, s: head });
const c = (v: string | number, s: XStyle = {}): XCell => ({ v, s: { border: true, align: typeof v === 'number' ? 'right' : 'left', ...s } });
const pct = (x: number) => Math.round(x * 1000) / 10;

function sheet(name: string, title: string, header: string[], body: XCell[][], widths: number[]): XSheet {
  return {
    name,
    rows: [[{ v: title, s: { bold: true, size: 13 } }], [], header.map(h), ...body],
    colWidths: widths,
    freeze: { rows: 3, cols: 0 },
    printTitleRows: [3, 3],
  };
}

/** Statystyki miesiąca w pliku .xlsx (A4 poziomo): do omówienia na odprawie lub wydruku. */
export function buildStatsWorkbook(state: AppState, month: string, scopeName: string, lines: LineScope, punches?: Punch[]): Uint8Array {
  const t = (s: string) => `${s} — ${scopeName}, ${month}`;
  const att = attendanceRows(state, month, lines, punches);
  const sheets: XSheet[] = [];
  sheets.push(
    sheet(
      'Obecność',
      t('Obecność według brygad'),
      ['Linia · brygada', 'Osób', 'Plan (zmian)', 'Nieobecni', 'Nieobecności %', 'L4', 'UW', 'NN', 'Inne', 'Godz. utracone', 'Dodatkowe (h)'],
      [...att, sumRows(att)].map((r) => [
        c(r.label, { bold: r.key === 'total' }),
        c(r.people),
        c(r.planned),
        c(r.absent),
        c(pct(r.absentRate)),
        c(r.byReason.L4 ?? 0),
        c(r.byReason.UW ?? 0),
        c(r.byReason.NN ?? 0),
        c(r.byReason.INNE ?? 0),
        c(r.lostHours),
        c(r.extraHours),
      ]),
      [24, 8, 12, 11, 14, 6, 6, 6, 6, 14, 14],
    ),
  );
  sheets.push(
    sheet(
      'Zmiany',
      t('Porównanie zmian na linii'),
      ['Linia', 'Zmiana', 'Godziny', 'Dni pracy', 'Śr. zaplanowanych', 'Śr. obecnych', 'Nieobecności %', 'Wymagane', 'Dni z luką', 'Brak zastępcy (dni)', 'Dodatkowe'],
      shiftComparison(state, month, lines).map((x) => [c(x.lineName), c(x.label), c(x.window), c(x.workDays), c(Math.round(x.avgScheduled * 10) / 10), c(Math.round(x.avgPresent * 10) / 10), c(pct(x.absentRate)), c(x.required), c(x.gapDays), c(x.soleDays), c(x.extraShifts)]),
      [18, 8, 10, 10, 16, 14, 15, 11, 11, 18, 11],
    ),
  );
  sheets.push(
    sheet(
      'Ryzyko',
      t('Ryzyko kompetencji — brak zastępcy na stanowisku'),
      ['Linia', 'Stanowisko', '★', 'Brygada', 'Wymagane', 'Wykwalifikowani', 'Ryzyko', 'Kto'],
      skillRisk(state, lines).map((x) => [
        c(x.lineName),
        c(x.stationName),
        c(x.special ? '★' : '', { align: 'center' }),
        c(x.brigade, { align: 'center' }),
        c(x.required),
        c(x.qualified),
        c(x.risk === 'none' ? 'BRAK OBSADY' : 'brak zastępcy', x.risk === 'none' ? { bold: true, color: 'B42318', bg: 'FDE2E2' } : {}),
        c(x.names.join(', ')),
      ]),
      [16, 34, 4, 9, 11, 15, 16, 40],
    ),
  );
  const norm = overtime(state, month, lines);
  sheets.push(
    sheet(
      'Godziny',
      t('Godziny i nadgodziny (ponad normę miesiąca)'),
      ['Pracownik', 'Linia', 'Brygada', 'Grafik (h)', 'Dodatkowe (h)', 'Razem (h)', 'Norma (h)', 'Ponad normę (h)'],
      norm.map((x) => [c(x.name), c(x.line), c(x.brigade, { align: 'center' }), c(x.plannedHours), c(x.extraHours), c(x.totalHours), c(x.normHours), c(x.overHours, x.overHours ? { bold: true, color: 'B42318' } : {})]),
      [28, 16, 9, 12, 14, 11, 11, 16],
    ),
  );
  sheets.push(
    sheet(
      'Dni tygodnia',
      t('Nieobecności według dnia tygodnia'),
      ['Dzień', 'Plan (zmian)', 'Nieobecni', 'Nieobecności %'],
      weekdayAbsences(state, month, lines).map((x) => [c(DOW[x.dow - 1]), c(x.planned), c(x.absent), c(pct(x.absentRate))]),
      [10, 14, 12, 16],
    ),
  );
  sheets.push(
    sheet(
      'Nieobecni',
      t('Najwięcej nieobecności'),
      ['Pracownik', 'Linia', 'Dni', 'Powody'],
      topAbsences(state, month, lines, 20).map((x) => [c(x.name), c(x.line), c(x.days), c(Object.entries(x.byReason).map(([k, v]) => `${k} ${v}`).join(', '))]),
      [28, 16, 8, 30],
    ),
  );
  sheets.push(
    sheet(
      'Przeniesienia',
      t('Praca poza własną linią'),
      ['Pracownik', 'Z linii', 'Na linię', 'Dni', 'Stanowiska'],
      transfers(state, month, lines).map((x) => [c(x.name), c(x.from), c(x.to), c(x.days), c(x.stations.join(', '))]),
      [28, 16, 16, 8, 40],
    ),
  );
  if (punches?.length) {
    sheets.push(
      sheet(
        'RCP',
        t('Punktualność z RCP'),
        ['Pracownik', 'Linia', 'Dni sprawdzone', 'Spóźnienia', 'Minuty spóźnień', 'Wcześniejsze wyjścia', 'Brak odbicia'],
        punctuality(state, month, lines, punches).map((x) => [c(x.name), c(x.line), c(x.checked), c(x.late), c(x.lateMin), c(x.early), c(x.missing)]),
        [28, 16, 15, 12, 17, 20, 14],
      ),
    );
  }
  return writeXlsx(sheets);
}

export const statsFileName = (scopeName: string, month: string) => `Statystyki_${scopeName.replace(/[^\p{L}\p{N}]+/gu, '_')}_${month}.xlsx`;
