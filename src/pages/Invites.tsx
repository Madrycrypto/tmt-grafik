import { useCallback, useEffect, useState } from 'react';
import qrcode from 'qrcode-generator';
import type { SupabaseClient } from '@supabase/supabase-js';
import { inviteCode } from '../domain/notify';
import type { AppState, Worker } from '../domain/types';
import { appUrl } from '../data/backend';
import { useApp } from '../data/AppContext';
import { t } from '../i18n';
import { codeExpiry } from './Access';

export interface Account {
  email: string;
  workerId: string;
  code: string | null;
  expires: string | null;
}

/** Konta pracowników (admin) i telefony z włączonymi powiadomieniami (kadra). */
export function useAccounts() {
  const { backend, role } = useApp();
  const [accounts, setAccounts] = useState<Map<string, Account>>(new Map());
  const [push, setPush] = useState<Set<string>>(new Set());
  const db = backend.client;

  const reload = useCallback(async () => {
    if (!db) return;
    if (role === 'admin') {
      const { data } = await db.from('allowed_users').select('email,worker_id,invite_code,code_expires').eq('role', 'employee');
      setAccounts(
        new Map(
          (data ?? [])
            .filter((r) => r.worker_id)
            .map((r) => [r.worker_id as string, { email: r.email, workerId: r.worker_id, code: r.invite_code, expires: r.code_expires }]),
        ),
      );
    }
    const { data: subs } = await db.from('push_subscriptions').select('worker_id');
    setPush(new Set((subs ?? []).map((s) => s.worker_id).filter(Boolean)));
  }, [db, role]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { accounts, push, reload, enabled: !!db && role === 'admin' };
}

export interface InviteResult {
  invited: { worker: Worker; email: string; code: string }[];
  skipped: { worker: Worker; reason: string }[];
}

/** Dopisuje pracowników do listy dostępu z rolą „employee” i nowym kodem aktywacyjnym (ważny 14 dni). */
export async function inviteWorkers(db: SupabaseClient, workers: Worker[]): Promise<InviteResult> {
  const res: InviteResult = { invited: [], skipped: [] };
  const withEmail = workers.filter((w) => {
    if (!w.email) res.skipped.push({ worker: w, reason: t('brak e-maila') });
    return !!w.email;
  });
  if (!withEmail.length) return res;
  const emails = withEmail.map((w) => w.email!.toLowerCase());
  const { data: existing } = await db.from('allowed_users').select('email,role,worker_id').in('email', emails);
  const rows = [];
  for (const w of withEmail) {
    const email = w.email!.toLowerCase();
    const ex = existing?.find((e) => e.email === email);
    if (ex && ex.role !== 'employee') {
      res.skipped.push({ worker: w, reason: t('ten e-mail ma konto kadry') });
      continue;
    }
    if (ex && ex.worker_id && ex.worker_id !== w.id) {
      res.skipped.push({ worker: w, reason: t('ten e-mail ma już inny pracownik') });
      continue;
    }
    const code = inviteCode();
    rows.push({ email, role: 'employee', worker_id: w.id, invite_code: code, code_expires: codeExpiry() });
    res.invited.push({ worker: w, email, code });
  }
  if (rows.length) {
    const { error } = await db.from('allowed_users').upsert(rows);
    if (error) throw new Error(error.message);
  }
  return res;
}

export async function revokeWorker(db: SupabaseClient, workerId: string): Promise<void> {
  await db.from('allowed_users').delete().eq('worker_id', workerId).eq('role', 'employee');
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

/** Kartki A4 (po 6 na stronę) z kodem QR, e-mailem i kodem aktywacyjnym — po polsku i po chińsku. */
export function printCards(state: AppState, items: { worker: Worker; email: string; code: string }[]): void {
  const cards = items
    .map(({ worker, email, code }) => {
      const link = `${appUrl()}?kod=${encodeURIComponent(code)}&e=${encodeURIComponent(email)}`;
      const qr = qrcode(0, 'M');
      qr.addData(link);
      qr.make();
      const line = state.lines.find((l) => l.id === worker.lineId);
      return `<div class="card">
  <div class="qr">${qr.createSvgTag({ cellSize: 3, margin: 0, scalable: true })}</div>
  <div class="txt">
    <div class="name">${esc(worker.name)}</div>
    <div class="meta">${esc([line?.group, line?.name].filter(Boolean).join(' · '))} · ${esc(t('Brygada'))} ${worker.brigade}</div>
    <div class="lbl">E-mail / 邮箱</div><div class="val">${esc(email)}</div>
    <div class="lbl">Kod / 激活码</div><div class="code">${code}</div>
    <ol>
      <li>Zeskanuj kod QR telefonem · 用手机扫描二维码</li>
      <li>Ustaw hasło → „Utwórz konto” · 设置密码 → “创建账号”</li>
      <li>Dodaj do ekranu głównego i włącz powiadomienia · 添加到主屏幕并开启通知</li>
    </ol>
    <div class="url">${esc(appUrl())}</div>
  </div>
</div>`;
    })
    .join('\n');
  const html = `<!doctype html><html lang="pl"><head><meta charset="utf-8"><title>TMT Grafik — kody aktywacyjne</title>
<style>
@page { size: A4; margin: 10mm; }
body { margin: 0; font-family: Arial, 'Microsoft YaHei', 'PingFang SC', sans-serif; color: #111; }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6mm; }
.card { border: 1px dashed #888; border-radius: 3mm; padding: 4mm; display: flex; gap: 4mm; break-inside: avoid; height: 84mm; box-sizing: border-box; }
.qr { width: 32mm; flex: 0 0 32mm; } .qr svg { width: 32mm; height: 32mm; }
.txt { flex: 1; min-width: 0; font-size: 9.5pt; }
.name { font-size: 13pt; font-weight: bold; } .meta { color: #555; margin-bottom: 2mm; }
.lbl { color: #555; font-size: 8pt; margin-top: 1.5mm; } .val { word-break: break-all; }
.code { font: bold 18pt monospace; letter-spacing: 2mm; }
ol { padding-left: 4mm; margin: 2mm 0; font-size: 8pt; } .url { font-size: 7.5pt; color: #555; word-break: break-all; }
</style></head><body><div class="grid">${cards}</div><script>window.onload=()=>setTimeout(()=>window.print(),300)</script></body></html>`;
  const win = window.open('', '_blank');
  if (!win) {
    alert(t('Przeglądarka zablokowała nowe okno. Zezwól na wyskakujące okna dla tej strony.'));
    return;
  }
  win.document.write(html);
  win.document.close();
}

/**
 * Karty RCP do wydruku (format karty kredytowej, 2 kolumny): kod QR karty pokazuje się
 * kamerze tabletu przy wejściu. Kod jest tajny — kartę zgubioną unieważnia „nowa karta”.
 */
export function printBadges(state: AppState, items: { worker: Worker; qr: string }[]): void {
  const cards = items
    .map(({ worker, qr: text }) => {
      const qr = qrcode(0, 'M');
      qr.addData(text);
      qr.make();
      const line = state.lines.find((l) => l.id === worker.lineId);
      return `<div class="card">
  <div class="qr">${qr.createSvgTag({ cellSize: 3, margin: 0, scalable: true })}</div>
  <div class="txt">
    <div class="brand">TMT · RCP</div>
    <div class="name">${esc(worker.name)}</div>
    <div class="meta">${esc([line?.group, line?.name].filter(Boolean).join(' · '))} · ${esc(t('Brygada'))} ${worker.brigade}</div>
    <div class="how">Pokaż kod kamerze tabletu przy wejściu · 在入口平板摄像头前出示此码</div>
  </div>
</div>`;
    })
    .join('\n');
  const html = `<!doctype html><html lang="pl"><head><meta charset="utf-8"><title>TMT — karty RCP</title>
<style>
@page { size: A4; margin: 10mm; }
body { margin: 0; font-family: Arial, 'Microsoft YaHei', 'PingFang SC', sans-serif; color: #111; }
.grid { display: grid; grid-template-columns: 85.6mm 85.6mm; gap: 6mm; justify-content: center; }
.card { width: 85.6mm; height: 54mm; border: 1px solid #999; border-radius: 3mm; padding: 4mm; display: flex; gap: 4mm; break-inside: avoid; box-sizing: border-box; }
.qr { width: 38mm; flex: 0 0 38mm; } .qr svg { width: 38mm; height: 38mm; }
.txt { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.brand { font-size: 8pt; color: #2457d6; font-weight: bold; letter-spacing: 1px; }
.name { font-size: 13pt; font-weight: bold; margin-top: 2mm; } .meta { color: #555; font-size: 8.5pt; }
.how { margin-top: auto; font-size: 7.5pt; color: #444; }
</style></head><body><div class="grid">${cards}</div><script>window.onload=()=>setTimeout(()=>window.print(),300)</script></body></html>`;
  const win = window.open('', '_blank');
  if (!win) {
    alert(t('Przeglądarka zablokowała nowe okno. Zezwól na wyskakujące okna dla tej strony.'));
    return;
  }
  win.document.write(html);
  win.document.close();
}
