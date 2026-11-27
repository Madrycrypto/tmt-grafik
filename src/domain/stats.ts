import { absenceOn, lineStatus, placement, plannedShift, qualified } from './coverage';
import { monthDays, todayIso, weekday } from './dates';
import { monthNorm } from './norm';
import { checkDay } from './punches';
import type { Punch } from './punches';
import { shiftDef } from './rota';
import type { AppState, Worker } from './types';

/** Zakres linii: lista id linii, których dotyczą statystyki. */
export type LineScope = string[];

const hoursOf = (s: { start: number; end: number }) => s.end - s.start;

export interface AttendanceRow {
  key: string;
  label: string;
  people: number;
  /** zmiany zaplanowane w grafiku (osobodni) */
  planned: number;
  absent: number;
  present: number;
  absentRate: number;
  byReason: Record<string, number>;
  plannedHours: number;
  /** godziny zaplanowane, których nie przepracowano z powodu nieobecności */
  lostHours: number;
  extraShifts: number;
  extraHours: number;
  /** dni pracy poza własną linią lub stanowiskiem */
  movedDays: number;
  /** wynik z odbić RCP (tylko dni do dzisiaj, gdy są odbicia) */
  rcp?: { checked: number; ok: number; late: number; early: number; missing: number; lateMin: number };
}

function emptyRow(key: string, label: string): AttendanceRow {
  return { key, label, people: 0, planned: 0, absent: 0, present: 0, absentRate: 0, byReason: {}, plannedHours: 0, lostHours: 0, extraShifts: 0, extraHours: 0, movedDays: 0 };
}

function inScope(w: Worker, lines: LineScope): boolean {
  return w.active && lines.includes(w.lineId);
}

/** Obecność według linii i brygady (według grafiku, a przy podanych odbiciach także RCP). */
export function attendanceRows(state: AppState, month: string, lines: LineScope, punches?: Punch[]): AttendanceRow[] {
  const days = monthDays(month);
  const today = todayIso();
  const rows = new Map<string, AttendanceRow>();
  const lineName = (id: string) => state.lines.find((l) => l.id === id)?.name ?? id;
  for (const w of state.workers.filter((x) => inScope(x, lines))) {
    const key = `${w.lineId}|${w.brigade}`;
    let r = rows.get(key);
    if (!r) {
      r = emptyRow(key, `${lineName(w.lineId)} · ${w.brigade}`);
      rows.set(key, r);
    }
    r.people++;
    for (const d of days) {
      const sh = plannedShift(state, w, d);
      if (!sh) continue;
      if (sh.extra) {
        // dodatkowa zmiana nie jest planem brygady, tylko osobno liczoną pracą ponad grafik
        if (!absenceOn(state, w.id, d)) {
          r.extraShifts++;
          r.extraHours += hoursOf(sh);
        }
        continue;
      }
      const h = hoursOf(sh);
      r.planned++;
      r.plannedHours += h;
      const ab = absenceOn(state, w.id, d);
      if (ab) {
        r.absent++;
        r.lostHours += h;
        r.byReason[ab.reason] = (r.byReason[ab.reason] ?? 0) + 1;
      } else {
        r.present++;
        if (placement(state, w, d).moved) r.movedDays++;
      }
      if (punches && d < today) {
        const c = checkDay(state, w, d, punches);
        if (c.plan && !c.absence) {
          r.rcp ??= { checked: 0, ok: 0, late: 0, early: 0, missing: 0, lateMin: 0 };
          r.rcp.checked++;
          if (c.status === 'ok') r.rcp.ok++;
          if (c.lateMin) {
            r.rcp.late++;
            r.rcp.lateMin += c.lateMin;
          }
          if (c.earlyMin) r.rcp.early++;
          if (c.status === 'missing') r.rcp.missing++;
        }
      }
    }
  }
  const out = [...rows.values()];
  for (const r of out) r.absentRate = r.planned ? r.absent / r.planned : 0;
  return out.sort((a, b) => a.label.localeCompare(b.label, 'pl'));
}

