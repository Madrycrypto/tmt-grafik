import { describe, expect, it } from 'vitest';
import { plannedShift } from './coverage';
import { monthDays } from './dates';
import { hasLeave, leaveBalance, leaveLoad, parseLeaveSheet, setLeaveDay } from './leave';
import { demoState } from './seed';
import type { Absence } from './types';

const ids = () => {
  let n = 0;
  return () => `x${++n}`;
};

describe('urlopy', () => {
  it('zdjęcie jednego dnia dzieli zakres urlopu i nie rusza L4', () => {
    const abs: Absence[] = [
      { id: 'a', workerId: 'w', from: '2026-12-22', to: '2026-12-24', reason: 'UW' },
      { id: 'b', workerId: 'w', from: '2026-12-28', to: '2026-12-28', reason: 'L4' },
    ];
    const out = setLeaveDay(abs, 'w', '2026-12-23', false, ids());
    expect(out.filter((a) => a.reason === 'UW').map((a) => [a.from, a.to])).toEqual([
      ['2026-12-22', '2026-12-22'],
      ['2026-12-24', '2026-12-24'],
    ]);
    expect(out.find((a) => a.reason === 'L4')).toBeTruthy();
    expect(setLeaveDay(out, 'w', '2026-12-23', true, ids()).filter((a) => a.reason === 'UW')).toHaveLength(3);
    expect(setLeaveDay(abs, 'w', '2026-12-23', true, ids())).toBe(abs);
  });

  it('pula pomniejsza się tylko o dni pracy z grafiku', () => {
    const s = demoState();
    const w = s.workers.find((x) => x.active && x.patternId === 'p8')!;
    w.leaveDays = 10;
    const m = '2026-12';
    const work = monthDays(m).find((d) => plannedShift(s, w, d))!;
    const off = monthDays(m).find((d) => !plannedShift(s, w, d))!;
    s.absences = setLeaveDay(s.absences, w.id, work, true, ids());
    s.absences = setLeaveDay(s.absences, w.id, off, true, ids());
    expect(hasLeave(s, w.id, off)).toBe(true);
    expect(leaveBalance(s, w, m)).toEqual({ pool: 10, planned: 1, left: 9 });
    w.leaveDays = undefined;
    expect(leaveBalance(s, w, m).left).toBeUndefined();
  });

  it('urlopy zwiększają liczbę nieobecnych w dniu, a luki nie maleją', () => {
    const s = demoState();
    const lineId = s.lines[0].id;
    const m = '2026-12';
    const before = leaveLoad(s, monthDays(m), [lineId]);
    for (const w of s.workers.filter((x) => x.active && x.lineId === lineId)) s.absences = setLeaveDay(s.absences, w.id, `${m}-02`, true, ids());
    const after = leaveLoad(s, monthDays(m), [lineId]);
    const d2b = before.find((x) => x.date === `${m}-02`)!;
    const d2a = after.find((x) => x.date === `${m}-02`)!;
    expect(d2a.onLeave).toBeGreaterThan(d2b.onLeave);
    expect(d2a.gaps).toBeGreaterThanOrEqual(d2b.gaps);
  });

  it('import z arkusza: daty m/d/rrrr, dowolna kolejność imienia, bez polskich znaków', () => {
    const s = demoState();
    const [a, b] = s.workers.filter((x) => x.active);
    const [f, ...rest] = a.name.split(' ');
    const swapped = [...rest, f].join(' ');
    const head = ['', '', 'stanowisko', '12/22/2026', '12/23/2026', '12/24/2026', '12/25/2026', '12/26/2026', 'System'].join('\t');
    const text = [head, `1\t${swapped}\tB CFM\tU\tU\t\t\t\t5`, `2\t${b.name}\tA CFM\t\t\tU\t\t\t3`, `3\tNikt Taki\tA CFM\tU\t\t\t\t\t3`].join('\n');
    const r = parseLeaveSheet(text, s.workers);
    expect(r.matched.find((m) => m.workerId === a.id)?.dates).toEqual(['2026-12-22', '2026-12-23']);
    expect(r.matched.find((m) => m.workerId === b.id)?.dates).toEqual(['2026-12-24']);
    expect(r.unmatched).toEqual(['Nikt Taki']);
    expect(r.days).toBe(3);
    expect(parseLeaveSheet('nic\ntu nie ma dat', s.workers).matched).toHaveLength(0);
  });
});
