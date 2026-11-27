import { describe, expect, it } from 'vitest';
import { monthDays } from './dates';
import { plannedShift } from './coverage';
import { attendanceRows, shiftComparison, sumRows, topAbsences, transfers, trend } from './stats';
import { demoState } from './seed';
import type { AppState } from './types';

const M = '2026-12';
const all = (s: AppState) => s.lines.map((l) => l.id);

describe('statystyki', () => {
  it('plan = zmiany z grafiku, a nieobecność w dzień pracy zmniejsza obecność i liczy utracone godziny', () => {
    const s = demoState();
    const w = s.workers.find((x) => x.active && x.patternId === 'p8')!;
    const day = monthDays(M).find((d) => plannedShift(s, w, d))!;
    const before = sumRows(attendanceRows(s, M, all(s)));
    s.absences.push({ id: 'a-test', workerId: w.id, from: day, to: day, reason: 'L4' });
    const after = sumRows(attendanceRows(s, M, all(s)));
    expect(after.planned).toBe(before.planned);
    expect(after.absent).toBe(before.absent + 1);
    expect(after.present).toBe(before.present - 1);
    expect(after.byReason.L4).toBe((before.byReason.L4 ?? 0) + 1);
    expect(after.lostHours).toBe(before.lostHours + 8);
  });

  it('nieobecność w dzień wolny nie liczy się do statystyk', () => {
    const s = demoState();
    const w = s.workers.find((x) => x.active && x.patternId === 'p8')!;
    const off = monthDays(M).find((d) => !plannedShift(s, w, d))!;
    const before = sumRows(attendanceRows(s, M, all(s)));
    s.absences.push({ id: 'a-off', workerId: w.id, from: off, to: off, reason: 'UW' });
    expect(sumRows(attendanceRows(s, M, all(s))).absent).toBe(before.absent);
  });

  it('porównanie zmian: obsada i luki zależą od nieobecności', () => {
    const s = demoState();
    const base = shiftComparison(s, M, all(s));
    expect(base.length).toBeGreaterThan(0);
    for (const c of base) {
      expect(c.workDays).toBeGreaterThan(0);
      expect(c.absentRate).toBeGreaterThanOrEqual(0);
    }
    // wszyscy z jednej linii na L4 przez cały miesiąc → absentRate tej linii rośnie do 100%
    const line = base[0].lineId;
    for (const w of s.workers.filter((x) => x.lineId === line)) s.absences.push({ id: `a-${w.id}`, workerId: w.id, from: `${M}-01`, to: `${M}-31`, reason: 'L4' });
    const after = shiftComparison(s, M, all(s)).filter((c) => c.lineId === line);
    expect(after.every((c) => c.absentRate === 1 && c.avgPresent === 0)).toBe(true);
  });

  it('przeniesienia: dzień na innej linii niż własna jest widoczny, własna linia nie', () => {
    const s = demoState();
    const w = s.workers.find((x) => x.active && x.patternId === 'p8')!;
    const other = s.lines.find((l) => l.id !== w.lineId)!;
    const day = monthDays(M).find((d) => plannedShift(s, w, d))!;
    expect(transfers(s, M, all(s))).toHaveLength(0);
    s.assignments.push({ id: 'as-t', date: day, workerId: w.id, lineId: other.id, stationId: null, source: 'manual' });
    const t = transfers(s, M, all(s));
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ workerId: w.id, to: other.name, days: 1 });
  });

  it('trend zwraca 6 miesięcy kończących się na wybranym, a lista nieobecnych jest posortowana', () => {
    const s = demoState();
    const tr = trend(s, '2026-02', all(s));
    expect(tr.map((p) => p.month)).toEqual(['2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02']);
    const w1 = s.workers[0];
    const w2 = s.workers[1];
    s.absences.push({ id: 'x1', workerId: w1.id, from: `${M}-01`, to: `${M}-31`, reason: 'L4' });
    s.absences.push({ id: 'x2', workerId: w2.id, from: `${M}-01`, to: `${M}-03`, reason: 'UW' });
    const top = topAbsences(s, M, all(s));
    for (let i = 1; i < top.length; i++) expect(top[i - 1].days).toBeGreaterThanOrEqual(top[i].days);
  });
});

import { overtime, punctuality, skillRisk, weekdayAbsences } from './stats';
import { buildStatsWorkbook } from './statsExport';

describe('statystyki — rozszerzenia', () => {
  it('ryzyko: brygada z jedną wykwalifikowaną osobą na stanowisku z wymogiem 1 to „brak zastępcy”, a bez nikogo „brak obsady”', () => {
    const s = demoState();
    const st = s.stations[0];
    const ws = s.workers.filter((w) => w.active && w.lineId === st.lineId && w.brigade === 'A');
    for (const w of ws) w.skills[st.id] = { level: 0 } as never;
    ws[0].skills[st.id] = { level: 4 } as never;
    const r = skillRisk(s, [st.lineId]).find((x) => x.stationName === st.name && x.brigade === 'A')!;
    expect(r.qualified).toBe(1);
    if (st.required === 1) expect(r.risk).toBe('sole');
    ws[0].skills[st.id] = { level: 0 } as never;
    const none = skillRisk(s, [st.lineId]).find((x) => x.stationName === st.name && x.brigade === 'A')!;
    expect(none.risk).toBe('none');
  });

  it('godziny: norma miesiąca i godziny ponad normę liczone z grafiku', () => {
    const s = demoState();
    const rows = overtime(s, M, all(s));
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.totalHours).toBe(r.plannedHours + r.extraHours);
      expect(r.overHours).toBe(Math.max(0, r.totalHours - r.normHours));
    }
  });

  it('dni tygodnia: suma planu zgadza się z obecnością, a nieobecność trafia w swój dzień', () => {
    const s = demoState();
    const base = weekdayAbsences(s, M, all(s));
    expect(base.reduce((n, r) => n + r.planned, 0)).toBe(sumRows(attendanceRows(s, M, all(s))).planned);
    const w = s.workers.find((x) => x.active && x.patternId === 'p8')!;
    const day = monthDays(M).find((d) => plannedShift(s, w, d))!;
    s.absences.push({ id: 'a-dow', workerId: w.id, from: day, to: day, reason: 'UW' });
    const after = weekdayAbsences(s, M, all(s));
    expect(after.reduce((n, r) => n + r.absent, 0)).toBe(base.reduce((n, r) => n + r.absent, 0) + 1);
  });

  it('RCP: dni bez odbić z przeszłości to „brak odbicia”, bez odbić w ogóle brak wierszy w przyszłości', () => {
    const s = demoState();
    const rows = punctuality(s, '2020-01', all(s), []);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].missing).toBeGreaterThan(0);
    expect(punctuality(s, '2999-01', all(s), [])).toHaveLength(0);
  });

  it('eksport statystyk to poprawny zip xlsx z arkuszami', () => {
    const bytes = buildStatsWorkbook(demoState(), M, 'Cały zakład', all(demoState()));
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
    expect(new TextDecoder('latin1').decode(bytes)).toContain('xl/worksheets/sheet7.xml');
  });
});
