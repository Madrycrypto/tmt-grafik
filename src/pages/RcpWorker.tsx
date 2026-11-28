import { useMemo, useState } from 'react';
import { addDays, fmtDate, monthDays, periodDays, todayIso, weekday } from '../domain/dates';
import { accountCsv, accountPeriod, fmtHM, sumDays } from '../domain/rcpAccount';
import type { DayAccount } from '../domain/rcpAccount';
import { DIR_LABEL, checkDay, fmtMin, planPunches, STATUS_LABEL, STATUS_TONE } from '../domain/punches';
import type { Punch } from '../domain/punches';
import { deletePunch, savePunch, usePunches } from '../data/punches';
import { useApp } from '../data/AppContext';
import { useMonthLocks } from '../data/locks';
import { downloadCsv } from './WorkerBulk';
import { toast } from '../toast';
import { t } from '../i18n';
import { Sheet, usePersistent } from '../ui';
import { WorkerEditor } from './Pracownicy';

type View = 'week' | 'month' | 'year';

const MONTH_NAMES = ['styczeń', 'luty', 'marzec', 'kwiecień', 'maj', 'czerwiec', 'lipiec', 'sierpień', 'wrzesień', 'październik', 'listopad', 'grudzień'];

const mondayOf = (d: string) => addDays(d, -((weekday(d) + 6) % 7));

function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

const hh = (h: number | undefined) => (h === undefined ? '—' : fmtMin(Math.round(h * 60)));

