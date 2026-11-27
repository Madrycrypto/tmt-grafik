import { useCallback, useEffect, useState } from 'react';
import { useApp } from './AppContext';

export type ReportStatus = 'pending' | 'confirmed' | 'from_plan' | 'on_demand' | 'rejected';

export interface LeaveReport {
  id: string;
  worker_id: string;
  date: string;
  status: ReportStatus;
  resolved_note: string | null;
  created_at: string;
  resolved_at: string | null;
}

/**
 * Zgłoszenia urlopu od pracowników, odświeżane na żądanie i na żywo.
 * Kadra widzi wszystkie, pracownik tylko swoje (RLS).
 */
export function useLeaveReports(): { reports: LeaveReport[]; reload: () => Promise<void> } {
  const { backend } = useApp();
  const [reports, setReports] = useState<LeaveReport[]>([]);
  const reload = useCallback(async () => {
    const db = backend.client;
    if (!db) return;
    const { data } = await db.from('leave_reports').select('*').order('date', { ascending: true }).limit(500);
    setReports((data ?? []) as LeaveReport[]);
  }, [backend]);
  useEffect(() => {
    void reload();
    const db = backend.client;
    if (!db) return;
    const ch = db
      .channel(`leave-reports-${Math.random().toString(36).slice(2, 7)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leave_reports' }, () => void reload())
      .subscribe();
    return () => {
      void db.removeChannel(ch);
    };
  }, [backend, reload]);
  return { reports, reload };
}
