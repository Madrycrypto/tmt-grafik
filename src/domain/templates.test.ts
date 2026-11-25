import { describe, expect, it } from 'vitest';
import { lineStatus } from './coverage';
import { monthDays, weekday } from './dates';
import { gapsOnDay, rotaCell, summarize } from './rota';
import { demoState, emptyState } from './seed';
import { buildSystem } from './templates';
import type { SystemKind } from './templates';
import type { AppState } from './types';
import { patternBrigades } from './types';

function withSystem(kind: SystemKind, hours: 8 | 12, start: number): { s: AppState; id: string } {
  const s = emptyState();
  s.exclusions = [];
  const r = buildSystem(s, { kind, hours, start });
  if ('error' in r) throw new Error(r.error);
  s.shiftDefs.push(...r.shiftDefs);
  s.patterns.push(r.pattern);
  return { s, id: r.pattern.id };
}

describe('systemy 1/2/3/4-zmianowe', () => {
  it.each([
    ['1', 8, 6, 1],
    ['2', 8, 6, 2],
    ['3', 8, 6, 3],
    ['2', 12, 6, 2],
    ['4', 8, 6, 3],
    ['4', 12, 6, 2],
  ] as const)('system %s × %s h: każdego dnia roboczego obsadzone są wszystkie zmiany dokładnie raz', (kind, hours, start, shifts) => {
    const { s, id } = withSystem(kind, hours, start);
    const p = s.patterns.find((x) => x.id === id)!;
    for (const d of monthDays('2026-12')) {
      const working = patternBrigades(p).map((b) => rotaCell(s, id, b, d)).filter((c) => c.status === 'work');
      const weekend = weekday(d) === 0 || weekday(d) === 6;
      if (kind !== '4' && weekend) expect(working).toHaveLength(0);
      else {
        expect(working).toHaveLength(shifts);
        expect(new Set(working.map((c) => c.code)).size).toBe(shifts);
        expect(gapsOnDay(s, id, d)).toEqual([]);
      }
    }
  });

  it('2 zmiany od 6:00 tworzą zmiany 06–14 i 14–22 i używają tylko brygad A i B', () => {
    const { s, id } = withSystem('2', 8, 6);
    expect(s.shiftDefs.filter((d) => d.code.endsWith('_06') || d.code.endsWith('_14')).map((d) => [d.start, d.hours])).toEqual([
      [6, 8],
      [14, 8],
    ]);
    expect(summarize(s, id, '2026-12').map((x) => x.brigade)).toEqual(['A', 'B']);
  });

  it('istniejąca zmiana o tych samych godzinach jest używana ponownie', () => {
    const s = emptyState();
    const r = buildSystem(s, { kind: '2', hours: 8, start: 7 });
    if ('error' in r) throw new Error(r.error);
    expect(r.shiftDefs).toEqual([]);
    expect(r.pattern.sequence).toContain('R8');
  });

  it('3 zmiany po 12 h są odrzucane', () => {
    expect('error' in buildSystem(emptyState(), { kind: '3', hours: 12, start: 6 })).toBe(true);
  });
});

describe('demo: CFM na dwóch zmianach', () => {
  it('w dzień roboczy CFM ma obsadę rano i po południu, w nocy i w weekend nikogo', () => {
    const s = demoState();
    const day = '2026-12-02';
    const morning = lineStatus(s, 'cfm1', day, { start: 6, end: 14 });
    const afternoon = lineStatus(s, 'cfm1', day, { start: 14, end: 22 });
    const night = lineStatus(s, 'cfm1', day, { start: 22, end: 30 });
    expect(morning.entries.length).toBeGreaterThan(0);
    expect(afternoon.entries.length).toBeGreaterThan(0);
    expect(night.entries.length).toBe(0);
    expect(lineStatus(s, 'cfm1', '2026-12-05', { start: 6, end: 14 }).entries.length).toBe(0);
    expect(morning.statuses.every((x) => x.ok)).toBe(true);
  });
});

describe('nazwy i luki', () => {
  it('system 2-zmianowy nie tworzy zbędnej nocki i nie pokazuje weekendu jako luki', () => {
    const { s, id } = withSystem('2', 8, 6);
    expect(s.patterns.find((p) => p.id === id)!.name).toBe('2 zmiany 8 h pn–pt (06:00–14:00 / 14:00–22:00)');
    expect(s.shiftDefs.some((d) => d.start === 22)).toBe(false);
    expect(gapsOnDay(s, id, '2026-12-05')).toEqual([]);
  });
});
