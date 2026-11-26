import { useCallback, useEffect, useState } from 'react';
import { useApp } from '../data/AppContext';
import { callApi } from '../rcp/api';
import { Sheet } from '../ui';
import { t } from '../i18n';

interface TnaState {
  lastSync?: string;
  lastOk?: string;
  lastError?: string | null;
  added?: number;
  users?: number;
  matched?: number;
  unmatched?: { userHash: string; name?: string; email?: string }[];
}

const ERR: Record<string, string> = {
  tna_auth_401: 'TNA odrzuciło klucz — sprawdź identyfikator i klucz.',
  tna_auth_400: 'TNA odrzuciło klucz — sprawdź identyfikator i klucz.',
  tna_not_configured: 'Brak klucza TNA.',
  'tna_http_403_/v2/users': 'Klucz nie ma uprawnienia do pracowników — w TNA ustaw „Zarządzanie pracownikami: Odczyt”.',
  'tna_http_403_/v2/history': 'Klucz nie ma uprawnienia do historii — w TNA ustaw „Historia pracowników: Odczyt”.',
};
const errText = (e?: string | null) => (e ? t(ERR[e] ?? 'Błąd połączenia z TNA: {e}', { e }) : '');

function ago(iso?: string): string {
  if (!iso) return '—';
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (s < 90) return t('{n} s temu', { n: s });
  if (s < 5400) return t('{n} min temu', { n: Math.round(s / 60) });
  return new Date(iso).toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw' });
}

/** Znaczek stanu w nagłówku RCP: „TNA na żywo · 30 s temu”. */
export function useTna() {
  const { backend } = useApp();
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [state, setState] = useState<TnaState>({});
  const load = useCallback(async () => {
    if (!backend.client) return;
    const r = await callApi<{ configured?: boolean; state?: TnaState }>(backend.client, { action: 'tna_status' });
    if (r.configured !== undefined) {
      setConfigured(r.configured);
      setState(r.state ?? {});
    }
  }, [backend]);
  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(id);
  }, [load]);
  return { configured, state, setState, setConfigured, reload: load };
}

export function TnaBadge({ tna, onClick }: { tna: ReturnType<typeof useTna>; onClick: () => void }) {
  const { configured, state } = tna;
  if (configured === null) return null;
  const ok = configured && !state.lastError;
  const cls = !configured ? '' : ok ? 'green' : 'red';
  return (
    <button type="button" className={`tag ${cls}`} style={{ cursor: 'pointer', border: 0, padding: '6px 10px' }} onClick={onClick} title={errText(state.lastError)}>
      {!configured ? t('Połącz z Comarch TNA') : ok ? `● ${t('TNA na żywo')} · ${ago(state.lastOk)}` : `● ${t('TNA: błąd')}`}
    </button>
  );
}

