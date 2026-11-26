import type { SupabaseClient } from '@supabase/supabase-js';
import type { PunchOutcome } from './PunchResult';
import type { Punch } from '../domain/punches';

/** Wywołanie funkcji tmt-api z odczytem kodu błędu także przy odpowiedzi 4xx. */
export async function callApi<T = Record<string, unknown>>(client: SupabaseClient, body: Record<string, unknown>): Promise<T & { error?: string }> {
  const { data, error } = await client.functions.invoke('tmt-api', { body });
  if (data) return data as T & { error?: string };
  const ctx = (error as { context?: Response } | null)?.context;
  if (ctx?.json) {
    const j = (await ctx.json().catch(() => null)) as (T & { error?: string }) | null;
    if (j) return j;
  }
  return { error: 'network' } as T & { error?: string };
}

export function toOutcome(r: Record<string, unknown> & { error?: string }): PunchOutcome {
  if (r.error) return { error: r.error, name: r.name as string | undefined };
  return { punch: r as unknown as Punch & { name?: string }, duplicate: !!r.duplicate };
}
