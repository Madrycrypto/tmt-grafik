import { useMemo, useState } from 'react';
import { uid } from '../domain/actions';
import { plannedShift, absenceOn } from '../domain/coverage';
import { addDays, fmtDate, fmtRange, todayIso } from '../domain/dates';
import { BRIGADES, REASON_LABEL, TYPE_LABEL } from '../domain/types';
import type { AbsenceReason, Worker, WorkerType } from '../domain/types';
import { useApp } from '../data/AppContext';
import { Icon, Sheet, TypeTag } from '../ui';

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
  const { state } = useApp();
  const [editing, setEditing] = useState<Worker | null>(null);
  const [query, setQuery] = useState('');
  const [line, setLine] = useState('all');
  const [type, setType] = useState('all');

  const list = useMemo(
    () =>
      state.workers
        .filter((w) => (line === 'all' || w.lineId === line) && (type === 'all' || w.type === type))
        .filter((w) => !query || w.name.toLowerCase().includes(query.toLowerCase()))
        .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name)),
    [state, query, line, type],
  );

  return (
    <>
      <div className="page-head">
        <div>
          <div className="sub">{state.workers.filter((w) => w.active).length} aktywnych</div>
          <h1>Pracownicy</h1>
        </div>
        <div className="row">
          <label className="field">
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
        </div>
      </div>
      <section className="card">
        {list.length === 0 && <div className="empty">Brak pracowników.</div>}
        {list.map((w) => (
          <button
            key={w.id}
            type="button"
            className="list-item"
            style={{ width: '100%', background: 'none', border: 0, borderBottom: '1px solid var(--line-soft)', textAlign: 'left', cursor: 'pointer', opacity: w.active ? 1 : 0.5 }}
            onClick={() => setEditing(w)}
          >
            <span className="grow">
              <b>{w.name}</b> <TypeTag w={w} />
              <div className="sub">
                {state.lines.find((l) => l.id === w.lineId)?.name} · {state.stations.find((s) => s.id === w.homeStationId)?.name ?? 'rezerwa'} ·{' '}
                {state.patterns.find((p) => p.id === w.patternId)?.name}
              </div>
            </span>
            <span className="tag">Bryg. {w.brigade}</span>
          </button>
        ))}
      </section>
      {editing && <WorkerForm initial={editing} onClose={() => setEditing(null)} />}
    </>
  );
}
