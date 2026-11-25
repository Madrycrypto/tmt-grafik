import { useMemo, useState } from 'react';
import { addAbsence, applyVariant, describeStep, lineName, setAssignment, stationName } from '../domain/actions';
import { level, plannedShift, roster } from '../domain/coverage';
import type { Interval } from '../domain/coverage';
import { fmtDate, fmtRange } from '../domain/dates';
import { findVariants, restCheck } from '../domain/replacement';
import type { Variant } from '../domain/replacement';
import type { AbsenceReason, Worker } from '../domain/types';
import { REASON_LABEL } from '../domain/types';
import { useApp } from '../data/AppContext';
import { Sheet, TypeTag } from '../ui';

export interface SheetTarget {
  /** dzień rozpoczęcia brakującej zmiany */
  date: string;
  lineId: string;
  stationId: string;
  window: Interval;
  absent?: Worker;
}

const KIND_LABEL = { reserve: 'z rezerwy', surplus: 'z nadwyżki', move: 'przesunięcie', extra: 'dodatkowa zmiana' };

function badge(v: Variant): string {
  const parts = [`${v.moves} ${v.moves === 1 ? 'ruch' : 'ruchy'}`];
  if (v.extras) parts.push(v.agency ? 'agencja' : 'nadgodziny');
  else parts.push('bez nadgodzin');
  if (v.otherLine) parts.push('inna linia');
  return parts.join(' · ');
}

