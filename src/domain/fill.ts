import { lineStatus, level, plannedShift, absenceOn } from './coverage';
import { daysBetween, monthDays } from './dates';
import { hrSummary } from './hrExport';
import { monthNorm } from './norm';
import { restCheck } from './replacement';
import { rotaCell, shiftDef } from './rota';
import { linePatterns, patternBrigades } from './types';
import type { AppState, Worker } from './types';

export interface FillProposal {
  worker: Worker;
  date: string;
  lineId: string;
  stationId: string;
  start: number;
  hours: number;
}

export interface WorkerDeficit {
  worker: Worker;
  planned: number;
  norm: number;
  missing: number;
}

/** Ludzie, którym w miesiącu brakuje godzin do wymiaru czasu pracy. */
export function deficits(state: AppState, month: string, workers?: Worker[]): WorkerDeficit[] {
  const norm = monthNorm(month).hours;
  const ids = workers ? new Set(workers.map((w) => w.id)) : null;
  return hrSummary(state, { month, lineId: 'all', who: 'all', includeInactive: false })
    .filter((r) => r.worker.active && (!ids || ids.has(r.worker.id)))
    .map((r) => ({ worker: r.worker, planned: r.hours, norm, missing: norm - r.hours }))
    .filter((d) => d.missing > 0)
    .sort((a, b) => b.missing - a.missing);
}

/** Zmiany, które danego dnia faktycznie trwają na linii (wg systemów linii). */
function lineWindows(state: AppState, lineId: string, date: string): { start: number; hours: number }[] {
  const seen = new Map<string, { start: number; hours: number }>();
  for (const p of linePatterns(state, lineId)) {
    for (const b of patternBrigades(p)) {
      const c = rotaCell(state, p.id, b, date);
      if (c.status !== 'work') continue;
      const d = shiftDef(state, c.code);
      if (d) seen.set(`${d.start}/${d.hours}`, { start: d.start, hours: d.hours });
    }
  }
  return [...seen.values()];
}

/**
 * Propozycje dodatkowych zmian dla ludzi z niedoborem godzin: tylko w ich dni wolne,
 * tylko na stanowiskach z luką, na których mają wymagany poziom, i z 11 h odpoczynku.
 */
export function fillProposals(state: AppState, month: string, opts: { from?: string; workers?: Worker[] } = {}): { deficits: WorkerDeficit[]; proposals: FillProposal[] } {
  const defs = deficits(state, month, opts.workers);
  const days = monthDays(month).filter((d) => !opts.from || d >= opts.from);
  // luki: klucz dzień|linia|stanowisko|start → ile osób brakuje
  const gaps = new Map<string, { date: string; lineId: string; stationId: string; start: number; hours: number; need: number }>();
  for (const date of days) {
    for (const line of state.lines) {
      for (const w of lineWindows(state, line.id, date)) {
        const window = { start: w.start, end: w.start + w.hours };
        for (const st of lineStatus(state, line.id, date, window).statuses) {
          if (st.ok) continue;
          const need = st.station.required - st.min;
          gaps.set(`${date}|${line.id}|${st.station.id}|${w.start}`, { date, lineId: line.id, stationId: st.station.id, start: w.start, hours: w.hours, need });
        }
      }
    }
  }
  const proposals: FillProposal[] = [];
  for (const d of defs) {
    let missing = d.missing;
    const taken = new Set<string>();
    const mine: { abs: number; end: number }[] = [];
    // odpoczynek względem już zaproponowanych dodatkowych zmian tej osoby
    const restOk = (date: string, start: number, hours: number) => {
      const abs = daysBetween(days[0] ?? date, date) * 24 + start;
      return mine.every((m) => abs >= m.end + 11 || abs + hours + 11 <= m.abs);
    };
    for (const g of [...gaps.values()].sort((a, b) => a.date.localeCompare(b.date))) {
      if (missing <= 0) break;
      if (g.need <= 0 || taken.has(g.date)) continue;
      const st = state.stations.find((s) => s.id === g.stationId)!;
      if (level(d.worker, st.id) < st.minLevel) continue;
      if (plannedShift(state, d.worker, g.date) || absenceOn(state, d.worker.id, g.date)) continue;
      if (!restCheck(state, d.worker, g.date, { start: g.start, end: g.start + g.hours }).ok) continue;
      if (!restOk(g.date, g.start, g.hours)) continue;
      const abs = daysBetween(days[0] ?? g.date, g.date) * 24 + g.start;
      mine.push({ abs, end: abs + g.hours });
      proposals.push({ worker: d.worker, date: g.date, lineId: g.lineId, stationId: g.stationId, start: g.start, hours: g.hours });
      g.need--;
      taken.add(g.date);
      missing -= g.hours;
    }
  }
  return { deficits: defs, proposals };
}
