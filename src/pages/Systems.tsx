import { useState } from 'react';
import { fmtRange } from '../domain/dates';
import { SYSTEM_LABEL, buildSystem } from '../domain/templates';
import type { SystemKind } from '../domain/templates';
import { OFF, holidaysOff, patternBrigades } from '../domain/types';
import { useApp } from '../data/AppContext';

/** Dodawanie systemów 1/2/3/4-zmianowych (8 h lub 12 h) i przypisanie ich do linii. */
export default function Systems() {
  const { state, update } = useApp();
  const [kind, setKind] = useState<SystemKind>('2');
  const [hours, setHours] = useState<8 | 12>(8);
  const [start, setStart] = useState(6);
  const [lineId, setLineId] = useState('');
  const preview = buildSystem(state, { kind, hours, start });

  const add = () => {
    if ('error' in preview) return;
    update((d) => {
      d.shiftDefs.push(...preview.shiftDefs);
      d.patterns.push(preview.pattern);
      const line = d.lines.find((l) => l.id === lineId);
      if (line) line.patternIds = [...new Set([...(line.patternIds?.length ? line.patternIds : []), preview.pattern.id])];
    }, `Dodano system zmianowy: ${preview.pattern.name}${lineId ? ` → ${state.lines.find((l) => l.id === lineId)?.name}` : ''}`);
  };

  const remove = (id: string) => {
    const p = state.patterns.find((x) => x.id === id)!;
    update((d) => {
      d.patterns = d.patterns.filter((x) => x.id !== id);
      d.targets = d.targets.filter((t) => t.patternId !== id);
      d.rotaOverrides = d.rotaOverrides.filter((o) => o.patternId !== id);
      for (const l of d.lines) if (l.patternIds) l.patternIds = l.patternIds.filter((x) => x !== id);
    }, `Usunięto system zmianowy: ${p.name}`);
  };

  return (
    <section className="card stack">
      <h2>Systemy zmianowe</h2>
      <p className="sub" style={{ margin: 0 }}>
        Każda linia może pracować w innym systemie: 1, 2 lub 3 zmiany (pn–pt) albo 4 brygady w ruchu ciągłym, na zmianach 8 h lub 12 h. Na jednej linii możesz łączyć
        system 8 h i 12 h — obsada liczy się godzinowo, więc dobę pokryją 3 osoby po 8 h albo 2 po 12 h.
      </p>
      {state.patterns.map((p) => {
        const workers = state.workers.filter((w) => w.patternId === p.id).length;
        const lines = state.lines.filter((l) => !l.patternIds?.length || l.patternIds.includes(p.id)).map((l) => l.name);
        const shifts = [...new Set(p.sequence.filter((c) => c !== OFF))]
          .map((c) => state.shiftDefs.find((d) => d.code === c))
          .filter(Boolean)
          .map((d) => `${d!.label} ${fmtRange(d!.start, d!.hours)}`);
        return (
          <div key={p.id} className="list-item">
            <span className="grow">
              <b>{p.name}</b>
              <div className="sub">
                brygady {patternBrigades(p).join(', ')} · {shifts.join(' / ')} · {workers} os. · linie: {lines.join(', ') || '—'}
              </div>
            </span>
            <label className="sub" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={holidaysOff(p)}
                onChange={(e) =>
                  update((d) => {
                    d.patterns.find((x) => x.id === p.id)!.holidaysOff = e.target.checked;
                  }, `${p.name}: ${e.target.checked ? 'wolne w święta ustawowe' : 'praca w święta ustawowe'}`)
                }
              />
              wolne w święta
            </label>
            <button
              type="button"
              className="btn small"
              disabled={workers > 0}
              title={workers > 0 ? 'Najpierw przenieś pracowników do innego systemu' : ''}
              onClick={() => remove(p.id)}
            >
              Usuń
            </button>
          </div>
        );
      })}
      <h3 style={{ marginTop: 8 }}>Dodaj system</h3>
      <div className="row">
        <label className="field">
          System
          <select value={kind} onChange={(e) => setKind(e.target.value as SystemKind)}>
            {(Object.keys(SYSTEM_LABEL) as SystemKind[]).map((k) => (
              <option key={k} value={k}>
                {SYSTEM_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Długość zmiany
          <select value={hours} onChange={(e) => setHours(Number(e.target.value) as 8 | 12)}>
            <option value={8}>8 h</option>
            <option value={12}>12 h</option>
          </select>
        </label>
        <label className="field">
          Start pierwszej zmiany
          <select value={start} onChange={(e) => setStart(Number(e.target.value))}>
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>
                {String(h).padStart(2, '0')}:00
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Przypisz do linii
          <select value={lineId} onChange={(e) => setLineId(e.target.value)}>
            <option value="">— później —</option>
            {state.lines.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {'error' in preview ? (
        <div className="note amber">{preview.error}</div>
      ) : (
        <div className="note">
          <b>{preview.pattern.name}</b> · brygady {patternBrigades(preview.pattern).join(', ')}
        </div>
      )}
      <button type="button" className="btn primary" disabled={'error' in preview} onClick={add}>
        Dodaj system
      </button>
    </section>
  );
}
