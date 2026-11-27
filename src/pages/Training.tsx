import { useMemo, useState } from 'react';
import { fmtDate, todayIso } from '../domain/dates';
import { level as skillLevel } from '../domain/coverage';
import { hasDoc } from '../domain/training';
import type { TrainingRecord } from '../domain/training';
import type { Worker } from '../domain/types';
import { addTraining, removeTraining, scanUrl, useTraining } from '../data/training';
import { useApp } from '../data/AppContext';
import { toast } from '../toast';
import { t } from '../i18n';
import { Level, Sheet } from '../ui';

const STAGES = [1, 2, 3, 4];

/** Karta szkoleń pracownika: dla każdego stanowiska z Matrixa ścieżka 1/4–4/4 z datą, podpisem i skanem dokumentu. */
export function TrainingCard({ worker }: { worker: Worker }) {
  const { state, backend, canEdit } = useApp();
  const { records, reload } = useTraining();
  const [adding, setAdding] = useState<{ stationId: string; level: number } | null>(null);
  const db = backend.client;
  const mine = useMemo(() => records.filter((r) => r.worker_id === worker.id), [records, worker.id]);
  const stationName = (id: string) => state.stations.find((s) => s.id === id)?.name ?? id;
  // stanowiska z Matrixa oraz te, na które są wpisy (np. po zmianie poziomu)
  const stationIds = useMemo(
    () => [...new Set([...Object.keys(worker.skills).filter((id) => skillLevel(worker, id) > 0), ...mine.map((r) => r.station_id)])].sort((a, b) => stationName(a).localeCompare(stationName(b), 'pl')),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [worker.skills, mine, state.stations],
  );
  if (!db) return null;

  const open = async (r: TrainingRecord) => {
    if (!r.file_path) return;
    const url = await scanUrl(db, r.file_path);
    if (url) window.open(url, '_blank', 'noopener');
    else toast(t('Nie udało się otworzyć skanu.'), { tone: 'warn' });
  };
  const remove = async (r: TrainingRecord) => {
    await removeTraining(db, r);
    await reload();
    toast(t('Usunięto wpis szkolenia.'));
  };

  return (
    <section className="card stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h3 style={{ margin: 0 }}>{t('Karta szkoleń')}</h3>
        {canEdit && (
          <button type="button" className="btn small" onClick={() => setAdding({ stationId: stationIds[0] ?? state.stations[0]?.id ?? '', level: 1 })}>
            + {t('Dodaj szkolenie')}
          </button>
        )}
      </div>
      {!stationIds.length && <div className="sub">{t('Brak stanowisk z poziomem w Matrixie.')}</div>}
      {stationIds.map((sid) => {
        const lv = skillLevel(worker, sid);
        const stages = STAGES.filter((l) => l <= Math.max(lv, ...mine.filter((r) => r.station_id === sid).map((r) => r.level)));
        return (
          <div key={sid} className="stack" style={{ gap: 4 }}>
            <div className="row" style={{ gap: 6 }}>
              <Level value={lv} />
              <b>{stationName(sid)}</b>
            </div>
            <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
              {stages.map((l) => {
                const recs = mine.filter((r) => r.station_id === sid && r.level === l);
                if (!hasDoc(mine, worker.id, sid, l)) {
                  return (
                    <button key={l} type="button" className="tag amber" style={{ border: 0, cursor: canEdit ? 'pointer' : 'default' }} disabled={!canEdit} onClick={() => setAdding({ stationId: sid, level: l })} title={t('Brak dokumentu szkolenia — dodaj skan')}>
                      {l}/4 · {t('brak dokumentu')}
                    </button>
                  );
                }
                return recs.map((r) => (
                  <span key={r.id} className="tag green" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                    <button type="button" style={{ border: 0, background: 'none', color: 'inherit', cursor: r.file_path ? 'pointer' : 'default', padding: 0 }} onClick={() => void open(r)} title={r.signed_by ? `${t('Podpisali')}: ${r.signed_by}` : undefined}>
                      {l}/4 · {fmtDate(r.trained_on)} {r.file_path ? '📎' : `(${t('bez skanu')})`}
                    </button>
                    {canEdit && (
                      <button type="button" aria-label={t('Usuń')} style={{ border: 0, background: 'none', color: 'inherit', cursor: 'pointer', padding: 0 }} onClick={() => void remove(r)}>
                        ×
                      </button>
                    )}
                  </span>
                ));
              })}
            </div>
          </div>
        );
      })}
      {adding && <AddTrainingSheet worker={worker} initial={adding} onClose={() => setAdding(null)} onSaved={() => void reload()} />}
    </section>
  );
}

