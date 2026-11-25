import { useState } from 'react';
import { uid } from '../domain/actions';
import type { Station } from '../domain/types';
import { useApp } from '../data/AppContext';

export default function Linie() {
  const { state, update } = useApp();
  const [newLine, setNewLine] = useState('');

  const addLine = () => {
    const name = newLine.trim();
    if (!name) return;
    update((d) => {
      d.lines.push({ id: uid('l'), name });
    }, `Dodano linię: ${name}`);
    setNewLine('');
  };

  return (
    <>
      <div className="page-head">
        <div>
          <div className="sub">Aplikacja jest uniwersalna: dodaj dowolne linie i stanowiska</div>
          <h1>Linie i stanowiska</h1>
        </div>
        <div className="row">
          <label className="field">
            Nowa linia
            <input value={newLine} onChange={(e) => setNewLine(e.target.value)} placeholder="np. CFM 2" onKeyDown={(e) => e.key === 'Enter' && addLine()} />
          </label>
          <button type="button" className="btn primary" disabled={!newLine.trim()} onClick={addLine}>
            Dodaj linię
          </button>
        </div>
      </div>
      {state.lines.length === 0 && <div className="card empty">Brak linii. Dodaj pierwszą powyżej.</div>}
      {state.lines.map((l) => (
        <LineCard key={l.id} lineId={l.id} />
      ))}
    </>
  );
}

