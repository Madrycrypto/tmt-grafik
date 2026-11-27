import { describe, expect, it } from 'vitest';
import { demoState } from './seed';
import { hasDoc, missingDocs, scanPath } from './training';
import type { TrainingRecord } from './training';

const rec = (workerId: string, stationId: string, level: number): TrainingRecord => ({
  id: `${workerId}-${stationId}-${level}`,
  worker_id: workerId,
  station_id: stationId,
  level,
  trained_on: '2026-01-10',
  signed_by: null,
  note: null,
  file_path: null,
  created_by: null,
  created_at: '2026-01-10T10:00:00Z',
});

describe('szkolenia', () => {
  it('brak dokumentu dla każdego stopnia do poziomu z Matrixa', () => {
    const w = demoState().workers[0];
    w.skills = { s1: { level: 3 }, s2: { level: 1 } };
    const records = [rec(w.id, 's1', 1), rec(w.id, 's1', 3), rec('inny', 's2', 1)];
    expect(missingDocs(w, records)).toEqual([
      { stationId: 's1', levels: [2] },
      { stationId: 's2', levels: [1] },
    ]);
  });
  it('komplet dokumentów daje pustą listę, a wyższy stopień niż w Matrixie nie przeszkadza', () => {
    const w = demoState().workers[0];
    w.skills = { s1: { level: 2 } };
    expect(missingDocs(w, [rec(w.id, 's1', 1), rec(w.id, 's1', 2), rec(w.id, 's1', 4)])).toEqual([]);
  });
  it('hasDoc patrzy na pracownika, stanowisko i stopień', () => {
    const r = [rec('a', 's1', 2)];
    expect(hasDoc(r, 'a', 's1', 2)).toBe(true);
    expect(hasDoc(r, 'a', 's1', 1)).toBe(false);
    expect(hasDoc(r, 'b', 's1', 2)).toBe(false);
  });
  it('ścieżka skanu jest pod pracownikiem i ma bezpieczne rozszerzenie', () => {
    expect(scanPath('hv-a01', 'x1', 'JPG')).toBe('hv-a01/x1.jpg');
    expect(scanPath('hv-a01', 'x1', '../x')).toBe('hv-a01/x1.x');
  });
});
