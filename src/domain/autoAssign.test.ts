import { describe, expect, it } from 'vitest';
import { autoAssign } from './autoAssign';
import type { Station, Worker } from './types';

const st = (id: string, order: number, required = 1): Station => ({ id, lineId: 'L', name: id, required, minLevel: 3, order });
const w = (id: string, home: string | null, skills: Record<string, number>): Worker => ({
  id, name: id, type: 'PL', patternId: 'p', brigade: 'A', lineId: 'L', homeStationId: home, active: true,
  skills: Object.fromEntries(Object.entries(skills).map(([k, v]) => [k, { level: v }])),
});
const map = (r: { workerId: string; stationId: string | null }[]) => Object.fromEntries(r.map((x) => [x.workerId, x.stationId]));

describe('rozstawienie według matrycy', () => {
  it('osoba bez kwalifikacji na macierzystym idzie tam, gdzie ma poziom', () => {
    const r = map(autoAssign([w('Marta', 'GP12', { OP53: 3 }), w('Travolta', 'GP12', { GP12: 4 })], [st('OP53', 0), st('GP12', 1)]));
    expect(r).toEqual({ Marta: 'OP53', Travolta: 'GP12' });
  });

  it('osoba wszechstronna łata lukę, której nikt inny nie obsadzi', () => {
    const r = map(autoAssign(
      [w('Magda', 'GP12', { GP12: 4, OP72: 3 }), w('Barbara', 'GP12', { GP12: 3 })],
      [st('OP72', 0), st('GP12', 1)],
    ));
    expect(r).toEqual({ Magda: 'OP72', Barbara: 'GP12' });
  });

  it('nadwyżka z kwalifikacją zostaje na macierzystym, bez kwalifikacji idzie do rezerwy', () => {
    const r = map(autoAssign(
      [w('A', 'GP12', { GP12: 3 }), w('B', 'GP12', { GP12: 3 }), w('C', 'GP12', { OP99: 3 })],
      [st('GP12', 0)],
    ));
    expect(r).toEqual({ A: 'GP12', B: 'GP12', C: null });
  });

  it('nie rusza ludzi, gdy wszystko i tak jest obsadzone', () => {
    const r = map(autoAssign([w('A', 'S1', { S1: 3, S2: 4 }), w('B', 'S2', { S2: 3 })], [st('S1', 0), st('S2', 1)]));
    expect(r).toEqual({ A: 'S1', B: 'S2' });
  });
});