/** Rozliczenie pracownika z odbić RCP: tydzień, miesiąc, rok, z korektą ręczną. To kontrola — płace liczy Comarch. */
export function RcpWorker({ workerId, date, onClose }: { workerId: string; date: string; onClose: () => void }) {
  const { state, canEdit: mayEdit, role } = useApp();
  const { locked, lock, unlock } = useMonthLocks();
  const worker = state.workers.find((w) => w.id === workerId);
  const [view, setView] = usePersistent<View>('rcp-settle-view', 'month');
  const [anchor, setAnchor] = useState(date);
  const [editDay, setEditDay] = useState<string | null>(null);
  const [card, setCard] = useState(false);

  const dates = useMemo(() => {
    if (view === 'week') {
      const m = mondayOf(anchor);
      return Array.from({ length: 7 }, (_, i) => addDays(m, i));
    }
    if (view === 'month') return monthDays(anchor.slice(0, 7));
    return periodDays(anchor.slice(0, 4));
  }, [view, anchor]);
  const { punches, loading, error, reload } = usePunches(addDays(dates[0], -1), addDays(dates[dates.length - 1], 1), workerId);

  const today = todayIso();
  const now = new Date();
  const hour = now.getHours() + now.getMinutes() / 60;
  const days = useMemo(() => (worker ? accountPeriod(state, worker, dates, punches, today, hour) : []), [state, worker, dates, punches, today, hour]);
  const totals = useMemo(() => sumDays(days), [days]);
  if (!worker) return null;
  const month = anchor.slice(0, 7);
  const isLocked = locked.has(month);
  const canEdit = mayEdit;
  const dayLocked = (d: string) => locked.has(d.slice(0, 7));
  const setLock = async (on: boolean) => {
    try {
      await (on ? lock(month) : unlock(month));
      toast(on ? t('Miesiąc zamknięty') : t('Miesiąc otwarty'));
    } catch {
      toast(t('Nie udało się zapisać'));
    }
  };

  const step = (n: number) => {
    if (view === 'week') setAnchor(addDays(anchor, 7 * n));
    else if (view === 'month') setAnchor(`${shiftMonth(anchor.slice(0, 7), n)}-01`);
    else setAnchor(`${Number(anchor.slice(0, 4)) + n}-01-01`);
  };
  const title =
    view === 'week' ? `${fmtDate(dates[0])} – ${fmtDate(dates[6])}` : view === 'month' ? `${t(MONTH_NAMES[Number(anchor.slice(5, 7)) - 1])} ${anchor.slice(0, 4)}` : anchor.slice(0, 4);
  const line = state.lines.find((l) => l.id === worker.lineId)?.name ?? '';
  const bal = (min: number) => ({ color: min < 0 ? 'var(--red-ink)' : min > 0 ? 'var(--green-ink, #14532d)' : undefined, fontWeight: 600 });

  const byMonth = view === 'year' ? Array.from({ length: 12 }, (_, k) => ({ k, list: days.filter((d) => Number(d.date.slice(5, 7)) === k + 1) })) : [];

  return (
    <Sheet title={`${t('Rozliczenie')}: ${worker.name}`} sub={`${line} · ${t('bryg.')} ${worker.brigade}`} onClose={onClose} wide>
      <div className="stack">
        <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <div className="row" style={{ gap: 6 }}>
            {(['week', 'month', 'year'] as View[]).map((v) => (
              <button key={v} type="button" className={`btn small ${view === v ? 'primary' : ''}`} onClick={() => setView(v)}>
                {t(v === 'week' ? 'Tydzień' : v === 'month' ? 'Miesiąc' : 'Rok')}
              </button>
            ))}
          </div>
          <div className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
            <button type="button" className="btn small" aria-label={t('Wstecz')} onClick={() => step(-1)}>‹</button>
            <b style={{ minWidth: 150, textAlign: 'center' }}>{title}</b>
            <button type="button" className="btn small" aria-label={t('Dalej')} onClick={() => step(1)}>›</button>
          </div>
          <button type="button" className="btn small ghost" onClick={() => setCard(true)}>{t('Karta pracownika')}</button>
        </div>
          {view !== 'week' && (
            <div className="row" style={{ gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <button type="button" className="btn small" onClick={() => downloadCsv(`rozliczenie-${worker.name.replace(/\s+/g, '-')}-${view === 'year' ? anchor.slice(0, 4) : month}.csv`, accountCsv(worker.name, days))}>
                {t('Eksport CSV')}
              </button>
              {view === 'month' && isLocked && <span className="tag">🔒 {t('Miesiąc zamknięty')}</span>}
              {view === 'month' && canEdit && !isLocked && (
                <button type="button" className="btn small" onClick={() => void setLock(true)}>{t('Zamknij miesiąc')}</button>
              )}

        <section className="kpis" aria-label={t('Podsumowanie')}>
          <div className="kpi"><div className="k">{t('Przepracowane dni')}</div><div className="v">{totals.workDays}</div></div>
          <div className="kpi"><div className="k">{t('Nieobecności (dni)')}</div><div className="v">{totals.absentDays}</div></div>
          <div className="kpi"><div className="k">{t('Plan')}</div><div className="v" style={{ fontSize: 18 }}>{fmtHM(totals.planMin)}</div></div>
          <div className="kpi"><div className="k">{t('Przepracowane')}</div><div className="v" style={{ fontSize: 18 }}>{fmtHM(totals.workedMin)}</div></div>
          <div className="kpi">
            <div className="k">{t('Bilans')}</div>
            <div className="v" style={{ fontSize: 18, ...bal(totals.balanceMin) }}>{fmtHM(totals.balanceMin, true)}</div>
            <div className="d">{t('nadgodziny')} {fmtHM(totals.overtimeMin)} · {t('braki')} {fmtHM(totals.deficitMin)}</div>
          </div>
          <div className="kpi">
            <div className="k">{t('Do poprawy')}</div>
            <div className="v" style={{ color: totals.problems ? 'var(--red-ink)' : undefined }}>{totals.problems}</div>
            <div className="d">{t('dni bez wejścia lub wyjścia')}</div>
          </div>
        </section>
        {error && <div className="note red">{error}</div>}
        {loading && <div className="sub">{t('Wczytuję odbicia…')}</div>}

        {view === 'year' ? (
          <div className="scroll-x">
            <table className="tbl-cards" style={{ minWidth: 560 }}>
              <thead>
                <tr>
                  <th>{t('Miesiąc')}</th>
                  <th>{t('Plan')}</th>
                  <th>{t('Przepracowane')}</th>
                  <th>{t('Bilans')}</th>
                  <th>{t('Do poprawy')}</th>
                </tr>
              </thead>
              <tbody>
                {byMonth.map(({ k, list }) => {
                  const s = sumDays(list);
                  return (
                    <tr key={k}>
                      <td className="full">
                        <button type="button" className="link-btn" onClick={() => { setAnchor(`${anchor.slice(0, 4)}-${String(k + 1).padStart(2, '0')}-01`); setView('month'); }}>
                          {t(MONTH_NAMES[k])}
                        </button>
                      </td>
                      <td data-l={t('Plan')}>{fmtHM(s.planMin)}</td>
                      <td data-l={t('Przepracowane')}>{fmtHM(s.workedMin)}</td>
                      <td data-l={t('Bilans')} style={bal(s.balanceMin)}>{fmtHM(s.balanceMin, true)}</td>
                      <td data-l={t('Do poprawy')}>{s.problems ? <span className="tag red">{s.problems}</span> : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="scroll-x">
            <table className="tbl-cards" style={{ minWidth: 640 }}>
              <thead>
                <tr>
                  <th>{t('Dzień')}</th>
                  <th>{t('Status')}</th>
                  <th>{t('Wejście')} / {t('Wyjście')}</th>
                  <th>{t('Plan')}</th>
                  <th>{t('Przepracowane')}</th>
                  <th>{t('Bilans')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {days.map((d) => (
                  <DayRow key={d.date} d={d} canEdit={canEdit && !dayLocked(d.date)} locked={dayLocked(d.date)} onEdit={() => setEditDay(d.date)} />
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="sub">
          {t('Liczymy od początku zmiany: wejście wcześniej się nie liczy. Spóźnienie i wyjście do 5 min nie obniżają czasu, a zostanie dłużej niż 5 min to nadgodziny. To podgląd kontrolny, oficjalne rozliczenie jest w Comarch TNA.')}
        </div>
          {view === 'month' && isLocked && role === 'admin' && (
            <button type="button" className="btn small" onClick={() => void setLock(false)}>{t('Otwórz miesiąc')}</button>
          )}
        </div>
      )}
      </div>
      {editDay && <DayEditor worker={worker} date={editDay} punches={punches} onClose={() => setEditDay(null)} onChanged={() => void reload()} />}
      {card && <WorkerEditor workerId={worker.id} onClose={() => setCard(false)} />}
    </Sheet>
  );
}

function DayRow({ d, canEdit, locked, onEdit }: { d: DayAccount; canEdit: boolean; locked?: boolean; onEdit: () => void }) {
  const c = d.check;
  const idle = c.status === 'off' && !c.punches.length;
  const dim = idle ? { opacity: 0.55 } : undefined;
  return (
    <tr style={dim}>
      <td className="full" style={{ whiteSpace: 'nowrap', fontWeight: 600 }}>{fmtDate(d.date)}</td>
      <td className="full">
        {idle ? (
          <span className="sub">{t('wolne')}</span>
        ) : (
          <span className={`tag ${STATUS_TONE[c.status]}`}>
            {c.absence ? t(c.absence.reason) : t(STATUS_LABEL[c.status])}
            {c.lateMin ? ` +${c.lateMin} min` : ''}
            {c.earlyMin ? ` −${c.earlyMin} min` : ''}
          </span>
        )}
      </td>
      <td data-l={t('Wejście / Wyjście')} className={idle ? 'hide-m' : undefined} style={{ whiteSpace: 'nowrap' }}>
        {c.punches.length ? (
          <>
            {hh(c.firstIn)} → {hh(c.lastOut)}
            {c.punches.some((p) => p.source === 'manual') ? ' ✎' : ''}
            {d.earlyIgnoredMin > 0 && <div className="sub">{t('niewliczone wcześniej')} {d.earlyIgnoredMin} min</div>}
          </>
        ) : (
          '—'
        )}
      </td>
      <td data-l={t('Plan')} className={idle ? 'hide-m' : undefined}>{c.plan ? `${fmtMin(Math.round(c.plan.start * 60))}–${fmtMin(Math.round(c.plan.end * 60))}` : '—'}</td>
      <td data-l={t('Przepracowane')} className={idle ? 'hide-m' : undefined}>{d.workedMin ? fmtHM(d.workedMin) : '—'}</td>
      <td data-l={t('Bilans')} className={idle ? 'hide-m' : undefined} style={{ color: d.balanceMin < 0 ? 'var(--red-ink)' : d.balanceMin > 0 ? 'var(--green-ink, #14532d)' : undefined, fontWeight: 600 }}>{d.balanceMin ? fmtHM(d.balanceMin, true) : '—'}</td>
      <td className="full">
        {locked && <span title={t('Miesiąc zamknięty')}>🔒</span>}
        {canEdit && (
          <button type="button" className="btn small ghost" aria-label={t('Popraw odbicia')} title={t('Popraw odbicia tego dnia')} onClick={onEdit}>
            ⋮
          </button>
        )}
      </td>
    </tr>
  );
}

const stamp = (day: string, hhmm: string) => new Date(`${day}T${hhmm}:00`).toISOString();

/** Korekta odbić jednego dnia. Każda zmiana wymaga przyczyny i da się ją cofnąć. */
function DayEditor({ worker, date, punches, onClose, onChanged }: { worker: { id: string; name: string }; date: string; punches: Punch[]; onClose: () => void; onChanged: () => void }) {
  const { state, backend, update } = useApp();
  const w = state.workers.find((x) => x.id === worker.id)!;
  const nowH = date === todayIso() ? new Date().getHours() + new Date().getMinutes() / 60 : date > todayIso() ? -99 : 99;
  const row = checkDay(state, w, date, punches, nowH);
  const [reason, setReason] = useState('');
  const [times, setTimes] = useState<Record<string, string>>({});
  const [dir, setDir] = useState<'in' | 'out'>('in');
  const [time, setTime] = useState('');
  const [nextDay, setNextDay] = useState(false);
  const ok = reason.trim().length >= 3;
  const client = backend.client;

  const log = (msg: string) => update(() => undefined, `RCP korekta (${reason.trim()}): ${worker.name} ${msg}`);
  const edit = async (p: Punch) => {
    const v = times[p.id];
    if (!v || v === fmtMin(p.min)) return;
    const [h, m] = v.split(':').map(Number);
    const next: Punch = { ...p, min: h * 60 + m, at: stamp(p.date, v), source: 'manual', note: `Korekta: ${reason.trim()} (było ${fmtMin(p.min)}, ${p.source})` };
    try {
      await savePunch(client, next);
      log(`${DIR_LABEL[p.dir]} ${p.date} ${fmtMin(p.min)} → ${v}`);
      onChanged();
      toast(t('Poprawiono odbicie {h}', { h: v }), {
        undo: async () => {
          await savePunch(client, p);
          log(`przywrócono ${p.date} ${fmtMin(p.min)}`);
          onChanged();
        },
      });
    } catch (e) {
      toast((e as Error).message, { tone: 'warn' });
    }
  };
  const remove = async (p: Punch) => {
    try {
      await deletePunch(client, p.id);
      log(`usunięto ${DIR_LABEL[p.dir]} ${p.date} ${fmtMin(p.min)} (${p.source})`);
      onChanged();
      toast(t('Usunięto odbicie {name} {h}', { name: worker.name, h: fmtMin(p.min) }), {
        undo: async () => {
          await savePunch(client, p);
          log(`przywrócono ${p.date} ${fmtMin(p.min)}`);
          onChanged();
        },
      });
    } catch (e) {
      toast((e as Error).message, { tone: 'warn' });
    }
  };
  const add = async () => {
    if (!time) return;
    const day = nextDay ? addDays(date, 1) : date;
    const [h, m] = time.split(':').map(Number);
    const p: Punch = { id: crypto.randomUUID(), workerId: worker.id, at: stamp(day, time), date: day, min: h * 60 + m, dir, source: 'manual', note: `Korekta: ${reason.trim()}` };
    try {
      await savePunch(client, p);
      log(`dodano ${DIR_LABEL[dir]} ${day} ${time}`);
      setTime('');
      onChanged();
      toast(t('Dodano odbicie {h}', { h: time }), {
        undo: async () => {
          await deletePunch(client, p.id);
          log(`cofnięto dodanie ${day} ${time}`);
          onChanged();
        },
      });
    } catch (e) {
      toast((e as Error).message, { tone: 'warn' });
    }
  };
  const fromPlan = planPunches(row, nowH);
  const confirmPlan = async () => {
    const made: Punch[] = fromPlan.map((p) => ({ ...p, id: crypto.randomUUID(), at: stamp(p.date, fmtMin(p.min)), note: `Korekta: ${reason.trim()}` }));
    try {
      for (const p of made) await savePunch(client, p);
      log(`zatwierdzono wg grafiku ${date}`);
      onChanged();
      toast(t('Zatwierdzono wg grafiku: {name}', { name: worker.name }), {
        undo: async () => {
          for (const p of made) await deletePunch(client, p.id);
          log(`cofnięto zatwierdzenie wg grafiku ${date}`);
          onChanged();
        },
      });
    } catch (e) {
      toast((e as Error).message, { tone: 'warn' });
    }
  };

  return (
    <Sheet title={`${t('Odbicia')}: ${fmtDate(date)}`} sub={worker.name} onClose={onClose}>
      <div className="stack">
        <label className="field">
          {t('Przyczyna korekty (wymagana)')}
          <input className="input" value={reason} placeholder={t('np. kiosk nie odczytał, zapomniał odbić')} onChange={(e) => setReason(e.target.value)} />
        </label>
        {row.punches.length === 0 && <div className="sub">{t('Brak odbić tego dnia.')}</div>}
        {row.punches.map((p) => (
          <div key={p.id} className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span className={`tag ${p.dir === 'private_out' ? 'amber' : ''}`} style={{ minWidth: 92 }}>
              {t(DIR_LABEL[p.ret ? 'return' : p.dir])}
              {p.date !== date ? ` (${fmtDate(p.date)})` : ''}
            </span>
            <input className="input" type="time" style={{ width: 110 }} value={times[p.id] ?? fmtMin(p.min)} onChange={(e) => setTimes({ ...times, [p.id]: e.target.value })} />
            <button type="button" className="btn small primary" disabled={!ok || !times[p.id] || times[p.id] === fmtMin(p.min)} onClick={() => void edit(p)}>
              {t('Zapisz')}
            </button>
            <button type="button" className="btn small ghost" disabled={!ok} aria-label={t('Usuń odbicie')} onClick={() => void remove(p)}>
              ×
            </button>
            <span className="sub">{p.source === 'manual' ? t('dodane ręcznie') : p.source === 'plan' ? t('zatwierdzone wg grafiku') : p.source === 'badge' ? t('karta RCP') : p.source === 'tna' ? t('czytnik Comarch TNA') : t('kiosk')}</span>
          </div>
        ))}
        <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <select value={dir} onChange={(e) => setDir(e.target.value as 'in' | 'out')}>
            <option value="in">{t('Wejście')}</option>
            <option value="out">{t('Wyjście')}</option>
          </select>
          <input className="input" type="time" style={{ width: 110 }} value={time} onChange={(e) => setTime(e.target.value)} />
          <label className="sub" style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
            <input type="checkbox" checked={nextDay} onChange={(e) => setNextDay(e.target.checked)} />
            {t('następnego dnia')}
          </label>
          <button type="button" className="btn small primary" disabled={!ok || !time} onClick={() => void add()}>
            + {t('Dodaj odbicie')}
          </button>
        </div>
        {fromPlan.length > 0 && (
          <button type="button" className="btn" disabled={!ok} onClick={() => void confirmPlan()}>
            ✓ {t('Wpisz brakujące wg grafiku')}
          </button>
        )}
        {!ok && <div className="sub">{t('Wpisz przyczynę (min. 3 znaki), żeby odblokować zmiany.')}</div>}
      </div>
    </Sheet>
  );
}
