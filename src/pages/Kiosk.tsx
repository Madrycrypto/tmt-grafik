import { useCallback, useEffect, useRef, useState } from 'react';
import qrcode from 'qrcode-generator';
import { useApp } from '../data/AppContext';
import { appUrl } from '../data/backend';
import { DIR_LABEL } from '../domain/punches';
import type { Punch } from '../domain/punches';
import { callApi, toOutcome } from '../rcp/api';
import PunchResult from '../rcp/PunchResult';
import type { PunchOutcome } from '../rcp/PunchResult';
import QrScan from '../rcp/QrScan';
import { LangSwitch, usePersistent } from '../ui';
import { t } from '../i18n';

interface Recent {
  id: string;
  at: string;
  dir: Punch['dir'];
  ret?: boolean;
  name: string;
}

/** Nowy kod QR co tyle sekund; serwer przyjmuje kod przez 60 s, więc zdjęcie kodu szybko się przeterminuje. */
const QR_EVERY = 20;
const POLL_MS = 3000;
/** Tryb „wyjście prywatne” po naciśnięciu przycisku trwa tyle, potem wraca do zwykłego. */
const PRIVATE_ARM_MS = 20_000;

export function punchUrl(token: string, priv = false): string {
  return `${appUrl()}#/odbij?k=${encodeURIComponent(token)}${priv ? '&p=1' : ''}`;
}

function hhmm(iso: string): string {
  return new Date(iso).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Warsaw' });
}

function svgOf(text: string, cell = 8): string {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: cell, margin: 2, scalable: true });
}

const tone = (r: { dir: Punch['dir']; ret?: boolean }) => (r.dir === 'private_out' ? 'amber' : r.dir === 'out' ? 'red' : 'green');

/**
 * Ekran tabletu przy wejściu. Dwa sposoby, oba bez klikania:
 * telefon pracownika skanuje kod z ekranu albo tablet skanuje kartę / kod z telefonu.
 */
