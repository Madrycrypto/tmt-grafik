import { addDays } from './dates';
import { absenceOn, covers, plannedShift, qualified, level, roster } from './coverage';
import type { Interval, RosterEntry } from './coverage';
import { t } from '../i18n';
import { canPair } from './types';
import type { AppState, Station, Worker } from './types';

/** combine = pracownik zostaje na swoim stanowisku i obsługuje też brakujące */
export type StepKind = 'reserve' | 'surplus' | 'combine' | 'move' | 'extra';

export interface Step {
  worker: Worker;
  kind: StepKind;
  fromLineId: string;
  fromStationId: string | null;
  toLineId: string;
  toStationId: string;
  level: number;
  /** dzień rozpoczęcia zmiany, na którą robimy przypisanie */
  shiftDate: string;
  /** dla combine: stanowiska, które pracownik już obsługuje razem z głównym */
  keepAlso?: string[];
  extraShift?: { start: number; hours: number };
  /** ile godzin brakuje pracownikowi do wymiaru w okresie rozliczeniowym (dla dodatkowej zmiany) */
  missing?: number;
  warnings: string[];
}

export interface Variant {
  steps: Step[];
  score: number;
  moves: number;
  extras: number;
  otherLine: boolean;
  agency: boolean;
  /** każda dodatkowa zmiana dopełnia komuś niedomiar, więc nie są to nadgodziny */
  fillsDeficit: boolean;
}

export interface GapRequest {
  /** dzień, względem którego liczone jest okno (dzień rozpoczęcia brakującej zmiany) */
  date: string;
  lineId: string;
  stationId: string;
  window: Interval;
  /** pracownicy, których nie wolno użyć (np. nieobecny) */
  excludeIds: string[];
  /** brakujące godziny do wymiaru wg pracownika; kto je ma, dostaje dodatkową zmianę przed nadgodzinami */
  missing?: Record<string, number>;
}

export interface Blocked {
  worker: Worker;
  stationId: string;
  reason: string;
}

export const MIN_DAILY_REST = 11;
const MAX_DEPTH = 3;
const MAX_VARIANTS = 3;

function stepCost(s: Step): number {
  // dodatkowa zmiana na niedomiar to nie nadgodziny: taniej niż agencja i nadgodziny, drożej niż ruchy w obrębie zmiany
  const base = { reserve: 0, surplus: 1, combine: 2, move: 3, extra: s.missing ? 10 : s.worker.type === 'AG' ? 25 : 20 }[s.kind];
  const otherLine = s.fromLineId !== s.toLineId ? 4 : 0;
  return base + otherLine - s.level * 0.25;
}

export interface RestCheck {
  ok: boolean;
  before: number;
  after: number;
}

/** Czy pracownik może przyjść na dodatkową zmianę bez łamania 11 h odpoczynku dobowego. */
export function restCheck(state: AppState, w: Worker, date: string, window: Interval): RestCheck {
  const prev = plannedShift(state, w, addDays(date, -1));
  const same = plannedShift(state, w, date);
  const next = plannedShift(state, w, addDays(date, 1));
  const prevEnd = Math.max(prev ? prev.end - 24 : -Infinity, same && same.end <= window.start ? same.end : -Infinity);
  const nextStart = Math.min(next ? next.start + 24 : Infinity, same && same.start >= window.end ? same.start : Infinity);
  const before = window.start - prevEnd;
  const after = nextStart - window.end;
  const overlapsSame = !!same && same.start < window.end && window.start < same.end;
  return { ok: !overlapsSame && before >= MIN_DAILY_REST && after >= MIN_DAILY_REST, before, after };
}

function usualHours(state: AppState, w: Worker): number {
  const p = state.patterns.find((x) => x.id === w.patternId);
  const code = p?.sequence.find((c) => c !== 'W');
  return state.shiftDefs.find((s) => s.code === code)?.hours ?? 8;
}

interface Ctx {
  state: AppState;
  req: GapRequest;
  present: RosterEntry[];
  stations: Map<string, Station>;
  blocked: Blocked[];
}

function stillCoveredWithout(ctx: Ctx, e: RosterEntry, used: Set<string>, window: Interval): boolean {
  if (!e.stationId) return true;
  const st = ctx.stations.get(e.stationId);
  if (!st) return true;
  const others = ctx.present.filter(
    (o) =>
      o.worker.id !== e.worker.id &&
      !used.has(o.worker.id) &&
      o.lineId === e.lineId &&
      (o.stationId === st.id || o.also.includes(st.id)) &&
      qualified(o.worker, st) &&
      covers(o.rel, window),
  ).length;
  return others >= st.required;
}

