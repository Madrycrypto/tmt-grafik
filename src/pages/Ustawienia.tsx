import { toast } from '../toast';
import { useState } from 'react';
import { fmtRange } from '../domain/dates';
import { demoState } from '../domain/seed';
import { BRIGADES, OFF } from '../domain/types';
import type { AppState, Pattern } from '../domain/types';
import { normalize, readCloudConfig, resetDemo, writeCloudConfig } from '../data/backend';
import { useApp } from '../data/AppContext';
import { useLabels } from '../data/labels';
import Access from './Access';
import Systems from './Systems';
import { t } from '../i18n';

function Connection() {
  const { backend, user, role } = useApp();
  const cfg = readCloudConfig();
  const [url, setUrl] = useState('');
  const [key, setKey] = useState('');

  if (backend.mode === 'cloud')
    return (
      <section className="card stack">
        <h2>{t('Baza danych')}</h2>
        <div className="note green">
          {t('Połączono z Supabase ({host}).', { host: cfg ? new URL(cfg.url).host : '' })} {t('Zalogowany:')} <b>{user}</b>{t(', rola:')} <b>{role}</b>.{' '}
          {t('Dane są widoczne tylko po zalogowaniu i tylko dla osób z listy dostępu.')}
        </div>
        <div className="row">
          <button type="button" className="btn" onClick={() => void backend.client?.auth.signOut()}>
            {t('Wyloguj')}
          </button>
        </div>
      </section>
    );

  return (
    <section className="card stack">
      <h2>{t('Baza danych')}</h2>
      <div className="note amber">{t('Tryb demo: dane przykładowe zapisane tylko w tej przeglądarce. Telefon i komputer nie widzą wzajemnie zmian.')}</div>
      <p className="sub" style={{ margin: 0 }}>
        {t('Podłącz Supabase, żeby dane były wspólne i chronione logowaniem. Instrukcja: plik README w repozytorium.')}
      </p>
      <label className="field">
        {t('Project URL')}
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder={t('https://xxxx.supabase.co')} />
      </label>
      <label className="field">
        {t('Klucz anon public')}
        <input value={key} onChange={(e) => setKey(e.target.value)} placeholder={t('eyJhbGciOi…')} />
      </label>
      <button
        type="button"
        className="btn primary"
        disabled={!/^https:\/\/.+/.test(url) || key.length < 20}
        onClick={() => {
          writeCloudConfig({ url: url.trim().replace(/\/$/, ''), anonKey: key.trim() });
          location.reload();
        }}
      >
        {t('Połącz')}
      </button>
    </section>
  );
}

