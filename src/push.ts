import type { SupabaseClient } from '@supabase/supabase-js';
import { lang } from './i18n';

export type PushState = 'unsupported' | 'needs-install' | 'denied' | 'off' | 'on';

export function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
}

function b64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function pushState(): Promise<PushState> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return isIos() && !isStandalone() ? 'needs-install' : 'unsupported';
  }
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return sub && Notification.permission === 'granted' ? 'on' : 'off';
}

/** Włącza powiadomienia na tym urządzeniu i zapisuje subskrypcję w bazie. Wywołać z kliknięcia. */
export async function enablePush(client: SupabaseClient, email: string, workerId: string | null): Promise<PushState> {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return perm === 'denied' ? 'denied' : 'off';
  const reg = await navigator.serviceWorker.ready;
  const { data, error } = await client.functions.invoke('tmt-api', { body: { action: 'vapid' } });
  if (error || !data?.publicKey) throw new Error(error?.message ?? 'vapid');
  let sub = await reg.pushManager.getSubscription();
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(data.publicKey) });
  const { error: e2 } = await client.from('push_subscriptions').upsert({
    endpoint: sub.endpoint,
    email: email.toLowerCase(),
    worker_id: workerId,
    lang,
    subscription: sub.toJSON(),
  });
  if (e2) throw new Error(e2.message);
  return 'on';
}

export async function disablePush(client: SupabaseClient): Promise<void> {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await client.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
  await sub.unsubscribe();
}

/** Po zmianie języka: zaktualizuj język powiadomień na tym urządzeniu. */
export async function syncPushLang(client: SupabaseClient): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) await client.from('push_subscriptions').update({ lang }).eq('endpoint', sub.endpoint);
}
