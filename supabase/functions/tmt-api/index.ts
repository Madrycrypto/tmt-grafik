// TMT Grafik — funkcja serwerowa (Supabase Edge Function).
// Akcje (POST JSON {action, ...}):
//   vapid  — publiczny klucz VAPID do subskrypcji push (generowany przy pierwszym wywołaniu)
//   reset  — ustawienie nowego hasła kodem aktywacyjnym {email, code, password}
//   notify — wysyłka powiadomień do pracowników (tylko admin/edytor) {items:[{workerId, pl:{title,body}, zh:{title,body}}]}
//   test   — powiadomienie testowe na własne urządzenia zalogowanego
import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

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

async function roleOf(email: string): Promise<string | null> {
  const { data } = await admin.from('allowed_users').select('role').eq('email', email).maybeSingle();
  return data?.role ?? null;
}

let vapidCache: { publicKey: string; privateKey: string } | null = null;

async function vapid() {
  if (vapidCache) return vapidCache;
  const { data } = await admin.from('app_secrets').select('name,value').in('name', ['vapid_public', 'vapid_private']);
  const m = new Map((data ?? []).map((r: { name: string; value: string }) => [r.name, r.value]));
  if (m.get('vapid_public') && m.get('vapid_private')) {
    vapidCache = { publicKey: m.get('vapid_public')!, privateKey: m.get('vapid_private')! };
  } else {
    const k = webpush.generateVAPIDKeys();
    await admin.from('app_secrets').upsert([
      { name: 'vapid_public', value: k.publicKey },
      { name: 'vapid_private', value: k.privateKey },
    ]);
    vapidCache = k;
  }
  webpush.setVapidDetails('mailto:mostmaciej@gmail.com', vapidCache.publicKey, vapidCache.privateKey);
  return vapidCache;
}

interface Msg {
  title: string;
  body: string;
}
interface Sub {
  endpoint: string;
  lang: string;
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } };
}

async function sendTo(subs: Sub[], pick: (lang: string) => Msg & { url?: string }) {
  await vapid();
  let sent = 0;
  const gone: string[] = [];
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(s.subscription, JSON.stringify(pick(s.lang)), { TTL: 86400 });
        sent++;
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) gone.push(s.endpoint);
        else console.error('push error', code, (e as Error).message);
      }
    }),
  );
  if (gone.length) await admin.from('push_subscriptions').delete().in('endpoint', gone);
  return { sent, removed: gone.length };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'bad json' }, 400);
  }

  try {
    switch (body.action) {
      case 'vapid':
        return json({ publicKey: (await vapid()).publicKey });

      case 'reset': {
        const email = String(body.email ?? '').trim().toLowerCase();
        const code = String(body.code ?? '').trim().toUpperCase();
        const password = String(body.password ?? '');
        if (!email || !code || password.length < 6) return json({ error: 'invalid_input' }, 400);
        const { data: row } = await admin.from('allowed_users').select('email,invite_code,code_expires').eq('email', email).maybeSingle();
        const ok = row && row.invite_code && row.invite_code.toUpperCase() === code && (!row.code_expires || new Date(row.code_expires) > new Date());
        if (!ok) {
          await new Promise((r) => setTimeout(r, 800));
          return json({ error: 'bad_code' }, 400);
        }
        const { data: uid } = await admin.rpc('auth_user_id', { p_email: email });
        if (!uid) return json({ error: 'no_account' }, 400);
        const { error } = await admin.auth.admin.updateUserById(uid as string, { password });
        if (error) return json({ error: error.message }, 400);
        await admin.from('allowed_users').update({ invite_code: null, code_expires: null }).eq('email', row!.email);
        return json({ ok: true });
      }

      case 'notify': {
        const email = await callerEmail(req);
        const role = email ? await roleOf(email) : null;
        if (role !== 'admin' && role !== 'editor') return json({ error: 'forbidden' }, 403);
        const items = (Array.isArray(body.items) ? body.items : []).slice(0, 500) as { workerId: string; pl: Msg; zh: Msg }[];
        const ids = [...new Set(items.map((i) => i.workerId))];
        if (!ids.length) return json({ sent: 0 });
        const { data: subs } = await admin.from('push_subscriptions').select('endpoint,lang,subscription,worker_id').in('worker_id', ids);
        let sent = 0;
        let removed = 0;
        for (const it of items) {
          const mine = (subs ?? []).filter((s: { worker_id: string }) => s.worker_id === it.workerId) as Sub[];
          if (!mine.length) continue;
          const r = await sendTo(mine, (lang) => ({ ...(lang === 'zh' ? it.zh : it.pl), url: './' }));
          sent += r.sent;
          removed += r.removed;
        }
        return json({ sent, removed, workers: ids.length });
      }

      case 'test': {
        const email = await callerEmail(req);
        if (!email) return json({ error: 'unauthorized' }, 401);
        const { data: subs } = await admin.from('push_subscriptions').select('endpoint,lang,subscription').eq('email', email);
        if (!subs?.length) return json({ sent: 0, error: 'no_subscriptions' });
        const r = await sendTo(subs as Sub[], (lang) =>
          lang === 'zh' ? { title: 'TMT 排班', body: '测试通知 —— 推送已开启 ✓' } : { title: 'TMT Grafik', body: 'Powiadomienie testowe — powiadomienia działają ✓' },
        );
        return json(r);
      }

      default:
        return json({ error: 'unknown action' }, 400);
    }
  } catch (e) {
    console.error(e);
    return json({ error: (e as Error).message }, 500);
  }
});