function LineCard({ lineId }: { lineId: string }) {
  const { state, update } = useApp();
  const line = state.lines.find((l) => l.id === lineId)!;
  const stations = state.stations.filter((s) => s.lineId === lineId).sort((a, b) => a.order - b.order);
  const [name, setName] = useState('');
  const crew = state.workers.filter((w) => w.lineId === lineId && w.active).length;

  const patch = (id: string, p: Partial<Station>) =>
    update((d) => {
      const s = d.stations.find((x) => x.id === id);
      if (s) Object.assign(s, p);
    });

  const addStation = () => {
    const n = name.trim();
    if (!n) return;
    update((d) => {
      d.stations.push({ id: uid('s'), lineId, name: n, required: 1, minLevel: 3, order: stations.length });
    }, `${line.name}: dodano stanowisko ${n}`);
    setName('');
  };

  const removeStation = (s: Station) => {
    if (!confirm(`Usunąć stanowisko „${s.name}”? Osoby z tym stanowiskiem macierzystym trafią do rezerwy.`)) return;
    update((d) => {
      d.stations = d.stations.filter((x) => x.id !== s.id);
      for (const w of d.workers) {
        if (w.homeStationId === s.id) w.homeStationId = null;
        delete w.skills[s.id];
      }
      d.assignments = d.assignments.filter((a) => a.stationId !== s.id);
    }, `${line.name}: usunięto stanowisko ${s.name}`);
  };

  const move = (s: Station, dir: -1 | 1) => {
    const other = stations[stations.indexOf(s) + dir];
    if (!other) return;
    update((d) => {
      const a = d.stations.find((x) => x.id === s.id)!;
      const b = d.stations.find((x) => x.id === other.id)!;
      [a.order, b.order] = [b.order, a.order];
    });
  };

  const removeLine = () => {
    if (crew > 0) return alert(`Na linii jest ${crew} aktywnych pracowników. Najpierw przenieś ich na inną linię.`);
    if (!confirm(`Usunąć linię ${line.name} i jej stanowiska?`)) return;
    update((d) => {
      d.lines = d.lines.filter((x) => x.id !== lineId);
      d.stations = d.stations.filter((x) => x.lineId !== lineId);
    }, `Usunięto linię ${line.name}`);
  };

  return (
    <section className="card">
      <div className="card-head">
        <div className="row" style={{ alignItems: 'center' }}>
          <input
            className="input"
            style={{ fontWeight: 700, fontSize: 16, width: 200 }}
            aria-label="Nazwa linii"
            defaultValue={line.name}
            onBlur={(e) =>
              e.target.value.trim() &&
              e.target.value.trim() !== line.name &&
              update((d) => {
                d.lines.find((x) => x.id === lineId)!.name = e.target.value.trim();
              }, `Zmiana nazwy linii: ${line.name} → ${e.target.value.trim()}`)
            }
          />
          <span className="sub">{crew} pracowników</span>
        </div>
        <button type="button" className="btn small" onClick={removeLine}>
          Usuń linię
        </button>
      </div>
      <div className="stack" style={{ marginBottom: 12 }}>
        <div className="sub">System zmianowy linii (można zaznaczyć kilka, np. 8 h i 12 h na tej samej linii):</div>
        <div className="row">
          {state.patterns.map((p) => {
            const on = !line.patternIds?.length || line.patternIds.includes(p.id);
            return (
              <label key={p.id} className={`tag ${on ? 'blue' : ''}`} style={{ display: 'inline-flex', gap: 6, alignItems: 'center', padding: '6px 10px', fontSize: 12 }}>
                <input
                  type="checkbox"
                  checked={on}
                  onChange={(e) =>
                    update((d) => {
                      const l = d.lines.find((x) => x.id === lineId)!;
                      const cur = l.patternIds?.length ? l.patternIds : d.patterns.map((x) => x.id);
                      l.patternIds = e.target.checked ? [...new Set([...cur, p.id])] : cur.filter((x) => x !== p.id);
                    }, `${line.name}: ${e.target.checked ? 'dodano' : 'usunięto'} system ${p.name}`)
                  }
                />
                {p.name}
              </label>
            );
          })}
        </div>
        <div className="sub">Nowy system (np. 2 zmiany 06–14 / 14–22) dodasz w Ustawienia → Systemy zmianowe.</div>
      </div>
      <div className="scroll-x">
        <table style={{ minWidth: 560 }}>
          <thead>
            <tr>
              <th>Stanowisko</th>
              <th style={{ width: 120 }}>Ludzi na godz.</th>
              <th style={{ width: 150 }}>Min. poziom</th>
              <th style={{ width: 170 }} />
            </tr>
          </thead>
          <tbody>
            {stations.map((s, i) => (
              <tr key={s.id}>
                <td>
                  <input className="input" style={{ width: '100%' }} aria-label="Nazwa stanowiska" defaultValue={s.name} onBlur={(e) => e.target.value.trim() && e.target.value !== s.name && patch(s.id, { name: e.target.value.trim() })} />
                </td>
                <td>
                  <input className="input" type="number" min={1} max={20} style={{ width: 80 }} aria-label="Wymagana liczba osób" value={s.required} onChange={(e) => patch(s.id, { required: Math.max(1, Number(e.target.value) || 1) })} />
                </td>
                <td>
                  <select className="input" aria-label="Minimalny poziom" value={s.minLevel} onChange={(e) => patch(s.id, { minLevel: Number(e.target.value) })}>
                    {[1, 2, 3, 4].map((l) => (
                      <option key={l} value={l}>
                        {l}
                        {l === 3 ? ' (standard)' : ''}
                      </option>
                    ))}
                  </select>
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button type="button" className="btn small ghost" aria-label="W górę" disabled={i === 0} onClick={() => move(s, -1)}>↑</button>
                  <button type="button" className="btn small ghost" aria-label="W dół" disabled={i === stations.length - 1} onClick={() => move(s, 1)}>↓</button>
                  <button type="button" className="btn small" onClick={() => removeStation(s)}>Usuń</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        <input className="input grow" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nowe stanowisko" aria-label="Nowe stanowisko" onKeyDown={(e) => e.key === 'Enter' && addStation()} />
        <button type="button" className="btn" disabled={!name.trim()} onClick={addStation}>
          Dodaj stanowisko
        </button>
      </div>
    </section>
  );
}
