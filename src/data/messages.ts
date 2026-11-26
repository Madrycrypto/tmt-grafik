import { useCallback, useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { useApp } from './AppContext';
import type { Message, MessageRead } from '../domain/messages';

/**
 * Wiadomości od przełożonych z potwierdzeniami przeczytania, odświeżane na żywo.
 * Kadra widzi wszystkie, pracownik tylko swoje (RLS).
 */
export function useMessages(limit = 50): {
  messages: Message[];
  reads: MessageRead[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
} {
  const { backend } = useApp();
  const [messages, setMessages] = useState<Message[]>([]);
  const [reads, setReads] = useState<MessageRead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const db = backend.client;
    if (!db) {
      setLoading(false);
      return;
    }
    const { data, error: e } = await db.from('messages').select('*').order('created_at', { ascending: false }).limit(limit);
    if (e) {
      setError(e.message);
      setLoading(false);
      return;
    }
    const ms = (data ?? []) as Message[];
    const { data: rd } = ms.length
      ? await db.from('message_reads').select('*').in('message_id', ms.map((m) => m.id))
      : { data: [] };
    setMessages(ms);
    setReads((rd ?? []) as MessageRead[]);
    setError(null);
    setLoading(false);
  }, [backend, limit]);

  useEffect(() => {
    void reload();
    const db = backend.client;
    if (!db) return;
    const ch = db
      .channel(`messages-${Math.random().toString(36).slice(2, 7)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, () => void reload())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'message_reads' }, () => void reload())
      .subscribe();
    return () => {
      void db.removeChannel(ch);
    };
  }, [backend, reload]);

  return { messages, reads, loading, error, reload };
}

export interface SendResult {
  recipients: number;
  phones: number;
  sent: number;
}

export async function sendMessage(
  client: SupabaseClient,
  m: { title: string; body: string; audience: string; workerIds: string[]; important: boolean },
): Promise<SendResult> {
  const { data, error } = await client.functions.invoke('tmt-api', { body: { action: 'message', ...m } });
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(String(data.error));
  return data as SendResult;
}

export async function markRead(client: SupabaseClient, workerId: string, ids: string[]): Promise<void> {
  if (!ids.length) return;
  await client.from('message_reads').upsert(
    ids.map((message_id) => ({ message_id, worker_id: workerId })),
    { onConflict: 'message_id,worker_id', ignoreDuplicates: true },
  );
}

export async function deleteMessage(client: SupabaseClient, id: string): Promise<void> {
  const { error } = await client.from('messages').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

/** Pracownicy, którzy mają aplikację z włączonymi powiadomieniami (widzi tylko kadra). */
export function usePhones(): Set<string> {
  const { backend } = useApp();
  const [ids, setIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    const db = backend.client;
    if (!db) return;
    void db
      .from('push_subscriptions')
      .select('worker_id')
      .not('worker_id', 'is', null)
      .then(({ data }) => setIds(new Set((data ?? []).map((r: { worker_id: string }) => r.worker_id))));
  }, [backend]);
  return ids;
}
