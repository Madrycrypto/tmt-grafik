import type { Worker } from './types';

/** Wpis szkolenia: jeden stopień (1/4–4/4) na jednym stanowisku, ze skanem podpisanego dokumentu. */
export interface TrainingRecord {
  id: string;
  worker_id: string;
  station_id: string;
  level: number;
  trained_on: string;
  /** kto podpisał dokument (lider, supervisor) */
  signed_by: string | null;
  note: string | null;
  /** ścieżka skanu w prywatnym magazynie */
  file_path: string | null;
  created_by: string | null;
  created_at: string;
}

export interface MissingDoc {
  stationId: string;
  /** stopnie, na które nie ma wpisu szkolenia */
  levels: number[];
}

/** Stopnie, które pracownik ma w Matrixie, a nie ma na nie wpisu szkolenia (do audytu). */
export function missingDocs(w: Worker, records: TrainingRecord[]): MissingDoc[] {
  const mine = records.filter((r) => r.worker_id === w.id);
  const out: MissingDoc[] = [];
  for (const [stationId, entry] of Object.entries(w.skills)) {
    const have = new Set(mine.filter((r) => r.station_id === stationId).map((r) => r.level));
    const levels = [1, 2, 3, 4].filter((l) => l <= entry.level && !have.has(l));
    if (levels.length) out.push({ stationId, levels });
  }
  return out.sort((a, b) => a.stationId.localeCompare(b.stationId));
}

/** Czy konkretny stopień na stanowisku ma dokument (dla znacznika przy kropce). */
export function hasDoc(records: TrainingRecord[], workerId: string, stationId: string, level: number): boolean {
  return records.some((r) => r.worker_id === workerId && r.station_id === stationId && r.level === level);
}

/** Zapis nazwy pliku w magazynie: zawsze pod identyfikatorem pracownika, żeby polityki i porządek były proste. */
export function scanPath(workerId: string, recordId: string, ext: string): string {
  return `${workerId}/${recordId}.${ext.replace(/[^a-z0-9]/gi, '').toLowerCase() || 'jpg'}`;
}
