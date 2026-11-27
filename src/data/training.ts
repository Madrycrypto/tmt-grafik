import { useCallback, useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { useApp } from './AppContext';
import { scanPath } from '../domain/training';
import type { TrainingRecord } from '../domain/training';

const BUCKET = 'training-scans';

/** Wpisy szkoleń z odświeżaniem na żądanie i na żywo. Kadra widzi wszystkie, pracownik tylko swoje (RLS). */
export function useTraining(): { records: TrainingRecord[]; reload: () => Promise<void> } {
  const { backend } = useApp();
  const [records, setRecords] = useState<TrainingRecord[]>([]);
  const reload = useCallback(async () => {
    const db = backend.client;
    if (!db) return;
    const { data } = await db.from('training_records').select('*').order('trained_on', { ascending: true }).limit(5000);
    setRecords((data ?? []) as TrainingRecord[]);
  }, [backend]);
  useEffect(() => {
    void reload();
    const db = backend.client;
    if (!db) return;
    const ch = db
      .channel(`training-${Math.random().toString(36).slice(2, 7)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'training_records' }, () => void reload())
      .subscribe();
    return () => {
      void db.removeChannel(ch);
    };
  }, [backend, reload]);
  return { records, reload };
}

/** Zdjęcie z telefonu zmniejszamy do ok. 1600 px (JPEG), żeby skan miał kilkaset KB, a nie kilka MB. PDF zostaje bez zmian. */
export async function shrinkScan(file: File, maxSide = 1600): Promise<{ blob: Blob; ext: string; type: string }> {
  if (!file.type.startsWith('image/')) return { blob: file, ext: file.type === 'application/pdf' ? 'pdf' : 'bin', type: file.type };
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  const blob = await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('jpeg'))), 'image/jpeg', 0.82));
  return { blob, ext: 'jpg', type: 'image/jpeg' };
}

export interface NewTraining {
  worker_id: string;
  station_id: string;
  level: number;
  trained_on: string;
  signed_by: string;
  note: string;
  file: File | null;
}

export async function addTraining(db: SupabaseClient, by: string | null, n: NewTraining): Promise<string | null> {
  const id = crypto.randomUUID();
  let file_path: string | null = null;
  if (n.file) {
    const { blob, ext, type } = await shrinkScan(n.file);
    file_path = scanPath(n.worker_id, id, ext);
    const up = await db.storage.from(BUCKET).upload(file_path, blob, { contentType: type, upsert: false });
    if (up.error) return up.error.message;
  }
  const { error } = await db.from('training_records').insert({
    id,
    worker_id: n.worker_id,
    station_id: n.station_id,
    level: n.level,
    trained_on: n.trained_on,
    signed_by: n.signed_by.trim() || null,
    note: n.note.trim() || null,
    file_path,
    created_by: by,
  });
  if (error) {
    if (file_path) await db.storage.from(BUCKET).remove([file_path]);
    return error.message;
  }
  return null;
}

export async function removeTraining(db: SupabaseClient, r: TrainingRecord): Promise<void> {
  await db.from('training_records').delete().eq('id', r.id);
  if (r.file_path) await db.storage.from(BUCKET).remove([r.file_path]);
}

/** Krótko żyjący link do skanu (magazyn jest prywatny). */
export async function scanUrl(db: SupabaseClient, path: string, seconds = 120): Promise<string | null> {
  const { data } = await db.storage.from(BUCKET).createSignedUrl(path, seconds);
  return data?.signedUrl ?? null;
}
