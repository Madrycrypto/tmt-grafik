import { describe, expect, it } from 'vitest';
import { detectColumns, importTna, parseDate, parseDir, parseTime } from './tnaImport';
import { emptyState } from './seed';
import type { AppState, Worker } from './types';
import { readTable, unzip } from '../data/readTable';

// dane testowe są zmyślone
function state(): AppState {
  const s = emptyState();
  const w = (id: string, name: string, email?: string): Worker => ({ id, name, type: 'PL', patternId: 'p8', brigade: 'A', lineId: 'L', homeStationId: null, active: true, skills: {}, ...(email ? { email } : {}) });
  s.workers = [w('anna', 'Nowak Anna', 'anna.test@example.com'), w('jan', 'Jan Kowalski'), w('li', 'LiWei')];
  return s;
}
const iso = (d: string, m: number) => `${d}T${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}:00Z`;

describe('import odbić z pliku Comarch TNA', () => {
  it('rozpoznaje daty, godziny i rodzaje zdarzeń w różnych zapisach', () => {
    expect(parseDate('26.11.2026')).toBe('2026-11-26');
    expect(parseDate('2026-11-26 06:58:12')).toBe('2026-11-26');
    expect(parseDate(46352)).toBe('2026-11-26');
    expect(parseTime('6:58')).toBe(418);
    expect(parseTime('2026-11-26 23:05:41')).toBe(1385);
    expect(parseTime(0.25)).toBe(360);
    expect(parseTime(46352.5)).toBe(720);
    expect(parseDir('Wejście')).toEqual({ dir: 'in' });
    expect(parseDir('Wyjście')).toEqual({ dir: 'out' });
    expect(parseDir('Wyjście prywatne')).toEqual({ dir: 'private_out' });
    expect(parseDir('Rozpoczęcie przerwy')).toEqual({ dir: 'private_out' });
    expect(parseDir('Zakończenie przerwy')).toEqual({ dir: 'in', ret: true });
    expect(parseDir('Wyjście służbowe')).toBeNull();
  });

  it('format zdarzeń: wiersz na odbicie, dopasowanie po e-mailu i nazwisku w dowolnej kolejności', () => {
    const rows = [
      ['Raport aktywności pracowników', '', '', ''],
      ['Imię i nazwisko', 'E-mail', 'Data i godzina', 'Typ zdarzenia'],
      ['Anna Nowak', 'anna.test@example.com', '2026-11-26 06:55', 'Wejście'],
      ['Anna Nowak', 'anna.test@example.com', '2026-11-26 10:00', 'Wyjście prywatne'],
      ['Anna Nowak', 'anna.test@example.com', '2026-11-26 10:20', 'Powrót'],
      ['Anna Nowak', 'anna.test@example.com', '2026-11-26 15:02', 'Wyjście'],
      ['Kowalski Jan', '', '26.11.2026 07:01', 'Wejście'],
      ['Osoba Spoza', '', '26.11.2026 07:03', 'Wejście'],
    ];
    const r = importTna(state(), rows, iso);
    expect(r.format).toBe('events');
    expect(r.matched).toBe(2);
    expect(r.unmatched).toEqual(['Osoba Spoza']);
    expect(r.punches.filter((p) => p.workerId === 'anna').map((p) => [p.min, p.dir, !!p.ret])).toEqual([
      [415, 'in', false],
      [600, 'private_out', false],
      [620, 'in', true],
      [902, 'out', false],
    ]);
    // ponowny import tego samego pliku daje te same identyfikatory — bez duplikatów
    expect(importTna(state(), rows, iso).punches.map((p) => p.id)).toEqual(r.punches.map((p) => p.id));
  });

  it('format dzienny: wejście i wyjście w jednym wierszu; nocka kończy się następnego dnia', () => {
    const rows = [
      ['Pracownik', 'Data', 'Wejście', 'Wyjście', 'Czas pracy'],
      ['LiWei', '2026-11-26', '06:57', '19:03', '12:06'],
      ['Jan Kowalski', '2026-11-26', '22:58', '07:01', '8:03'],
      ['Jan Kowalski', '2026-11-27', '', '', ''],
    ];
    const r = importTna(state(), rows, iso);
    expect(r.format).toBe('daily');
    const j = r.punches.filter((p) => p.workerId === 'jan');
    expect(j.map((p) => [p.date, p.min, p.dir])).toEqual([
      ['2026-11-26', 1378, 'in'],
      ['2026-11-27', 421, 'out'],
    ]);
    expect(r.skipped).toBe(1);
  });

  it('bez kolumny rodzaju: kolejne odbicia na zmianę wejście / wyjście; nazwisko tylko w pierwszym wierszu osoby', () => {
    const rows = [
      ['Nazwisko', 'Imię', 'Data', 'Godzina'],
      ['Nowak', 'Anna', '2026-11-26', '06:55'],
      ['', '', '2026-11-26', '15:01'],
      ['', '', '2026-11-27', '06:50'],
    ];
    const r = importTna(state(), rows, iso);
    expect(detectColumns(rows)).toMatchObject({ header: 0, last: 0, first: 1 });
    expect(r.punches.map((p) => p.dir)).toEqual(['in', 'out', 'in']);
  });

  it('nie rozpoznaje pliku bez kolumn osoby i czasu', () => {
    expect(importTna(state(), [['Produkt', 'Ilość'], ['A', 1]], iso).columns).toBeNull();
  });
});

/** Minimalny zip bez kompresji (metoda 0) do testu czytnika .xlsx. */
function zipStored(files: Record<string, string>): Uint8Array {
  const enc = new TextEncoder();
  const parts: number[] = [];
  const central: number[] = [];
  const u16 = (n: number) => [n & 255, (n >> 8) & 255];
  const u32 = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
  let count = 0;
  for (const [name, text] of Object.entries(files)) {
    const nb = [...enc.encode(name)];
    const data = [...enc.encode(text)];
    const offset = parts.length;
    parts.push(...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(0), ...u32(0), ...u32(0), ...u32(data.length), ...u32(data.length), ...u16(nb.length), ...u16(0), ...nb, ...data);
    central.push(...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...u32(0), ...u32(0), ...u32(data.length), ...u32(data.length), ...u16(nb.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset), ...nb);
    count++;
  }
  const cdOffset = parts.length;
  return new Uint8Array([...parts, ...central, ...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(count), ...u16(count), ...u32(central.length), ...u32(cdOffset), ...u16(0)]);
}

describe('czytanie plików', () => {
  it('wypakowuje pliki z archiwum zip (.xlsx)', async () => {
    const files = await unzip(zipStored({ 'xl/worksheets/sheet1.xml': '<x/>', 'docProps/app.xml': '<y/>' }), (n) => n.startsWith('xl/'));
    expect([...files.entries()]).toEqual([['xl/worksheets/sheet1.xml', '<x/>']]);
  });

  it('czyta CSV ze średnikiem (polski Excel)', async () => {
    const t = await readTable('a.csv', new TextEncoder().encode('Pracownik;Data;Wejście\nNowak Anna;2026-11-26;06:55\n'));
    expect(t[1]).toEqual(['Nowak Anna', '2026-11-26', '06:55']);
  });

  it('stary binarny .xls prosi o zapis jako .xlsx', async () => {
    await expect(readTable('a.xls', new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0, 0]))).rejects.toThrow('OLD_XLS');
  });
});
