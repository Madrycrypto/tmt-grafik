import { useEffect, useMemo, useState } from 'react';
import { addDays, fmtDate, monthDays, todayIso, weekday } from '../domain/dates';
import { holidayName } from '../domain/holidays';
import { dayEntry, hrSummary } from '../domain/hrExport';
import { REASON_LABEL, TYPE_LABEL } from '../domain/types';
import type { AbsenceReason } from '../domain/types';
import { useApp } from '../data/AppContext';
import { t } from '../i18n';
import { disablePush, enablePush, isIos, isStandalone, pushState } from '../push';
import type { PushState } from '../push';
import { LangSwitch } from '../ui';

interface InstallEvent extends Event {
  prompt: () => Promise<void>;
}

function useInstallPrompt(): [InstallEvent | null, () => void] {
  const [ev, setEv] = useState<InstallEvent | null>(null);
  useEffect(() => {
    const on = (e: Event) => {
      e.preventDefault();
      setEv(e as InstallEvent);
    };
    window.addEventListener('beforeinstallprompt', on);
    return () => window.removeEventListener('beforeinstallprompt', on);
  }, []);
  return [ev, () => void ev?.prompt().then(() => setEv(null))];
}

function shiftText(code: string): string {
  if (code === 'W') return t('wolne');
  if (code === 'ŚW') return t('święto');
  if (code in REASON_LABEL) return t(REASON_LABEL[code as AbsenceReason]);
  return code.replace('-', '–');
}

