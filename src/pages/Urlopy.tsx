import { useMemo, useState } from 'react';
import { uid } from '../domain/actions';
import { monthDays, periodDays, todayIso, weekday } from '../domain/dates';
import { holidayName } from '../domain/holidays';
import { hasLeave, leaveBalance, leaveDaysIn, leaveLoad, parseLeaveSheet, setLeaveDay } from '../domain/leave';
import { plannedShift } from '../domain/coverage';
import { shiftDef } from '../domain/rota';
import { useApp } from '../data/AppContext';
import { LineOptions, usePersistent, useScope } from '../ui';
import type { AppState, Worker } from '../domain/types';
import { t } from '../i18n';

const DOW = ['Nd', 'Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'So'];
const MONTHS = ['styczeń', 'luty', 'marzec', 'kwiecień', 'maj', 'czerwiec', 'lipiec', 'sierpień', 'wrzesień', 'październik', 'listopad', 'grudzień'];
/** Sobota, niedziela i święta: lekko na czerwono (nagłówek, komórki i wiersze podsumowania). */
const OFF_TINT = 'rgba(214, 69, 69, 0.09)';
const isOffDay = (d: string) => weekday(d) === 0 || weekday(d) === 6 || !!holidayName(d);

export default function Urlopy() {
  const { state, update, canEdit } = useApp();
  const [month, setMonth] = usePersistent('urlopy-month', todayIso().slice(0, 7));
  const [scope, setScope] = useScope(state);
  const [maxOff, setMaxOff] = usePersistent('urlopy-max', '');
  const [paste, setPaste] = useState<string | null>(null);
  const [view, setView] = usePersistent<'month' | 'year'>('urlopy-view', 'month');
  const year = month.slice(0, 4);
  const yearMode = view === 'year';
  const [openMap, setOpenMap] = useState<Record<string, boolean>>({});
  const lines = useMemo(() => {
    const ls = scope === 'all' ? state.lines : scope.startsWith('g:') ? state.lines.filter((l) => l.group === scope.slice(2)) : state.lines.filter((l) => l.id === scope);
    return ls.map((l) => l.id);
  }, [state.lines, scope]);
  const groups = [...new Set(state.lines.map((l) => l.group).filter((g): g is string => !!g))];
  const workers = useMemo(
    () => state.workers.filter((w) => w.active && lines.includes(w.lineId)).sort((a, b) => a.lineId.localeCompare(b.lineId) || a.brigade.localeCompare(b.brigade) || a.name.localeCompare(b.name, 'pl')),
    [state.workers, lines],
  );
  const yearTotals = useMemo(() => (yearMode ? new Map(workers.map((w) => [w.id, leaveBalance(state, w, year)])) : null), [yearMode, workers, state, year]);
  const limit = maxOff === '' ? undefined : Number(maxOff);
  const lineName = (id: string) => state.lines.find((l) => l.id === id)?.name ?? id;
  const toggleOpen = (k: string, cur: boolean) => setOpenMap((m) => ({ ...m, [k]: !cur }));
  const thisMonth = todayIso().slice(0, 7);
  const preview = useMemo(() => (paste === null ? null : parseLeaveSheet(paste, state.workers)), [paste, state.workers]);

  const toggle = (workerId: string, date: string, name: string) => {
    const on = !hasLeave(state, workerId, date);
    update((d) => {
      d.absences = setLeaveDay(d.absences, workerId, date, on, () => uid('ab'));
    }, `Urlop: ${name} ${date} ${on ? 'dodany' : 'usunięty'}`);
  };
  const setPool = (workerId: string, value: string) =>
    update((d) => {
      const w = d.workers.find((x) => x.id === workerId);
      if (w) w.leaveDays = value === '' ? undefined : Math.max(0, Number(value));
    }, 'Pula urlopowa');
  const applyImport = () => {
    if (!preview) return;
    update((d) => {
      for (const m of preview.matched) for (const date of m.dates) d.absences = setLeaveDay(d.absences, m.workerId, date, true, () => uid('ab'));
    }, `Import urlopów: ${preview.matched.length} osób, ${preview.days} dni`);
    setPaste(null);
  };

  return (
    <>
      <div className="page-head">
        <div>
          <div className="sub">{t('Kliknij dzień, aby dodać lub zdjąć urlop. Pula pomniejsza się tylko o dni, w które według grafiku pracujesz.')}</div>
          <h1>{t('Urlopy')}</h1>
        </div>
        <div className="row">
          <label className="field">
            {t('Linia')}
            <select value={scope} onChange={(e) => setScope(e.target.value)}>
              <option value="all">{t('cały zakład')}</option>
              {groups.map((g) => (
                <option key={g} value={`g:${g}`}>
                  {g} — {t('cała linia główna')}
                </option>
              ))}
              <LineOptions state={state} />
            </select>
          </label>
          <div className="field">
            {t('Okres')}
            <div className="row" style={{ gap: 6 }}>
              <button type="button" className={`btn ${!yearMode ? 'primary' : ''}`} onClick={() => setView('month')}>{t('Miesiąc')}</button>
              <button type="button" className={`btn ${yearMode ? 'primary' : ''}`} onClick={() => setView('year')}>{t('Cały rok')}</button>
            </div>
          </div>
          {yearMode ? (
            <label className="field">
              {t('Rok')}
              <select value={year} onChange={(e) => setMonth(`${e.target.value}-${month.slice(5)}`)}>
                {[-1, 0, 1, 2].map((k) => String(Number(thisMonth.slice(0, 4)) + k)).map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </label>
          ) : (
            <label className="field">
              {t('Miesiąc')}
              <input className="input" type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
            </label>
          )}
          <label className="field" title={t('Dni z większą liczbą urlopów zostaną podświetlone')}>
            {t('Maks. urlopów dziennie')}
            <input className="input" type="number" min={0} style={{ width: 90 }} value={maxOff} onChange={(e) => setMaxOff(e.target.value)} />
          </label>
          {canEdit && (
            <button type="button" className="btn" onClick={() => setPaste('')}>
              {t('Wklej z Excela')}
            </button>
          )}
        </div>
      </div>

      {paste !== null && (
        <section className="card" style={{ marginBottom: 14 }}>
          <div className="card-head">
            <h2>{t('Import urlopów z arkusza')}</h2>
            <span className="sub">{t('Skopiuj z Excela wiersz z datami i wiersze pracowników (komórka „U” = urlop)')}</span>
          </div>
          <textarea className="input" rows={6} style={{ width: '100%', fontFamily: 'monospace' }} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={t('Wklej tutaj')} />
          {preview && paste.trim() !== '' && (
            <div style={{ marginTop: 8 }}>
              <div>
                {t('Rozpoznano')}: <b>{preview.matched.length}</b> {t('osób')}, <b>{preview.days}</b> {t('dni urlopu')}
                {preview.unmatched.length > 0 && (
                  <span className="tag amber" style={{ marginLeft: 8 }} title={preview.unmatched.join(', ')}>
                    {t('nie znaleziono w bazie')}: {preview.unmatched.length}
                  </span>
                )}
              </div>
              {preview.unmatched.length > 0 && <div className="sub">{preview.unmatched.join(', ')}</div>}
            </div>
          )}
          <div className="row" style={{ marginTop: 10 }}>
            <button type="button" className="btn primary" disabled={!preview || !preview.matched.length} onClick={applyImport}>
              {t('Wpisz urlopy')}
            </button>
            <button type="button" className="btn" onClick={() => setPaste(null)}>
              {t('Anuluj')}
            </button>
          </div>
        </section>
      )}

      {yearMode ? (
        <>
          <div className="row" style={{ marginBottom: 8 }}>
            <button type="button" className="btn small" onClick={() => setOpenMap(Object.fromEntries(MONTHS.map((_, k) => [`${year}-${String(k + 1).padStart(2, '0')}`, true])))}>{t('Rozwiń wszystko')}</button>
            <button type="button" className="btn small" onClick={() => setOpenMap(Object.fromEntries(MONTHS.map((_, k) => [`${year}-${String(k + 1).padStart(2, '0')}`, false])))}>{t('Zwiń wszystko')}</button>
          </div>
          {MONTHS.map((name, k) => {
            const m = `${year}-${String(k + 1).padStart(2, '0')}`;
            const open = openMap[m] ?? m === (thisMonth.startsWith(year) ? thisMonth : `${year}-01`);
            const planned = leaveDaysIn(state, new Set(workers.map((w) => w.id)), monthDays(m));
            return (
              <div key={m} style={{ marginBottom: 10 }}>
                <button type="button" className="group-head" aria-expanded={open} onClick={() => toggleOpen(m, open)}>
                  <span className="chev">{open ? '▾' : '▸'}</span>
                  <h2>{t(name)} {year}</h2>
                  <span className="sub">{planned ? `${planned} ${t('dni urlopu')}` : t('brak urlopów')}</span>
                </button>
                {open && <MonthGrid state={state} month={m} workers={workers} lines={lines} limit={limit} canEdit={canEdit} lineName={lineName} onToggle={toggle} onPool={setPool} yearTotals={yearTotals} />}
              </div>
            );
          })}
        </>
      ) : (
        <MonthGrid state={state} month={month} workers={workers} lines={lines} limit={limit} canEdit={canEdit} lineName={lineName} onToggle={toggle} onPool={setPool} yearTotals={null} />
      )}
    </>
  );
}

type GridProps = {
  state: AppState;
  month: string;
  workers: Worker[];
  lines: string[];
  limit: number | undefined;
  canEdit: boolean;
  lineName: (id: string) => string;
  onToggle: (workerId: string, date: string, name: string) => void;
  onPool: (workerId: string, value: string) => void;
  /** w widoku rocznym: plan i wynik za cały rok zamiast za miesiąc */
  yearTotals: Map<string, ReturnType<typeof leaveBalance>> | null;
};

/** Tabela urlopów jednego miesiąca: dni w kolumnach, „U” w komórce, pula i wynik z prawej. */
function MonthGrid({ state, month, workers, lines, limit, canEdit, lineName, onToggle: toggle, onPool: setPool, yearTotals }: GridProps) {
  const days = useMemo(() => periodDays(month), [month]);
  const load = useMemo(() => leaveLoad(state, days, lines), [state, days, lines]);
  return (
      <section className="card">
        <div className="scroll-x">
          <table style={{ minWidth: 40 * days.length + 420, tableLayout: 'fixed' }}>
            <thead>
              <tr>
                <th className="sticky-col" style={{ width: 200 }}>{t('Pracownik')}</th>
                <th style={{ width: 54 }}>{t('Brygada')}</th>
                {days.map((d) => (
                  <th key={d} title={holidayName(d) ?? ''} style={{ textAlign: 'center', width: 34, padding: '6px 1px', color: isOffDay(d) ? 'var(--red-ink)' : undefined, background: isOffDay(d) ? OFF_TINT : undefined }}>
                    {t(DOW[weekday(d)])}
                    <br />
                    {d.slice(8)}
                  </th>
                ))}
                <th style={{ width: 70, textAlign: 'center' }} title={t('Pozostała pula urlopu w dniach (wpisz z systemu kadrowego)')}>{t('Pula (dni)')}</th>
                {yearTotals && <th style={{ width: 70, textAlign: 'center' }}>{t('UW w miesiącu')}</th>}
                <th style={{ width: 70, textAlign: 'center' }}>{yearTotals ? t('UW w roku') : t('Plan UW')}</th>
                <th style={{ width: 70, textAlign: 'center' }}>{yearTotals ? t('Zostanie po roku') : t('Zostanie')}</th>
              </tr>
            </thead>
            <tbody>
              {workers.map((w, i) => {
                const mon = leaveBalance(state, w, month);
                const bal = yearTotals?.get(w.id) ?? mon;
                const newLine = i === 0 || workers[i - 1].lineId !== w.lineId;
                return (
                  <tr key={w.id} style={newLine ? { borderTop: '2px solid var(--line)' } : undefined}>
                    <td className="sticky-col" style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={`${w.name} · ${lineName(w.lineId)}`}>
                      {w.name}
                      {newLine && <div className="sub" style={{ fontWeight: 400 }}>{lineName(w.lineId)}</div>}
                    </td>
                    <td>{w.brigade}</td>
                    {days.map((d) => {
                      const sh = plannedShift(state, w, d);
                      const leave = hasLeave(state, w.id, d);
                      const def = sh?.code ? shiftDef(state, sh.code) : undefined;
                      return (
                        <td key={d} style={{ padding: '3px 1px', textAlign: 'center', background: isOffDay(d) ? OFF_TINT : undefined }}>
                          <button
                            type="button"
                            disabled={!canEdit}
                            className="cell c-W"
                            style={{
                              width: 30,
                              height: 24,
                              opacity: sh || leave ? 1 : 0.35,
                              background: leave ? 'var(--green-bg, #dff3e4)' : isOffDay(d) && !sh ? 'transparent' : undefined,
                              color: leave ? 'var(--green-ink, #14532d)' : undefined,
                              fontWeight: leave ? 700 : 400,
                            }}
                            title={`${d} ${sh ? (def?.label ?? sh.code) : t('wolne')}${leave ? ' · UW' : ''}`}
                            onClick={() => toggle(w.id, d, w.name)}
                          >
                            {leave ? 'U' : sh ? (def?.label ?? '·') : ''}
                          </button>
                        </td>
                      );
                    })}
                    <td style={{ textAlign: 'center' }}>
                      <input
                        className="input"
                        type="number"
                        min={0}
                        style={{ width: 58, padding: '2px 4px', textAlign: 'center' }}
                        value={bal.pool ?? ''}
                        disabled={!canEdit}
                        onChange={(e) => setPool(w.id, e.target.value)}
                      />
                    </td>
                    {yearTotals && <td style={{ textAlign: 'center' }}>{mon.planned || '—'}</td>}
                    <td style={{ textAlign: 'center', fontWeight: 600 }}>{bal.planned || '—'}</td>
                    <td style={{ textAlign: 'center' }}>
                      {bal.left === undefined ? '—' : <span className={`tag ${bal.left < 0 ? 'red' : bal.left <= 2 ? 'amber' : 'green'}`}>{bal.left}</span>}
                    </td>
                  </tr>
                );
              })}
              <tr style={{ borderTop: '2px solid var(--line)' }}>
                <td className="sticky-col" style={{ fontWeight: 700 }}>{t('Urlopy w dniu')}</td>
                <td />
                {load.map((x) => (
                  <td key={x.date} style={{ textAlign: 'center', fontWeight: 700, fontSize: 12, color: limit !== undefined && x.onLeave > limit ? 'var(--red-ink)' : undefined, background: limit !== undefined && x.onLeave > limit ? 'var(--red-bg, #fde2e2)' : isOffDay(x.date) ? OFF_TINT : undefined }}>
                    {x.onLeave || ''}
                  </td>
                ))}
                <td colSpan={yearTotals ? 4 : 3} />
              </tr>
              <tr>
                <td className="sticky-col" style={{ fontWeight: 700, color: 'var(--red-ink)' }} title={t('Stanowiska bez wymaganej obsady kwalifikowanej po odjęciu urlopów')}>
                  {t('Luki na stanowiskach')}
                </td>
                <td />
                {load.map((x) => (
                  <td key={x.date} style={{ textAlign: 'center', fontWeight: 700, fontSize: 12, color: 'var(--red-ink)', background: isOffDay(x.date) ? OFF_TINT : undefined }}>
                    {x.gaps || ''}
                  </td>
                ))}
                <td colSpan={yearTotals ? 4 : 3} />
              </tr>
            </tbody>
          </table>
        </div>
        <div className="sub" style={{ marginTop: 8 }}>
          {t('Luki liczą się razem z innymi nieobecnościami. Wzór: ten sam układ co w arkuszu urlopowym — dni w kolumnach, „U” w komórce, pula i wynik po urlopach z prawej.')}
        </div>
      </section>
  );
}