export function sumRows(rows: AttendanceRow[], label = 'Razem'): AttendanceRow {
  const t = emptyRow('total', label);
  for (const r of rows) {
    t.people += r.people;
    t.planned += r.planned;
    t.absent += r.absent;
    t.present += r.present;
    t.plannedHours += r.plannedHours;
    t.lostHours += r.lostHours;
    t.extraShifts += r.extraShifts;
    t.extraHours += r.extraHours;
    t.movedDays += r.movedDays;
    for (const [k, v] of Object.entries(r.byReason)) t.byReason[k] = (t.byReason[k] ?? 0) + v;
    if (r.rcp) {
      t.rcp ??= { checked: 0, ok: 0, late: 0, early: 0, missing: 0, lateMin: 0 };
      for (const k of Object.keys(r.rcp) as (keyof NonNullable<AttendanceRow['rcp']>)[]) t.rcp[k] += r.rcp[k];
    }
  }
  t.absentRate = t.planned ? t.absent / t.planned : 0;
  return t;
}

export interface ShiftCompare {
  lineId: string;
  lineName: string;
  code: string;
  label: string;
  /** godziny zmiany, np. „07–15” */
  window: string;
  workDays: number;
  avgScheduled: number;
  avgPresent: number;
  absentRate: number;
  /** suma wymaganych osób na stanowiskach linii (0 = linia bez stanowisk) */
  required: number;
  /** dni, w których przynajmniej jedno stanowisko nie miało wymaganej obsady kwalifikowanej */
  gapDays: number;
  /** liczba stanowisk bez wymaganej obsady, zsumowana po dniach */
  gapStationDays: number;
  /** dni, w których jakieś stanowisko miało tylko jedną kwalifikowaną osobę (brak zastępcy) */
  soleDays: number;
  extraShifts: number;
}

/** Porównanie zmian (R / P / N) na każdej linii zakresu: obsada, nieobecności, luki. */
export function shiftComparison(state: AppState, month: string, lines: LineScope): ShiftCompare[] {
  const days = monthDays(month);
  const out: ShiftCompare[] = [];
  for (const lineId of lines) {
    const line = state.lines.find((l) => l.id === lineId);
    if (!line) continue;
    const stations = state.stations.filter((s) => s.lineId === lineId);
    const required = stations.reduce((s, x) => s + x.required, 0);
    const codes = new Set<string>();
    for (const w of state.workers) {
      if (!w.active || w.lineId !== lineId) continue;
      for (const d of days) {
        const c = plannedShift(state, w, d)?.code;
        if (c) codes.add(c);
      }
    }
    for (const code of [...codes].sort((a, b) => (shiftDef(state, a)?.start ?? 0) - (shiftDef(state, b)?.start ?? 0))) {
      const def = shiftDef(state, code);
      if (!def) continue;
      const window = { start: def.start, end: def.start + def.hours };
      let workDays = 0;
      let scheduled = 0;
      let present = 0;
      let gapDays = 0;
      let gapStationDays = 0;
      let soleDays = 0;
      let extra = 0;
      for (const d of days) {
        const st = lineStatus(state, lineId, d, window);
        const mine = st.entries.filter((e) => e.shift.code === code && !e.shift.extra);
        extra += st.entries.filter((e) => e.shift.extra && !e.absence && e.rel.start >= window.start - 1 && e.rel.start <= window.end - 1).length;
        if (!mine.length) continue;
        workDays++;
        scheduled += mine.length;
        present += mine.filter((e) => !e.absence).length;
        const gaps = st.statuses.filter((s) => !s.ok).length;
        if (gaps) gapDays++;
        gapStationDays += gaps;
        if (st.statuses.some((s) => s.soleQualified)) soleDays++;
      }
      if (!workDays) continue;
      out.push({
        lineId,
        lineName: line.name,
        code,
        label: def.label,
        window: `${String(def.start % 24).padStart(2, '0')}–${String((def.start + def.hours) % 24).padStart(2, '0')}`,
        workDays,
        avgScheduled: scheduled / workDays,
        avgPresent: present / workDays,
        absentRate: scheduled ? 1 - present / scheduled : 0,
        required,
        gapDays: stations.length ? gapDays : 0,
        gapStationDays: stations.length ? gapStationDays : 0,
        soleDays: stations.length ? soleDays : 0,
        extraShifts: extra,
      });
    }
  }
  return out;
}

export interface TransferRow {
  workerId: string;
  name: string;
  from: string;
  to: string;
  days: number;
  /** stanowiska, na których pracował poza własnym (nazwy) */
  stations: string[];
}

