import { useState } from 'react';
import { useApp } from '../data/AppContext';
import { savePunches } from '../data/punches';
import { readTable } from '../data/readTable';
import { fmtDate } from '../domain/dates';
import { fmtMin, DIR_LABEL } from '../domain/punches';
import { importTna } from '../domain/tnaImport';
import type { TnaResult } from '../domain/tnaImport';
import { Sheet } from '../ui';
import { t } from '../i18n';

const toIso = (date: string, min: number) => new Date(`${date}T${fmtMin(min)}:00`).toISOString();

/** Import odbić z pliku wyeksportowanego z Comarch TNA (xlsx, csv albo xls-HTML). */
export default function TnaImport({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { state, backend, update } = useApp();
  const [file, setFile] = useState<string | null>(null);
  const [res, setRes] = useState<TnaResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);

  const load = async (f: File) => {
    setErr(null);
    setRes(null);
    setFile(f.name);
    try {
      const rows = await readTable(f.name, new Uint8Array(await f.arrayBuffer()));
      const r = importTna(state, rows, toIso);
      if (!r.columns) setErr(t('Nie rozpoznano kolumn. Potrzebne są: pracownik (albo e-mail), data i godzina (albo kolumny Wejście / Wyjście). Prześlij plik — dopasujemy import do formatu TNA.'));
      setRes(r);
    } catch (e) {
      const m = (e as Error).message;
      setErr(m === 'OLD_XLS' ? t('To stary format .xls. Otwórz plik w Excelu i zapisz jako .xlsx (albo CSV), potem wgraj ponownie.') : t('Nie udało się odczytać pliku: {e}', { e: m }));
    }
  };

  const run = async () => {
    if (!res?.punches.length) return;
    setBusy(true);
    try {
      await savePunches(backend.client, res.punches);
      update(() => undefined, `Import odbić z TNA (${file}): ${res.punches.length} odbić, ${res.matched} os., ${res.from} – ${res.to}`);
      onDone();
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const name = (id: string) => state.workers.find((w) => w.id === id)?.name ?? id;
  return (
    <Sheet title={t('Import odbić z Comarch TNA')} sub={t('TNA → Zarządzanie kadrą → Raporty pracowników → Pobierz raport → „Raport aktywności pracowników” (wejścia i wyjścia). Wgraj ten plik tutaj.')} onClose={onClose}>
      <label
        className={`drop ${drag ? 'over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          const f = e.dataTransfer.files[0];
          if (f) void load(f);
        }}
      >
        <input type="file" accept=".xlsx,.xls,.csv,.txt,.html" hidden onChange={(e) => e.target.files?.[0] && void load(e.target.files[0])} />
        <b>{file ?? t('Przeciągnij plik tutaj albo kliknij, aby wybrać')}</b>
        <span className="sub">.xlsx · .csv · .xls</span>
      </label>
      {err && <div className="note red">{err}</div>}
      {res?.columns && (
        <div className="stack">
          <div className="row">
            <span className="tag green">{t('{n} odbić', { n: res.punches.length })}</span>
            <span className="tag">{t('{n} pracowników', { n: res.matched })}</span>
            {res.from && <span className="tag">{fmtDate(res.from)} – {fmtDate(res.to!)}</span>}
            <span className="tag">{res.format === 'daily' ? t('układ: wejście i wyjście w wierszu') : t('układ: wiersz na zdarzenie')}</span>
            {res.skipped > 0 && <span className="tag amber">{t('pominięto {n} wierszy', { n: res.skipped })}</span>}
          </div>
          {res.unmatched.length > 0 && (
            <div className="note amber">
              {t('Nie znaleziono w aplikacji ({n}) — popraw nazwisko albo e-mail w karcie pracownika:', { n: res.unmatched.length })} <b>{res.unmatched.slice(0, 30).join(', ')}</b>
              {res.unmatched.length > 30 ? ' …' : ''}
            </div>
          )}
          <div className="scroll-x" style={{ maxHeight: 280 }}>
            <table>
              <tbody>
                {res.punches.slice(0, 12).map((p) => (
                  <tr key={p.id}>
                    <td>{name(p.workerId)}</td>
                    <td>{fmtDate(p.date)}</td>
                    <td>{fmtMin(p.min)}</td>
                    <td>{t(DIR_LABEL[p.ret ? 'return' : p.dir])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {res.punches.length > 12 && <div className="sub">{t('… i {n} więcej', { n: res.punches.length - 12 })}</div>}
          <div className="sub">{t('Ponowny import tego samego pliku niczego nie dubluje.')}</div>
        </div>
      )}
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button type="button" className="btn" onClick={onClose}>{t('Anuluj')}</button>
        <button type="button" className="btn primary" disabled={!res?.punches.length || busy} onClick={() => void run()}>
          {t('Importuj {n} odbić', { n: res?.punches.length ?? 0 })}
        </button>
      </div>
    </Sheet>
  );
}
