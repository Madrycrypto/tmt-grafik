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
  state.assignments.push({ ...a, ...(shift ? { shift } : {}), id: uid('as') });
}

/** Ten dzień z inną długością zmiany (np. 12 h zamiast 8 h); null przywraca godziny z grafiku. */
export function setDayHours(state: AppState, w: Worker, date: string, hours: number | null, base: { start: number; hours: number }, place: { lineId: string; stationId: string | null }): void {
  const old = state.assignments.find((x) => x.workerId === w.id && x.date === date);
  state.assignments = state.assignments.filter((x) => x !== old);
  const moved = old && (old.stationId !== w.homeStationId || old.lineId !== w.lineId);
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