export default function Kiosk() {
  const { backend, user } = useApp();
  const [token, setToken] = useState<string | null>(null);
  const [recent, setRecent] = useState<Recent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(new Date());
  const [camOn, setCamOn] = usePersistent('kiosk-cam', true);
  const [facing, setFacing] = usePersistent<'user' | 'environment'>('kiosk-facing', 'user');
  const [privUntil, setPrivUntil] = useState(0);
  const [result, setResult] = useState<PunchOutcome | null>(null);
  const tokenAt = useRef(0);
  const seen = useRef<Set<string> | null>(null);
  const mine = useRef<Set<string>>(new Set());
  const name = new URLSearchParams(location.hash.split('?')[1] ?? '').get('nazwa') ?? 'wejscie';
  const priv = privUntil > now.getTime();

  useEffect(() => {
    const db = backend.client;
    if (!db) {
      setError(t('Kiosk działa tylko z bazą w chmurze.'));
      return;
    }
    let stop = false;
    const tick = async () => {
      const data = await callApi<{ token?: string; recent?: Recent[] }>(db, { action: 'kiosk', kiosk: name });
      if (stop) return;
      if (!data.token) {
        setError(t('Brak połączenia z serwerem — odbicia są wstrzymane.'));
        return;
      }
      setError(null);
      if (Date.now() - tokenAt.current > QR_EVERY * 1000) {
        setToken(data.token);
        tokenAt.current = Date.now();
      }
      const list = data.recent ?? [];
      // odbicie z telefonu (nie z kamery tabletu): też pokaż duży kolorowy ekran
      if (seen.current) {
        const fresh = list.find((r) => !seen.current!.has(r.id) && !mine.current.has(r.id));
        if (fresh) setResult({ punch: { ...fresh, workerId: '', date: '', min: 0, source: 'qr' } });
      }
      seen.current = new Set(list.map((r) => r.id));
      setRecent(list);
    };
    void tick();
    const id = window.setInterval(() => void tick(), POLL_MS);
    return () => {
      stop = true;
      window.clearInterval(id);
    };
  }, [backend, name]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    let lock: { release: () => Promise<void> } | null = null;
    const nav = navigator as Navigator & { wakeLock?: { request: (k: 'screen') => Promise<{ release: () => Promise<void> }> } };
    void nav.wakeLock?.request('screen').then((l) => (lock = l)).catch(() => undefined);
    return () => {
      window.clearInterval(id);
      void lock?.release();
    };
  }, []);

  const onCode = useCallback(
    async (code: string) => {
      const db = backend.client;
      if (!db || !/^TMT[BW]:/.test(code)) return;
      const r = await callApi(db, { action: 'kiosk_scan', code, private: priv, kiosk: name });
      if (typeof r.id === 'string') mine.current.add(r.id);
      setPrivUntil(0);
      setResult(toOutcome(r));
    },
    [backend, priv, name],
  );

  const undo = async () => {
    const db = backend.client;
    const id = result?.punch?.id;
    if (!db || !id) return;
    await callApi(db, { action: 'unpunch', id });
    setResult(null);
  };

  return (
    <div className="kiosk">
      {result && <PunchResult outcome={result} autoCloseMs={result.error ? 6000 : 4500} onUndo={result.punch && !result.duplicate ? () => void undo() : undefined} onClose={() => setResult(null)} />}
      <header>
        <div>
          <div className="kiosk-clock">{now.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Warsaw' })}</div>
          <div className="kiosk-date">{now.toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Warsaw' })}</div>
        </div>
        <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
          <LangSwitch dark />
          <button type="button" className="btn small ghost" style={{ color: '#9eabc2' }} title={t('Pełny ekran')} onClick={() => void document.documentElement.requestFullscreen?.()}>
            ⛶
          </button>
        </span>
      </header>
      <main>
        <section className="kiosk-qr">
          <h1>{t('Zeskanuj telefonem')}</h1>
          <p>{t('Wejście albo wyjście zapisze się samo.')}</p>
          <div className="qr-box" aria-label={t('Kod QR do odbicia')} dangerouslySetInnerHTML={{ __html: token ? svgOf(punchUrl(token)) : '' }} />
          <div className="kiosk-private-qr">
            <div className="qr-mini" dangerouslySetInnerHTML={{ __html: token ? svgOf(punchUrl(token, true), 4) : '' }} />
            <div>
              <b>{t('Wyjście prywatne')}</b>
              <div className="sub">{t('Zeskanuj ten mały kod. Powrót — zwykłym kodem.')}</div>
            </div>
          </div>
          {error ? <div className="note red">{error}</div> : <div className="sub">{t('Kod zmienia się co {s} s — zdjęcie kodu nie zadziała później.', { s: QR_EVERY })}</div>}
        </section>
        <section className="kiosk-list">
          <div className="kiosk-cam-head">
            <h2>{t('Karta lub kod z telefonu')}</h2>
            <span style={{ display: 'inline-flex', gap: 6 }}>
              {camOn && (
                <button type="button" className="btn small ghost" style={{ color: '#9eabc2' }} title={t('Przełącz kamerę')} onClick={() => setFacing(facing === 'user' ? 'environment' : 'user')}>
                  ⇄
                </button>
              )}
              <button type="button" className="btn small ghost" style={{ color: '#9eabc2' }} onClick={() => setCamOn(!camOn)}>
                {camOn ? t('Wyłącz kamerę') : t('Włącz kamerę')}
              </button>
            </span>
          </div>
          {camOn && (
            <>
              <QrScan key={facing} facing={facing} paused={!!result} onCode={(c) => void onCode(c)} />
              <button type="button" className={`btn kiosk-private-btn ${priv ? 'armed' : ''}`} onClick={() => setPrivUntil(priv ? 0 : Date.now() + PRIVATE_ARM_MS)}>
                {priv ? t('Wyjście prywatne — pokaż kartę ({s} s)', { s: Math.ceil((privUntil - now.getTime()) / 1000) }) : t('Wyjście prywatne? Dotknij, potem pokaż kartę')}
              </button>
            </>
          )}
          <h2>{t('Ostatnie odbicia')}</h2>
          {recent.length === 0 && <div className="sub">{t('Jeszcze nikt się nie odbił.')}</div>}
          {recent.map((r) => (
            <div key={r.id} className="kiosk-row">
              <span className={`tag ${tone(r)}`}>{t(DIR_LABEL[r.ret ? 'return' : r.dir])}</span>
              <span className="grow">{r.name}</span>
              <b>{hhmm(r.at)}</b>
            </div>
          ))}
        </section>
      </main>
      <footer className="sub">{t('Kiosk')}: {name} · {user}</footer>
    </div>
  );
}
