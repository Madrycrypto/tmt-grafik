import { describe, expect, it } from 'vitest';
import { applyVariant, setAssignment, setCombined } from './actions';
import { lineStatus } from './coverage';
import { hrSummary } from './hrExport';
import { findVariants } from './replacement';
import { emptyState } from './seed';
import type { AppState, Worker } from './types';
import { BRIGADES } from './types';
import { rotaCell, shiftDef } from './rota';

const day = '2026-12-02';

function worker(id: string, home: string, skills: Record<string, number>, brigade = 'A' as const): Worker {
  return {
    id,
    name: id,
    type: 'PL',
    patternId: 'p8',
    brigade,
    lineId: 'L',
    homeStationId: home,
    active: true,
    skills: Object.fromEntries(Object.entries(skills).map(([k, v]) => [k, { level: v }])),
  };
}

/** Linia z OP50-2 i OP51/52, które może obsłużyć jedna osoba; obie osoby na tej samej zmianie. */
function line(): { s: AppState; window: { start: number; end: number } } {
  const s = emptyState();
  s.exclusions = [];
  s.lines = [{ id: 'L', name: 'Moduły' }];
  s.stations = [
    { id: 'op50', lineId: 'L', name: 'OP50-2', required: 1, minLevel: 3, order: 0, pairWith: ['op51'] },
    { id: 'op51', lineId: 'L', name: 'OP51/52', required: 1, minLevel: 3, order: 1 },
  ];
  const b = BRIGADES.find((x) => rotaCell(s, 'p8', x, day).status === 'work')!;
  const def = shiftDef(s, rotaCell(s, 'p8', b, day).code)!;
  s.workers = [worker('Przemek', 'op50', { op50: 4, op51: 3 }), worker('Magda', 'op51', { op51: 3 })].map((w) => ({ ...w, brigade: b }));
  return { s, window: { start: def.start, end: def.start + def.hours } };
}

describe('łączenie stanowisk', () => {
  it('bez łączenia OP51/52 ma lukę, gdy Magdy nie ma', () => {
    const { s, window } = line();
    s.absences.push({ id: 'a', workerId: 'Magda', from: day, to: day, reason: 'L4' });
    const st = lineStatus(s, 'L', day, window).statuses;
    expect(st.find((x) => x.station.id === 'op51')!.ok).toBe(false);
  });

  it('osoba łącząca stanowiska pokrywa oba naraz', () => {
    const { s, window } = line();
    s.absences.push({ id: 'a', workerId: 'Magda', from: day, to: day, reason: 'L4' });
    setCombined(s, s.workers[0], day, { lineId: 'L', stationId: 'op50', also: [] }, 'op51', true);
    const st = lineStatus(s, 'L', day, window).statuses;
    expect(st.every((x) => x.ok)).toBe(true);
    expect(st.find((x) => x.station.id === 'op51')!.people.map((e) => e.worker.id)).toContain('Przemek');
  });

  it('podpowiedź zastępstwa proponuje łączenie zamiast zabierania z OP50-2', () => {
    const { s, window } = line();
    const { variants } = findVariants(s, { date: day, lineId: 'L', stationId: 'op51', window, excludeIds: ['Magda'] });
    expect(variants[0].steps).toHaveLength(1);
    expect(variants[0].steps[0].kind).toBe('combine');
    applyVariant(s, 'test', variants[0], { worker: s.workers[1], date: day, reason: 'L4' });
    expect(lineStatus(s, 'L', day, window).statuses.every((x) => x.ok)).toBe(true);
  });

  it('nie proponuje łączenia, gdy stanowiska nie są oznaczone jako łączone', () => {
    const { s, window } = line();
    s.stations[0].pairWith = undefined;
    const { variants } = findVariants(s, { date: day, lineId: 'L', stationId: 'op51', window, excludeIds: ['Magda'] });
    expect(variants.some((v) => v.steps.some((x) => x.kind === 'combine'))).toBe(false);
  });

  it('stałe łączenie u pracownika nie idzie za nim po przesunięciu na inne stanowisko', () => {
    const { s, window } = line();
    s.workers[0].alsoStationIds = ['op51'];
    s.absences.push({ id: 'a', workerId: 'Magda', from: day, to: day, reason: 'L4' });
    expect(lineStatus(s, 'L', day, window).statuses.every((x) => x.ok)).toBe(true);
    setAssignment(s, { date: day, workerId: 'Przemek', lineId: 'L', stationId: 'op51', source: 'manual' });
    const st = lineStatus(s, 'L', day, window).statuses;
    expect(st.find((x) => x.station.id === 'op50')!.ok).toBe(false);
  });

  it('godziny do premii dzielą się po równo między łączone stanowiska', () => {
    const { s } = line();
    setCombined(s, s.workers[0], day, { lineId: 'L', stationId: 'op50', also: [] }, 'op51', true);
    const sum = hrSummary(s, { month: '2026-12', lineId: 'all', who: 'all' } as never).find((x) => x.worker.id === 'Przemek')!;
    const d = sum.days.find((x) => x.date === day)!;
    expect(d.alsoStationIds).toEqual(['op51']);
    const total = Object.values(sum.byStation).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(sum.hours);
    expect(sum.byStation.op51).toBeCloseTo(d.hours / 2);
  });
});
