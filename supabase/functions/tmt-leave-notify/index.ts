// TMT Grafik — push do pracownika po odrzuceniu zgłoszenia urlopu (Supabase Edge Function).
// POST {id: id zgłoszenia} z tokenem admina/edytora. Wysyła tylko dla zgłoszeń odrzuconych przed chwilą.
// Osobna funkcja, żeby nie ruszać tmt-api (RCP, logowanie, TNA).
import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';
import { rejectedPush } from './text.ts';

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  try {
    const body = (await req.json()) as { id?: unknown };
    const email = await callerEmail(req);
    if (!email) return json({ error: 'unauthorized' }, 401);
    const { data: me } = await admin.from('allowed_users').select('role').eq('email', email).maybeSingle();
    if (!me || !['admin', 'editor'].includes(me.role)) return json({ error: 'forbidden' }, 403);

    const { data: r } = await admin.from('leave_reports').select('worker_id,date,status,resolved_at').eq('id', String(body.id ?? '')).maybeSingle();
    if (!r || r.status !== 'rejected' || !r.resolved_at) return json({ sent: 0 });
    if (Date.now() - new Date(r.resolved_at).getTime() > 10 * 60_000) return json({ sent: 0 }); // tylko świeże odrzucenia

    const { data: subs } = await admin.from('push_subscriptions').select('endpoint,lang,subscription').eq('worker_id', r.worker_id);
    if (!subs?.length) return json({ sent: 0 });

    const { data: keys } = await admin.from('app_secrets').select('name,value').in('name', ['vapid_public', 'vapid_private']);
    const m = new Map((keys ?? []).map((k: { name: string; value: string }) => [k.name, k.value]));
    if (!m.get('vapid_public') || !m.get('vapid_private')) return json({ sent: 0 });
    webpush.setVapidDetails('mailto:mostmaciej@gmail.com', m.get('vapid_public')!, m.get('vapid_private')!);

    let sent = 0;
    const gone: string[] = [];
    await Promise.all(
      subs.map(async (s: { endpoint: string; lang: string; subscription: { endpoint: string; keys: { p256dh: string; auth: string } } }) => {
        try {
          await webpush.sendNotification(s.subscription, JSON.stringify({ ...rejectedPush(r.date, s.lang), url: './', tag: `leave-${body.id}` }), { TTL: 86400 });
          sent++;
        } catch (e) {
          const code = (e as { statusCode?: number }).statusCode;
          if (code === 404 || code === 410) gone.push(s.endpoint);
          else console.error('push error', code, (e as Error).message);
        }
      }),
    );
    if (gone.length) await admin.from('push_subscriptions').delete().in('endpoint', gone);
    return json({ sent });
  } catch (e) {
    console.error(e);
    return json({ error: (e as Error).message }, 500);
  }
});
