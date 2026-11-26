import { describe, expect, it } from 'vitest';
import { plannedShift } from './coverage';
import { addDays } from './dates';
import { checkDay, planPunches, suggestDir } from './punches';
import type { Punch } from './punches';
import { rotaCell } from './rota';
import { emptyState } from './seed';
import type { AppState, Worker } from './types';
import { BRIGADES } from './types';

/** Pracownik, który w dniu `day` ma zmianę o podanym początku (z wzorca p8 lub p12). */
function setup(pattern: 'p8' | 'p12', wantStart: number, nextOff = false): { s: AppState; w: Worker; day: string; start: number; end: number } {
  const s = emptyState();
  s.exclusions = [];
  for (let i = 0; i < 30; i++) {
    const day = addDays('2026-12-01', i);
    for (const b of BRIGADES) {
      if (rotaCell(s, pattern, b, day).status !== 'work') continue;
      const w: Worker = { id: 'w', name: 'Jan', type: 'PL', patternId: pattern, brigade: b, lineId: 'L', homeStationId: null, active: true, skills: {} };
      s.workers = [w];
      const p = plannedShift(s, w, day);
      if (p && p.start === wantStart && (!nextOff || !plannedShift(s, w, addDays(day, 1)))) return { s, w, day, start: p.start, end: p.end };
    }
  }
  throw new Error('brak takiej zmiany');
}

let n = 0;
function punch(day: string, hour: number, dir: 'in' | 'out'): Punch {
  const d = addDays(day, Math.floor(hour / 24));
  const min = Math.round((hour - Math.floor(hour / 24) * 24) * 60);
  const at = `${d}T${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}:00Z`;
  return { id: `p${n++}`, workerId: 'w', at, date: d, min, dir, source: 'qr' };
}

describe('RCP: plan a odbicia', () => {
  it('wejście i wyjście o czasie = OK, liczy przepracowane godziny', () => {
    const { s, w, day, start, end } = setup('p8', 7);
    const r = checkDay(s, w, day, [punch(day, start - 0.2, 'in'), punch(day, end + 0.1, 'out')]);
    expect(r.status).toBe('ok');
    expect(r.worked).toBeCloseTo(end - start + 0.3);
  });

  it('spóźnienie ponad tolerancję i wcześniejsze wyjście', () => {
    const { s, w, day, start, end } = setup('p8', 7);
    expect(checkDay(s, w, day, [punch(day, start + 0.25, 'in'), punch(day, end, 'out')]).lateMin).toBe(15);
    expect(checkDay(s, w, day, [punch(day, start + 0.05, 'in'), punch(day, end, 'out')]).status).toBe('ok');
    const r = checkDay(s, w, day, [punch(day, start, 'in'), punch(day, end - 1, 'out')]);
    expect(r.status).toBe('early');
    expect(r.earlyMin).toBe(60);
  });

  it('nocka: wyjście następnego dnia rano należy do zmiany z poprzedniego dnia', () => {
    const { s, w, day, start, end } = setup('p8', 23, true);
    const ps = [punch(day, start - 0.1, 'in'), punch(day, end, 'out')];
    expect(ps[1].date).toBe(addDays(day, 1));
    const r = checkDay(s, w, day, ps);
    expect(r.status).toBe('ok');
    expect(r.worked).toBeCloseTo(8.1);
    // ten sam poranek nie pojawia się jako odbicie poza grafikiem następnego dnia
    expect(checkDay(s, w, addDays(day, 1), ps).punches).toHaveLength(0);
  });

  it('brak odbić, brak wyjścia i zmiana w trakcie', () => {
    const { s, w, day, start } = setup('p8', 7);
    expect(checkDay(s, w, day, []).status).toBe('missing');
    expect(checkDay(s, w, day, [], start - 1).status).toBe('pending');
    expect(checkDay(s, w, day, [punch(day, start, 'in')]).status).toBe('no_out');
    expect(checkDay(s, w, day, [punch(day, start, 'in')], start + 3).status).toBe('pending');
  });

  it('odbicie w dzień wolny = poza grafikiem', () => {
    const { s, w, day } = setup('p8', 7);
    let off = day;
    for (let i = 1; i < 10; i++) if (!plannedShift(s, w, addDays(day, i))) { off = addDays(day, i); break; }
    expect(checkDay(s, w, off, [punch(off, 10, 'in'), punch(off, 14, 'out')]).status).toBe('unplanned');
  });

  it('podpowiada wyjście po wejściu, a wejście po wyjściu lub po długiej przerwie', () => {
    const inP = { ...punch('2026-12-01', 6, 'in'), at: '2026-12-01T06:00:00Z' };
    expect(suggestDir([], '2026-12-01T06:00:00Z')).toBe('in');
    expect(suggestDir([inP], '2026-12-01T14:00:00Z')).toBe('out');
    expect(suggestDir([inP], '2026-12-02T06:00:00Z')).toBe('in');
  });

  it('zatwierdzenie wg grafiku uzupełnia tylko brakujące odbicia (nocka: wyjście następnego dnia)', () => {
    const { s, w, day, start, end } = setup('p8', 23, true);
    const all = planPunches(checkDay(s, w, day, []));
    expect(all.map((p) => [p.dir, p.date, p.min])).toEqual([
      ['in', day, start * 60],
      ['out', addDays(day, 1), (end - 24) * 60],
    ]);
    const onlyOut = planPunches(checkDay(s, w, day, [punch(day, start + 0.1, 'in')]));
    expect(onlyOut.map((p) => p.dir)).toEqual(['out']);
    const full = checkDay(s, w, day, [punch(day, start, 'in'), punch(day, end, 'out')]);
    expect(planPunches(full)).toEqual([]);
    // po uzupełnieniu dzień jest OK
    const filled = all.map((p, i) => ({ ...p, id: `x${i}`, at: `${p.date}T00:00:00Z` }));
    expect(checkDay(s, w, day, filled).status).toBe('ok');
  });
});
