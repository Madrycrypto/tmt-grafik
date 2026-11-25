import { useEffect, useRef, useState } from 'react';
import qrcode from 'qrcode-generator';
import { useApp } from '../data/AppContext';
import { appUrl } from '../data/backend';
import { LangSwitch } from '../ui';
import { t } from '../i18n';

interface Recent {
  at: string;
  dir: 'in' | 'out';
  name: string;
}

/** Nowy kod QR co tyle sekund; serwer przyjmuje kod przez 60 s, więc zdjęcie kodu szybko się przeterminuje. */
const QR_EVERY = 20;
const POLL_MS = 4000;

export function punchUrl(token: string): string {
  return `${appUrl()}#/odbij?k=${encodeURIComponent(token)}`;
}

function hhmm(iso: string): string {
  return new Date(iso).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Warsaw' });
}

/** Ekran tabletu przy wejściu: zmienny kod QR i lista ostatnich odbić. */
export default function Kiosk() {
  const { backend, user } = useApp();
  const [token, setToken] = useState<string | null>(null);
  const [recent, setRecent] = useState<Recent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(new Date());
  const tokenAt = useRef(0);
  const seen = useRef<string | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const name = new URLSearchParams(location.hash.split('?')[1] ?? '').get('nazwa') ?? 'wejscie';

  useEffect(() => {
    const db = backend.client;
    if (!db) {
      setError(t('Kiosk działa tylko z bazą w chmurze.'));
      return;
    }
    let stop = false;
    const tick = async () => {
      const { data, error: e } = await db.functions.invoke('tmt-api', { body: { action: 'kiosk', kiosk: name } });
      if (stop) return;
      if (e || !data?.token) {
        setError(t('Brak połączenia z serwerem — odbicia są wstrzymane.'));
        return;
      }
      setError(null);
      if (Date.now() - tokenAt.current > QR_EVERY * 1000) {
        setToken(data.token as string);
        tokenAt.current = Date.now();
      }
      const list = (data.recent ?? []) as Recent[];
      const top = list[0] ? list[0].at + list[0].name : null;
      if (top && seen.current && top !== seen.current) {
        setFresh(top);
        window.setTimeout(() => setFresh((f) => (f === top ? null : f)), 6000);
      }
      seen.current = top;
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

  const svg = (() => {
    if (!token) return '';
    const qr = qrcode(0, 'M');
    qr.addData(punchUrl(token));
    qr.make();
    return qr.createSvgTag({ cellSize: 8, margin: 2, scalable: true });
  })();

  const last = recent[0];
  const flash = last && fresh === last.at + last.name ? last : null;

  return (
    <div className="kiosk">
      <header>
        <div>
          <div className="kiosk-clock">{now.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Warsaw' })}</div>
          <div className="kiosk-date">{now.toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Warsaw' })}</div>
        </div>
        <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
          <LangSwitch dark />
          <button type="button" className="btn small ghost" style={{ color: '#9eabc2' }} onClick={() => void document.documentElement.requestFullscreen?.()}>
            ⛶
          </button>
        </span>
      </header>
      <main>
        <section className="kiosk-qr">
          <h1>{t('Odbij się telefonem')}</h1>
          <p>{t('Zeskanuj kod aparatem telefonu i wybierz: wejście albo wyjście.')}</p>
          <div className="qr-box" aria-label={t('Kod QR do odbicia')} dangerouslySetInnerHTML={{ __html: svg }} />
          {error ? <div className="note red">{error}</div> : <div className="sub">{t('Kod zmienia się co {s} s — zdjęcie kodu nie zadziała później.', { s: QR_EVERY })}</div>}
        </section>
        <section className="kiosk-list">
          {flash && (
            <div className={`kiosk-flash ${flash.dir}`}>
              <div>{flash.dir === 'in' ? t('Wejście') : t('Wyjście')} · {hhmm(flash.at)}</div>
              <strong>{flash.name}</strong>
            </div>
          )}
          <h2>{t('Ostatnie odbicia')}</h2>
          {recent.length === 0 && <div className="sub">{t('Jeszcze nikt się nie odbił.')}</div>}
          {recent.map((r) => (
            <div key={r.at + r.name} className="kiosk-row">
              <span className={`tag ${r.dir === 'in' ? 'green' : 'blue'}`}>{r.dir === 'in' ? t('Wejście') : t('Wyjście')}</span>
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
