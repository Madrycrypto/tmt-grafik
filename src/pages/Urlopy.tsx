import { useEffect, useMemo, useRef, useState } from 'react';
import { uid } from '../domain/actions';
import { monthDays, periodDays, todayIso, weekday } from '../domain/dates';
import { holidayName } from '../domain/holidays';
import { applyLeaveReport, hasLeave, isOnDemandDay, leaveBalance, leaveDaysIn, leaveLoad, ON_DEMAND_DAYS, parseLeaveSheet, resolveLeaveReport, setLeaveDay } from '../domain/leave';
import { useLeaveReports } from '../data/leaveReports';
import type { ReportStatus } from '../data/leaveReports';
import { fmtDate } from '../domain/dates';
import { plannedShift } from '../domain/coverage';
import { shiftDef } from '../domain/rota';
import { useApp } from '../data/AppContext';
import { useLabels } from '../data/labels';
import { LineOptions, usePersistent, useScope } from '../ui';
import type { AppState, Worker } from '../domain/types';
import { t } from '../i18n';

const DOW = ['Nd', 'Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'So'];
const MONTHS = ['styczeń', 'luty', 'marzec', 'kwiecień', 'maj', 'czerwiec', 'lipiec', 'sierpień', 'wrzesień', 'październik', 'listopad', 'grudzień'];
/** Sobota, niedziela i święta: lekko na czerwono (nagłówek, komórki i wiersze podsumowania). */
const OFF_TINT = 'rgba(214, 69, 69, 0.09)';
const isOffDay = (d: string) => weekday(d) === 0 || weekday(d) === 6 || !!holidayName(d);

export default function Urlopy() {
  const lb = useLabels();
  const { state, update, canEdit } = useApp();
  const [month, setMonth] = usePersistent('urlopy-month', todayIso().slice(0, 7));
  const [scope, setScope] = useScope(state);
  const [maxOff, setMaxOff] = usePersistent('urlopy-max', '');
  const [paste, setPaste] = useState<string | null>(null);
  const [view, setView] = usePersistent<'month' | 'year'>('urlopy-view', 'month');
  const year = month.slice(0, 4);
  const yearMode = view === 'year';
  const lines = useMemo(() => {
    const ls = scope === 'all' ? state.lines : scope.startsWith('g:') ? state.lines.filter((l) => l.group === scope.slice(2)) : state.lines.filter((l) => l.id === scope);
    return ls.map((l) => l.id);
  }, [state.lines, scope]);
  const groups = [...new Set(state.lines.map((l) => l.group).filter((g): g is string => !!g))];
  const workers = useMemo(
    () => state.workers.filter((w) => w.active && lines.includes(w.lineId)).sort((a, b) => a.lineId.localeCompare(b.lineId) || a.brigade.localeCompare(b.brigade) || a.name.localeCompare(b.name, 'pl')),
    [state.workers, lines],
  );
  const limit = maxOff === '' ? undefined : Number(maxOff);
  const lineName = (id: string) => state.lines.find((l) => l.id === id)?.name ?? id;
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
              <option value="all">{lb.plant}</option>
              {groups.map((g) => (
                <option key={g} value={`g:${g}`}>
                  {lb.main(g)}
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

      <ReportsPanel />
      <Grid state={state} period={yearMode ? year : month} workers={workers} lines={lines} limit={limit} canEdit={canEdit} lineName={lineName} onToggle={toggle} onPool={setPool} />
    </>
  );
}

/** Zgłoszenia urlopów od pracowników: lider sprawdza, czy dzień był zaplanowany, i wybiera, skąd go zabrać. */
function ReportsPanel() {
  const { state, update, canEdit, backend } = useApp();
  const { reports, reload } = useLeaveReports();
  const pending = reports.filter((r) => r.status === 'pending');
  if (!pending.length) return null;
  const nameOf = (id: string) => state.workers.find((w) => w.id === id)?.name ?? id;
  const done = async (id: string, status: ReportStatus, note?: string) => {
    await backend.client?.from('leave_reports').update({ status, resolved_note: note ?? null, resolved_at: new Date().toISOString() }).eq('id', id);
    // odrzucenie nie zmienia grafiku, więc pracownik dostaje osobny push; błąd wysyłki nie cofa decyzji
    if (status === 'rejected') void backend.client?.functions.invoke('tmt-leave-notify', { body: { id } }).catch(() => undefined);
    await reload();
  };
  const resolve = (r: (typeof pending)[number], mode: 'planned' | 'from-plan' | 'on-demand', planDate?: string) => {
    update((d) => {
      d.absences = applyLeaveReport(d.absences, r.worker_id, r.date, mode, planDate, () => uid('ab'));
    }, `Urlop zgłoszony: ${nameOf(r.worker_id)} ${r.date}`);
    void done(r.id, mode === 'planned' ? 'confirmed' : mode === 'from-plan' ? 'from_plan' : 'on_demand', planDate);
  };
  return (
    <section className="card stack">
      <h3 style={{ marginTop: 0 }}>
        {t('Zgłoszone urlopy')} <span className="tag amber">{pending.length}</span>
      </h3>
      {pending.map((r) => {
        const w = state.workers.find((x) => x.id === r.worker_id);
        const res = w ? resolveLeaveReport(state, w, r.date) : undefined;
        return (
          <div key={r.id} className="list-item" style={{ alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
            <div className="grow stack" style={{ gap: 2 }}>
              <b>{nameOf(r.worker_id)} · {fmtDate(r.date)}</b>
              <div className="sub">
                {!res && t('Nie znaleziono pracownika.')}
                {res?.kind === 'planned' && t('Ten dzień był zaplanowany jako urlop.')}
                {res?.kind === 'from-plan' && `${t('Nie był zaplanowany. Zabierzemy dzień z planu:')} ${fmtDate(res.planDate)}. ${t('Na żądanie zostało')} ${res.onDemandLeft} ${t('z')} ${ON_DEMAND_DAYS}.`}
                {res?.kind === 'on-demand' && `${t('Brak zaplanowanego urlopu do zabrania — pójdzie z puli na żądanie.')} ${t('Zostało')} ${res.onDemandLeft} ${t('z')} ${ON_DEMAND_DAYS}.`}
              </div>
            </div>
            {canEdit && res && (
              <div className="row">
                {res.kind === 'planned' && <button type="button" className="btn primary small" onClick={() => resolve(r, 'planned')}>{t('Potwierdź')}</button>}
                {res.kind === 'from-plan' && <button type="button" className="btn primary small" onClick={() => resolve(r, 'from-plan', res.planDate)}>{t('Zabierz z planu')}</button>}
                {res.kind !== 'planned' && (
                  <button type="button" className={`btn small ${res.kind === 'on-demand' ? 'primary' : ''}`} disabled={res.onDemandLeft <= 0} onClick={() => resolve(r, 'on-demand')}>
                    {t('Z puli na żądanie')}
                  </button>
                )}
                <button type="button" className="btn small ghost" onClick={() => void done(r.id, 'rejected')}>{t('Odrzuć')}</button>
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}

type GridProps = {
  state: AppState;
  /** miesiąc („2026-11”) albo cały rok („2026”): rok to jedna tabela z miesiącami jeden za drugim */
  period: string;
  workers: Worker[];
  lines: string[];
  limit: number | undefined;
  canEdit: boolean;
  lineName: (id: string) => string;
  onToggle: (workerId: string, date: string, name: string) => void;
  onPool: (workerId: string, value: string) => void;
};

/** Tabela urlopów: dni w kolumnach, „U” w komórce. W miesiącu pula i wynik są z prawej, w roku z lewej (kolumna „Zostanie” przykleja się do nazw). */
function Grid({ state, period, workers, lines, limit, canEdit, lineName, onToggle: toggle, onPool: setPool }: GridProps) {
  const yearMode = period.length === 4;
  const year = period.slice(0, 4);
  const days = useMemo(() => periodDays(period), [period]);
  const load = useMemo(() => leaveLoad(state, days, lines), [state, days, lines]);
  const dayW = yearMode ? 30 : 34;
  const months = useMemo(
    () => (yearMode ? MONTHS.map((name, k) => ({ name, key: `${period}-${String(k + 1).padStart(2, '0')}` })) : []),
    [yearMode, period],
  );
  const ids = useMemo(() => new Set(workers.map((w) => w.id)), [workers]);
  const monthLeave = useMemo(() => months.map((m) => leaveDaysIn(state, ids, monthDays(m.key))), [months, state, ids]);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // rok otwiera się na bieżącym dniu, żeby od razu planować „od teraz” w prawo
    const idx = days.indexOf(todayIso());
    if (yearMode && box.current) box.current.scrollLeft = idx > 0 ? idx * dayW : 0;
  }, [yearMode, period, days, dayW]);
  // na wąskim ekranie kolumna nazwisk jest węższa (patrz .sticky-col), więc przyklejone saldo musi zaczynać się tuż za nią
  const narrow = typeof window !== 'undefined' && window.matchMedia('(max-width: 860px)').matches;
  const nameCol = narrow ? 120 : 200;
  const stickyLeft = { position: 'sticky' as const, left: nameCol, background: 'var(--surface)', zIndex: 1 };
  const poolInput = (w: Worker, pool: number | undefined) => (
    <input className="input" type="number" min={0} style={{ width: 58, padding: '2px 4px', textAlign: 'center' }} value={pool ?? ''} disabled={!canEdit} onChange={(e) => setPool(w.id, e.target.value)} />
  );
  const leftTag = (left: number | undefined) => (left === undefined ? '—' : <span className={`tag ${left < 0 ? 'red' : left <= 2 ? 'amber' : 'green'}`}>{left}</span>);
  return (
    <section className="card">
      <div className="scroll-x" ref={box}>
        <table style={{ minWidth: dayW * days.length + nameCol + 96 + 70 + 70 + 64, tableLayout: 'fixed' }}>
          {/* przy tableLayout fixed szerokości bierze się z pierwszego wiersza (u nas z nagłówkiem miesięcy z colSpan), więc podajemy je wprost */}
          <colgroup>
            <col style={{ width: nameCol }} />
            <col style={{ width: 96 }} />
            <col style={{ width: 70 }} />
            <col style={{ width: 70 }} />
            <col style={{ width: 64 }} />
            {days.map((d) => (
              <col key={d} style={{ width: dayW }} />
            ))}
          </colgroup>
          <thead>
            {yearMode && (
              <tr>
                <th className="sticky-col" style={{ width: nameCol }} />
                <th style={{ ...stickyLeft, width: 96, zIndex: 2 }} />
                <th colSpan={3} />
                {months.map((m, k) => (
                  <th key={m.key} colSpan={monthDays(m.key).length} style={{ textAlign: 'left', padding: '6px 6px', borderLeft: '2px solid var(--line)' }}>
                    {t(m.name)} <span className="sub">{monthLeave[k] ? `· ${monthLeave[k]} ${t('dni urlopu')}` : ''}</span>
                  </th>
                ))}
              </tr>
            )}
            <tr>
              <th className="sticky-col" style={{ width: nameCol, maxWidth: nameCol }}>{t('Pracownik')}</th>
              <th style={{ ...stickyLeft, width: 96, textAlign: 'center', zIndex: 2 }} title={t('Zostanie z puli po wszystkich zaplanowanych urlopach; pod spodem ile można zaplanować do listopada (4 dni zostają na żądanie)')}>{t('Zostanie')}</th>
              <th style={{ width: 70, textAlign: 'center' }} title={t('Pozostała pula urlopu w dniach (wpisz z systemu kadrowego)')}>{t('Pula (dni)')}</th>
              <th style={{ width: 70, textAlign: 'center' }}>{t('UW w roku')}</th>
              <th style={{ width: 64 }}>{t('Brygada')}</th>
              {days.map((d) => (
                <th
                  key={d}
                  title={holidayName(d) ?? ''}
                  style={{ textAlign: 'center', width: dayW, padding: '6px 1px', color: isOffDay(d) ? 'var(--red-ink)' : undefined, background: isOffDay(d) ? OFF_TINT : undefined, borderLeft: yearMode && d.endsWith('-01') ? '2px solid var(--line)' : undefined }}
                >
                  {t(DOW[weekday(d)])}
                  <br />
                  {d.slice(8)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {workers.map((w, i) => {
              const bal = leaveBalance(state, w, year);
              const newLine = i === 0 || workers[i - 1].lineId !== w.lineId;
              return (
                <tr key={w.id} style={newLine ? { borderTop: '2px solid var(--line)' } : undefined}>
                  <td className="sticky-col" style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={`${w.name} · ${lineName(w.lineId)}`}>
                    {w.name}
                    {newLine && <div className="sub" style={{ fontWeight: 400 }}>{lineName(w.lineId)}</div>}
                  </td>
                  <td style={{ ...stickyLeft, textAlign: 'center', lineHeight: 1.2 }}>
                    {leftTag(bal.left)}
                    {bal.plannable !== undefined && (
                      <div className="sub" style={{ color: bal.plannable < 0 ? 'var(--red-ink)' : undefined, fontSize: 11 }} title={t('Do listopada można zaplanować tyle dni; 4 dni zostają na żądanie i zwalniają się w grudniu')}>
                        {bal.plannable < 0 ? `${t('przekroczone o')} ${-bal.plannable}` : `${t('do XI')}: ${bal.plannable}`}
                      </div>
                    )}
                  </td>
                  <td style={{ textAlign: 'center' }}>{poolInput(w, bal.pool)}</td>
                  <td style={{ textAlign: 'center', fontWeight: 600 }}>{bal.planned || '—'}</td>
                  <td>{w.brigade}</td>
                  {days.map((d) => {
                    const sh = plannedShift(state, w, d);
                    const leave = hasLeave(state, w.id, d);
                    const def = sh?.code ? shiftDef(state, sh.code) : undefined;
                    return (
                      <td key={d} style={{ padding: '3px 1px', textAlign: 'center', background: isOffDay(d) ? OFF_TINT : undefined, borderLeft: yearMode && d.endsWith('-01') ? '2px solid var(--line)' : undefined }}>
                        <button
                          type="button"
                          disabled={!canEdit}
                          className="cell c-W"
                          style={{
                            width: dayW - 4,
                            height: 24,
                            minWidth: 0,
                            opacity: sh || leave ? 1 : 0.35,
                            background: leave ? 'var(--green-bg, #dff3e4)' : isOffDay(d) && !sh ? 'transparent' : undefined,
                            color: leave ? 'var(--green-ink, #14532d)' : undefined,
                            fontWeight: leave ? 700 : 400,
                          }}
                          title={`${d} ${sh ? (def?.label ?? sh.code) : t('wolne')}${leave ? (isOnDemandDay(state, w.id, d) ? ` · UW ${t('na żądanie')}` : ' · UW') : ''}`}
                          onClick={() => toggle(w.id, d, w.name)}
                        >
                          {leave ? (isOnDemandDay(state, w.id, d) ? 'Ż' : 'U') : sh ? (def?.label ?? '·') : ''}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            <tr style={{ borderTop: '2px solid var(--line)' }}>
              <td className="sticky-col" style={{ fontWeight: 700 }}>{t('Urlopy w dniu')}</td>
              <td style={stickyLeft} />
              <td colSpan={2} />
              <td />
              {load.map((x) => (
                <td key={x.date} style={{ textAlign: 'center', fontWeight: 700, fontSize: 12, color: limit !== undefined && x.onLeave > limit ? 'var(--red-ink)' : undefined, background: limit !== undefined && x.onLeave > limit ? 'var(--red-bg, #fde2e2)' : isOffDay(x.date) ? OFF_TINT : undefined }}>
                  {x.onLeave || ''}
                </td>
              ))}
            </tr>
            <tr>
              <td className="sticky-col" style={{ fontWeight: 700, color: 'var(--red-ink)' }} title={t('Stanowiska bez wymaganej obsady kwalifikowanej po odjęciu urlopów')}>
                {t('Luki na stanowiskach')}
              </td>
              <td style={stickyLeft} />
              <td colSpan={2} />
              <td />
              {load.map((x) => (
                <td key={x.date} style={{ textAlign: 'center', fontWeight: 700, fontSize: 12, color: 'var(--red-ink)', background: isOffDay(x.date) ? OFF_TINT : undefined }}>
                  {x.gaps || ''}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <div className="sub" style={{ marginTop: 8 }}>
        {t('Luki liczą się razem z innymi nieobecnościami. Wzór: ten sam układ co w arkuszu urlopowym — dni w kolumnach, „U” w komórce, pula i saldo zawsze z lewej. „U” to urlop zaplanowany, „Ż” to urlop na żądanie (4 dni z puli, zwalniają się w grudniu).')}
      </div>
    </section>
  );
}