function AddTrainingSheet({ worker, initial, onClose, onSaved }: { worker: Worker; initial: { stationId: string; level: number }; onClose: () => void; onSaved: () => void }) {
  const { state, backend, user, update } = useApp();
  const [stationId, setStationId] = useState(initial.stationId);
  const [lvl, setLvl] = useState(initial.level);
  const [date, setDate] = useState(todayIso());
  const [signed, setSigned] = useState('');
  const [note, setNote] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const stations = [...state.stations].sort((a, b) => a.name.localeCompare(b.name, 'pl'));

  const save = async () => {
    const db = backend.client;
    if (!db || !stationId) return;
    setBusy(true);
    setErr(null);
    const e = await addTraining(db, user, { worker_id: worker.id, station_id: stationId, level: lvl, trained_on: date, signed_by: signed, note, file });
    setBusy(false);
    if (e) {
      setErr(e);
      return;
    }
    // szkolenie jest źródłem prawdy: kropka w Matrixie idzie do góry razem z dokumentem
    if (skillLevel(worker, stationId) < lvl) {
      update((d) => {
        const dw = d.workers.find((x) => x.id === worker.id);
        if (dw) dw.skills[stationId] = { ...dw.skills[stationId], level: lvl };
      }, `Szkolenie: ${worker.name} — ${stations.find((s) => s.id === stationId)?.name}: ${lvl}/4`);
    }
    toast(file ? t('Zapisano szkolenie ze skanem.') : t('Zapisano szkolenie bez skanu — dodaj skan później.'));
    onSaved();
    onClose();
  };

  return (
    <Sheet title={`${t('Szkolenie')}: ${worker.name}`} onClose={onClose}>
      <div className="stack">
        <label className="field">
          {t('Stanowisko')}
          <select value={stationId} onChange={(e) => setStationId(e.target.value)}>
            {stations.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <div className="row" style={{ gap: 6 }}>
          {STAGES.map((l) => (
            <button key={l} type="button" className={`btn ${lvl === l ? 'primary' : ''}`} onClick={() => setLvl(l)}>
              {l}/4
            </button>
          ))}
        </div>
        <label className="field">
          {t('Data szkolenia')}
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="field">
          {t('Podpisali (lider, supervisor)')}
          <input className="input" value={signed} onChange={(e) => setSigned(e.target.value)} />
        </label>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <label className="btn primary" style={{ cursor: 'pointer' }}>
            📷 {t('Zrób zdjęcie dokumentu')}
            <input type="file" accept="image/*" capture="environment" hidden onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>
          <label className="btn" style={{ cursor: 'pointer' }}>
            {t('Wybierz plik / PDF')}
            <input type="file" accept="image/*,application/pdf" hidden onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>
        </div>
        {file && <div className="sub">📎 {file.name}</div>}
        <label className="field">
          {t('Notatka')}
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        {err && <div className="note red">{err}</div>}
        <button type="button" className="btn primary" disabled={busy || !stationId} onClick={() => void save()}>
          {busy ? t('Zapisuję…') : t('Zapisz')}
        </button>
        {!file && <div className="sub">{t('Można zapisać bez skanu — pracownik dostanie znacznik „brak dokumentu”, dopóki go nie dodasz.')}</div>}
      </div>
    </Sheet>
  );
}
