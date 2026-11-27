import { toast } from '../toast';
import { useMemo, useState } from 'react';
import { applyImport, matchNames, parseDelimited, planImport, removeWorkers, workersCsv } from '../domain/workerImport';
import type { Cell, ImportItem } from '../domain/workerImport';
import type { Worker } from '../domain/types';
import { useApp } from '../data/AppContext';
import { Sheet } from '../ui';
import { t } from '../i18n';

export function downloadCsv(name: string, csv: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function downloadXlsx(name: string, bytes: Uint8Array): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
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
      setReadError(t('Nie udało się odczytać pliku: {msg}', { msg: e instanceof Error ? e.message : String(e) }));
    }
  };

  const run = () => {
    update((d) => applyImport(d, ok), `Import listy pracowników${fileName ? ` (${fileName})` : ''}: ${count('new')} nowych, ${count('update')} zaktualizowanych`);
    onClose();
  };

  return (
    <Sheet title={t('Import listy pracowników')} sub={t('Excel (.xlsx), CSV albo wklejka z Excela. Pierwszy wiersz to nagłówki.')} onClose={onClose}>
      <div className="note">
        {t('Kolumny: Imię i nazwisko, Typ (PL / CN / Agencja), Agencja, System (8h / 12h), Brygada (A–D), Linia, Stanowisko, Aktywny (tak/nie). Dodatkowe kolumny o nazwach stanowisk (np. „Lutowanie”) wczytują poziomy matrycy 0–4. Kolejność kolumn dowolna. Nagłówki kolumn wpisuj po polsku.')}
      </div>
      <div className="row">
        <label className="btn primary">
          {t('Wybierz plik')}
          <input type="file" accept=".xlsx,.csv,.txt,text/csv" hidden onChange={(e) => e.target.files?.[0] && void onFile(e.target.files[0])} />
        </label>
        <button type="button" className="btn" onClick={template}>
          {t('Pobierz wzór (CSV)')}
        </button>
        {fileName && <span className="sub">{fileName}</span>}
      </div>
      <details>
        <summary style={{ cursor: 'pointer', fontSize: 14, fontWeight: 600 }}>{t('…albo wklej z Excela')}</summary>
        <textarea className="input" style={{ width: '100%', height: 120, padding: 8, marginTop: 8 }} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={t('Zaznacz w Excelu tabelę z nagłówkami, Ctrl+C, wklej tutaj')} />
        <button type="button" className="btn" disabled={!paste.trim()} onClick={() => { setFileName('wklejka'); setRows(parseDelimited(paste)); }}>
          {t('Sprawdź wklejone')}
        </button>
      </details>
      <label className="sub" style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
        <input type="checkbox" checked={updateExisting} onChange={(e) => setUpdateExisting(e.target.checked)} />
        {t('aktualizuj istniejących (dopasowanie po imieniu i nazwisku)')}
      </label>
      {readError && <div className="note red">{readError}</div>}
      {plan?.problem && <div className="note red">{plan.problem}</div>}
      {plan && !plan.problem && (
        <>
          <div className="row">
            <span className="tag green">{t('nowi')}: {count('new')}</span>
            <span className="tag blue">{t('aktualizacje')}: {count('update')}</span>
            <span className="tag red">{t('pominięte')}: {count('error')}</span>
          </div>
          <div className="scroll-x" style={{ maxHeight: 300, overflowY: 'auto' }}>
            <table style={{ minWidth: 520 }}>
              <thead>
                <tr>
                  <th>{t('Wiersz')}</th>
                  <th>{t('Pracownik')}</th>
                  <th>{t('Wynik')}</th>
                  <th>{t('Uwagi')}</th>
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
                          {state.lines.find((l) => l.id === it.worker!.lineId)?.name} · {t('bryg.')} {it.worker.brigade} ·{' '}
                          {state.stations.find((s) => s.id === it.worker!.homeStationId)?.name ?? t('rezerwa')}
                          {it.skills ? ` · ${it.skills} ${t('poz. matrycy')}` : ''}
                        </div>
                      )}
                    </td>
                    <td>
                      <span className={`tag ${ACTION_TAG[it.action][0]}`}>{t(ACTION_TAG[it.action][1])}</span>
                    </td>
                    <td className="sub">{[...it.errors, ...it.warnings].join('; ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button type="button" className="btn success" disabled={!ok.length} onClick={run}>
            {t('Importuj')} {ok.length} {t(osob(ok.length))}
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
    <Sheet title={t('Usuń lub dezaktywuj listą')} sub={t('Wklej nazwiska (jedno w wierszu) albo wczytaj plik — liczy się pierwsza kolumna.')} onClose={onClose}>
      <div className="row">
        <label className="btn">
          {t('Wczytaj plik (.xlsx / .csv)')}
          <input type="file" accept=".xlsx,.csv,.txt,text/csv" hidden onChange={(e) => e.target.files?.[0] && void onFile(e.target.files[0])} />
        </label>
      </div>
      <textarea className="input" style={{ width: '100%', height: 140, padding: 8 }} value={text} onChange={(e) => setText(e.target.value)} placeholder={'Kowalski Jan\nNowak Anna\n…'} />
      {result && (
        <>
          <div className="row">
            <span className="tag green">{t('znaleziono')}: {result.found.length}</span>
            {result.missing.length > 0 && <span className="tag red">{t('nie znaleziono')}: {result.missing.length}</span>}
          </div>
          {result.missing.length > 0 && <div className="note amber">{t('Nie ma w bazie:')} {result.missing.join(', ')}</div>}
          <div className="sub">{result.found.map((w) => w.name).join(', ')}</div>
          <BulkButtons workers={result.found} onDone={onClose} update={update} />
        </>
      )}
    </Sheet>
  );
}

export function BulkButtons({ workers, onDone, update, small }: { workers: Worker[]; onDone: () => void; update: ReturnType<typeof useApp>['update']; small?: boolean }) {
  const { undo } = useApp();
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
        {t('Oznacz nieaktywnych')} ({n})
      </button>
      <button
        type="button"
        className={'btn danger' + sz}
        disabled={!n}
        onClick={() => {
          update((d) => removeWorkers(d, ids), `Usunięto ${n} os.: ${names()}`);
          toast(t('Usunięto {n} os.', { n }), { undo });
          onDone();
        }}
      >
        {t('Usuń')} ({n})
      </button>
    </div>
  );
}
