// TMT Grafik — funkcja serwerowa (Supabase Edge Function).
// Akcje (POST JSON {action, ...}):
//   vapid  — publiczny klucz VAPID do subskrypcji push (generowany przy pierwszym wywołaniu)
//   reset  — ustawienie nowego hasła kodem aktywacyjnym {email, code, password}
//   notify — wysyłka powiadomień do pracowników (tylko admin/edytor) {items:[{workerId, pl:{title,body}, zh:{title,body}}]}
//   test   — powiadomienie testowe na własne urządzenia zalogowanego
//   kiosk  — kod QR kiosku RCP (ważny 60 s) i ostatnie odbicia (admin/edytor/kiosk)
//   punch  — odbicie pracownika po zeskanowaniu QR {k, dir: 'in'|'out'}; czas bierze serwer
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

// ---------- RCP: kiosk QR ----------
const TOKEN_TTL = 60;
const ZONE = 'Europe/Warsaw';
let kioskKey: CryptoKey | null = null;

async function kioskSecret(): Promise<CryptoKey> {
  if (kioskKey) return kioskKey;
  const { data } = await admin.from('app_secrets').select('value').eq('name', 'kiosk_secret').maybeSingle();
  let secret = data?.value as string | undefined;
  if (!secret) {
    secret = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('');
    await admin.from('app_secrets').upsert({ name: 'kiosk_secret', value: secret });
  }
  kioskKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return kioskKey;
}

async function sign(payload: string): Promise<string> {
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await kioskSecret(), new TextEncoder().encode(payload)));
  return btoa(String.fromCharCode(...sig.slice(0, 16))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Token: <czas unix>.<kiosk>.<podpis>; kiosk = krótka nazwa urządzenia. */
async function makeToken(kiosk: string): Promise<string> {
  const ts = Math.floor(Date.now() / 1000);
  const name = kiosk.replace(/[^a-z0-9_-]/gi, '').slice(0, 20) || 'kiosk';
  return `${ts}.${name}.${await sign(`${ts}.${name}`)}`;
}

async function checkToken(token: string): Promise<string | null> {
  const [ts, name, sig] = token.split('.');
  if (!ts || !name || !sig) return null;
  const age = Math.floor(Date.now() / 1000) - Number(ts);
  if (!(age >= -5 && age <= TOKEN_TTL)) return null;
  return (await sign(`${ts}.${name}`)) === sig ? name : null;
}

function localParts(d: Date): { date: string; min: number } {
  const f = new Intl.DateTimeFormat('sv-SE', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, min: Number(p.hour) * 60 + Number(p.minute) };
}

async function recentPunches(limit = 12) {
  const since = new Date(Date.now() - 16 * 3600_000).toISOString();
  const { data } = await admin.from('records').select('data').eq('kind', 'punches').gte('data->>at', since).order('data->>at', { ascending: false }).limit(limit);
  const rows = (data ?? []).map((r: { data: Record<string, unknown> }) => r.data);
  const ids = [...new Set(rows.map((r) => String(r.workerId)))];
  const { data: ws } = ids.length ? await admin.from('records').select('id,data').eq('kind', 'workers').in('id', ids) : { data: [] };
  const names = new Map((ws ?? []).map((w: { id: string; data: { name: string } }) => [w.id, w.data.name]));
  return rows.map((r) => ({ at: r.at, dir: r.dir, name: names.get(String(r.workerId)) ?? '?' }));
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

      case 'kiosk': {
        const email = await callerEmail(req);
        const role = email ? await roleOf(email) : null;
        if (role !== 'admin' && role !== 'editor' && role !== 'kiosk') return json({ error: 'forbidden' }, 403);
        const name = String(body.kiosk ?? 'wejscie');
        return json({ token: await makeToken(name), ttl: TOKEN_TTL, now: new Date().toISOString(), recent: await recentPunches() });
      }

      case 'punch': {
        const email = await callerEmail(req);
        if (!email) return json({ error: 'unauthorized' }, 401);
        const { data: me } = await admin.from('allowed_users').select('role,worker_id').eq('email', email).maybeSingle();
        if (!me?.worker_id || me.role !== 'employee') return json({ error: 'not_employee' }, 403);
        const kiosk = await checkToken(String(body.k ?? ''));
        if (!kiosk) return json({ error: 'expired' }, 400);
        const dir = body.dir === 'out' ? 'out' : body.dir === 'in' ? 'in' : null;
        if (!dir) return json({ error: 'invalid_input' }, 400);
        const now = new Date();
        // podwójne zeskanowanie w ciągu 2 minut nie tworzy drugiego odbicia
        const { data: last } = await admin.from('records').select('data').eq('kind', 'punches').eq('data->>workerId', me.worker_id).order('data->>at', { ascending: false }).limit(1).maybeSingle();
        const prev = last?.data as { at: string; dir: string } | undefined;
        if (prev && prev.dir === dir && now.getTime() - new Date(prev.at).getTime() < 120_000) return json({ ok: true, duplicate: true, ...prev });
        const id = crypto.randomUUID();
        const punch = { id, workerId: me.worker_id, at: now.toISOString(), ...localParts(now), dir, source: 'qr', kiosk };
        const { error } = await admin.from('records').insert({ kind: 'punches', id, data: punch, updated_by: email });
        if (error) return json({ error: error.message }, 500);
        return json({ ok: true, ...punch });
      }

      default:
        return json({ error: 'unknown action' }, 400);
    }
  } catch (e) {
    console.error(e);
    return json({ error: (e as Error).message }, 500);
  }
});
