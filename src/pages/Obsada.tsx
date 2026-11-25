import { useMemo, useState } from 'react';
import { setAssignment, setCombined, setDayHours, stationName } from '../domain/actions';
import { lineStatus, level } from '../domain/coverage';
import { shiftDef } from '../domain/rota';
import type { RosterEntry, StationStatus } from '../domain/coverage';
import { addDays, fmtDate, fmtHour, fmtRange, todayIso } from '../domain/dates';
import { OFF, REASON_LABEL, canPair, linePatterns } from '../domain/types';
import { useApp } from '../data/AppContext';
import { Level, LineSelect, TypeTag, currentWindowCode, shiftLabel, useLine } from '../ui';
import ReplacementSheet from './ReplacementSheet';
import { WorkerEditor } from './Pracownicy';
import { autoAssign } from '../domain/autoAssign';
import type { SheetTarget } from './ReplacementSheet';
import { t } from '../i18n';

function deficitWindow(s: StationStatus, start: number): { start: number; end: number } {
  const low = s.perHour.map((n, i) => (n < s.station.required ? i : -1)).filter((i) => i >= 0);
  return { start: start + low[0], end: start + low[low.length - 1] + 1 };
}

function PersonRow({ e, at, names, onAbsent, onUndo, onHours, onUncombine, moveTo, onOpen }: { e: RosterEntry; at?: string; names?: (id: string) => string; onAbsent: () => void; onUndo: () => void; onHours?: () => void; onUncombine?: () => void; moveTo?: { options: { id: string; label: string }[]; go: (stationId: string | null) => void }; onOpen?: () => void }) {
  const here = at ?? e.stationId;
  const lv = here ? level(e.worker, here) : 0;
  const others = [e.stationId, ...e.also].filter((x): x is string => !!x && x !== here);
  const len = e.shift.end - e.shift.start;
  return (
    <div className="person">
      <div className="who">
        <button type="button" className="link-btn" title={t('Otwórz kartę pracownika')} onClick={onOpen} style={e.absence ? { textDecoration: 'line-through', color: 'var(--muted)' } : undefined}>
          {e.worker.name}
        </button>{' '}
        <TypeTag w={e.worker} />
        <div className="sub">
          {fmtRange(e.shift.start, e.shift.end - e.shift.start)} · {t('bryg.')} {e.worker.brigade}
          {e.shift.extra && ` · ${t('dodatkowa zmiana')}`}
          {e.moved && !e.shift.extra && ` · ${t('przesunięty')}`}
          {others.length > 0 && names && ` · ${t('łączy z')} ${others.map(names).join(', ')}`}
        </div>
      </div>
      {here && <Level value={lv} />}
      {e.absence ? (
        <>
          <span className="tag red">{t(REASON_LABEL[e.absence.reason])}</span>
          {e.absence.from === e.absence.to && (
            <button type="button" className="btn small ghost" onClick={onUndo}>
              {t('Cofnij')}
            </button>
          )}
        </>
      ) : (
        <>
          {(moveTo || onHours) && (
            <select
              className="btn small"
              aria-label={t('Zmień')}
              title={t('Przenieś na inne stanowisko, do rezerwy albo zmień godziny tylko na ten dzień')}
              value=""
              onChange={(ev) => {
                const v = ev.target.value;
                if (v === 'h') onHours?.();
                else if (v) moveTo?.go(v === '-' ? null : v);
              }}
            >
              <option value="">{t('Zmień…')}</option>
              {onHours && <option value="h">{t('Tylko ten dzień: {h} h', { h: len === 12 ? 8 : 12 })}</option>}
              {moveTo && (
                <optgroup label={t('Przenieś')}>
                  <option value="-">{t('do rezerwy (mobilna)')}</option>
                  {moveTo.options.map((o) => (
                    <option key={o.id} value={o.id}>{o.label}</option>
                  ))}
                </optgroup>
              )}
            </select>
          )}
          {onUncombine ? (
            <button type="button" className="btn small" title={t('Ta osoba przestaje obsługiwać to stanowisko w tym dniu')} onClick={onUncombine}>
              {t('Odłącz')}
            </button>
          ) : (
            <button type="button" className="btn small" onClick={onAbsent}>
              {t('Brak')}
            </button>
          )}
        </>
      )}
    </div>
  );
}

