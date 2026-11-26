import { describe, expect, it } from 'vitest';
import { setAssignment } from './actions';
import { monthDays } from './dates';
import { dayEntry, hrDailyCsv, hrMonthlyCsv, hrSummary } from './hrExport';
import { rotaCell } from './rota';
import { demoState } from './seed';

const F = { month: '2026-12', lineId: 'all', who: 'all', includeInactive: false };

describe('eksport dla kadr', () => {
  it('nocka 23–07 daje 8 h, w tym 7 h nocnych (22–6); dzień 12 h nie ma godzin nocnych', () => {
    const s = demoState();
    const w8 = s.workers.find((w) => w.patternId === 'p8')!;
    const night = monthDays('2026-12').find((d) => rotaCell(s, 'p8', w8.brigade, d).status === 'work' && rotaCell(s, 'p8', w8.brigade, d).code === 'N8')!;
    expect(dayEntry(s, w8, night)).toMatchObject({ code: '23-07', hours: 8, night: 7 });
    const w12 = s.workers.find((w) => w.patternId === 'p12')!;
    const day = monthDays('2026-12').find((d) => rotaCell(s, 'p12', w12.brigade, d).code === 'D12')!;
    expect(dayEntry(s, w12, day)).toMatchObject({ code: '07-19', hours: 12, night: 0 });
  });

  it('nocka z soboty na niedzielę liczy godziny niedzielne od północy', () => {
    const s = demoState();
    const w = s.workers.find((x) => x.patternId === 'p12')!;
    const sat = '2026-12-05';
    setAssignment(s, { date: sat, workerId: w.id, lineId: w.lineId, stationId: null, extraShift: { start: 19, hours: 12 }, source: 'manual' });
    expect(dayEntry(s, w, sat)).toMatchObject({ code: '19-07*', hours: 12, sunday: 7, extra: true });
  });

  it('L4 i urlop zastępują zmianę i są liczone w podsumowaniu', () => {
    const s = demoState();
    const w = s.workers[0];
    s.absences.push({ id: 'a', workerId: w.id, from: '2026-12-01', to: '2026-12-03', reason: 'UW' });
    const sum = hrSummary(s, F).find((x) => x.worker.id === w.id)!;
    expect(sum.days.slice(0, 3).map((d) => d.code)).toEqual(['UW', 'UW', 'UW']);
    expect(sum.absences.UW).toBe(3);
    expect(sum.hours).toBe(sum.days.reduce((a, d) => a + d.hours, 0));
  });

  it('CSV miesięczny ma wiersz na pracownika i kolumnę na każdy dzień', () => {
    const s = demoState();
    const lines = hrMonthlyCsv(s, { ...F, lineId: 'hvac1' }).split('\r\n');
    const head = lines[0].split(';');
    expect(head).toHaveLength(6 + 31 + 9);
    expect(lines.filter((l) => l && !l.startsWith('Legenda') && !l.startsWith('Wygenerowano')).length - 1).toBe(s.workers.filter((w) => w.lineId === 'hvac1').length);
  });

  it('filtr agencji i lista dzienna bez dni wolnych', () => {
    const s = demoState();
    const csv = hrDailyCsv(s, { ...F, who: 'ag:Agencja Bałtyk' });
    const rows = csv.split('\r\n').slice(1);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.includes('Agencja Bałtyk'))).toBe(true);
    expect(rows.some((r) => r.endsWith('W'))).toBe(false);
  });
});
