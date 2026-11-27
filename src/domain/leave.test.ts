import { describe, expect, it } from 'vitest';
import { plannedShift } from './coverage';
import { monthDays, periodDays } from './dates';
import { applyLeaveReport, hasLeave, leaveBalance, resolveLeaveReport, leaveDaysIn, leaveLoad, parseLeaveSheet, setLeaveDay } from './leave';
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
    expect(leaveBalance(s, w, m)).toEqual({ pool: 10, planned: 1, left: 9, plannable: 9, onDemandLeft: 4 });
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

describe('urlopy: cały rok', () => {
  it('okres roczny to 365 dni (366 w przestępnym), miesięczny bez zmian', () => {
    expect(periodDays('2026')).toHaveLength(365);
    expect(periodDays('2028')).toHaveLength(366);
    expect(periodDays('2026-11')).toEqual(monthDays('2026-11'));
  });
  it('plan roczny to suma planów miesięcy, a pula pomniejsza się o całość', () => {
    const s = demoState();
    const w = s.workers.find((x) => x.active)!;
    w.leaveDays = 26;
    s.absences.push({ id: 'u1', workerId: w.id, from: '2026-03-02', to: '2026-03-06', reason: 'UW' }, { id: 'u2', workerId: w.id, from: '2026-11-02', to: '2026-11-06', reason: 'UW' });
    const months = Array.from({ length: 12 }, (_, i) => leaveBalance(s, w, `2026-${String(i + 1).padStart(2, '0')}`).planned);
    const year = leaveBalance(s, w, '2026');
    expect(year.planned).toBe(months.reduce((a, b) => a + b, 0));
    expect(year.planned).toBeGreaterThan(leaveBalance(s, w, '2026-03').planned);
    expect(year.left).toBe(26 - year.planned);
  });
  it('cztery dni na żądanie zostają poza planem do listopada, w grudniu się zwalniają', () => {
    const s = demoState();
    const w = s.workers.find((x) => x.active)!;
    w.leaveDays = 10;
    const wd = (m: string, n: number) => monthDays(m).filter((d) => plannedShift(s, w, d)).slice(0, n);
    s.absences = [];
    for (const d of wd('2026-03', 5)) s.absences = setLeaveDay(s.absences, w.id, d, true, ids());
    expect(leaveBalance(s, w, '2026').plannable).toBe(1);
    for (const d of wd('2026-12', 3)) s.absences = setLeaveDay(s.absences, w.id, d, true, ids());
    const b = leaveBalance(s, w, '2026');
    expect(b.plannable).toBe(1);
    expect(b.left).toBe(2);
    for (const d of wd('2026-06', 3)) s.absences = setLeaveDay(s.absences, w.id, d, true, ids());
    expect(leaveBalance(s, w, '2026').plannable).toBe(-2);
  });
  it('zgłoszony urlop: zaplanowany tylko potwierdza, niezaplanowany zabiera dzień z planu, bez planu idzie na żądanie', () => {
    const s = demoState();
    const w = s.workers.find((x) => x.active)!;
    w.leaveDays = 10;
    const wd = (m: string) => monthDays(m).filter((d) => plannedShift(s, w, d));
    const [p1, p2] = wd('2026-08');
    const [r1] = wd('2026-06');
    s.absences = [];
    for (const d of [p1, p2]) s.absences = setLeaveDay(s.absences, w.id, d, true, ids());
    expect(resolveLeaveReport(s, w, p1)).toEqual({ kind: 'planned' });
    const res = resolveLeaveReport(s, w, r1);
    expect(res).toMatchObject({ kind: 'from-plan', planDate: p1, onDemandLeft: 4 });
    const after = { ...s, absences: applyLeaveReport(s.absences, w.id, r1, 'from-plan', p1, ids()) };
    expect(hasLeave(after, w.id, r1)).toBe(true);
    expect(hasLeave(after, w.id, p1)).toBe(false);
    expect(leaveBalance(after, w, '2026').planned).toBe(2);
    // bez planu: z puli na żądanie, pula 4 maleje, a limit „do XI” się nie zmniejsza
    const none = { ...s, absences: [] as typeof s.absences };
    expect(resolveLeaveReport(none, w, r1)).toEqual({ kind: 'on-demand', onDemandLeft: 4 });
    const od = { ...s, absences: applyLeaveReport([], w.id, r1, 'on-demand', undefined, ids()) };
    const b = leaveBalance(od, w, '2026');
    expect(b.onDemandLeft).toBe(3);
    expect(b.left).toBe(9);
    expect(b.plannable).toBe(6);
  });
  it('liczy dni urlopu w miesiącu tylko dla wybranych osób i tylko UW', () => {
    const s = demoState();
    s.absences = [
      { id: 'a', workerId: 'w1', from: '2026-03-30', to: '2026-04-02', reason: 'UW' },
      { id: 'b', workerId: 'w2', from: '2026-03-30', to: '2026-04-02', reason: 'UW' },
      { id: 'c', workerId: 'w1', from: '2026-03-30', to: '2026-03-31', reason: 'L4' },
    ];
    expect(leaveDaysIn(s, new Set(['w1']), monthDays('2026-03'))).toBe(2);
    expect(leaveDaysIn(s, new Set(['w1']), monthDays('2026-04'))).toBe(2);
  });
});
