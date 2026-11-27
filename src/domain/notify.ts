import { tl } from '../i18n';
import type { Lang } from '../i18n';
import { absenceOn, placement, plannedShift } from './coverage';
import { addDays, fmtHour, weekday, WEEKDAY_SHORT } from './dates';
import type { AppState, Worker } from './types';

export interface Notice {
  workerId: string;
  pl: { title: string; body: string };
  zh: { title: string; body: string };
}

interface DayInfo {
  key: string;
  shift?: { start: number; end: number };
  station?: string | null;
  lineId?: string;
  extra?: boolean;
  also?: string[];
  absence?: string;
}

function dayInfo(state: AppState, w: Worker, date: string): DayInfo {
  const ab = absenceOn(state, w.id, date);
  if (ab) return { key: `A:${ab.reason}`, absence: ab.reason };
  const s = plannedShift(state, w, date);
  if (!s) return { key: 'W' };
  const pl = placement(state, w, date);
  const st = pl.stationId;
  return { key: `${s.start}-${s.end}@${pl.lineId}:${[st ?? '', ...pl.also].join('+')}`, shift: { start: s.start, end: s.end }, station: st, lineId: pl.lineId, extra: s.extra, also: pl.also };
}

function describe(l: Lang, state: AppState, d: DayInfo, w: Worker): string {
  if (d.absence) return tl(l, d.absence === 'UW' ? 'Urlop' : d.absence === 'L4' ? 'L4' : 'Inne');
  if (!d.shift) return tl(l, 'wolne');
  const range = `${fmtHour(d.shift.start).slice(0, 2)}–${fmtHour(d.shift.end).slice(0, 2)}`;
  const name = (id: string) => state.stations.find((x) => x.id === id)?.name ?? '?';
  const st = d.station ? [d.station, ...(d.also ?? [])].map(name).join(' + ') : undefined;
  // na innej linii niż własna pracownik musi wiedzieć, dokąd idzie
  const line = d.lineId && d.lineId !== w.lineId ? `${state.lines.find((x) => x.id === d.lineId)?.name ?? ''}: ` : '';
  const extra = d.extra ? ` (${tl(l, 'dodatkowa zmiana')})` : '';
  return `${range} ${line}${st ?? ''}${extra}`.replace(/\s+/g, ' ').trim();
}

function dayLabel(l: Lang, date: string): string {
  return `${tl(l, WEEKDAY_SHORT[weekday(date)])} ${date.slice(8)}.${date.slice(5, 7)}`;
}

/**
 * Porównuje grafik pracowników przed i po zmianie w oknie [from, from + days)
 * i zwraca treść powiadomień dla każdego, komu coś się zmieniło.
 */
export function scheduleNotices(prev: AppState, next: AppState, from: string, days = 14): Notice[] {
  const out: Notice[] = [];
  for (const w of next.workers) {
    if (!w.active || !w.email) continue;
    const old = prev.workers.find((x) => x.id === w.id);
    if (!old) continue;
    const changes: { date: string; before: DayInfo; after: DayInfo }[] = [];
    for (let i = 0; i < days; i++) {
      const d = addDays(from, i);
      const before = dayInfo(prev, old, d);
      const after = dayInfo(next, w, d);
      if (before.key !== after.key) changes.push({ date: d, before, after });
    }
    if (!changes.length) continue;
    const msg = (l: Lang) => {
      const lines = changes.slice(0, 4).map((c) => `${dayLabel(l, c.date)}: ${describe(l, prev, c.before, old)} → ${describe(l, next, c.after, w)}`);
      if (changes.length > 4) lines.push(tl(l, 'i jeszcze {n} zmian', { n: changes.length - 4 }));
      return { title: tl(l, 'Zmiana grafiku'), body: lines.join('\n') };
    };
    out.push({ workerId: w.id, pl: msg('pl'), zh: msg('zh') });
  }
  return out;
}

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** 6-znakowy kod aktywacyjny bez mylących znaków (0/O, 1/I). */
export function inviteCode(): string {
  const a = new Uint32Array(6);
  crypto.getRandomValues(a);
  return Array.from(a, (x) => CODE_CHARS[x % CODE_CHARS.length]).join('');
}
