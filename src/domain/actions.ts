import type { Variant } from './replacement';
import { stretch } from './coverage';
import type { AbsenceReason, AppState, Assignment, Worker } from './types';

export function uid(prefix = ''): string {
  return prefix + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export function log(state: AppState, user: string, text: string): void {
  state.history.unshift({ id: uid('h'), at: new Date().toISOString(), user, text });
  if (state.history.length > 500) state.history.length = 500;
}

export function setAssignment(state: AppState, a: Omit<Assignment, 'id'>): void {
  const old = state.assignments.find((x) => x.workerId === a.workerId && x.date === a.date);
  state.assignments = state.assignments.filter((x) => x !== old);
  // przesunięcie na inne stanowisko nie kasuje zmienionych godzin tego dnia
  const shift = a.shift ?? (a.extraShift ? undefined : old?.shift);
  const also = a.alsoStationIds ?? (old && old.stationId === a.stationId ? old.alsoStationIds : undefined);
  state.assignments.push({ ...a, ...(shift ? { shift } : {}), ...(also ? { alsoStationIds: also } : {}), id: uid('as') });
}

/** Na ten dzień pracownik obsługuje (lub przestaje obsługiwać) dodatkowe stanowisko obok swojego. */
export function setCombined(state: AppState, w: Worker, date: string, place: { lineId: string; stationId: string; also: string[] }, stationId: string, on: boolean): void {
  const also = on ? [...new Set([...place.also, stationId])] : place.also.filter((x) => x !== stationId);
  setAssignment(state, { date, workerId: w.id, lineId: place.lineId, stationId: place.stationId, alsoStationIds: also, source: 'manual' });
}

/** Ten dzień z inną długością zmiany (np. 12 h zamiast 8 h); null przywraca godziny z grafiku. */
export function setDayHours(state: AppState, w: Worker, date: string, hours: number | null, base: { start: number; hours: number }, place: { lineId: string; stationId: string | null }): void {
  const old = state.assignments.find((x) => x.workerId === w.id && x.date === date);
  state.assignments = state.assignments.filter((x) => x !== old);
  const moved = old && (old.stationId !== w.homeStationId || old.lineId !== w.lineId || old.alsoStationIds !== undefined);
  if (hours === null) {
    if (moved) state.assignments.push({ ...old!, shift: undefined, id: uid('as') });
    return;
  }
  const [start, end] = stretch(base.start, base.hours, hours);
  state.assignments.push({
    id: uid('as'),
    date,
    workerId: w.id,
    lineId: place.lineId,
    stationId: place.stationId,
    shift: { start, hours: end - start },
    ...(old?.alsoStationIds ? { alsoStationIds: old.alsoStationIds } : {}),
    source: old?.source ?? 'manual',
  });
}

export function addAbsence(state: AppState, workerId: string, date: string, reason: AbsenceReason, to = date): void {
  const exists = state.absences.some((a) => a.workerId === workerId && a.from <= date && date <= a.to);
  if (!exists) state.absences.push({ id: uid('ab'), workerId, from: date, to, reason });
}

export function stationName(state: AppState, id: string | null): string {
  if (!id) return 'rezerwa';
  return state.stations.find((s) => s.id === id)?.name ?? '?';
}

export function lineName(state: AppState, id: string): string {
  return state.lines.find((l) => l.id === id)?.name ?? '?';
}

export function describeStep(state: AppState, s: Variant['steps'][number]): string {
  if (s.kind === 'combine') return `${s.worker.name}: ${stationName(state, s.fromStationId)} + ${stationName(state, s.toStationId)}`;
  const from = s.kind === 'extra' ? 'wolne (dodatkowa zmiana)' : stationName(state, s.fromStationId);
  const line = s.fromLineId !== s.toLineId ? ` [${lineName(state, s.fromLineId)} → ${lineName(state, s.toLineId)}]` : '';
  return `${s.worker.name}: ${from} → ${stationName(state, s.toStationId)}${line}`;
}

export function applyVariant(
  state: AppState,
  user: string,
  v: Variant,
  absent?: { worker: Worker; date: string; reason: AbsenceReason },
): void {
  if (absent) addAbsence(state, absent.worker.id, absent.date, absent.reason);
  for (const s of v.steps) {
    if (s.kind === 'combine' && s.fromStationId) {
      setCombined(state, s.worker, s.shiftDate, { lineId: s.fromLineId, stationId: s.fromStationId, also: s.keepAlso ?? [] }, s.toStationId, true);
      continue;
    }
    setAssignment(state, {
      date: s.shiftDate,
      workerId: s.worker.id,
      lineId: s.toLineId,
      stationId: s.toStationId,
      extraShift: s.extraShift,
      source: 'replacement',
    });
  }
  const head = absent ? `Brak: ${absent.worker.name} (${absent.date}, ${absent.reason}). ` : 'Uzupełnienie obsady. ';
  log(state, user, head + v.steps.map((s) => describeStep(state, s)).join('; '));
}
