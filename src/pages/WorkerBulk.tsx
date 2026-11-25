import { useMemo, useState } from 'react';
import { applyImport, matchNames, parseDelimited, planImport, removeWorkers, workersCsv } from '../domain/workerImport';
import type { Cell, ImportItem } from '../domain/workerImport';
import type { Worker } from '../domain/types';
import { useApp } from '../data/AppContext';
import { Sheet } from '../ui';

export function downloadCsv(name: string, csv: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

async function readFileRows(file: File): Promise<Cell[][]> {
  if (/\.xlsx$/i.test(file.name)) {
    const { readSheet } = await import('read-excel-file/browser');
    return (await readSheet(file)) as Cell[][];
  }
  return parseDelimited(await file.text());
}

function osob(n: number): string {
  if (n === 1) return 'osobę';
  const d = n % 10;
  const t = n % 100;
  return d >= 2 && d <= 4 && (t < 12 || t > 14) ? 'osoby' : 'osób';
}

const ACTION_TAG: Record<ImportItem['action'], [string, string]> = {
  new: ['green', 'nowy'],
  update: ['blue', 'aktualizacja'],
  error: ['red', 'pominięty'],
};

export function ImportSheet({ onClose }: { onClose: () => void }) {
  const { state, update } = useApp();
  const [rows, setRows] = useState<Cell[][] | null>(null);
  const [paste, setPaste] = useState('');
  const [updateExisting, setUpdateExisting] = useState(true);
  const [fileName, setFileName] = useState('');
  const [readError, setReadError] = useState<string | null>(null);

  const plan = useMemo(() => (rows ? planImport(state, rows, updateExisting) : null), [rows, state, updateExisting]);
  const ok = plan?.items.filter((i) => i.action !== 'error') ?? [];
  const count = (a: ImportItem['action']) => plan?.items.filter((i) => i.action === a).length ?? 0;

  const template = () => {
    const sample = state.workers.slice(0, 2);
    downloadCsv('wzor-lista-pracownikow.csv', workersCsv(state, sample));
  };

  const onFile = async (f: File) => {
    setReadError(null);
    setFileName(f.name);
    try {
      setRows(await readFileRows(f));
    } catch (e) {
      setReadError(`Nie udało się odczytać pliku: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const run = () => {
    update((d) => applyImport(d, ok), `Import listy pracowników${fileName ? ` (${fileName})` : ''}: ${count('new')} nowych, ${count('update')} zaktualizowanych`);
    onClose();
  };

  return (
    <Sheet title="Import listy pracowników" sub="Excel (.xlsx), CSV albo wklejka z Excela. Pierwszy wiersz to nagłówki." onClose={onClose}>
      <div className="note">
        Kolumny: <b>Imię i nazwisko</b>, Typ (PL / CN / Agencja), Agencja, System (8h / 12h), <b>Brygada</b> (A–D), <b>Linia</b>, Stanowisko, Aktywny (tak/nie). Dodatkowe kolumny o nazwach
        stanowisk (np. „Lutowanie”) wczytują poziomy matrycy 0–4. Kolejność kolumn dowolna.
      </div>
      <div className="row">
        <label className="btn primary">
          Wybierz plik
          <input type="file" accept=".xlsx,.csv,.txt,text/csv" hidden onChange={(e) => e.target.files?.[0] && void onFile(e.target.files[0])} />
        </label>
        <button type="button" className="btn" onClick={template}>
          Pobierz wzór (CSV)
        </button>
        {fileName && <span className="sub">{fileName}</span>}
      </div>
      <details>
        <summary style={{ cursor: 'pointer', fontSize: 14, fontWeight: 600 }}>…albo wklej z Excela</summary>
        <textarea className="input" style={{ width: '100%', height: 120, padding: 8, marginTop: 8 }} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="Zaznacz w Excelu tabelę z nagłówkami, Ctrl+C, wklej tutaj" />
        <button type="button" className="btn" disabled={!paste.trim()} onClick={() => { setFileName('wklejka'); setRows(parseDelimited(paste)); }}>
          Sprawdź wklejone
        </button>
      </details>
      <label className="sub" style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
        <input type="checkbox" checked={updateExisting} onChange={(e) => setUpdateExisting(e.target.checked)} />
        aktualizuj istniejących (dopasowanie po imieniu i nazwisku)
      </label>
      {readError && <div className="note red">{readError}</div>}
      {plan?.problem && <div className="note red">{plan.problem}</div>}
      {plan && !plan.problem && (
        <>
          <div className="row">
            <span className="tag green">nowi: {count('new')}</span>
            <span className="tag blue">aktualizacje: {count('update')}</span>
            <span className="tag red">pominięte: {count('error')}</span>
          </div>
          <div className="scroll-x" style={{ maxHeight: 300, overflowY: 'auto' }}>
            <table style={{ minWidth: 520 }}>
              <thead>
                <tr>
                  <th>Wiersz</th>
                  <th>Pracownik</th>
                  <th>Wynik</th>
                  <th>Uwagi</th>
                </tr>
              </thead>
              <tbody>
                {plan.items.map((it) => (
                  <tr key={it.row}>
                    <td>{it.row}</td>
                    <td>
                      <b>{it.name || '—'}</b>
                      {it.worker && (
                        <div className="sub">
                          {state.lines.find((l) => l.id === it.worker!.lineId)?.name} · bryg. {it.worker.brigade} ·{' '}
                          {state.stations.find((s) => s.id === it.worker!.homeStationId)?.name ?? 'rezerwa'}
                          {it.skills ? ` · ${it.skills} poz. matrycy` : ''}
                        </div>
                      )}
                    </td>
                    <td>
                      <span className={`tag ${ACTION_TAG[it.action][0]}`}>{ACTION_TAG[it.action][1]}</span>
                    </td>
                    <td className="sub">{[...it.errors, ...it.warnings].join('; ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button type="button" className="btn success" disabled={!ok.length} onClick={run}>
            Importuj {ok.length} {osob(ok.length)}
          </button>
        </>
      )}
    </Sheet>
  );
}

export function RemoveListSheet({ onClose }: { onClose: () => void }) {
  const { state, update } = useApp();
  const [text, setText] = useState('');
  const result = useMemo(() => (text.trim() ? matchNames(state, text) : null), [state, text]);

  const onFile = async (f: File) => {
    const rows = await readFileRows(f);
    setText(rows.map((r) => String(r[0] ?? '')).join('\n'));
  };

  return (
    <Sheet title="Usuń lub dezaktywuj listą" sub="Wklej nazwiska (jedno w wierszu) albo wczytaj plik — liczy się pierwsza kolumna." onClose={onClose}>
      <div className="row">
        <label className="btn">
          Wczytaj plik (.xlsx / .csv)
          <input type="file" accept=".xlsx,.csv,.txt,text/csv" hidden onChange={(e) => e.target.files?.[0] && void onFile(e.target.files[0])} />
        </label>
      </div>
      <textarea className="input" style={{ width: '100%', height: 140, padding: 8 }} value={text} onChange={(e) => setText(e.target.value)} placeholder={'Kowalski Jan\nNowak Anna\n…'} />
      {result && (
        <>
          <div className="row">
            <span className="tag green">znaleziono: {result.found.length}</span>
            {result.missing.length > 0 && <span className="tag red">nie znaleziono: {result.missing.length}</span>}
          </div>
          {result.missing.length > 0 && <div className="note amber">Nie ma w bazie: {result.missing.join(', ')}</div>}
          <div className="sub">{result.found.map((w) => w.name).join(', ')}</div>
          <BulkButtons workers={result.found} onDone={onClose} update={update} />
        </>
      )}
    </Sheet>
  );
}

export function BulkButtons({ workers, onDone, update, small }: { workers: Worker[]; onDone: () => void; update: ReturnType<typeof useApp>['update']; small?: boolean }) {
  const sz = small ? ' small' : '';
  const ids = new Set(workers.map((w) => w.id));
  const n = workers.length;
  const names = (max = 5) => workers.slice(0, max).map((w) => w.name).join(', ') + (n > max ? ` i ${n - max} innych` : '');
  return (
    <div className="row">
      <button
        type="button"
        className={'btn' + sz}
        disabled={!n}
        onClick={() => {
          update((d) => {
            for (const w of d.workers) if (ids.has(w.id)) w.active = false;
          }, `Dezaktywowano ${n} os.: ${names()}`);
          onDone();
        }}
      >
        Oznacz nieaktywnych ({n})
      </button>
      <button
        type="button"
        className={'btn danger' + sz}
        disabled={!n}
        onClick={() => {
          if (!confirm(`Trwale usunąć ${n} os. razem z matrycą, nieobecnościami i przypisaniami?\n\n${names(10)}`)) return;
          update((d) => removeWorkers(d, ids), `Usunięto ${n} os.: ${names()}`);
          onDone();
        }}
      >
        Usuń ({n})
      </button>
    </div>
  );
}
