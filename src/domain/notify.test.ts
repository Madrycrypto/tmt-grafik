import { describe, expect, it } from 'vitest';
import { setAssignment } from './actions';
import { monthDays } from './dates';
import { hrSummary, hrStationsCsv } from './hrExport';
import { inviteCode, scheduleNotices } from './notify';
import { findVariants } from './replacement';
import { applyVariant } from './actions';
import { lineStatus } from './coverage';
import { rotaCell } from './rota';
import { demoState } from './seed';

describe('powiadomienia o zmianie grafiku', () => {
  it('przesunięcie na inne stanowisko daje powiadomienie tylko temu pracownikowi (z e-mailem)', () => {
    const prev = demoState();
    prev.workers.forEach((w, i) => (w.email = `w${i}@x.pl`));
    const next = structuredClone(prev);
    const w = next.workers.find((x) => x.homeStationId === 'hvac1-s1')!;
    const day = monthDays('2026-12').find((d) => rotaCell(next, w.patternId, w.brigade, d).status === 'work')!;
    setAssignment(next, { date: day, workerId: w.id, lineId: w.lineId, stationId: 'hvac1-s2', source: 'manual' });
    const n = scheduleNotices(prev, next, '2026-12-01');
    expect(n.map((x) => x.workerId)).toEqual([w.id]);
    expect(n[0].pl.title).toBe('Zmiana grafiku');
    expect(n[0].pl.body).toContain('Lutowanie');
    expect(n[0].zh.title).toBe('排班变更');
  });

  it('bez e-maila nie ma powiadomień; bez zmian nie ma powiadomień', () => {
    const prev = demoState();
    expect(scheduleNotices(prev, structuredClone(prev), '2026-12-01')).toEqual([]);
    const next = structuredClone(prev);
    next.rotaOverrides.push({ id: 'o', patternId: 'p8', brigade: 'A', date: '2026-12-02', code: 'W' });
    expect(scheduleNotices(prev, next, '2026-12-01')).toEqual([]);
  });

  it('kod aktywacyjny: 6 znaków bez 0/O/1/I', () => {
    for (let i = 0; i < 50; i++) expect(inviteCode()).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
  });
});

describe('godziny na stanowiskach (premie)', () => {
  it('zastępca liczy godziny na stanowisku nieobecnego, suma się zgadza', () => {
    const s = demoState();
    const day = '2026-12-02';
    const st = lineStatus(s, 'hvac1', day, { start: 7, end: 15 });
    const gap = st.statuses.find((x) => x.people.length && x.station.name === 'Lutowanie')!;
    const absent = gap.people[0];
    const { variants } = findVariants(s, { date: absent.shift.date, lineId: 'hvac1', stationId: gap.station.id, window: absent.rel, excludeIds: [absent.worker.id] });
    const v = variants.find((x) => x.steps[0].kind !== 'extra') ?? variants[0];
    applyVariant(s, 'test', v, { worker: absent.worker, date: absent.shift.date, reason: 'L4' });
    const sum = hrSummary(s, { month: '2026-12', lineId: 'all', who: 'all', includeInactive: false });
    const sub = sum.find((x) => x.worker.id === v.steps[0].worker.id)!;
    expect(sub.byStation[gap.station.id]).toBeGreaterThan(0);
    expect(Object.keys(sub.byStation).length).toBeGreaterThanOrEqual(2);
    for (const x of sum) expect(Object.values(x.byStation).reduce((a, b) => a + b, 0)).toBe(x.hours);
    expect(hrStationsCsv(s, { month: '2026-12', lineId: 'all', who: 'all', includeInactive: false })).toContain('Lutowanie');
  });
});

describe('mieszane 8 h i 12 h', () => {
  it('stretch: rano zachowuje początek, popołudnie i noc zachowują koniec', async () => {
    const { stretch } = await import('./coverage');
    expect(stretch(7, 8, 12)).toEqual([7, 19]);
    expect(stretch(15, 8, 12)).toEqual([11, 23]);
    expect(stretch(23, 8, 12)).toEqual([19, 31]);
    expect(stretch(7, 8)).toEqual([7, 15]);
  });

  it('pracownik 12 h w systemie 2-zmianowym 8 h pokrywa stanowisko do 19:00; zmiana jednego dnia nie jest dodatkową', async () => {
    const { plannedShift, lineStatus } = await import('./coverage');
    const { setDayHours, setAssignment } = await import('./actions');
    const s = demoState();
    const w = s.workers.find((x) => x.lineId === 'cfm1')!;
    const day = monthDays('2026-12').find((d) => rotaCell(s, w.patternId, w.brigade, d).status === 'work')!;
    const base = plannedShift(s, w, day)!;
    w.shiftHours = 12;
    const long = plannedShift(s, w, day)!;
    expect(long.end - long.start).toBe(12);
    w.shiftHours = undefined;
    setDayHours(s, w, day, 12, { start: base.start, hours: 8 }, { lineId: w.lineId, stationId: w.homeStationId });
    const d = plannedShift(s, w, day)!;
    expect([d.end - d.start, d.extra]).toEqual([12, false]);
    expect(lineStatus(s, 'cfm1', day, { start: base.start, end: base.start + 12 }).entries.find((e) => e.worker.id === w.id)?.moved).toBe(false);
    setAssignment(s, { date: day, workerId: w.id, lineId: w.lineId, stationId: null, source: 'manual' });
    expect(plannedShift(s, w, day)!.end - plannedShift(s, w, day)!.start).toBe(12);
  });
});