/** Dni pracy na innej linii niż własna — widać to bez osobnego zgłaszania przeniesień. */
export function transfers(state: AppState, month: string, lines: LineScope): TransferRow[] {
  const map = new Map<string, TransferRow>();
  const lineName = (id: string) => state.lines.find((l) => l.id === id)?.name ?? id;
  for (const a of state.assignments) {
    if (!a.date.startsWith(month)) continue;
    const w = state.workers.find((x) => x.id === a.workerId);
    if (!w || a.lineId === w.lineId) continue;
    if (!lines.includes(w.lineId) && !lines.includes(a.lineId)) continue;
    if (absenceOn(state, w.id, a.date)) continue;
    const key = `${w.id}|${a.lineId}`;
    const r = map.get(key) ?? { workerId: w.id, name: w.name, from: lineName(w.lineId), to: lineName(a.lineId), days: 0, stations: [] };
    r.days++;
    const sn = state.stations.find((s) => s.id === a.stationId)?.name;
    if (sn && !r.stations.includes(sn)) r.stations.push(sn);
    map.set(key, r);
  }
  return [...map.values()].sort((a, b) => b.days - a.days || a.name.localeCompare(b.name, 'pl'));
}

export interface PersonAbsence {
  workerId: string;
  name: string;
  line: string;
  days: number;
  byReason: Record<string, number>;
}

/** Osoby z największą liczbą nieobecności w zaplanowane dni pracy. */
export function topAbsences(state: AppState, month: string, lines: LineScope, limit = 8): PersonAbsence[] {
  const days = monthDays(month);
  const out: PersonAbsence[] = [];
  for (const w of state.workers.filter((x) => inScope(x, lines))) {
    const by: Record<string, number> = {};
    let n = 0;
    for (const d of days) {
      if (!plannedShift(state, w, d)) continue;
      const ab = absenceOn(state, w.id, d);
      if (!ab) continue;
      n++;
      by[ab.reason] = (by[ab.reason] ?? 0) + 1;
    }
    if (n) out.push({ workerId: w.id, name: w.name, line: state.lines.find((l) => l.id === w.lineId)?.name ?? '', days: n, byReason: by });
  }
  return out.sort((a, b) => b.days - a.days || a.name.localeCompare(b.name, 'pl')).slice(0, limit);
}

export interface TrendPoint {
  month: string;
  absentRate: number;
  extraHours: number;
  lostHours: number;
}

/** Ostatnie n miesięcy (włącznie z wybranym): odsetek nieobecności i godziny dodatkowe. */
export function trend(state: AppState, month: string, lines: LineScope, n = 6): TrendPoint[] {
  const out: TrendPoint[] = [];
  let [y, m] = month.split('-').map(Number);
  for (let i = 0; i < n; i++) {
    const mm = `${y}-${String(m).padStart(2, '0')}`;
    const t = sumRows(attendanceRows(state, mm, lines));
    out.unshift({ month: mm, absentRate: t.absentRate, extraHours: t.extraHours, lostHours: t.lostHours });
    m--;
    if (m === 0) {
      m = 12;
      y--;
    }
  }
  return out;
}

export interface RiskRow {
  lineName: string;
  stationName: string;
  special: boolean;
  brigade: string;
  required: number;
  /** liczba aktywnych osób z wymaganym poziomem w tej brygadzie */
  qualified: number;
  names: string[];
  /** none = nikt (stanowisko nie do obsadzenia), sole = tylko tyle, ile wymaga stanowisko (brak zastępcy) */
  risk: 'none' | 'sole';
}

/** Mapa ryzyka kompetencji: stanowiska, na których brygada nie ma zastępcy (lub nikogo). */
export function skillRisk(state: AppState, lines: LineScope): RiskRow[] {
  const out: RiskRow[] = [];
  for (const lineId of lines) {
    const line = state.lines.find((l) => l.id === lineId);
    if (!line) continue;
    const brigades = [...new Set(state.workers.filter((w) => w.active && w.lineId === lineId).map((w) => w.brigade))].sort();
    for (const st of state.stations.filter((x) => x.lineId === lineId).sort((a, b) => a.order - b.order)) {
      for (const b of brigades) {
        const q = state.workers.filter((w) => w.active && w.lineId === lineId && w.brigade === b && qualified(w, st));
        if (q.length > st.required) continue;
        out.push({
          lineName: line.name,
          stationName: st.name,
          special: !!st.special,
          brigade: b,
          required: st.required,
          qualified: q.length,
          names: q.map((w) => w.name),
          risk: q.length < st.required ? 'none' : 'sole',
        });
      }
    }
  }
  // najpierw braki całkowite, potem stanowiska specjalne
  return out.sort((a, b) => Number(a.risk === 'sole') - Number(b.risk === 'sole') || Number(b.special) - Number(a.special) || a.lineName.localeCompare(b.lineName, 'pl'));
}

