import { describe, expect, it } from 'vitest';
import { applyVariant } from './actions';
import { lineStatus, roster } from './coverage';
import { addDays, monthDays } from './dates';
import { findVariants, restCheck } from './replacement';
import { brigadeMonth, gapsOnDay, longestRest, rotaCell, summarize } from './rota';
import { demoState, emptyState } from './seed';
import type { AppState, BrigadeId, Worker } from './types';
import { BRIGADES } from './types';

function noExclusions(): AppState {
  const s = emptyState();
  s.exclusions = [];
  return s;
}

function worker(id: string, brigade: BrigadeId, home: string | null, skills: Record<string, number>, patternId = 'p8'): Worker {
  return {
    id,
    name: id,
    type: 'PL',
    patternId,
    brigade,
    lineId: 'L',
    homeStationId: home,
    active: true,
    skills: Object.fromEntries(Object.entries(skills).map(([k, v]) => [k, { level: v }])),
  };
}

function smallLine(): AppState {
  const s = noExclusions();
  s.lines = [{ id: 'L', name: 'Linia' }];
  s.stations = [
    { id: 'S1', lineId: 'L', name: 'Lutowanie', required: 1, minLevel: 3, order: 0 },
    { id: 'S2', lineId: 'L', name: 'Montaż', required: 1, minLevel: 3, order: 1 },
  ];
  return s;
}

describe('rotacja 4 brygad', () => {
  it('każdego dnia każda zmiana 8 h ma dokładnie jedną brygadę, a jedna ma wolne', () => {
    const s = noExclusions();
    for (const d of monthDays('2026-12')) {
      const codes = BRIGADES.map((b) => rotaCell(s, 'p8', b, d).code).sort();
      expect(codes).toEqual(['N8', 'P8', 'R8', 'W'].sort());
    }
  });

  it('wzorzec 12 h daje jedną brygadę na dzień i jedną na noc', () => {
    const s = noExclusions();
    for (const d of monthDays('2026-12')) {
      const codes = BRIGADES.map((b) => rotaCell(s, 'p12', b, d).code).filter((c) => c !== 'W').sort();
      expect(codes).toEqual(['D12', 'N12']);
    }
  });

  it('wyłączenie „niedziela noc” zdejmuje nockę i pokazuje ją jako wyłączoną, nie jako lukę', () => {
    const s = emptyState();
    const sunday = '2026-12-06';
    const night = BRIGADES.map((b) => rotaCell(s, 'p8', b, sunday)).find((c) => c.code === 'N8');
    expect(night?.status).toBe('excluded');
    expect(gapsOnDay(s, 'p8', sunday)).toEqual([]);
    const monday = BRIGADES.map((b) => rotaCell(s, 'p8', b, addDays(sunday, 1))).find((c) => c.code === 'N8');
    expect(monday?.status).toBe('work');
  });

  it('docelowa liczba dni: brygada pracuje dokładnie tyle dni, nadwyżka staje się wolnym', () => {
    const s = noExclusions();
    const before = brigadeMonth(s, 'p8', 'A', '2026-12').filter((c) => c.status === 'work').length;
    expect(before).toBeGreaterThan(20);
    const t = { ...s, targets: [{ id: 't', patternId: 'p8', month: '2026-12', days: { A: 20 } }] };
    const cells = brigadeMonth(t, 'p8', 'A', '2026-12');
    expect(cells.filter((c) => c.status === 'work').length).toBe(20);
    expect(cells.filter((c) => c.status === 'trimmed').length).toBe(before - 20);
    const trimmedDay = cells.find((c) => c.status === 'trimmed')!;
    expect(gapsOnDay(t, 'p8', trimmedDay.date)).toEqual([trimmedDay.code]);
  });

  it('ręczna zmiana komórki ma pierwszeństwo przed wyłączeniem', () => {
    const s = emptyState();
    s.rotaOverrides = [{ id: 'o', patternId: 'p8', brigade: 'A', date: '2026-12-06', code: 'N8' }];
    expect(rotaCell(s, 'p8', 'A', '2026-12-06')).toMatchObject({ code: 'N8', status: 'work', overridden: true });
  });

  it('cykl R-R-P-P-N-N-W-W: tygodnie poniżej 35 h są zgłaszane, ale mają co najmniej 24 h (zmiana zmiany)', () => {
    const s = noExclusions();
    const flagged = summarize(s, 'p8', '2026-12').flatMap((b) => b.weeksWithoutRest);
    expect(flagged.length).toBeGreaterThan(0);
    for (const w of flagged) expect(w.rest).toBeGreaterThanOrEqual(24);
  });

  it('longestRest wykrywa tydzień bez 35 h przerwy', () => {
    const daily: [number, number][] = Array.from({ length: 7 }, (_, i) => [i * 24 + 7, i * 24 + 19]);
    expect(longestRest(daily, 0, 168)).toBe(12);
  });
});

describe('pokrycie godzinowe 8 h + 12 h', () => {
  it('pracownik 12 h liczy się tylko w godzinach, w których jest obecny', () => {
    const s = smallLine();
    s.workers = [worker('cn', 'A', 'S1', { S1: 3 }, 'p12')];
    const day = monthDays('2026-12').find((d) => rotaCell(s, 'p12', 'A', d).code === 'D12')!;
    const afternoon = lineStatus(s, 'L', day, { start: 15, end: 23 });
    const s1 = afternoon.statuses.find((x) => x.station.id === 'S1')!;
    expect(s1.perHour).toEqual([1, 1, 1, 1, 0, 0, 0, 0]);
    expect(s1.ok).toBe(false);
  });

  it('nocka z poprzedniego dnia jest widoczna rano', () => {
    const s = smallLine();
    s.workers = [worker('n', 'A', 'S1', { S1: 3 })];
    const day = monthDays('2026-12').find((d) => rotaCell(s, 'p8', 'A', d).code === 'N8')!;
    const r = roster(s, addDays(day, 1), { start: 0, end: 7 }, 'L');
    expect(r.map((e) => e.worker.id)).toEqual(['n']);
  });
});