export default function ReplacementSheet({ target, onClose }: { target: SheetTarget; onClose: () => void }) {
  const { state, update, user } = useApp();
  const [reason, setReason] = useState<AbsenceReason>('L4');
  const [picked, setPicked] = useState(0);
  const [manual, setManual] = useState('');
  const station = state.stations.find((s) => s.id === target.stationId);

  const { variants, blocked } = useMemo(
    () =>
      findVariants(state, {
        date: target.date,
        lineId: target.lineId,
        stationId: target.stationId,
        window: target.window,
        excludeIds: target.absent ? [target.absent.id] : [],
      }),
    [state, target],
  );

  const manualOptions = useMemo(() => {
    if (!station) return [];
    const present = new Map(roster(state, target.date, target.window).map((e) => [e.worker.id, e]));
    return state.workers
      .filter((w) => w.active && w.id !== target.absent?.id && level(w, station.id) >= 1)
      .map((w) => {
        const e = present.get(w.id);
        const rest = e ? null : restCheck(state, w, target.date, target.window);
        return { w, e, rest, lv: level(w, station.id) };
      })
      .sort((a, b) => b.lv - a.lv || Number(!!b.e) - Number(!!a.e));
  }, [state, station, target]);

  if (!station) return null;
  const absentInfo = target.absent ? { worker: target.absent, date: target.date, reason } : undefined;
  const range = fmtRange(target.window.start, target.window.end - target.window.start);

  const approve = () => {
    const v = variants[picked];
    if (!v) return;
    update((d) => applyVariant(d, user, v, absentInfo));
    onClose();
  };

  const onlyAbsence = () => {
    if (!target.absent) return;
    const w = target.absent;
    update((d) => addAbsence(d, w.id, target.date, reason), `Brak: ${w.name} (${target.date}, ${reason}) — bez zastępstwa`);
    onClose();
  };

  const assignManual = () => {
    const opt = manualOptions.find((o) => o.w.id === manual);
    if (!opt) return;
    if (opt.lv < station.minLevel && !confirm(`${opt.w.name} ma poziom ${opt.lv} (wymagany ${station.minLevel}). Przypisać mimo to?`)) return;
    if (opt.rest && !opt.rest.ok && !confirm(`${opt.w.name}: brak 11 h odpoczynku (przed: ${opt.rest.before} h, po: ${opt.rest.after} h). Przypisać mimo to?`)) return;
    update(
      (d) => {
        if (target.absent) addAbsence(d, target.absent.id, target.date, reason);
        const shift = opt.e ? opt.e.shift : null;
        setAssignment(d, {
          date: shift ? shift.date : target.date,
          workerId: opt.w.id,
          lineId: target.lineId,
          stationId: station.id,
          extraShift: shift ? undefined : { start: target.window.start, hours: target.window.end - target.window.start },
          source: 'manual',
        });
      },
      `${target.absent ? `Brak: ${target.absent.name} (${reason}). ` : ''}Ręcznie: ${opt.w.name} → ${station.name} (${lineName(state, target.lineId)})`,
    );
    onClose();
  };

  return (
    <Sheet
      title={target.absent ? `Brak: ${target.absent.name}` : `Uzupełnij: ${station.name}`}
      sub={`${station.name} · ${lineName(state, target.lineId)} · ${fmtDate(target.date)} ${range} · wymagany poziom ≥${station.minLevel}`}
      onClose={onClose}
    >
      {target.absent && (
        <label className="field">
          Powód nieobecności
          <select value={reason} onChange={(e) => setReason(e.target.value as AbsenceReason)}>
            {Object.entries(REASON_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
      )}

      <h3>Podpowiedzi według matrycy</h3>
      {variants.length === 0 && <div className="note red">Brak kandydatów z poziomem ≥{station.minLevel}, którzy mogą przyjść bez łamania 11 h odpoczynku. Użyj przypisania ręcznego poniżej.</div>}
      {variants.map((v, i) => (
        <button type="button" key={i} className={`variant ${i === picked ? 'on' : ''}`} onClick={() => setPicked(i)}>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <strong>Wariant {i + 1}{i === 0 ? ' · rekomendowany' : ''}</strong>
            <span className="tag">{badge(v)}</span>
          </div>
          {v.steps.map((s, j) => (
            <div className="step" key={j}>
              <span className="n">{j + 1}</span>
              <span>
                <b>{s.worker.name}</b> <TypeTag w={s.worker} /> — {s.kind === 'extra' ? 'wolne' : stationName(state, s.fromStationId)} → {stationName(state, s.toStationId)}
                {s.fromLineId !== s.toLineId && ` (z linii ${lineName(state, s.fromLineId)})`}
                <br />
                <span className="sub">
                  {KIND_LABEL[s.kind]} · poziom {s.level}
                  {s.extraShift && ` · ${fmtRange(s.extraShift.start, s.extraShift.hours)}`}
                  {s.warnings.map((w) => ` · ⚠ ${w}`).join('')}
                </span>
              </span>
            </div>
          ))}
        </button>
      ))}

      {blocked.length > 0 && (
        <div className="note amber">
          Zablokowani (nie da się ich zabrać bez zostawienia pustego stanowiska):{' '}
          {blocked.map((b) => `${b.worker.name} (${stationName(state, b.stationId)})`).join(', ')}
        </div>
      )}

      <div className="row">
        <button type="button" className="btn success grow" disabled={!variants.length} onClick={approve}>
          Zatwierdź wariant {variants.length ? picked + 1 : ''}
        </button>
        {target.absent && (
          <button type="button" className="btn" onClick={onlyAbsence}>
            Tylko zgłoś brak
          </button>
        )}
      </div>

      <details>
        <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: 14 }}>Przypisz ręcznie</summary>
        <div className="row" style={{ marginTop: 10 }}>
          <label className="field grow">
            Pracownik (z poziomem na {station.name})
            <select value={manual} onChange={(e) => setManual(e.target.value)}>
              <option value="">— wybierz —</option>
              {manualOptions.map(({ w, e, rest, lv }) => (
                <option key={w.id} value={w.id}>
                  {`poz. ${lv} · ${w.name} · ${e ? `na zmianie (${stationName(state, e.stationId)})` : plannedShift(state, w, target.date) ? 'inna zmiana' : 'wolne'}${rest && !rest.ok ? ' · brak 11 h' : ''}`}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="btn primary" disabled={!manual} onClick={assignManual}>
            Przypisz
          </button>
        </div>
      </details>
      {variants[picked] && <div className="sub">Zapis w historii: {variants[picked].steps.map((s) => describeStep(state, s)).join('; ')}</div>}
    </Sheet>
  );
}

