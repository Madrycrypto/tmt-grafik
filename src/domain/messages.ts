import { absenceOn, assignmentOn, plannedShift } from './coverage';
import { fmtHour } from './dates';
import type { AppState, BrigadeId, Worker } from './types';

/** Do kogo idzie wiadomość. */
export type Audience =
  | { kind: 'all' }
  | { kind: 'group'; group: string }
  | { kind: 'line'; lineId: string; brigade?: BrigadeId }
  | { kind: 'shift'; date: string; start: number; lineId?: string }
  | { kind: 'workers'; ids: string[] };

/** Linia, na której pracownik jest danego dnia (zmiana dodatkowa może być na innej linii). */
function lineOn(state: AppState, w: Worker, date: string): string {
  return assignmentOn(state, w.id, date)?.lineId ?? w.lineId;
}

function groupOf(state: AppState, lineId: string): string {
  const l = state.lines.find((x) => x.id === lineId);
  return l?.group || l?.name || '';
}

/** Aktywni pracownicy, do których trafi wiadomość. */
export function recipients(state: AppState, aud: Audience): Worker[] {
  const active = state.workers.filter((w) => w.active);
  switch (aud.kind) {
    case 'all':
      return active;
    case 'group':
      return active.filter((w) => groupOf(state, w.lineId) === aud.group);
    case 'line':
      return active.filter((w) => w.lineId === aud.lineId && (!aud.brigade || w.brigade === aud.brigade));
    case 'workers': {
      const ids = new Set(aud.ids);
      return active.filter((w) => ids.has(w.id));
    }
    case 'shift':
      return active.filter((w) => {
        if (absenceOn(state, w.id, aud.date)) return false;
        const s = plannedShift(state, w, aud.date);
        return !!s && s.start === aud.start && (!aud.lineId || lineOn(state, w, aud.date) === aud.lineId);
      });
  }
}

export interface ShiftOption {
  start: number;
  end: number;
  count: number;
}

/** Zmiany, które danego dnia ktoś faktycznie pracuje (bez nieobecnych), od najwcześniejszej. */
export function shiftOptions(state: AppState, date: string, lineId?: string): ShiftOption[] {
  const by = new Map<number, ShiftOption>();
  for (const w of state.workers) {
    if (!w.active || absenceOn(state, w.id, date)) continue;
    const s = plannedShift(state, w, date);
    if (!s || (lineId && lineOn(state, w, date) !== lineId)) continue;
    const o = by.get(s.start) ?? { start: s.start, end: s.end, count: 0 };
    o.count++;
    o.end = Math.max(o.end, s.end);
    by.set(s.start, o);
  }
  return [...by.values()].sort((a, b) => a.start - b.start);
}

export function shiftRange(start: number, end: number): string {
  return `${fmtHour(start).slice(0, 2)}–${fmtHour(end).slice(0, 2)}`;
}

/** Krótki opis adresatów zapisywany przy wiadomości (np. „Linia Moduły · brygada A”). */
export function audienceLabel(state: AppState, aud: Audience): string {
  const line = (id: string) => state.lines.find((l) => l.id === id)?.name ?? id;
  switch (aud.kind) {
    case 'all':
      return 'Wszyscy';
    case 'group':
      return `${aud.group} — cała grupa`;
    case 'line':
      return `Linia ${line(aud.lineId)}${aud.brigade ? ` · brygada ${aud.brigade}` : ''}`;
    case 'shift': {
      const o = shiftOptions(state, aud.date, aud.lineId).find((x) => x.start === aud.start);
      const range = o ? shiftRange(o.start, o.end) : fmtHour(aud.start).slice(0, 2);
      return `Zmiana ${range} · ${aud.date.slice(8)}.${aud.date.slice(5, 7)}${aud.lineId ? ` · ${line(aud.lineId)}` : ''}`;
    }
    case 'workers': {
      const ws = recipients(state, aud);
      return ws.length === 1 ? ws[0].name : `${ws.length} wybranych osób`;
    }
  }
}

export interface Message {
  id: string;
  created_at: string;
  author: string;
  title: string | null;
  body: string;
  audience: string;
  worker_ids: string[];
  important: boolean;
}

export interface MessageRead {
  message_id: string;
  worker_id: string;
  read_at: string;
}
