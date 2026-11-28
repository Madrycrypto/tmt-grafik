import { describe, expect, it } from 'vitest';
import { plannedShift } from './coverage';
import { addDays } from './dates';
import type { Punch } from './punches';
import { rotaCell } from './rota';
import { accountDay, accountPeriod, fmtHM, sumDays } from './rcpAccount';
import { emptyState } from './seed';
import type { AppState, Worker } from './types';
import { BRIGADES } from './types';

function setup(): { s: AppState; w: Worker; day: string; start: number; end: number } {
  const s = emptyState();
  s.exclusions = [];
  for (let i = 0; i < 30; i++) {
    const day = addDays('2026-12-01', i);
    for (const b of BRIGADES) {
      if (rotaCell(s, 'p8', b, day).status !== 'work') continue;
      const w: Worker = { id: 'w', name: 'Jan', type: 'PL', patternId: 'p8', brigade: b, lineId: 'L', homeStationId: null, active: true, skills: {} };
      s.workers = [w];
      const p = plannedShift(s, w, day);
      if (p && p.start === 7) return { s, w, day, start: p.start, end: p.end };
    }
  }
  throw new Error('brak zmiany');
}
let n = 0;
function punch(day: string, hour: number, dir: Punch['dir']): Punch {
  const min = Math.round(hour * 60);
  return { id: `p${n++}`, workerId: 'w', at: `${day}T${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}:00Z`, date: day, min, dir, source: 'qr' };
}
const acc = (c: ReturnType<typeof setup>, inH: number, outH: number, extra: Punch[] = []) =>
  accountDay(c.s, c.w, c.day, [punch(c.day, inH, 'in'), ...extra, punch(c.day, outH, 'out')], 99);

describe('rozliczenie dnia RCP', () => {
  it('wejście 15 min przed zmianą się nie liczy, nadgodzin brak', () => {
    const c = setup();
    const a = acc(c, c.start - 0.25, c.end);
    expect(a.workedMin).toBe(480);
    expect(a.earlyIgnoredMin).toBe(15);
    expect(a.balanceMin).toBe(0);
  });
  it('spóźnienie i wyjście w granicach tolerancji nie obniżają czasu', () => {
    const c = setup();
    expect(acc(c, c.start + 3 / 60, c.end - 3 / 60).balanceMin).toBe(0);
  });
  it('spóźnienie ponad tolerancję pomniejsza czas o całe spóźnienie', () => {
    const c = setup();
    expect(acc(c, c.start + 0.25, c.end).balanceMin).toBe(-15);
  });
  it('zostanie po zmianie: w tolerancji 0, ponad tolerancję cały nadmiar to nadgodziny', () => {
    const c = setup();
    expect(acc(c, c.start, c.end + 4 / 60).balanceMin).toBe(0);
    expect(acc(c, c.start, c.end + 0.5).balanceMin).toBe(30);
  });
  it('wyjście prywatne jest odejmowane', () => {
    const c = setup();
    const a = acc(c, c.start, c.end, [punch(c.day, 10, 'private_out'), punch(c.day, 10.5, 'in')]);
    expect(a.workedMin).toBe(450);
    expect(a.balanceMin).toBe(-30);
  });
  it('brak wyjścia to dzień problemowy bez wpływu na bilans', () => {
    const c = setup();
    const a = accountDay(c.s, c.w, c.day, [punch(c.day, c.start, 'in')], 99);
    expect(a.problem).toBe(true);
    expect(a.balanceMin).toBe(0);
  });
  it('praca poza grafikiem liczy się w całości jako nadgodziny, a bez odbić dzień wolny to zero', () => {
    const c = setup();
    let off = addDays(c.day, 1);
    while (plannedShift(c.s, c.w, off)) off = addDays(off, 1);
    const a = accountDay(c.s, c.w, off, [punch(off, 13, 'in'), punch(off, 17, 'out')], 99);
    expect(a.planMin).toBe(0);
    expect(a.balanceMin).toBe(240);
    expect(accountDay(c.s, c.w, addDays(off, 1), [], 99).balanceMin).toBe(0);
  });
  it('podsumowanie okresu: nadgodziny, braki i problemy osobno', () => {
    const c = setup();
    const list = accountPeriod(c.s, c.w, [c.day], [punch(c.day, c.start, 'in'), punch(c.day, c.end + 1, 'out')], '2026-12-31', 12);
    const t = sumDays(list);
    expect(t).toMatchObject({ workDays: 1, overtimeMin: 60, deficitMin: 0, problems: 0, balanceMin: 60 });
  });
  it('formatuje czas ze znakiem', () => {
    expect(fmtHM(-34 * 60 - 12, true)).toBe('−34 h 12 min');
    expect(fmtHM(125, true)).toBe('+2 h 05 min');
  });
});
