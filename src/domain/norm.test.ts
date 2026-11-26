import { describe, expect, it } from 'vitest';
import { monthNorm } from './norm';

describe('wymiar czasu pracy', () => {
  it('liczy miesiące zgodnie z kalendarzem (KP art. 130)', () => {
    // listopad 2026: 21 dni pn–pt, święta 1.11 (nd — nie obniża) i 11.11 (śr) → 20 dni = 160 h
    expect(monthNorm('2026-11')).toEqual({ hours: 160, workdays: 20 });
    // grudzień 2026: 23 dni pn–pt, święta 24 (czw), 25 (pt), 26 (sob — też obniża) → 20 dni
    expect(monthNorm('2026-12')).toEqual({ hours: 160, workdays: 20 });
    // luty 2026: 20 dni pn–pt, bez świąt
    expect(monthNorm('2026-02')).toEqual({ hours: 160, workdays: 20 });
  });
});
