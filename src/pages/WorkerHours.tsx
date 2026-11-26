import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../data/AppContext';
import { setAssignment, stationName } from '../domain/actions';
import { level, plannedShift, absenceOn } from '../domain/coverage';
import { addDays, fmtDate, fmtRange, todayIso } from '../domain/dates';
import { lineWindows } from '../domain/fill';
import { patternPeriod, periodLabel, workerPattern, workerPeriod } from '../domain/settlement';
import { restCheck } from '../domain/replacement';
import type { Worker } from '../domain/types';
import { toast } from '../toast';
import { t } from '../i18n';

/**
 * W karcie pracownika: ile godzin ma w miesiącu względem wymiaru i szybkie dodanie
 * zmiany na innej linii (np. żeby odrobił brakujące godziny).
 */
export default function WorkerHours({ worker }: { worker: Worker }) {
  const { state, update, undo } = useApp();
  const today = todayIso();
  const [month, setMonth] = useState(today.slice(0, 7));
  const period = patternPeriod(workerPattern(state, worker), month);
  const bal = useMemo(() => workerPeriod(state, worker, period), [state, worker, period.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const planned = bal.hours;
  const diff = bal.diff;

  // pierwszy wolny dzień od jutra jako podpowiedź
  const firstFree = useMemo(() => {
    for (let i = 1; i < 31; i++) {
      const d = addDays(today, i);
      if (!plannedShift(state, worker, d) && !absenceOn(state, worker.id, d)) return d;
    }
    return addDays(today, 1);
  }, [state, worker, today]);
  const [date, setDate] = useState(firstFree);
  const [lineId, setLineId] = useState(state.lines.find((l) => l.id !== worker.lineId)?.id ?? worker.lineId);
  const windows = lineWindows(state, lineId, date);
  const [winKey, setWinKey] = useState('');
  const win = windows.find((w) => `${w.start}/${w.hours}` === winKey) ?? windows[0];
  const stations = state.stations
    .filter((s) => s.lineId === lineId)
    .sort((a, b) => level(worker, b.id) - level(worker, a.id) || a.order - b.order);
  const [stationId, setStationId] = useState('');
  const station = stations.find((s) => s.id === stationId) ?? stations.find((s) => level(worker, s.id) >= s.minLevel) ?? stations[0];
  // najbliższe dni, gdy pracownik ma wolne, a wybrana linia pracuje — do kliknięcia
  const freeDays = useMemo(() => {
    const out: string[] = [];
    for (let i = 1; i <= 35 && out.length < 8; i++) {
      const d = addDays(today, i);
      if (plannedShift(state, worker, d) || absenceOn(state, worker.id, d)) continue;
      if (lineWindows(state, lineId, d).length) out.push(d);
    }
    return out;
  }, [state, worker, lineId, today]);
  // dzień, w który linia nie pracuje, zamień na najbliższy pasujący
  useEffect(() => {
    if (!lineWindows(state, lineId, date).length && freeDays[0]) setDate(freeDays[0]);
  }, [lineId, freeDays]); // eslint-disable-line react-hooks/exhaustive-deps
  const busy = plannedShift(state, worker, date);
  const absent = absenceOn(state, worker.id, date);
  const rest = win ? restCheck(state, worker, date, { start: win.start, end: win.start + win.hours }) : null;
  const lv = station ? level(worker, station.id) : 0;
  const lineName = (id: string) => state.lines.find((l) => l.id === id)?.name ?? '';

  const extras = state.assignments
    .filter((a) => a.workerId === worker.id && a.extraShift && a.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date));

  const add = () => {
    if (!win || !station) return;
    update(
      (d) => setAssignment(d, { date, workerId: worker.id, lineId, stationId: station.id, extraShift: { start: win.start, hours: win.hours }, source: 'manual' }),
      `Dodatkowa zmiana: ${worker.name} ${date} ${lineName(lineId)}/${station.name} ${fmtRange(win.start, win.hours)}`,
    );
    const warn = [lv < station.minLevel ? t('poziom {lv} (wymagany {min})', { lv, min: station.minLevel }) : '', rest && !rest.ok ? t('mniej niż 11 h odpoczynku') : ''].filter(Boolean);
    toast(warn.length ? t('Dodano mimo uwag: {w}', { w: warn.join(', ') }) : t('Dodano zmianę {d} na {l}', { d: fmtDate(date), l: lineName(lineId) }), { undo, tone: warn.length ? 'warn' : 'ok' });
  };

  return (
    <div className="note stack" style={{ gap: 8 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <b>{period.length > 1 ? t('Godziny w okresie rozliczeniowym {p}', { p: periodLabel(period) }) : t('Godziny w miesiącu')}</b>
        <input className="input" type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} aria-label={t('Miesiąc')} style={{ width: 150 }} />
      </div>
      <div className="row" style={{ alignItems: 'center' }}>
        <span>
          {planned} h / {bal.norm} h
        </span>
        <span className={`tag ${diff < 0 ? 'red' : diff > 0 ? 'amber' : 'green'}`}>
          {diff === 0 ? t('zgodnie z wymiarem') : diff < 0 ? t('brakuje {h} h', { h: -diff }) : t('nadwyżka {h} h', { h: diff })}
        </span>
      </div>
      {period.length > 1 && (
        <div className="row" style={{ gap: 4 }}>
          {bal.months.map((m) => (
            <span key={m.month} className={`tag ${m.diff < 0 ? 'red' : m.diff > 0 ? 'amber' : 'green'}`} title={`${m.hours} h / ${m.norm} h`}>
              {periodLabel([m.month])}: {m.diff === 0 ? '0' : `${m.diff > 0 ? '+' : '−'}${Math.abs(m.diff)}`} h
            </span>
          ))}
        </div>
      )}

      <b style={{ marginTop: 4 }}>{t('Dodatkowa zmiana na innej linii')}</b>
      <div className="row">
        <label className="field">
          {t('Dzień')}
          <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
        </label>
        <label className="field grow">
          {t('Linia')}
          <select
            value={lineId}
            onChange={(e) => {
              setLineId(e.target.value);
              setStationId('');
              setWinKey('');
            }}
          >
            {state.lines.map((l) => (
              <option key={l.id} value={l.id}>
                {l.group ? `${l.group} · ` : ''}
                {l.name}
                {l.id === worker.lineId ? ` (${t('własna')})` : ''}
              </option>
            ))}
          </select>
        </label>
      </div>
      {freeDays.length > 0 && (
        <div className="row" style={{ gap: 6, alignItems: 'center' }}>
          <span className="sub">{t('Wolne dni, gdy ta linia pracuje:')}</span>
          {freeDays.map((d) => (
            <button key={d} type="button" className={`btn small ${d === date ? 'primary' : ''}`} onClick={() => setDate(d)}>
              {fmtDate(d)}
            </button>
          ))}
        </div>
      )}
      {windows.length === 0 ? (
        <div className="sub">{t('Tego dnia linia nie pracuje.')}</div>
      ) : (
        <div className="row">
          <label className="field">
            {t('Zmiana')}
            <select value={win ? `${win.start}/${win.hours}` : ''} onChange={(e) => setWinKey(e.target.value)}>
              {windows.map((w) => (
                <option key={`${w.start}/${w.hours}`} value={`${w.start}/${w.hours}`}>
                  {fmtRange(w.start, w.hours)}
                </option>
              ))}
            </select>
          </label>
          <label className="field grow">
            {t('Stanowisko')}
            <select value={station?.id ?? ''} onChange={(e) => setStationId(e.target.value)}>
              {stations.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} — {t('poz.')} {level(worker, s.id)}
                  {level(worker, s.id) < s.minLevel ? ` (${t('min.')} ${s.minLevel})` : ''}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      {win && (busy || absent || (rest && !rest.ok) || (station && lv < station.minLevel)) && (
        <div className="note amber">
          {busy && <div>{t('Tego dnia ma już zmianę {r} — to będzie druga zmiana.', { r: fmtRange(busy.start, busy.end - busy.start) })}</div>}
          {absent && <div>{t('Tego dnia ma nieobecność.')}</div>}
          {rest && !rest.ok && <div>{t('Mniej niż 11 h odpoczynku (przed: {b} h, po: {a} h).', { b: rest.before, a: rest.after })}</div>}
          {station && lv < station.minLevel && <div>{t('Poziom {lv} — stanowisko wymaga {min}.', { lv, min: station.minLevel })}</div>}
        </div>
      )}
      <button type="button" className="btn primary" disabled={!win || !station} onClick={add}>
        {win ? t('Dodaj zmianę {r} · {d}', { r: fmtRange(win.start, win.hours), d: fmtDate(date) }) : t('Dodaj zmianę')}
      </button>

      {extras.length > 0 && (
        <div className="stack" style={{ gap: 4 }}>
          <span className="sub">{t('Zaplanowane dodatkowe zmiany')}</span>
          {extras.map((a) => (
            <div key={a.id} className="list-item">
              <span className="grow">
                {fmtDate(a.date)} · {fmtRange(a.extraShift!.start, a.extraShift!.hours)} · {lineName(a.lineId)} / {stationName(state, a.stationId)}
              </span>
              <button
                type="button"
                className="btn small"
                onClick={() => {
                  update((d) => void (d.assignments = d.assignments.filter((x) => x.id !== a.id)), `Usunięto dodatkową zmianę: ${worker.name} ${a.date}`);
                  toast(t('Usunięto dodatkową zmianę'), { undo });
                }}
              >
                {t('Usuń')}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
