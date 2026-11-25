import { useState } from 'react';
import { fmtRange } from '../domain/dates';
import { demoState } from '../domain/seed';
import { BRIGADES, OFF } from '../domain/types';
import type { AppState, Pattern } from '../domain/types';
import { normalize, readCloudConfig, resetDemo, writeCloudConfig } from '../data/backend';
import { useApp } from '../data/AppContext';
import Access from './Access';
import Systems from './Systems';

function Connection() {
  const { backend, user, role } = useApp();
  const cfg = readCloudConfig();
  const [url, setUrl] = useState('');
  const [key, setKey] = useState('');

  if (backend.mode === 'cloud')
    return (
      <section className="card stack">
        <h2>Baza danych</h2>
        <div className="note green">
          Połączono z Supabase ({cfg ? new URL(cfg.url).host : ''}). Zalogowany: <b>{user}</b>, rola: <b>{role}</b>. Dane są widoczne tylko po zalogowaniu i tylko dla osób z listy
          dostępu.
        </div>
        <div className="row">
          <button type="button" className="btn" onClick={() => void backend.client?.auth.signOut()}>
            Wyloguj
          </button>
        </div>
      </section>
    );

  return (
    <section className="card stack">
      <h2>Baza danych</h2>
      <div className="note amber">Tryb demo: dane przykładowe zapisane tylko w tej przeglądarce. Telefon i komputer nie widzą wzajemnie zmian.</div>
      <p className="sub" style={{ margin: 0 }}>
        Podłącz Supabase, żeby dane były wspólne i chronione logowaniem. Instrukcja: plik README w repozytorium.
      </p>
      <label className="field">
        Project URL
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://xxxx.supabase.co" />
      </label>
      <label className="field">
        Klucz anon public
        <input value={key} onChange={(e) => setKey(e.target.value)} placeholder="eyJhbGciOi…" />
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
        Połącz
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
      <h2>Zaawansowane: godziny zmian i cykle</h2>
      <div className="scroll-x">
        <table style={{ minWidth: 460 }}>
          <thead>
            <tr>
              <th>Kod</th>
              <th>Skrót</th>
              <th>Start</th>
              <th>Godzin</th>
              <th>Czas</th>
            </tr>
          </thead>
          <tbody>
            {state.shiftDefs.map((s) => (
              <tr key={s.code}>
                <td>{s.code}</td>
                <td>
                  <input className="input" style={{ width: 60 }} aria-label="Skrót" value={s.label} onChange={(e) => update((d) => void (d.shiftDefs.find((x) => x.code === s.code)!.label = e.target.value.slice(0, 3)))} />
                </td>
                <td>
                  <select className="input" aria-label="Godzina startu" value={s.start} onChange={(e) => update((d) => void (d.shiftDefs.find((x) => x.code === s.code)!.start = Number(e.target.value)), `Zmiana ${s.code}: start ${e.target.value}:00`)}>
                    {Array.from({ length: 24 }, (_, h) => (
                      <option key={h} value={h}>
                        {String(h).padStart(2, '0')}:00
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input className="input" type="number" min={1} max={16} style={{ width: 70 }} aria-label="Liczba godzin" value={s.hours} onChange={(e) => update((d) => void (d.shiftDefs.find((x) => x.code === s.code)!.hours = Math.max(1, Math.min(16, Number(e.target.value) || 8))))} />
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
            Nazwa wzorca
            <input defaultValue={p.name} onBlur={(e) => e.target.value.trim() && patchPattern(p.id, { name: e.target.value.trim() })} />
          </label>
          <label className="field">
            Cykl (kody zmian oddzielone spacją, W = wolne; dostępne: {state.shiftDefs.map((s) => s.code).join(', ')})
            <input
              defaultValue={p.sequence.join(' ')}
              onBlur={(e) => {
                const seq = e.target.value.trim().split(/\s+/).filter(Boolean);
                const valid = seq.length > 0 && seq.every((c) => c === OFF || state.shiftDefs.some((s) => s.code === c));
                if (!valid) {
                  alert('Nieznany kod zmiany w cyklu.');
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
                Przesunięcie {b}
                <input type="number" min={0} max={p.sequence.length - 1} value={p.offsets[b]} onChange={(e) => patchPattern(p.id, { offsets: { ...p.offsets, [b]: Number(e.target.value) || 0 } })} />
              </label>
            ))}
            <label className="field">
              Początek cyklu
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
      if (!confirm(`Zastąpić wszystkie dane zawartością pliku (${next.workers.length} pracowników, ${next.lines.length} linii)?`)) return;
      replaceAll(next);
    } catch {
      alert('To nie jest poprawny plik kopii zapasowej.');
    }
  };

  return (
    <section className="card stack">
      <h2>Dane</h2>
      <div className="row">
        <button type="button" className="btn" onClick={download}>
          Pobierz kopię (JSON)
        </button>
        {admin && (
          <label className="btn">
            Wczytaj kopię
            <input type="file" accept="application/json" hidden onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
          </label>
        )}
        {admin && state.workers.length === 0 && (
          <button type="button" className="btn" onClick={() => confirm('Wgrać przykładowe linie i pracowników?') && replaceAll({ ...demoState(), history: state.history })}>
            Wgraj dane przykładowe
          </button>
        )}
        {backend.mode === 'demo' && (
          <button
            type="button"
            className="btn"
            onClick={() => {
              if (!confirm('Przywrócić dane przykładowe? Twoje zmiany w trybie demo zostaną usunięte.')) return;
              resetDemo();
              location.reload();
            }}
          >
            Przywróć demo
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
        <h1>Ustawienia</h1>
      </div>
      <Connection />
      <Access />
      <Systems />
      <ShiftsAndPatterns />
      <Data />
    </>
  );
}
