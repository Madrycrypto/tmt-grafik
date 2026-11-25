import { useMemo, useState } from 'react';
import { uid } from '../domain/actions';
import { plannedShift, absenceOn } from '../domain/coverage';
import { addDays, fmtDate, fmtRange, todayIso } from '../domain/dates';
import { BRIGADES, REASON_LABEL, TYPE_LABEL } from '../domain/types';
import type { AbsenceReason, Worker, WorkerType } from '../domain/types';
import { workersCsv } from '../domain/workerImport';
import { useApp } from '../data/AppContext';
import { Icon, Sheet, TypeTag } from '../ui';
import { BulkButtons, ImportSheet, RemoveListSheet, downloadCsv } from './WorkerBulk';
import HrExportSheet from './HrExport';

function emptyWorker(lineId: string, patternId: string): Worker {
  return { id: uid('w'), name: '', type: 'PL', patternId, brigade: 'A', lineId, homeStationId: null, active: true, skills: {} };
}

function WorkerForm({ initial, onClose }: { initial: Worker; onClose: () => void }) {
  const { state, update } = useApp();
  const [w, setW] = useState<Worker>(initial);
  const isNew = !state.workers.some((x) => x.id === initial.id);
  const stations = state.stations.filter((s) => s.lineId === w.lineId);
  const set = <K extends keyof Worker>(k: K, v: Worker[K]) => setW({ ...w, [k]: v });

  const save = () => {
    if (!w.name.trim()) return;
    const clean = { ...w, name: w.name.trim(), agency: w.type === 'AG' ? w.agency : undefined };
    update((d) => {
      const i = d.workers.findIndex((x) => x.id === w.id);
      if (i >= 0) d.workers[i] = clean;
      else d.workers.push(clean);
    }, `${isNew ? 'Dodano' : 'Zmieniono'} pracownika: ${clean.name}`);
    onClose();
  };

  const remove = () => {
    if (!confirm(`Usunąć ${w.name} razem z jego matrycą? Zamiast tego możesz oznaczyć go jako nieaktywnego.`)) return;
    update((d) => {
      d.workers = d.workers.filter((x) => x.id !== w.id);
      d.assignments = d.assignments.filter((a) => a.workerId !== w.id);
      d.absences = d.absences.filter((a) => a.workerId !== w.id);
    }, `Usunięto pracownika: ${w.name}`);
    onClose();
  };

  return (
    <Sheet title={isNew ? 'Nowy pracownik' : w.name} onClose={onClose}>
      <label className="field">
        Imię i nazwisko
        <input value={w.name} onChange={(e) => set('name', e.target.value)} autoFocus />
      </label>
      <div className="row">
        <label className="field grow">
          Typ
          <select value={w.type} onChange={(e) => set('type', e.target.value as WorkerType)}>
            {Object.entries(TYPE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        {w.type === 'AG' && (
          <label className="field grow">
            Agencja
            <input value={w.agency ?? ''} onChange={(e) => set('agency', e.target.value)} />
          </label>
        )}
      </div>
      <div className="row">
        <label className="field grow">
          System czasu pracy
          <select value={w.patternId} onChange={(e) => set('patternId', e.target.value)}>
            {state.patterns.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Brygada
          <select value={w.brigade} onChange={(e) => set('brigade', e.target.value as Worker['brigade'])}>
            {BRIGADES.map((b) => (
              <option key={b}>{b}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="row">
        <label className="field grow">
          Linia
          <select value={w.lineId} onChange={(e) => setW({ ...w, lineId: e.target.value, homeStationId: null })}>
            {state.lines.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field grow">
          Stanowisko macierzyste
          <select value={w.homeStationId ?? ''} onChange={(e) => set('homeStationId', e.target.value || null)}>
            <option value="">rezerwa</option>
            {stations.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="sub" style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
        <input type="checkbox" checked={w.active} onChange={(e) => set('active', e.target.checked)} />
        aktywny (nieaktywni nie są planowani)
      </label>
      {!isNew && <WorkerAbsences worker={w} />}
      <div className="row">
        <button type="button" className="btn primary grow" onClick={save} disabled={!w.name.trim()}>
          Zapisz
        </button>
        {!isNew && (
          <button type="button" className="btn" onClick={remove}>
            Usuń
          </button>
        )}
      </div>
    </Sheet>
  );
}

function WorkerAbsences({ worker }: { worker: Worker }) {
  const { state, update } = useApp();
  const [from, setFrom] = useState(todayIso());
  const [to, setTo] = useState(todayIso());
  const [reason, setReason] = useState<AbsenceReason>('UW');
  const list = state.absences.filter((a) => a.workerId === worker.id).sort((a, b) => b.from.localeCompare(a.from));
  const next = Array.from({ length: 7 }, (_, i) => addDays(todayIso(), i));

  return (
    <div className="stack">
      <h3>Najbliższe 7 dni</h3>
      <div className="row" style={{ gap: 6 }}>
        {next.map((d) => {
          const s = plannedShift(state, worker, d);
          const ab = absenceOn(state, worker.id, d);
          return (
            <span key={d} className={`tag ${ab ? 'red' : s ? 'green' : ''}`} style={{ padding: '6px 8px' }}>
              {fmtDate(d)}: {ab ? ab.reason : s ? fmtRange(s.start, s.end - s.start) : 'wolne'}
            </span>
          );
        })}
      </div>
      <h3>Nieobecności (urlop, L4)</h3>
      <div className="row">
        <label className="field">
          Od
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="field">
          Do
          <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
        </label>
        <label className="field">
          Powód
          <select value={reason} onChange={(e) => setReason(e.target.value as AbsenceReason)}>
            {Object.entries(REASON_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="btn"
          disabled={!from || !to || to < from}
          onClick={() =>
            update((d) => {
              d.absences.push({ id: uid('ab'), workerId: worker.id, from, to, reason });
            }, `Nieobecność: ${worker.name} ${from}–${to} (${reason})`)
          }
        >
          Dodaj
        </button>
      </div>
      {list.slice(0, 8).map((a) => (
        <div key={a.id} className="list-item">
          <span className="grow">
            {a.from === a.to ? a.from : `${a.from} – ${a.to}`} · {REASON_LABEL[a.reason]}
          </span>
          <button
            type="button"
            className="btn small"
            onClick={() =>
              update((d) => {
                d.absences = d.absences.filter((x) => x.id !== a.id);
              }, `Usunięto nieobecność: ${worker.name} ${a.from}`)
            }
          >
            Usuń
          </button>
        </div>
      ))}
    </div>
  );
}

export default function Pracownicy() {
  const { state, update } = useApp();
  const [editing, setEditing] = useState<Worker | null>(null);
  const [query, setQuery] = useState('');
  const [line, setLine] = useState('all');
  const [type, setType] = useState('all');
  const [brig, setBrig] = useState('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sheet, setSheet] = useState<'import' | 'remove' | 'hr' | null>(null);

  const list = useMemo(
    () =>
      state.workers
        .filter((w) => (line === 'all' || w.lineId === line) && (type === 'all' || w.type === type) && (brig === 'all' || w.brigade === brig))
        .filter((w) => !query || w.name.toLowerCase().includes(query.toLowerCase()))
        .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name)),
    [state, query, line, type, brig],
  );
  const chosen = state.workers.filter((w) => selected.has(w.id));
  const allVisible = list.length > 0 && list.every((w) => selected.has(w.id));

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };
  const toggleAll = () => setSelected(allVisible ? new Set() : new Set([...selected, ...list.map((w) => w.id)]));

  const bulkSet = (patch: Partial<Worker>, text: string) => {
    const ids = new Set(selected);
    update((d) => {
      for (const w of d.workers) {
        if (!ids.has(w.id)) continue;
        if (patch.lineId && patch.lineId !== w.lineId) w.homeStationId = null;
        Object.assign(w, patch);
      }
    }, `${text} (${ids.size} os.)`);
  };

  return (
    <>
      <div className="page-head">
        <div>
          <div className="sub">{state.workers.filter((w) => w.active).length} aktywnych · {state.workers.length} łącznie</div>
          <h1>Pracownicy</h1>
        </div>
        <div className="row">
          <button
            type="button"
            className="btn primary"
            disabled={!state.lines.length}
            onClick={() => setEditing(emptyWorker(line !== 'all' ? line : state.lines[0].id, state.patterns[0]?.id ?? ''))}
          >
            <span style={{ width: 18, height: 18, display: 'inline-flex' }}>
              <Icon name="plus" />
            </span>
            Dodaj
          </button>
          <button type="button" className="btn" onClick={() => setSheet('import')}>
            Import listy
          </button>
          <button type="button" className="btn" onClick={() => downloadCsv(`pracownicy-${todayIso()}.csv`, workersCsv(state, list))}>
            Eksport ({list.length})
          </button>
          <button type="button" className="btn" onClick={() => setSheet('remove')}>
            Usuń listą
          </button>
          <button type="button" className="btn" onClick={() => setSheet('hr')}>
            Eksport dla kadr
          </button>
        </div>
      </div>

      <section className="card">
        <div className="row" style={{ marginBottom: 8 }}>
          <label className="field grow" style={{ minWidth: 160 }}>
            Szukaj
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="nazwisko" />
          </label>
          <label className="field">
            Linia
            <select value={line} onChange={(e) => setLine(e.target.value)}>
              <option value="all">wszystkie</option>
              {state.lines.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Brygada
            <select value={brig} onChange={(e) => setBrig(e.target.value)}>
              <option value="all">wszystkie</option>
              {BRIGADES.map((b) => (
                <option key={b}>{b}</option>
              ))}
            </select>
          </label>
          <label className="field">
            Typ
            <select value={type} onChange={(e) => setType(e.target.value)}>
              <option value="all">wszyscy</option>
              {Object.entries(TYPE_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
        </div>

        {selected.size > 0 && (
          <div className="note" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 8, background: 'var(--accent-soft)' }}>
            <b style={{ color: 'var(--accent)' }}>Zaznaczono: {selected.size}</b>
            <select className="input" aria-label="Zmień brygadę zaznaczonym" value="" onChange={(e) => e.target.value && bulkSet({ brigade: e.target.value as Worker['brigade'] }, `Zmiana brygady na ${e.target.value}`)}>
              <option value="">Brygada →</option>
              {BRIGADES.map((b) => (
                <option key={b}>{b}</option>
              ))}
            </select>
            <select className="input" aria-label="Przenieś zaznaczonych na linię" value="" onChange={(e) => e.target.value && bulkSet({ lineId: e.target.value }, `Przeniesienie na ${state.lines.find((l) => l.id === e.target.value)?.name}`)}>
              <option value="">Linia →</option>
              {state.lines.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
            <button type="button" className="btn small" onClick={() => bulkSet({ active: true }, 'Aktywowano')}>
              Aktywuj
            </button>
            <BulkButtons small workers={chosen} update={update} onDone={() => setSelected(new Set())} />
            <button type="button" className="btn small ghost" onClick={() => setSelected(new Set())}>
              Odznacz
            </button>
          </div>
        )}

        {list.length === 0 ? (
          <div className="empty">Brak pracowników. Dodaj ręcznie albo zaimportuj listę z Excela.</div>
        ) : (
          <label className="list-item sub" style={{ cursor: 'pointer' }}>
            <input type="checkbox" checked={allVisible} onChange={toggleAll} style={{ width: 20, height: 20 }} />
            zaznacz wszystkich widocznych ({list.length})
          </label>
        )}
        {list.map((w) => (
          <div key={w.id} className="list-item" style={{ opacity: w.active ? 1 : 0.55, flexWrap: 'nowrap' }}>
            <input type="checkbox" aria-label={`Zaznacz ${w.name}`} checked={selected.has(w.id)} onChange={() => toggle(w.id)} style={{ width: 20, height: 20, flex: '0 0 20px' }} />
            <button type="button" onClick={() => setEditing(w)} style={{ flex: 1, minWidth: 0, background: 'none', border: 0, textAlign: 'left', cursor: 'pointer', padding: 0 }}>
              <b>{w.name}</b> <TypeTag w={w} /> {!w.active && <span className="tag">nieaktywny</span>}
              <div className="sub">
                {state.lines.find((l) => l.id === w.lineId)?.name} · {state.stations.find((s) => s.id === w.homeStationId)?.name ?? 'rezerwa'} ·{' '}
                {state.patterns.find((p) => p.id === w.patternId)?.name.match(/\d+ h/)?.[0]}
              </div>
            </button>
            <span className="tag">Bryg. {w.brigade}</span>
          </div>
        ))}
      </section>
      {editing && <WorkerForm initial={editing} onClose={() => setEditing(null)} />}
      {sheet === 'import' && <ImportSheet onClose={() => setSheet(null)} />}
      {sheet === 'remove' && <RemoveListSheet onClose={() => setSheet(null)} />}
      {sheet === 'hr' && <HrExportSheet onClose={() => setSheet(null)} />}
    </>
  );
}