function PushCard() {
  const { backend, user, state } = useApp();
  const [st, setSt] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [install, doInstall] = useInstallPrompt();

  useEffect(() => {
    void pushState().then(setSt);
  }, []);

  if (!backend.client || st === null) return null;
  const client = backend.client;

  const on = async () => {
    setBusy(true);
    setMsg(null);
    try {
      setSt(await enablePush(client, user, state.workers[0]?.id ?? null));
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const test = async () => {
    const { data } = await client.functions.invoke('tmt-api', { body: { action: 'test' } });
    setMsg(data?.sent ? t('Wysłano powiadomienie testowe.') : t('Nie udało się wysłać — włącz powiadomienia ponownie.'));
  };

  return (
    <section className="card stack">
      <h2>{t('Powiadomienia')}</h2>
      {st === 'needs-install' && (
        <div className="note amber">
          {isIos()
            ? t('Na iPhonie powiadomienia działają po dodaniu aplikacji do ekranu początkowego: Udostępnij → Do ekranu początkowego, potem otwórz ją z ikony.')
            : t('Dodaj aplikację do ekranu głównego, aby włączyć powiadomienia.')}
        </div>
      )}
      {st === 'unsupported' && <div className="note amber">{t('Ta przeglądarka nie obsługuje powiadomień. Grafik zobaczysz po otwarciu aplikacji.')}</div>}
      {st === 'denied' && <div className="note amber">{t('Powiadomienia są zablokowane w ustawieniach telefonu dla tej strony. Odblokuj je w ustawieniach przeglądarki.')}</div>}
      {st === 'off' && (
        <>
          <div className="sub">{t('Dostaniesz powiadomienie, gdy zmieni się Twój grafik na najbliższe 2 tygodnie.')}</div>
          <button type="button" className="btn primary" disabled={busy} onClick={() => void on()}>
            {t('Włącz powiadomienia')}
          </button>
        </>
      )}
      {st === 'on' && (
        <div className="row" style={{ alignItems: 'center' }}>
          <span className="tag green">{t('Powiadomienia włączone ✓')}</span>
          <button type="button" className="btn small" onClick={() => void test()}>
            {t('Wyślij test')}
          </button>
          <button type="button" className="btn small ghost" onClick={() => void disablePush(client).then(() => setSt('off'))}>
            {t('Wyłącz')}
          </button>
        </div>
      )}
      {install && !isStandalone() && (
        <button type="button" className="btn" onClick={doInstall}>
          {t('Zainstaluj aplikację na telefonie')}
        </button>
      )}
      {msg && <div className="sub">{msg}</div>}
    </section>
  );
}

export default function EmployeeApp({ previewId }: { previewId?: string }) {
  const { state, backend, user, reload } = useApp();
  const [month, setMonth] = useState(todayIso().slice(0, 7));
  const w = previewId ? state.workers.find((x) => x.id === previewId) : state.workers[0];
  const today = todayIso();

  useEffect(() => {
    const on = (e: MessageEvent) => e.data?.type === 'reload-data' && void reload();
    navigator.serviceWorker?.addEventListener('message', on);
    const vis = () => document.visibilityState === 'visible' && void reload();
    document.addEventListener('visibilitychange', vis);
    return () => {
      navigator.serviceWorker?.removeEventListener('message', on);
      document.removeEventListener('visibilitychange', vis);
    };
  }, [reload]);

  const summary = useMemo(
    () => (w ? hrSummary(state, { month, lineId: 'all', who: 'all', includeInactive: true }).find((s) => s.worker.id === w.id) : undefined),
    [state, month, w],
  );
  const next = useMemo(() => {
    if (!w) return null;
    for (let i = 0; i < 21; i++) {
      const d = addDays(today, i);
      const e = dayEntry(state, w, d);
      if (e.hours > 0) return e;
    }
    return null;
  }, [state, w, today]);

  const stationName = (id: string | null | undefined) => (id ? (state.stations.find((s) => s.id === id)?.name ?? '') : t('rezerwa'));
  const shiftMonth = (n: number) => {
    const [y, m] = month.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1 + n, 1));
    setMonth(d.toISOString().slice(0, 7));
  };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      <header className="mobile-top" style={{ display: 'flex' }}>
        <strong style={{ fontFamily: "'Space Grotesk', sans-serif" }}>{t('TMT Grafik')}</strong>
        <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
          <LangSwitch dark />
          {previewId ? (
            <a className="btn small ghost" style={{ color: '#c9d3e6' }} href="#/pracownicy">
              ✕
            </a>
          ) : (
            <button type="button" className="btn small ghost" style={{ color: '#c9d3e6' }} onClick={() => void backend.client?.auth.signOut()}>
              {t('Wyloguj')}
            </button>
          )}
        </span>
      </header>
      <main style={{ maxWidth: 640, margin: '0 auto', padding: '14px 12px 40px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {!w ? (
          <div className="card empty">{t('Twoje konto nie jest jeszcze powiązane z pracownikiem. Poproś przełożonego o sprawdzenie.')}</div>
        ) : (
          <>
            <section className="card">
              <div className="sub">{previewId ? `${t('Podgląd aplikacji pracownika')} · ${w.email ?? ''}` : user}</div>
              <h1 style={{ fontSize: 22 }}>{w.name}</h1>
              <div className="sub">
                {state.lines.find((l) => l.id === w.lineId)?.name} · {t('Brygada')} {w.brigade} · {stationName(w.homeStationId)} ·{' '}
                {w.type === 'AG' && w.agency ? w.agency : t(TYPE_LABEL[w.type])}
              </div>
            </section>

            <section className="card" style={{ background: 'var(--side)', color: '#fff' }}>
              <div style={{ fontSize: 12, color: '#9eabc2' }}>{t('Najbliższa zmiana')}</div>
              {next ? (
                <>
                  <div style={{ fontSize: 26, fontWeight: 700, marginTop: 2 }}>
                    {next.date === today ? t('Dziś') : next.date === addDays(today, 1) ? t('Jutro') : fmtDate(next.date)} · {shiftText(next.code.replace('*', ''))}
                  </div>
                  <div style={{ color: '#c9d3e6', marginTop: 2 }}>
                    {[next.stationId, ...(next.alsoStationIds ?? [])].map((x) => stationName(x ?? null)).join(' + ')}
                    {next.extra ? ` · ${t('dodatkowa zmiana')}` : ''}
                  </div>
                </>
              ) : (
                <div style={{ fontSize: 18, marginTop: 4 }}>{t('Brak zaplanowanych zmian w najbliższych 3 tygodniach.')}</div>
              )}
            </section>

            {!previewId && <PushCard />}

            <section className="card">
              <div className="card-head">
                <button type="button" className="btn small" aria-label={t('Poprzedni miesiąc')} onClick={() => shiftMonth(-1)}>
                  ‹
                </button>
                <h2>{t('Mój grafik')} · {month}</h2>
                <button type="button" className="btn small" aria-label={t('Następny miesiąc')} onClick={() => shiftMonth(1)}>
                  ›
                </button>
              </div>
              {monthDays(month).map((d) => {
                const e = dayEntry(state, w, d);
                const work = e.hours > 0;
                const hol = holidayName(d);
                return (
                  <div
                    key={d}
                    className="list-item"
                    style={{
                      flexWrap: 'nowrap',
                      background: d === today ? 'var(--accent-soft)' : undefined,
                      borderRadius: d === today ? 8 : 0,
                      padding: '9px 8px',
                    }}
                  >
                    <span style={{ width: 64, flex: '0 0 64px', fontWeight: 600, color: weekday(d) === 0 || hol ? 'var(--red-ink)' : undefined }}>{fmtDate(d)}</span>
                    <span className="grow" style={{ minWidth: 0 }}>
                      <b style={{ color: work ? undefined : e.absence ? 'var(--red-ink)' : 'var(--muted)' }}>{shiftText(e.code.replace('*', ''))}</b>
                      {work && <span className="sub"> · {[e.stationId, ...(e.alsoStationIds ?? [])].map((x) => stationName(x ?? null)).join(' + ')}</span>}
                      {e.extra && <span className="tag amber" style={{ marginLeft: 6 }}>{t('dodatkowa zmiana')}</span>}
                      {hol && <div className="sub">{t(hol)}</div>}
                    </span>
                    {work && <span className="sub">{e.hours} h</span>}
                  </div>
                );
              })}
            </section>

            {summary && (
              <section className="card stack">
                <h2>{t('Moje godziny')} · {month}</h2>
                <div className="kpis">
                  <div className="kpi" style={{ background: 'var(--bg)' }}>
                    <div className="k">{t('Dni pracy')}</div>
                    <div className="v">{summary.workDays}</div>
                  </div>
                  <div className="kpi" style={{ background: 'var(--bg)' }}>
                    <div className="k">{t('Godziny')}</div>
                    <div className="v">{summary.hours}</div>
                  </div>
                  <div className="kpi" style={{ background: 'var(--bg)' }}>
                    <div className="k">{t('w tym nocne 22–6')}</div>
                    <div className="v">{summary.night}</div>
                  </div>
                  <div className="kpi" style={{ background: 'var(--bg)' }}>
                    <div className="k">{t('w tym dodatkowe')}</div>
                    <div className="v">{summary.extraHours}</div>
                  </div>
                </div>
                {Object.keys(summary.absences).length > 0 && (
                  <div className="sub">
                    {t('Nieobecności')}: {Object.entries(summary.absences).map(([k, n]) => `${t(REASON_LABEL[k as AbsenceReason])} ${n}`).join(' · ')}
                  </div>
                )}
                <h3>{t('Godziny na stanowiskach')}</h3>
                {Object.entries(summary.byStation)
                  .sort((a, b) => b[1] - a[1])
                  .map(([id, h]) => (
                    <div key={id} className="list-item">
                      <span className="grow">{stationName(id || null)}</span>
                      <b>{Math.round(h * 10) / 10} h</b>
                    </div>
                  ))}
                <div className="sub">{t('Godziny według grafiku. Ostateczne rozliczenie robią kadry.')}</div>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}