export default function Obsada() {
  const { state, update } = useApp();
  const [lineId, setLineId] = useLine(state);
  const [date, setDate] = useState(todayIso());
  const [code, setCode] = useState(() => currentWindowCode(state));
  const [target, setTarget] = useState<SheetTarget | null>(null);
  const [openWorker, setOpenWorker] = useState<string | null>(null);

  const lineCodes = new Set(linePatterns(state, lineId).flatMap((p) => p.sequence.filter((c) => c !== OFF)));
  const lineDefs = state.shiftDefs.filter((d) => lineCodes.has(d.code)).sort((a, b) => a.hours - b.hours || a.start - b.start);
  const options = lineDefs.length ? lineDefs : state.shiftDefs;
  const def = options.find((d) => d.code === code) ?? options.find((d) => { const h = new Date().getHours(); return (h >= d.start && h < d.start + d.hours) || (h + 24 >= d.start && h + 24 < d.start + d.hours); }) ?? options[0];
  const window = useMemo(() => ({ start: def?.start ?? 0, end: (def?.start ?? 0) + (def?.hours ?? 8) }), [def]);
  const ls = useMemo(() => lineStatus(state, lineId, date, window), [state, lineId, date, window]);

  if (!state.lines.length) return <div className="card empty">{t('Najpierw dodaj linię i stanowiska w zakładce „Linie i stanowiska”.')}</div>;

  const present = ls.entries.filter((e) => !e.absence);
  const gaps = ls.statuses.filter((s) => !s.ok);
  const sole = ls.statuses.filter((s) => s.ok && s.soleQualified && s.station.required === 1);
  const count = (t: string) => present.filter((e) => e.worker.type === t).length;

  const openAbsent = (e: RosterEntry) => {
    if (!e.stationId) {
      update((d) => {
        if (!d.absences.some((a) => a.workerId === e.worker.id && a.from <= e.shift.date && e.shift.date <= a.to))
          d.absences.push({ id: crypto.randomUUID(), workerId: e.worker.id, from: e.shift.date, to: e.shift.date, reason: 'L4' });
      }, `Brak: ${e.worker.name} (${e.shift.date}) — rezerwa`);
      return;
    }
    setTarget({ date: e.shift.date, lineId, stationId: e.stationId, window: { start: e.shift.start, end: e.shift.end }, absent: e.worker });
  };

  const undoAbsence = (e: RosterEntry) => {
    const ab = e.absence;
    if (!ab) return;
    update((d) => {
      d.absences = d.absences.filter((a) => a.id !== ab.id);
    }, `Cofnięto brak: ${e.worker.name} (${ab.from})`);
  };

  const toggleHours = (e: RosterEntry) => {
    if (e.shift.extra || !e.shift.code) return undefined;
    const d = shiftDef(state, e.shift.code);
    if (!d) return undefined;
    const len = e.shift.end - e.shift.start;
    const target = len === 12 ? 8 : 12;
    const back = target === (e.worker.shiftHours ?? d.hours);
    return () =>
      update(
        (s) => setDayHours(s, s.workers.find((w) => w.id === e.worker.id)!, e.shift.date, back ? null : target, { start: d.start, hours: d.hours }, { lineId: e.lineId, stationId: e.stationId }),
        `${e.worker.name}: ${e.shift.date} ${target} h`,
      );
  };

  const names = (id: string) => stationName(state, id);

  const combine = (e: RosterEntry, stationId: string, on: boolean) => {
    if (!e.stationId) return;
    const place = { lineId: e.lineId, stationId: e.stationId, also: e.also };
    update(
      (d) => setCombined(d, d.workers.find((w) => w.id === e.worker.id)!, e.shift.date, place, stationId, on),
      on ? `${e.worker.name}: ${names(e.stationId)} + ${names(stationId)} (${e.shift.date})` : `${e.worker.name}: koniec łączenia z ${names(stationId)} (${e.shift.date})`,
    );
  };

  /** osoby z sąsiednich stanowisk, które mogą też obsłużyć to stanowisko */
  const pairCandidates = (s: StationStatus) =>
    present.filter((e) => e.stationId && e.stationId !== s.station.id && !e.also.includes(s.station.id) && canPair(state, e.stationId, s.station.id) && level(e.worker, s.station.id) >= s.station.minLevel);

  const fillGap = (s: StationStatus) => setTarget({ date, lineId, stationId: s.station.id, window: deficitWindow(s, window.start) });

  const assignReserve = (e: RosterEntry, stationId: string) =>
    update(
      (d) => setAssignment(d, { date: e.shift.date, workerId: e.worker.id, lineId, stationId: stationId || null, source: 'manual' }),
      `Ręcznie: ${e.worker.name} → ${stationName(state, stationId || null)}`,
    );

  const arrange = () => {
    const people = [...new Map(present.filter((e) => e.lineId === lineId).map((e) => [e.worker.id, e])).values()];
    const current = new Map(people.map((e) => [e.worker.id, e.stationId]));
    const stations = state.stations.filter((st) => st.lineId === lineId);
    const plan = autoAssign(people.map((e) => e.worker), stations, current);
    const moves = plan.filter((p) => p.stationId !== current.get(p.workerId));
    if (!moves.length) {
      alert(t('Nic do zmiany — ludzie już stoją tam, gdzie mają kwalifikacje.'));
      return;
    }
    const byId = new Map(people.map((e) => [e.worker.id, e]));
    update((d) => {
      for (const m of moves) {
        const e = byId.get(m.workerId)!;
        setAssignment(d, { date: e.shift.date, workerId: m.workerId, lineId, stationId: m.stationId, source: 'manual' });
      }
    }, `Rozstawienie wg matrycy (${date}): ` + moves.map((m) => `${byId.get(m.workerId)!.worker.name} → ${stationName(state, m.stationId)}`).join('; '));
  };

  const resetDay = () => {
    if (!confirm(t('Usunąć wszystkie ręczne przesunięcia i dodatkowe zmiany na tej linii w tym dniu? Nieobecności zostaną.'))) return;
    update((d) => {
      d.assignments = d.assignments.filter((a) => !(a.date === date && a.lineId === lineId));
    }, `Przywrócono plan dnia ${date} (${state.lines.find((l) => l.id === lineId)?.name})`);
  };

  const hourCells = (s: StationStatus) => (
    <div className="hours" aria-label={t('Pokrycie w kolejnych godzinach')}>
      {s.perHour.map((n, i) => (
        <span key={i} className={n < s.station.required ? 'h-low' : n > s.station.required ? 'h-over' : 'h-ok'} title={`${fmtHour(window.start + i)}: ${n}/${s.station.required}`} />
      ))}
    </div>
  );

  return (
    <>
      <div className="page-head">
        <div>
          <div className="sub">
            {fmtDate(date)} · {def ? shiftLabel(def) : ''}
          </div>
          <h1>{t('Obsada')} — {state.lines.find((l) => l.id === lineId)?.name}</h1>
        </div>
        <div className="row">
          <LineSelect state={state} value={lineId} onChange={setLineId} />
          <label className="field">
            {t('Dzień')}
            <div className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
              <button type="button" className="btn small" aria-label={t('Poprzedni dzień')} onClick={() => setDate(addDays(date, -1))}>‹</button>
              <input className="input" type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
              <button type="button" className="btn small" aria-label={t('Następny dzień')} onClick={() => setDate(addDays(date, 1))}>›</button>
            </div>
          </label>
          <label className="field">
            {t('Zmiana / okno')}
            <select value={def?.code ?? ''} onChange={(e) => setCode(e.target.value)}>
              {options.map((d) => (
                <option key={d.code} value={d.code}>
                  {shiftLabel(d)}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <section className="kpis" aria-label={t('Wskaźniki zmiany')}>
        <div className="kpi">
          <div className="k">{t('Obecni / zaplanowani')}</div>
          <div className="v">
            {present.length} / {ls.entries.length}
          </div>
          <div className="d" style={{ color: ls.entries.length > present.length ? 'var(--red-ink)' : undefined }}>
            {t('{n} nieobecnych', { n: ls.entries.length - present.length })}
          </div>
        </div>
        <div className="kpi">
          <div className="k">{t('Stanowiska bez pokrycia')}</div>
          <div className="v" style={{ color: gaps.length ? 'var(--red-ink)' : 'var(--green-ink)' }}>{gaps.length}</div>
          <div className="d">{gaps.map((g) => g.station.name).join(', ') || t('wszystko obsadzone')}</div>
        </div>
        <div className="kpi">
          <div className="k">{t('Bez zastępcy na zmianie')}</div>
          <div className="v" style={{ color: sole.length ? 'var(--amber-ink)' : undefined }}>{sole.length}</div>
          <div className="d">{sole.map((g) => g.station.name).join(', ') || '—'}</div>
        </div>
        <div className="kpi">
          <div className="k">{t('Skład: PL · CN · agencja')}</div>
          <div className="v">
            {count('PL')} · {count('CN')} · {count('AG')}
          </div>
          <div className="d">{t('pokrycie liczone godzinowo')}</div>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>{t('Stanowiska')}</h2>
          <div className="row" style={{ alignItems: 'center' }}>
            <span className="legend">
              <span><span className="dot h-ok" /> {t('pokryte')}</span>
              <span><span className="dot h-low" /> {t('brak')}</span>
            </span>
            <button type="button" className="btn small primary" title={t('Ustaw obecnych ludzi na stanowiskach, na których mają kwalifikacje, tak żeby pokryć jak najwięcej stanowisk')} onClick={arrange}>
              {t('Rozstaw wg matrycy')}
            </button>
            <button type="button" className="btn small" onClick={resetDay}>
              {t('Przywróć plan dnia')}
            </button>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
          {ls.statuses.map((s) => (
            <div key={s.station.id} className={`station-card ${s.ok ? '' : 'gap'}`}>
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <strong>{s.station.name}</strong>
                <span className={`tag ${s.ok ? (s.soleQualified && s.station.required === 1 ? 'amber' : 'green') : 'red'}`}>
                  {s.ok ? `OK · ${s.min}/${s.station.required}` : `${t('Brak#obsada')} · ${s.min}/${s.station.required}`}
                </span>
              </div>
              {hourCells(s)}
              {s.people.length === 0 && <div className="sub">{t('Nikt nie jest zaplanowany.')}</div>}
              {s.people.map((e) => {
                const guest = e.stationId !== s.station.id;
                return (
                  <PersonRow
                    key={e.worker.id + e.shift.date}
                    e={e}
                    at={s.station.id}
                    names={names}
                    onAbsent={() => openAbsent(e)}
                    onUndo={() => undoAbsence(e)}
                    onHours={toggleHours(e)}
                    onOpen={() => setOpenWorker(e.worker.id)}
                    onUncombine={guest ? () => combine(e, s.station.id, false) : undefined}
                    moveTo={guest ? undefined : {
                      options: ls.statuses.filter((o) => o.station.id !== s.station.id).map((o) => ({ id: o.station.id, label: `${o.station.name} (${t('poz.')} ${level(e.worker, o.station.id)})` })),
                      go: (to) => assignReserve(e, to ?? ''),
                    }}
                  />
                );
              })}
              {pairCandidates(s).length > 0 && (
                <label className="field">
                  {t('Obsłuży też osoba z')}
                  <select value="" onChange={(ev) => { const e = pairCandidates(s).find((x) => x.worker.id === ev.target.value); if (e) combine(e, s.station.id, true); }}>
                    <option value="">{t('— wybierz —')}</option>
                    {pairCandidates(s).map((e) => (
                      <option key={e.worker.id} value={e.worker.id}>
                        {names(e.stationId!)}: {e.worker.name} ({t('poz.')} {level(e.worker, s.station.id)})
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {!s.ok && (
                <button type="button" className="btn danger" onClick={() => fillGap(s)}>
                  {t('Znajdź zastępstwo')}
                </button>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>{t('Rezerwa i osoby bez stanowiska')}</h2>
          <span className="sub">{ls.reserve.length} os.</span>
        </div>
        {ls.reserve.length === 0 && <div className="sub">{t('Brak rezerwy na tej zmianie.')}</div>}
        {ls.reserve.map((e) => (
          <div key={e.worker.id + e.shift.date} className="list-item">
            <PersonRow e={e} onOpen={() => setOpenWorker(e.worker.id)} onAbsent={() => openAbsent(e)} onUndo={() => undoAbsence(e)} onHours={toggleHours(e)} />
            {!e.absence && (
              <label className="field" style={{ minWidth: 200 }}>
                {t('Przypisz do')}
                <select value="" onChange={(ev) => assignReserve(e, ev.target.value)}>
                  <option value="">{t('— stanowisko —')}</option>
                  {ls.statuses.map((s) => (
                    <option key={s.station.id} value={s.station.id}>
                      {s.station.name} ({t('poz.')} {level(e.worker, s.station.id)})
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        ))}
      </section>

      {openWorker && <WorkerEditor workerId={openWorker} onClose={() => setOpenWorker(null)} />}
      {target && <ReplacementSheet target={target} onClose={() => setTarget(null)} />}
    </>
  );
}
