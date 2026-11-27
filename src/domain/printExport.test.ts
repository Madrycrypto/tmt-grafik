import { unzipSync, strFromU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { buildPrintWorkbook } from './printExport';
import { demoState } from './seed';

describe('eksport do Excela (druk)', () => {
  it('zapisuje dwa arkusze z ustawieniami wydruku i kolorami zmian', () => {
    const s = demoState();
    const p = s.patterns[0];
    const bytes = buildPrintWorkbook(s, { patternId: p.id, month: '2026-12', scopeName: 'Test', lineIds: s.lines.map((l) => l.id) });
    const f = unzipSync(bytes);
    const wb = strFromU8(f['xl/workbook.xml']);
    expect(wb).toContain('name="Brygady"');
    expect(wb).toContain('name="Pracownicy"');
    expect(wb).toContain('_xlnm.Print_Titles');
    const sh2 = strFromU8(f['xl/worksheets/sheet2.xml']);
    expect(sh2).toContain('orientation="landscape"');
    expect(sh2).toContain('fitToHeight="0"');
    expect(sh2).toContain('<brk ');
    expect(strFromU8(f['xl/worksheets/sheet1.xml'])).toContain('Grafik brygad — Test — grudzień 2026');
  });
  it('brygady w pierwszym arkuszu mają kody zmian zgodne z grafikiem', () => {
    const s = demoState();
    const p = s.patterns.find((x) => x.id === 'p8') ?? s.patterns[0];
    const xml = strFromU8(unzipSync(buildPrintWorkbook(s, { patternId: p.id, month: '2026-12', scopeName: 'X', lineIds: s.lines.map((l) => l.id) }))['xl/worksheets/sheet1.xml']);
    expect(xml).toMatch(/<t xml:space="preserve">[RPN]<\/t>/);
  });
});