export interface OvertimeRow {
  workerId: string;
  name: string;
  line: string;
  brigade: string;
  /** godziny zaplanowane w grafiku (także w dni nieobecności — liczą się do normy) */
  plannedHours: number;
  extraHours: number;
  totalHours: number;
  normHours: number;
  /** godziny ponad normę miesiąca (0, gdy w normie) */
  overHours: number;
}

/** Godziny każdej osoby na tle normy miesiąca; ponad normę = nadgodziny. */
export function overtime(state: AppState, month: string, lines: LineScope): OvertimeRow[] {
  const days = monthDays(month);
  const norm = monthNorm(month).hours;
  const out: OvertimeRow[] = [];
  for (const w of state.workers.filter((x) => inScope(x, lines))) {
    let planned = 0;
    let extra = 0;
    for (const d of days) {
      const sh = plannedShift(state, w, d);
      if (!sh) continue;
      if (sh.extra) {
        if (!absenceOn(state, w.id, d)) extra += hoursOf(sh);
      } else planned += hoursOf(sh);
    }
    const total = planned + extra;
    if (!total) continue;
    out.push({
      workerId: w.id,
      name: w.name,
      line: state.lines.find((l) => l.id === w.lineId)?.name ?? '',
      brigade: w.brigade,
      plannedHours: planned,
      extraHours: extra,
      totalHours: total,
      normHours: norm,
      overHours: Math.max(0, total - norm),
    });
  }
  return out.sort((a, b) => b.overHours - a.overHours || b.extraHours - a.extraHours || a.name.localeCompare(b.name, 'pl'));
}

export interface PunctualRow {
  workerId: string;
  name: string;
  line: string;
  checked: number;
  late: number;
  lateMin: number;
  early: number;
  missing: number;
}

/** Punktualność z odbić RCP, osobno dla każdej osoby (tylko dni do dzisiaj). */
export function punctuality(state: AppState, month: string, lines: LineScope, punches: Punch[]): PunctualRow[] {
  const today = todayIso();
  const out: PunctualRow[] = [];
  for (const w of state.workers.filter((x) => inScope(x, lines))) {
    const r: PunctualRow = { workerId: w.id, name: w.name, line: state.lines.find((l) => l.id === w.lineId)?.name ?? '', checked: 0, late: 0, lateMin: 0, early: 0, missing: 0 };
    for (const d of monthDays(month)) {
      if (d >= today) break;
      const c = checkDay(state, w, d, punches);
      if (!c.plan || c.absence || c.plan.extra) continue;
      r.checked++;
      if (c.lateMin) {
        r.late++;
        r.lateMin += c.lateMin;
      }
      if (c.earlyMin) r.early++;
      if (c.status === 'missing') r.missing++;
    }
    if (r.checked && (r.late || r.early || r.missing)) out.push(r);
  }
  return out.sort((a, b) => b.late + b.early + b.missing - (a.late + a.early + a.missing) || b.lateMin - a.lateMin);
}

export interface WeekdayRow {
  /** 1 = poniedziałek … 7 = niedziela */
  dow: number;
  planned: number;
  absent: number;
  absentRate: number;
}

/** Nieobecności według dnia tygodnia — poniedziałki i piątki zwykle zdradzają problem pierwsze. */
export function weekdayAbsences(state: AppState, month: string, lines: LineScope): WeekdayRow[] {
  const rows: WeekdayRow[] = [1, 2, 3, 4, 5, 6, 7].map((dow) => ({ dow, planned: 0, absent: 0, absentRate: 0 }));
  for (const w of state.workers.filter((x) => inScope(x, lines))) {
    for (const d of monthDays(month)) {
      const sh = plannedShift(state, w, d);
      if (!sh || sh.extra) continue;
      const r = rows[(weekday(d) + 6) % 7];
      r.planned++;
      if (absenceOn(state, w.id, d)) r.absent++;
    }
  }
  for (const r of rows) r.absentRate = r.planned ? r.absent / r.planned : 0;
  return rows.filter((r) => r.planned);
}
