import { describe, expect, it } from 'vitest';
import { setAssignment } from './actions';
import { monthDays } from './dates';
import { audienceLabel, recipients, shiftOptions } from './messages';
import { rotaCell } from './rota';
import { demoState } from './seed';

describe('adresaci wiadomości', () => {
  it('wszyscy = tylko aktywni', () => {
    const s = demoState();
    s.workers[0].active = false;
    const r = recipients(s, { kind: 'all' });
    expect(r.length).toBe(s.workers.length - 1);
    expect(r.some((w) => w.id === s.workers[0].id)).toBe(false);
  });

  it('linia z brygadą zawęża do tej brygady', () => {
    const s = demoState();
    const lineId = s.workers[0].lineId;
    const all = recipients(s, { kind: 'line', lineId });
    const a = recipients(s, { kind: 'line', lineId, brigade: 'A' });
    expect(all.every((w) => w.lineId === lineId)).toBe(true);
    expect(a.length).toBeGreaterThan(0);
    expect(a.length).toBeLessThan(all.length);
    expect(a.every((w) => w.brigade === 'A')).toBe(true);
  });

  it('grupa obejmuje wszystkie podlinie z tą samą linią główną', () => {
    const s = demoState();
    const [l1, l2] = s.lines;
    l1.group = 'CFM';
    l2.group = 'CFM';
    const r = recipients(s, { kind: 'group', group: 'CFM' });
    expect(new Set(r.map((w) => w.lineId))).toEqual(new Set([l1.id, l2.id]));
  });

  it('zmiana: tylko pracujący tego dnia na tej zmianie, bez nieobecnych', () => {
    const s = demoState();
    const w = s.workers[0];
    const day = monthDays('2026-12').find((d) => rotaCell(s, w.patternId, w.brigade, d).status === 'work')!;
    const opts = shiftOptions(s, day, w.lineId);
    expect(opts.length).toBeGreaterThan(0);
    const mine = opts.find((o) => recipients(s, { kind: 'shift', date: day, start: o.start, lineId: w.lineId }).some((x) => x.id === w.id))!;
    expect(mine.count).toBe(recipients(s, { kind: 'shift', date: day, start: mine.start, lineId: w.lineId }).length);
    s.absences.push({ id: 'ab1', workerId: w.id, from: day, to: day, reason: 'L4' });
    expect(recipients(s, { kind: 'shift', date: day, start: mine.start, lineId: w.lineId }).some((x) => x.id === w.id)).toBe(false);
  });

  it('zmiana dodatkowa na innej linii liczy się do tamtej linii', () => {
    const s = demoState();
    const w = s.workers[0];
    const other = s.lines.find((l) => l.id !== w.lineId)!;
    const day = monthDays('2026-12').find((d) => rotaCell(s, w.patternId, w.brigade, d).status !== 'work')!;
    setAssignment(s, { date: day, workerId: w.id, lineId: other.id, stationId: null, source: 'manual', extraShift: { start: 6, hours: 8 } });
    expect(recipients(s, { kind: 'shift', date: day, start: 6, lineId: other.id }).some((x) => x.id === w.id)).toBe(true);
    expect(recipients(s, { kind: 'shift', date: day, start: 6, lineId: w.lineId }).some((x) => x.id === w.id)).toBe(false);
  });

  it('opis adresatów', () => {
    const s = demoState();
    expect(audienceLabel(s, { kind: 'all' })).toBe('Wszyscy');
    expect(audienceLabel(s, { kind: 'workers', ids: [s.workers[0].id] })).toBe(s.workers[0].name);
    expect(audienceLabel(s, { kind: 'line', lineId: s.lines[0].id, brigade: 'B' })).toBe(`Linia ${s.lines[0].name} · brygada B`);
  });
});
