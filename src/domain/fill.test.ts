import { describe, expect, it } from 'vitest';
import { plannedShift } from './coverage';
import { weekday } from './dates';
import { fillProposals } from './fill';
import { emptyState } from './seed';
import { buildSystem } from './templates';
import type { AppState, Worker } from './types';

function setup(skill: number): { s: AppState; w: Worker } {
  const s = emptyState();
  s.exclusions = [];
  for (const kind of ['3L', '4'] as const) {
    const r = buildSystem(s, { kind, hours: 8, start: 7 });
    if ('error' in r) throw new Error(r.error);
    s.shiftDefs.push(...r.shiftDefs);
    s.patterns.push(r.pattern);
  }
  s.lines = [
    { id: 'L1', name: 'Moduły', patternIds: ['sys3L_8_07'] },
    { id: 'L2', name: 'HVAC', patternIds: ['sys4_8_07'] },
  ];
  s.stations = [
    { id: 'S1', lineId: 'L1', name: 'OP50', required: 0, minLevel: 3, order: 0 },
    { id: 'S2', lineId: 'L2', name: 'Palnik', required: 1, minLevel: 3, order: 0 },
  ];
  const w: Worker = { id: 'w', name: 'Jan', type: 'PL', patternId: 'sys3L_8_07', brigade: 'A', lineId: 'L1', homeStationId: 'S1', active: true, skills: { S1: { level: 3 }, S2: { level: skill } } };
  s.workers = [w];
  return { s, w };
}

describe('dopełnianie godzin na innych liniach', () => {
  it('proponuje dodatkową zmianę w dzień wolny na stanowisku z luką, tylko do wysokości niedoboru', () => {
    const { s, w } = setup(3);
    const { deficits, proposals } = fillProposals(s, '2027-02');
    const d = deficits.find((x) => x.worker.id === 'w')!;
    expect(d.missing).toBeGreaterThan(0);
    expect(proposals.length).toBe(Math.ceil(d.missing / 8));
    for (const p of proposals) {
      expect(p.lineId).toBe('L2');
      expect(p.stationId).toBe('S2');
      expect(plannedShift(s, w, p.date)).toBeNull();
      // nie dzień po nocce rano (11 h odpoczynku)
      expect(p.start === 7 && weekday(p.date) === 4).toBe(false);
    }
  });

  it('nie przekracza niedoboru i zachowuje 11 h odpoczynku między propozycjami', () => {
    const { s } = setup(3);
    const { proposals } = fillProposals(s, '2027-02');
    const dates = proposals.map((p) => p.date).sort();
    expect(new Set(dates).size).toBe(dates.length);
  });

  it('nie proponuje nikogo bez kwalifikacji na stanowisku', () => {
    const { s } = setup(2);
    expect(fillProposals(s, '2027-02').proposals).toEqual([]);
  });

  it('w okresie 3-miesięcznym liczy brak za cały okres i dopełnia go w dowolnym miesiącu okresu', () => {
    const { s } = setup(3);
    const month = deficitsOf(s, '2027-02');
    s.patterns.find((p) => p.id === 'sys3L_8_07')!.settlementMonths = 3;
    const { deficits, proposals } = fillProposals(s, '2027-02');
    const d = deficits.find((x) => x.worker.id === 'w')!;
    expect(d.months).toEqual(['2027-01', '2027-02', '2027-03']);
    expect(d.missing).toBeGreaterThan(month);
    expect(proposals.reduce((h, p) => h + p.hours, 0)).toBeGreaterThan(month);
    expect(proposals.some((p) => p.date.slice(0, 7) !== '2027-02')).toBe(true);
    expect(proposals.every((p) => d.months.includes(p.date.slice(0, 7)))).toBe(true);
  });
});

function deficitsOf(s: AppState, month: string): number {
  return fillProposals(s, month).deficits.find((x) => x.worker.id === 'w')?.missing ?? 0;
}
