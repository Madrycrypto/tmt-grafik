import { describe, expect, it } from 'vitest';
import { setAssignment } from './actions';
import { plannedShift } from './coverage';
import { monthDays } from './dates';
import { monthNorm } from './norm';
import { addMonths, periodLabel, periodMonths, workerPeriod } from './settlement';
import { demoState } from './seed';

describe('okres rozliczeniowy', () => {
  it('okresy liczone od stycznia', () => {
    expect(periodMonths('2026-11', 1)).toEqual(['2026-11']);
    expect(periodMonths('2026-11', 3)).toEqual(['2026-10', '2026-11', '2026-12']);
    expect(periodMonths('2026-11', 4)).toEqual(['2026-09', '2026-10', '2026-11', '2026-12']);
    expect(periodMonths('2026-11', 6)).toEqual(['2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12']);
    expect(periodMonths('2026-11', 12)).toHaveLength(12);
    expect(periodMonths('2026-11', 12)[0]).toBe('2026-01');
  });

  it('okres od wskazanego miesiąca, także przez przełom roku', () => {
    expect(periodMonths('2027-01', 3, '2026-11')).toEqual(['2026-11', '2026-12', '2027-01']);
    expect(periodMonths('2026-10', 3, '2026-11')).toEqual(['2026-08', '2026-09', '2026-10']);
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(periodLabel(['2026-11', '2026-12', '2027-01'])).toBe('XI 2026 – I 2027');
  });

  it('suma okresu = suma miesięcy; zmiana dodatkowa zmniejsza brak', () => {
    const s = demoState();
    const w = s.workers[0];
    const months = periodMonths('2026-11', 3);
    const before = workerPeriod(s, w, months);
    expect(before.norm).toBe(months.reduce((x, m) => x + monthNorm(m).hours, 0));
    expect(before.hours).toBe(before.months.reduce((x, m) => x + m.hours, 0));
    const free = monthDays('2026-12').find((d) => !plannedShift(s, w, d))!;
    setAssignment(s, { date: free, workerId: w.id, lineId: w.lineId, stationId: null, source: 'manual', extraShift: { start: 6, hours: 8 } });
    expect(workerPeriod(s, w, months).diff).toBe(before.diff + 8);
  });

  it('urlop nie tworzy braku godzin — obniża wymiar o godziny z grafiku', () => {
    const s = demoState();
    const w = s.workers[0];
    const months = ['2026-12'];
    const before = workerPeriod(s, w, months);
    const work = monthDays('2026-12').find((d) => plannedShift(s, w, d))!;
    const h = plannedShift(s, w, work)!.end - plannedShift(s, w, work)!.start;
    s.absences.push({ id: 'u1', workerId: w.id, from: work, to: work, reason: 'UW' });
    const after = workerPeriod(s, w, months);
    expect(after.hours).toBe(before.hours - h);
    expect(after.norm).toBe(before.norm - h);
    expect(after.diff).toBe(before.diff);
  });
});

describe('stanowiska specjalne ★', () => {
  it('godziny na stanowisku ★ liczą się osobno w eksporcie dla kadr', async () => {
    const { hrSummary, hrMonthlyCsv } = await import('./hrExport');
    const s = demoState();
    const w = s.workers.find((x) => x.homeStationId)!;
    const f = { month: '2026-12', lineId: 'all', who: 'all', includeInactive: false } as const;
    const before = hrSummary(s, f).find((r) => r.worker.id === w.id)!;
    expect(before.specialHours).toBe(0);
    s.stations.find((x) => x.id === w.homeStationId)!.special = true;
    const after = hrSummary(s, f).find((r) => r.worker.id === w.id)!;
    expect(after.specialHours).toBe(after.byStation[w.homeStationId!]);
    expect(after.specialHours).toBeGreaterThan(0);
    expect(hrMonthlyCsv(s, f)).toContain('w tym na stanowiskach ★');
  });
});