function fill(ctx: Ctx, stationId: string, lineId: string, window: Interval, used: Set<string>, depth: number): Step[][] {
  const st = ctx.stations.get(stationId);
  if (!st) return [];
  const chains: Step[][] = [];

  for (const e of ctx.present) {
    const w = e.worker;
    if (used.has(w.id) || !qualified(w, st) || !covers(e.rel, window)) continue;
    if ((e.stationId === stationId || e.also.includes(stationId)) && e.lineId === lineId) continue;
    if (e.stationId && e.lineId === lineId && canPair(ctx.state, e.stationId, stationId)) {
      chains.push([
        {
          worker: w,
          kind: 'combine',
          fromLineId: e.lineId,
          fromStationId: e.stationId,
          toLineId: lineId,
          toStationId: stationId,
          level: level(w, stationId),
          shiftDate: e.shift.date,
          keepAlso: e.also,
          warnings: [],
        },
      ]);
    }
    const fromStation = e.stationId && ctx.stations.has(e.stationId) ? e.stationId : null;
    const step: Step = {
      worker: w,
      kind: 'reserve',
      fromLineId: e.lineId,
      fromStationId: fromStation,
      toLineId: lineId,
      toStationId: stationId,
      level: level(w, stationId),
      shiftDate: e.shift.date,
      warnings: [],
    };
    if (fromStation === null) {
      chains.push([step]);
    } else if (stillCoveredWithout(ctx, e, used, e.rel)) {
      chains.push([{ ...step, kind: 'surplus' }]);
    } else if (depth > 1) {
      const next = new Set(used).add(w.id);
      // przesunięty pracownik zostawia puste stanowisko na całą swoją zmianę
      const subs = fill(ctx, fromStation, e.lineId, e.rel, next, depth - 1);
      if (subs.length === 0 && depth === MAX_DEPTH) {
        ctx.blocked.push({ worker: w, stationId: fromStation, reason: t('brak zastępcy na jego stanowisku') });
      }
      for (const sub of subs) chains.push([{ ...step, kind: 'move' }, ...sub]);
    }
  }

  for (const w of ctx.state.workers) {
    if (!w.active || used.has(w.id) || ctx.req.excludeIds.includes(w.id) || !qualified(w, st)) continue;
    if (absenceOn(ctx.state, w.id, ctx.req.date)) continue;
    if (ctx.present.some((e) => e.worker.id === w.id)) continue;
    const rest = restCheck(ctx.state, w, ctx.req.date, window);
    if (!rest.ok) continue;
    const hours = window.end - window.start;
    const warnings: string[] = [];
    if (hours > usualHours(ctx.state, w)) warnings.push(t('zmiana {h} h dla pracownika {u} h', { h: hours, u: usualHours(ctx.state, w) }));
    const shift = window.start < 0 ? -1 : window.start >= 24 ? 1 : 0;
    chains.push([
      {
        worker: w,
        kind: 'extra',
        fromLineId: w.lineId,
        fromStationId: null,
        toLineId: lineId,
        toStationId: stationId,
        level: level(w, stationId),
        shiftDate: addDays(ctx.req.date, shift),
        extraShift: { start: window.start - shift * 24, hours },
        missing: ctx.req.missing?.[w.id],
        warnings,
      },
    ]);
  }
  return chains;
}

/** Najlepsze warianty obsadzenia luki, z kaskadą przesunięć do 3 ruchów. */
export function findVariants(state: AppState, req: GapRequest): { variants: Variant[]; blocked: Blocked[] } {
  const present = roster(state, req.date, { start: -24, end: 48 }).filter((e) => !e.absence && !req.excludeIds.includes(e.worker.id));
  const ctx: Ctx = {
    state,
    req,
    present,
    stations: new Map(state.stations.map((s) => [s.id, s])),
    blocked: [],
  };
  const chains = fill(ctx, req.stationId, req.lineId, req.window, new Set(req.excludeIds), MAX_DEPTH);
  const variants = chains
    .filter((c) => new Set(c.map((s) => s.worker.id)).size === c.length)
    .map((steps) => ({
      steps,
      score: steps.reduce((a, s) => a + stepCost(s), 0),
      moves: steps.length,
      extras: steps.filter((s) => s.kind === 'extra').length,
      otherLine: steps.some((s) => s.fromLineId !== s.toLineId),
      agency: steps.some((s) => s.kind === 'extra' && s.worker.type === 'AG'),
      fillsDeficit: steps.some((s) => s.kind === 'extra') && steps.filter((s) => s.kind === 'extra').every((s) => (s.missing ?? 0) > 0),
    }))
    .sort((a, b) => a.score - b.score);

  const picked: Variant[] = [];
  const firstUsed = new Set<string>();
  for (const v of variants) {
    if (firstUsed.has(v.steps[0].worker.id)) continue;
    firstUsed.add(v.steps[0].worker.id);
    picked.push(v);
    if (picked.length === MAX_VARIANTS) break;
  }
  const blockedUnique = ctx.blocked.filter((b, i, arr) => arr.findIndex((x) => x.worker.id === b.worker.id) === i);
  return { variants: picked, blocked: blockedUnique };
}