function ShiftsAndPatterns() {
  const { state, update } = useApp();
  const patchPattern = (id: string, p: Partial<Pattern>) =>
    update((d) => {
      const x = d.patterns.find((y) => y.id === id);
      if (x) Object.assign(x, p);
    });

  return (
    <section className="card stack">
      <h2>{t('Zaawansowane: godziny zmian i cykle')}</h2>
      <div className="scroll-x">
        <table style={{ minWidth: 460 }}>
          <thead>
            <tr>
              <th>{t('Kod')}</th>
              <th>{t('Skrót')}</th>
              <th>{t('Start')}</th>
              <th>{t('Godzin')}</th>
              <th>{t('Czas')}</th>
            </tr>
          </thead>
          <tbody>
            {state.shiftDefs.map((s) => (
              <tr key={s.code}>
                <td>{s.code}</td>
                <td>
                  <input className="input" style={{ width: 60 }} aria-label={t('Skrót')} value={s.label} onChange={(e) => update((d) => void (d.shiftDefs.find((x) => x.code === s.code)!.label = e.target.value.slice(0, 3)))} />
                </td>
                <td>
                  <select className="input" aria-label={t('Godzina startu')} value={s.start} onChange={(e) => update((d) => void (d.shiftDefs.find((x) => x.code === s.code)!.start = Number(e.target.value)), `Zmiana ${s.code}: start ${e.target.value}:00`)}>
                    {Array.from({ length: 24 }, (_, h) => (
                      <option key={h} value={h}>
                        {String(h).padStart(2, '0')}:00
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input className="input" type="number" min={1} max={16} style={{ width: 70 }} aria-label={t('Liczba godzin')} value={s.hours} onChange={(e) => update((d) => void (d.shiftDefs.find((x) => x.code === s.code)!.hours = Math.max(1, Math.min(16, Number(e.target.value) || 8))))} />
                </td>
                <td>{fmtRange(s.start, s.hours)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {state.patterns.map((p) => (
        <div key={p.id} className="stack" style={{ borderTop: '1px solid var(--line)', paddingTop: 12 }}>
          <label className="field">
            {t('Nazwa wzorca')}
            <input defaultValue={p.name} onBlur={(e) => e.target.value.trim() && patchPattern(p.id, { name: e.target.value.trim() })} />
          </label>
          <label className="field">
            {t('Cykl (kody zmian oddzielone spacją, W = wolne; dostępne: {codes})', { codes: state.shiftDefs.map((s) => s.code).join(', ') })}
            <input
              defaultValue={p.sequence.join(' ')}
              onBlur={(e) => {
                const seq = e.target.value.trim().split(/\s+/).filter(Boolean);
                const valid = seq.length > 0 && seq.every((c) => c === OFF || state.shiftDefs.some((s) => s.code === c));
                if (!valid) {
                  toast(t('Nieznany kod zmiany w cyklu.'), { tone: 'warn' });
                  e.target.value = p.sequence.join(' ');
                  return;
                }
                update((d) => void (d.patterns.find((x) => x.id === p.id)!.sequence = seq), `Wzorzec ${p.name}: cykl ${seq.join(' ')}`);
              }}
            />
          </label>
          <div className="row">
            {BRIGADES.map((b) => (
              <label key={b} className="field" style={{ width: 90 }}>
                {t('Przesunięcie')} {b}
                <input type="number" min={0} max={p.sequence.length - 1} value={p.offsets[b]} onChange={(e) => patchPattern(p.id, { offsets: { ...p.offsets, [b]: Number(e.target.value) || 0 } })} />
              </label>
            ))}
            <label className="field">
              {t('Początek cyklu')}
              <input type="date" value={p.anchor} onChange={(e) => e.target.value && patchPattern(p.id, { anchor: e.target.value })} />
            </label>
          </div>
        </div>
      ))}
    </section>
  );
}

function Data() {
  const { state, backend, replaceAll, role } = useApp();
  const admin = role === 'admin';

  const download = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `tmt-grafik-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const upload = async (file: File) => {
    try {
      const next = normalize(JSON.parse(await file.text()) as Partial<AppState>);
      if (!confirm(t('Zastąpić wszystkie dane zawartością pliku ({w} pracowników, {l} linii)?', { w: next.workers.length, l: next.lines.length }))) return;
      replaceAll(next);
    } catch {
      toast(t('To nie jest poprawny plik kopii zapasowej.'), { tone: 'warn' });
    }
  };

  return (
    <section className="card stack">
      <h2>{t('Dane')}</h2>
      <div className="row">
        <button type="button" className="btn" onClick={download}>
          {t('Pobierz kopię (JSON)')}
        </button>
        {admin && (
          <label className="btn">
            {t('Wczytaj kopię')}
            <input type="file" accept="application/json" hidden onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
          </label>
        )}
        {admin && state.workers.length === 0 && (
          <button type="button" className="btn" onClick={() => confirm(t('Wgrać przykładowe linie i pracowników?')) && replaceAll({ ...demoState(), history: state.history })}>
            {t('Wgraj dane przykładowe')}
          </button>
        )}
        {backend.mode === 'demo' && (
          <button
            type="button"
            className="btn"
            onClick={() => {
              if (!confirm(t('Przywrócić dane przykładowe? Twoje zmiany w trybie demo zostaną usunięte.'))) return;
              resetDemo();
              location.reload();
            }}
          >
            {t('Przywróć demo')}
          </button>
        )}
      </div>
    </section>
  );
}

export default function Ustawienia() {
  return (
    <>
      <div className="page-head">
        <h1>{t('Ustawienia')}</h1>
      </div>
      <Connection />
      <ScopeLabels />
      <Access />
      <Systems />
      <ShiftsAndPatterns />
      <Data />
    </>
  );
}

/** Nazwy zakresu w listach wyboru linii (Grafik, Urlopy, RCP, Statystyki, Matrix, Pracownicy). */
function ScopeLabels() {
  const { canEdit } = useApp();
  const lb = useLabels();
  const [plant, setPlant] = useState<string | null>(null);
  const [suffix, setSuffix] = useState<string | null>(null);
  const commit = async (next: { plant?: string; suffix?: string }) => {
    try {
      await lb.save({ ...lb.raw, ...next });
      toast(t('Zapisano'));
    } catch {
      toast(t('Nie udało się zapisać'));
    }
  };
  return (
    <section className="card stack">
      <h2>{t('Nazwy w listach linii')}</h2>
      <div className="sub">{t('Nazwa całego zakładu i dopisek przy liniach głównych (np. „HVAC — cała linia główna”). Nazwy samych linii i grup zmienisz w Linie i stanowiska. Puste pole przywraca domyślny napis.')}</div>
      <label className="field">
        {t('Cały zakład')}
        <input disabled={!canEdit} value={plant ?? lb.plant} onChange={(e) => setPlant(e.target.value)} onBlur={() => plant !== null && void commit({ plant }).then(() => setPlant(null))} />
      </label>
      <label className="field">
        {t('Dopisek przy linii głównej')}
        <input disabled={!canEdit} value={suffix ?? lb.suffix} onChange={(e) => setSuffix(e.target.value)} onBlur={() => suffix !== null && void commit({ suffix }).then(() => setSuffix(null))} />
      </label>
    </section>
  );
}