export default function TnaLive({ tna, onClose }: { tna: ReturnType<typeof useTna>; onClose: () => void }) {
  const { state: app, backend, role } = useApp();
  const { configured, state } = tna;
  const [id, setId] = useState('');
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const db = backend.client;

  const save = async () => {
    if (!db) return;
    setBusy(true);
    setMsg(null);
    const r = await callApi<{ ok?: boolean; users?: number; state?: TnaState }>(db, { action: 'tna_config', clientId: id, clientSecret: key });
    setBusy(false);
    if (!r.ok) return setMsg(errText(r.error));
    setKey('');
    tna.setConfigured(true);
    tna.setState(r.state ?? {});
    setMsg(t('Połączono. Kont w TNA: {n}. Od teraz odbicia przychodzą co minutę.', { n: r.users ?? 0 }));
  };

  const sync = async () => {
    if (!db) return;
    setBusy(true);
    const r = await callApi<{ state?: TnaState }>(db, { action: 'tna_sync', days: 7 });
    setBusy(false);
    if (r.state) tna.setState(r.state);
  };

  const link = async (userHash: string, workerId: string) => {
    if (!db || !workerId) return;
    setBusy(true);
    const r = await callApi<{ state?: TnaState }>(db, { action: 'tna_link', userHash, workerId });
    setBusy(false);
    if (r.state) tna.setState(r.state);
  };

  const workers = [...app.workers].filter((w) => w.active).sort((a, b) => a.name.localeCompare(b.name, 'pl'));

  return (
    <Sheet title={t('Comarch TNA — odbicia na żywo')} sub={t('Odbicia z czytnika TNA trafiają do RCP automatycznie co minutę, przez oficjalne API Comarch TNA.')} onClose={onClose}>
      {configured && (
        <div className="stack">
          <div className="row">
            <span className={`tag ${state.lastError ? 'red' : 'green'}`}>{state.lastError ? t('błąd') : t('połączono')}</span>
            <span className="tag">{t('ostatnio')}: {ago(state.lastSync)}</span>
            {state.users !== undefined && <span className="tag">{t('konta TNA: {n}', { n: state.users })}</span>}
            {state.matched !== undefined && <span className="tag green">{t('powiązane: {n}', { n: state.matched })}</span>}
            {state.added !== undefined && <span className="tag">{t('nowe w ostatnim pobraniu: {n}', { n: state.added })}</span>}
          </div>
          {state.lastError && <div className="note red">{errText(state.lastError)}</div>}
          <div className="row">
            <button type="button" className="btn" disabled={busy} onClick={() => void sync()}>
              {t('Pobierz teraz (ostatnie 7 dni)')}
            </button>
          </div>
          {(state.unmatched?.length ?? 0) > 0 && (
            <div className="stack">
              <h3 style={{ margin: '8px 0 0' }}>{t('Konta TNA bez pracownika w aplikacji ({n})', { n: state.unmatched!.length })}</h3>
              <div className="sub">{t('Wybierz, kim jest ta osoba w aplikacji — jej odbicia zaczną spływać od razu.')}</div>
              {state.unmatched!.map((u) => (
                <div key={u.userHash} className="list-item">
                  <span className="grow">
                    <b>{u.name || '—'}</b> <span className="sub">{u.email}</span>
                  </span>
                  <select defaultValue="" disabled={busy} onChange={(e) => void link(u.userHash, e.target.value)} aria-label={t('Pracownik')}>
                    <option value="">{t('— kto to? —')}</option>
                    {workers.map((w) => (
                      <option key={w.id} value={w.id}>{w.name}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {role === 'admin' && (
        <div className="stack" style={{ marginTop: 16 }}>
          <h3 style={{ margin: 0 }}>{configured ? t('Zmień klucz API') : t('Połącz z Comarch TNA')}</h3>
          <ol className="sub" style={{ margin: 0, paddingLeft: 18 }}>
            <li>{t('W TNA (konto administratora): Ustawienia → API → „Generuj nowy klucz API”.')}</li>
            <li>{t('Uprawnienia klucza: Zarządzanie pracownikami — Odczyt, Historia pracowników — Odczyt.')}</li>
            <li>{t('Wklej poniżej identyfikator klucza i klucz. Klucz trafia tylko na serwer — nie da się go potem odczytać.')}</li>
          </ol>
          <label className="field">
            {t('Identyfikator klucza')}
            <input value={id} onChange={(e) => setId(e.target.value)} autoComplete="off" spellCheck={false} />
          </label>
          <label className="field">
            {t('Klucz')}
            <input type="password" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="new-password" spellCheck={false} />
          </label>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="btn primary" disabled={!id.trim() || !key.trim() || busy} onClick={() => void save()}>
              {busy ? t('Łączę…') : t('Połącz i sprawdź')}
            </button>
          </div>
        </div>
      )}
      {msg && <div className={`note ${msg.startsWith(t('Połączono')) ? 'green' : 'red'}`}>{msg}</div>}
    </Sheet>
  );
}
