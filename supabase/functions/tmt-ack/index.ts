// TMT Grafik — potwierdzenie odbioru wiadomości przez pracownika (Supabase Edge Function).
// POST {ids: [id wiadomości]} z tokenem zalogowanego pracownika: zapisuje potwierdzenie
// i wysyła autorowi wiadomości push (mała grupa: każde potwierdzenie, duża: ostatnie).
// Osobna funkcja, żeby nie ruszać tmt-api (RCP, logowanie, TNA).
import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';
import { ackPush } from './ack.ts';

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

async function callerEmail(req: Request): Promise<string | null> {
  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!token || !token.includes('.')) return null;
  const { data } = await admin.auth.getUser(token);
  return data.user?.email?.toLowerCase() ?? null;
}

let vapidReady = false;
async function vapid() {
  if (vapidReady) return;
  const { data } = await admin.from('app_secrets').select('name,value').in('name', ['vapid_public', 'vapid_private']);
  const m = new Map((data ?? []).map((r: { name: string; value: string }) => [r.name, r.value]));
  // klucze generuje tmt-api; bez nich nie ma jeszcze żadnych subskrypcji, więc nie ma komu wysyłać
  if (!m.get('vapid_public') || !m.get('vapid_private')) throw new Error('no_vapid');
  webpush.setVapidDetails('mailto:mostmaciej@gmail.com', m.get('vapid_public')!, m.get('vapid_private')!);
  vapidReady = true;
}

interface Sub {
  endpoint: string;
  lang: string;
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } };
}

async function sendTo(subs: Sub[], pick: (lang: string) => Record<string, unknown>) {
  await vapid();
  const gone: string[] = [];
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(s.subscription, JSON.stringify(pick(s.lang)), { TTL: 86400 });
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) gone.push(s.endpoint);
        else console.error('push error', code, (e as Error).message);
      }
    }),
  );
  if (gone.length) await admin.from('push_subscriptions').delete().in('endpoint', gone);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  try {
    const body = (await req.json()) as { ids?: unknown };
    const email = await callerEmail(req);
    if (!email) return json({ error: 'unauthorized' }, 401);
    const { data: me } = await admin.from('allowed_users').select('role,worker_id').eq('email', email).maybeSingle();
    if (!me?.worker_id || me.role !== 'employee') return json({ error: 'not_employee' }, 403);
    const ids = [...new Set((Array.isArray(body.ids) ? body.ids : []).map(String))].slice(0, 50);
    if (!ids.length) return json({ confirmed: 0 });

    const { data: msgs } = await admin.from('messages').select('id,author,title,worker_ids').in('id', ids).contains('worker_ids', [me.worker_id]);
    const { data: w } = await admin.from('records').select('data').eq('kind', 'workers').eq('id', me.worker_id).maybeSingle();
    const name = (w?.data as { name?: string } | undefined)?.name ?? '?';

    let confirmed = 0;
    for (const m of (msgs ?? []) as { id: string; author: string; title: string | null; worker_ids: string[] }[]) {
      const { data: ins, error } = await admin
        .from('message_reads')
        .upsert({ message_id: m.id, worker_id: me.worker_id }, { onConflict: 'message_id,worker_id', ignoreDuplicates: true })
        .select('message_id');
      if (error) return json({ error: error.message }, 500);
      if (!ins?.length) continue; // już potwierdzone wcześniej
      confirmed++;
      const { count } = await admin.from('message_reads').select('message_id', { count: 'exact', head: true }).eq('message_id', m.id).in('worker_id', m.worker_ids);
      const input = { title: m.title, total: m.worker_ids.length, confirmed: count ?? 0, names: [name] };
      if (!ackPush(input, 'pl')) continue;
      const { data: subs } = await admin.from('push_subscriptions').select('endpoint,lang,subscription').ilike('email', m.author.replace(/[%_\\]/g, '\\$&'));
      if (subs?.length) {
        try {
          await sendTo(subs as Sub[], (lang) => ({ ...ackPush(input, lang)!, url: './#/wiadomosci', tag: `ack-${m.id}` }));
        } catch (e) {
          console.error('ack push failed', (e as Error).message); // potwierdzenie jest już zapisane
        }
      }
    }
    return json({ confirmed });
  } catch (e) {
    console.error(e);
    return json({ error: (e as Error).message }, 500);
  }
});
