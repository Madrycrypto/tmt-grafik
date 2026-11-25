import { useState } from 'react';
import { useApp } from '../data/AppContext';
import { usePunches } from '../data/punches';
import { addDays, todayIso } from '../domain/dates';
import { fmtMin, suggestDir } from '../domain/punches';
import type { Punch } from '../domain/punches';
import { t } from '../i18n';

/** Token z zeskanowanego kodu kiosku: #/odbij?k=… */
export function scannedToken(): string | null {
  const m = location.hash.match(/^#\/odbij\?(.*)$/);
  return m ? new URLSearchParams(m[1]).get('k') : null;
}

export function clearScan(): void {
  history.replaceState(null, '', location.pathname + location.search + '#/');
}

type Result = { ok: true; punch: Punch; duplicate?: boolean } | { ok: false; error: string };

const ERRORS: Record<string, string> = {
  expired: 'Kod wygasł — zeskanuj go jeszcze raz z ekranu przy wejściu.',
  not_employee: 'To konto nie jest kontem pracownika.',
  unauthorized: 'Zaloguj się ponownie.',
};

/** Odbicie po zeskanowaniu kodu z kiosku: jedno dotknięcie „Wejście” albo „Wyjście”. */
export default function PunchPanel({ token, onDone }: { token: string; onDone: () => void }) {
  const { backend } = useApp();
  const today = todayIso();
  const { punches } = usePunches(addDays(today, -1), today);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const suggested = suggestDir(punches, new Date().toISOString());

  const punch = async (dir: 'in' | 'out') => {
    if (!backend.client) return;
    setBusy(true);
    const { data, error } = await backend.client.functions.invoke('tmt-api', { body: { action: 'punch', k: token, dir } });
    setBusy(false);
    if (data?.ok) setResult({ ok: true, punch: data as Punch, duplicate: !!data.duplicate });
    else {
      let code = (data as { error?: string } | null)?.error;
      const ctx = (error as { context?: Response } | null)?.context;
      if (!code && ctx?.json) code = ((await ctx.json().catch(() => ({}))) as { error?: string }).error;
      setResult({ ok: false, error: t(ERRORS[code ?? ''] ?? 'Nie udało się odbić. Spróbuj jeszcze raz.') });
    }
  };

  if (result?.ok) {
    const p = result.punch;
    const time = new Date(p.at).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Warsaw' });
    return (
      <section className={`card punch-done ${p.dir}`}>
        <div className="big">✓</div>
        <h1>{p.dir === 'in' ? t('Wejście') : t('Wyjście')} · {time}</h1>
        <p>{result.duplicate ? t('To odbicie było już zapisane.') : t('Odbicie zapisane.')}</p>
        <button type="button" className="btn" onClick={onDone}>{t('Gotowe')}</button>
      </section>
    );
  }

  const mineToday = punches.filter((p) => p.date === today).sort((a, b) => a.at.localeCompare(b.at));
  return (
    <section className="card stack punch-panel">
      <h1 style={{ fontSize: 22 }}>{t('Odbicie RCP')}</h1>
      <div className="punch-buttons">
        {(['in', 'out'] as const).map((d) => (
          <button key={d} type="button" disabled={busy} className={`btn punch-btn ${d} ${suggested === d ? 'primary' : ''}`} onClick={() => void punch(d)}>
            {d === 'in' ? t('Wejście') : t('Wyjście')}
            {suggested === d && <span className="sub">{t('proponowane')}</span>}
          </button>
        ))}
      </div>
      {result && !result.ok && <div className="note red">{result.error}</div>}
      {mineToday.length > 0 && (
        <div className="sub">
          {t('Dziś')}: {mineToday.map((p) => `${p.dir === 'in' ? '→' : '←'} ${fmtMin(p.min)}`).join(' · ')}
        </div>
      )}
      <button type="button" className="btn ghost small" onClick={onDone}>{t('Anuluj')}</button>
    </section>
  );
}
