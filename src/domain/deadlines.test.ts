import { describe, expect, it } from 'vitest';
import { deadlines } from './deadlines';
import { demoState } from './seed';
import { parseDate, planImport, workersCsv, parseDelimited } from './workerImport';

describe('terminy umów i badań', () => {
  it('pokazuje terminy do 60 dni i przeterminowane, ostrzega 30 dni przed, pomija nieaktywnych i bez dat', () => {
    const s = demoState();
    const [a, b, c, d, e] = s.workers;
    a.contractEnd = '2026-12-10'; // za 13 dni → pilne
    b.medicalExpiry = '2026-11-20'; // 7 dni temu → po terminie
    c.contractEnd = '2027-01-15'; // za 49 dni → na liście, jeszcze nie pilne
    d.contractEnd = '2027-06-01'; // poza listą
    e.contractEnd = '2026-12-01';
    e.active = false;
    const r = deadlines(s, '2026-11-27');
    expect(r.map((x) => [x.workerId, x.kind, x.days, x.urgent])).toEqual([
      [b.id, 'medical', -7, true],
      [a.id, 'contract', 13, true],
      [c.id, 'contract', 49, false],
    ]);
  });

  it('parseDate: ISO, dd.mm.rrrr, numer seryjny Excela; odrzuca nieistniejące dni', () => {
    expect(parseDate('2026-12-31')).toBe('2026-12-31');
    expect(parseDate('05.03.2027')).toBe('2027-03-05');
    expect(parseDate('5/3/2027')).toBe('2027-03-05');
    expect(parseDate('46357')).toBe('2026-12-01');
    expect(parseDate('31.02.2027')).toBeUndefined();
    expect(parseDate('jutro')).toBeUndefined();
  });

  it('import i eksport listy przenoszą daty i pulę urlopu', () => {
    const s = demoState();
    const w = s.workers[0];
    const csv = ['Imię i nazwisko;Linia;Koniec umowy;Badanie ważne do;Data zatrudnienia;Pula urlopu', `${w.name};${s.lines.find((l) => l.id === w.lineId)!.name};31.12.2026;2027-02-01;01.03.2024;12,5`].join('\n');
    const plan = planImport(s, parseDelimited(csv), true);
    const it = plan.items[0];
    expect(it.worker).toMatchObject({ id: w.id, contractEnd: '2026-12-31', medicalExpiry: '2027-02-01', hireDate: '2024-03-01', leaveDays: 12.5 });
    s.workers[0] = { ...w, ...it.worker! };
    const out = workersCsv(s, [s.workers[0]]);
    expect(out).toContain('2026-12-31');
    expect(out).toContain('2027-02-01');
  });
});
