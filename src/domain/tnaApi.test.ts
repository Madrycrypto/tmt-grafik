import { describe, expect, it } from 'vitest';
import { dirOf, matchUsers, toPunch } from '../../supabase/functions/tmt-api/tna';

// dane testowe są zmyślone
const workers = [
  { id: 'w1', name: 'Nowak Anna', email: 'anna.test@example.com' },
  { id: 'w2', name: 'Jan Kowalski' },
  { id: 'w3', name: 'Łukasz Żółw' },
];

describe('integracja z API Comarch TNA', () => {
  it('łączy konta TNA z pracownikami po e-mailu, nazwisku w dowolnej kolejności i ręcznym powiązaniu', () => {
    const { map, unmatched } = matchUsers(
      [
        { userHash: 'h1', nameAndLastname: 'Inna Nazwa', email: 'Anna.Test@example.com' },
        { userHash: 'h2', nameAndLastname: 'Kowalski Jan' },
        { userHash: 'h3', nameAndLastname: 'Lukasz Zolw' },
        { userHash: 'h4', nameAndLastname: 'Osoba Spoza' },
        { userHash: 'h5', nameAndLastname: 'Ktoś Jeszcze' },
      ],
      workers,
      { h5: 'w2' },
    );
    expect(Object.fromEntries(map)).toEqual({ h1: 'w1', h2: 'w2', h3: 'w3', h5: 'w2' });
    expect(unmatched.map((u) => u.userHash)).toEqual(['h4']);
  });

  it('zamienia odbicie TNA na odbicie aplikacji w czasie polskim, z tym samym id co import z pliku', () => {
    // 2026-11-26 05:58:12 UTC = 06:58 w Polsce (CET)
    const p = toPunch({ timestamp: Date.UTC(2026, 10, 26, 5, 58, 12) / 1000, direction: 'IN', entry: { description: 'Wejście A', building: { description: 'Hala 1' } } }, 'w1')!;
    expect(p).toMatchObject({ date: '2026-11-26', min: 418, dir: 'in', source: 'tna', kiosk: 'Hala 1 / Wejście A' });
    expect(p.id).toBe('tna-w1-2026-11-26-418-in');
    // lato (CEST): 22:30 UTC = 00:30 następnego dnia
    expect(toPunch({ timestamp: Date.UTC(2026, 6, 1, 22, 30) / 1000, direction: 'OUT' }, 'w1')).toMatchObject({ date: '2026-07-02', min: 30, dir: 'out' });
    expect(toPunch({ timestamp: 1, direction: 'UNKNOWN' }, 'w1')).toBeNull();
    expect(dirOf('out')).toBe('out');
  });
});