describe('zastępstwa', () => {
  function scenario() {
    const s = smallLine();
    const day = monthDays('2026-12').find((d) => rotaCell(s, 'p8', 'A', d).code === 'R8')!;
    s.workers = [
      worker('x', 'A', 'S1', { S1: 3 }),
      worker('y', 'A', 'S2', { S1: 4, S2: 3 }),
      worker('z', 'A', null, { S2: 3, S1: 2 }),
    ];
    return { s, day };
  }

  it('kaskada: Y przechodzi na lutowanie, Z z rezerwy na montaż', () => {
    const { s, day } = scenario();
    const { variants } = findVariants(s, { date: day, lineId: 'L', stationId: 'S1', window: { start: 7, end: 15 }, excludeIds: ['x'] });
    expect(variants[0].steps.map((st) => [st.worker.id, st.fromStationId, st.toStationId])).toEqual([
      ['y', 'S2', 'S1'],
      ['z', null, 'S2'],
    ]);
    expect(variants[0].extras).toBe(0);
  });

  it('poziom 2 nie obsadza samodzielnie stanowiska', () => {
    const { s, day } = scenario();
    const { variants } = findVariants(s, { date: day, lineId: 'L', stationId: 'S1', window: { start: 7, end: 15 }, excludeIds: ['x'] });
    expect(variants.some((v) => v.steps[0].worker.id === 'z')).toBe(false);
  });

  it('jedyna kwalifikowana osoba bez zastępcy jest zablokowana', () => {
    const { s, day } = scenario();
    s.workers = s.workers.filter((w) => w.id !== 'z');
    const { variants, blocked } = findVariants(s, { date: day, lineId: 'L', stationId: 'S1', window: { start: 7, end: 15 }, excludeIds: ['x'] });
    expect(variants.every((v) => v.steps[0].worker.id !== 'y')).toBe(true);
    expect(blocked.map((b) => b.worker.id)).toEqual(['y']);
  });

  it('dodatkowa zmiana tylko z zachowaniem 11 h odpoczynku', () => {
    const s = smallLine();
    const nightDay = monthDays('2026-12').find((d) => rotaCell(s, 'p8', 'B', d).code === 'N8' && rotaCell(s, 'p8', 'B', addDays(d, 1)).code !== 'N8')!;
    const morning = addDays(nightDay, 1);
    const b = worker('b', 'B', 'S1', { S1: 3 });
    s.workers = [b];
    expect(restCheck(s, b, morning, { start: 7, end: 15 }).ok).toBe(false);
    expect(restCheck(s, b, morning, { start: 23, end: 31 }).ok).toBe(true);
  });

  it('zatwierdzony wariant zapisuje nieobecność i przypisania, a obsada wraca do normy', () => {
    const { s, day } = scenario();
    const { variants } = findVariants(s, { date: day, lineId: 'L', stationId: 'S1', window: { start: 7, end: 15 }, excludeIds: ['x'] });
    applyVariant(s, 'test', variants[0], { worker: s.workers[0], date: day, reason: 'L4' });
    const st = lineStatus({ ...s }, 'L', day, { start: 7, end: 15 });
    expect(st.statuses.every((x) => x.ok)).toBe(true);
    expect(s.history[0].text).toContain('Brak: x');
  });
});

describe('dane demo', () => {
  it('na rannej zmianie HVAC 1 wszystkie stanowiska są obsadzone lub mają zastępstwo', () => {
    const s = demoState();
    const day = monthDays('2026-12').find((d) => rotaCell(s, 'p8', 'A', d).code === 'R8' && rotaCell(s, 'p12', 'A', d).code === 'D12');
    const anyDay = day ?? '2026-12-02';
    const st = lineStatus(s, 'hvac1', anyDay, { start: 7, end: 15 });
    expect(st.statuses.length).toBe(6);
    const lut = st.statuses.find((x) => x.station.name === 'Lutowanie')!;
    const absent = lut.people[0];
    const { variants } = findVariants(s, { date: anyDay, lineId: 'hvac1', stationId: lut.station.id, window: absent.rel, excludeIds: [absent.worker.id] });
    expect(variants.length).toBeGreaterThan(0);
  });
});

describe('wyłączenia a bilans godzin', () => {
  it('nowe wyłączenie od razu zmienia godziny brygady w nowym stanie (bez starej pamięci podręcznej)', async () => {
    const { emptyState } = await import('./seed');
    const { summarize } = await import('./rota');
    const s1 = emptyState();
    s1.exclusions = [];
    const before = summarize(s1, 'p8', '2026-11');
    const night = s1.patterns.find((p) => p.id === 'p8')!.sequence.find((c) => s1.shiftDefs.find((d) => d.code === c)?.label === 'N')!;
    const s2 = { ...s1, exclusions: [{ id: 'x', kind: 'weekly' as const, weekday: 0, shiftCodes: [night] }] };
    const after = summarize(s2, 'p8', '2026-11');
    expect(after.reduce((h, b) => h + b.hours, 0)).toBeLessThan(before.reduce((h, b) => h + b.hours, 0));
  });
});
