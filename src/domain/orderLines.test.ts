import { describe, expect, it } from 'vitest';
import { orderLines } from './types';
import type { Line } from './types';

const L = (id: string, name: string, group?: string, order?: number): Line => ({ id, name, group, order });

describe('orderLines', () => {
  it('układa linie wg liczby, a bez liczby alfabetycznie na końcu', () => {
    const r = orderLines([L('a', 'Moduły', 'CFM', 2), L('b', 'Lutowanie', 'CFM', 1), L('c', 'Rdzenie', 'CFM', 3), L('d', 'Flame', 'HVAC'), L('e', 'Assembly', 'HVAC')]);
    expect(r.map((l) => l.name)).toEqual(['Lutowanie', 'Moduły', 'Rdzenie', 'Assembly', 'Flame']);
  });
  it('grupa idzie wg najmniejszej liczby jej linii, a linia bez grupy wchodzi między grupy', () => {
    const r = orderLines([L('1', 'Assembly', 'HVAC', 5), L('2', 'Injection', undefined, 1), L('3', 'Lutowanie', 'CFM', 3), L('4', 'Flame', 'HVAC', 2)]);
    expect(r.map((l) => l.name)).toEqual(['Injection', 'Flame', 'Assembly', 'Lutowanie']);
  });
  it('bez żadnych liczb zachowuje grupy przed liniami bez grupy', () => {
    const r = orderLines([L('1', 'Injection'), L('2', 'Flame', 'HVAC')]);
    expect(r.map((l) => l.name)).toEqual(['Flame', 'Injection']);
  });
});
