import { useMemo, useState } from 'react';
import { useApp } from '../data/AppContext';
import { deletePunch, savePunch, savePunches, usePunches } from '../data/punches';
import { toast } from '../toast';
import { addDays, fmtDate, fmtRange, todayIso } from '../domain/dates';
import { checkDay, DIR_LABEL, fmtMin, planPunches, STATUS_LABEL, STATUS_TONE } from '../domain/punches';
import type { DayCheck, Punch } from '../domain/punches';
import { LineOptions, TypeTag, scopeLineIds, useScope } from '../ui';
import { RcpWorker } from './RcpWorker';
import TnaImport from './TnaImport';
import TnaLive, { TnaBadge, useTna } from './TnaLive';
import { t } from '../i18n';

const PROBLEM = new Set(['late', 'early', 'late_early', 'no_in', 'no_out', 'missing', 'unplanned']);

function hourText(h?: number): string {
  return h === undefined ? '—' : fmtMin(Math.round(h * 60));
}

function AddPunch({ row, onAdd }: { row: DayCheck; onAdd: (dir: 'in' | 'out', hhmm: string, nextDay: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const night = !!row.plan && row.plan.end > 24;
  const [dir, setDir] = useState<'in' | 'out'>(row.firstIn === undefined ? 'in' : 'out');
  const [time, setTime] = useState(() => hourText(dir === 'in' ? row.plan?.start : row.plan?.end).replace('—', '07:00'));
  const [next, setNext] = useState(night && dir === 'out');
  if (!open)
    return (
      <button type="button" className="btn small ghost" onClick={() => setOpen(true)}>
        + {t('odbicie')}
      </button>
    );
  return (
    <span className="row" style={{ gap: 4, alignItems: 'center', flexWrap: 'nowrap' }}>
      <span role="group" aria-label={t('Kierunek')} style={{ display: 'inline-flex' }}>
        {(['in', 'out'] as const).map((d) => (
          <button key={d} type="button" className={`btn small ${dir === d ? 'primary' : ''}`} aria-pressed={dir === d} onClick={() => setDir(d)}>
            {d === 'in' ? t('Wejście') : t('Wyjście')}
          </button>
        ))}
      </span>
      <input className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} aria-label={t('Godzina')} />
      {night && (
        <label className="sub" style={{ whiteSpace: 'nowrap' }}>
          <input type="checkbox" checked={next} onChange={(e) => setNext(e.target.checked)} /> {t('nast. dzień')}
        </label>
      )}
      <button type="button" className="btn small primary" disabled={!time} onClick={() => { onAdd(dir, time, next); setOpen(false); }}>
        {t('Dodaj')}
      </button>
      <button type="button" className="btn small ghost" onClick={() => setOpen(false)}>✕</button>
    </span>
  );
}

/** Panel RCP: grafik kontra odbicia z kiosku na wybrany dzień. */
export default function Rcp() {
  const { state, backend, update, canEdit } = useApp();
  const [date, setDate] = useState(todayIso());
  const [lineId, setLineId] = useScope(state);
  const [onlyProblems, setOnlyProblems] = useState(false);
  const [openWorker, setOpenWorker] = useState<string | null>(null);
  const [tna, setTna] = useState(false);
  const [live, setLive] = useState(false);
  const tnaLive = useTna();
  const { punches, error, reload } = usePunches(addDays(date, -1), addDays(date, 1));

  const nowH = date === todayIso() ? new Date().getHours() + new Date().getMinutes() / 60 : date > todayIso() ? -99 : 99;
  const rows = useMemo(
    () =>
      state.workers
        .filter((w) => w.active && (lineId === 'all' || scopeLineIds(state, lineId).includes(w.lineId)))
        .map((w) => checkDay(state, w, date, punches, nowH))
        .filter((r) => r.status !== 'off')
        .sort((a, b) => (a.plan?.start ?? 99) - (b.plan?.start ?? 99) || a.worker.name.localeCompare(b.worker.name, 'pl')),
    [state, punches, date, lineId, nowH],
  );
  const shown = onlyProblems ? rows.filter((r) => PROBLEM.has(r.status)) : rows;
  const count = (st: string[]) => rows.filter((r) => st.includes(r.status)).length;
  const present = rows.filter((r) => r.firstIn !== undefined).length;
  const planned = rows.filter((r) => r.plan && !r.absence).length;

  const add = async (row: DayCheck, dir: 'in' | 'out', hhmm: string, nextDay: boolean) => {
    const day = nextDay ? addDays(date, 1) : date;
    const [h, m] = hhmm.split(':').map(Number);
    const p: Punch = {
      id: crypto.randomUUID(),
      workerId: row.worker.id,
      at: new Date(`${day}T${hhmm}:00`).toISOString(),
      date: day,
      min: h * 60 + m,
      dir,
      source: 'manual',
    };
    try {
      await savePunch(backend.client, p);
      update(() => undefined, `RCP ręcznie: ${row.worker.name} ${dir === 'in' ? 'wejście' : 'wyjście'} ${day} ${hhmm}`);
      await reload();
    } catch (e) {
      toast((e as Error).message, { tone: 'warn' });
    }
  };

  const confirmPlan = async (list: DayCheck[]) => {
    const todo = list.flatMap((r) => planPunches(r, nowH).map((p) => ({ r, p })));
    if (!todo.length) return;
    try {
      const made: Punch[] = todo.map(({ p }) => ({ ...p, id: crypto.randomUUID(), at: new Date(`${p.date}T${fmtMin(p.min)}:00`).toISOString() }));
      await savePunches(backend.client, made);
      const names = [...new Set(todo.map((x) => x.r.worker.name))];
      update(() => undefined, `RCP zatwierdzono wg grafiku (${date}): ${names.join(', ')}`);
      await reload();
      toast(names.length === 1 ? t('Zatwierdzono wg grafiku: {name}', { name: names[0] }) : t('Zatwierdzono wg grafiku: {n} os.', { n: names.length }), {
        undo: async () => {
          for (const p of made) await deletePunch(backend.client, p.id);
          update(() => undefined, `RCP cofnięto zatwierdzenie wg grafiku (${date}): ${names.join(', ')}`);
          await reload();
        },
      });
    } catch (e) {
      toast((e as Error).message, { tone: 'warn' });
    }
  };
  const fixable = rows.filter((r) => planPunches(r, nowH).length > 0);

  const remove = async (row: DayCheck, p: Punch) => {
    try {
      await deletePunch(backend.client, p.id);
      update(() => undefined, `RCP usunięto: ${row.worker.name} ${p.dir === 'in' ? 'wejście' : 'wyjście'} ${p.date} ${fmtMin(p.min)} (${p.source})`);
      await reload();
      toast(t('Usunięto odbicie {name} {h}', { name: row.worker.name, h: fmtMin(p.min) }), {
        undo: async () => {
          await savePunch(backend.client, p);
          update(() => undefined, `RCP przywrócono: ${row.worker.name} ${p.date} ${fmtMin(p.min)}`);
          await reload();
        },
      });
    } catch (e) {
      toast((e as Error).message, { tone: 'warn' });
    }
  };


  return (
    <>
      <div className="page-head">
        <div>
          <div className="sub">{fmtDate(date)}</div>
          <h1>{t('RCP — obecność')}</h1>
        </div>
        <div className="row">
          <label className="field">
            {t('Linia')}
            <select value={lineId} onChange={(e) => setLineId(e.target.value)}>
              <option value="all">{t('wszystkie')}</option>
              {[...new Set(state.lines.map((l) => l.group).filter((g): g is string => !!g))].map((g) => (
                <option key={g} value={`g:${g}`}>
                  {g} — {t('cała linia główna')}
                </option>
              ))}
              <LineOptions state={state} />
            </select>
          </label>
          <label className="field">
            {t('Dzień')}
            <div className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
              <button type="button" className="btn small" aria-label={t('Poprzedni dzień')} onClick={() => setDate(addDays(date, -1))}>‹</button>
              <input className="input" type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
              <button type="button" className="btn small" aria-label={t('Następny dzień')} onClick={() => setDate(addDays(date, 1))}>›</button>
            </div>
          </label>
          {backend.client && <TnaBadge tna={tnaLive} onClick={() => setLive(true)} />}
          {canEdit && (
            <button type="button" className="btn ghost" title={t('Wgraj plik z odbiciami z czytnika Comarch TNA (gdy API nie działa)')} onClick={() => setTna(true)}>
              {t('Import z pliku')}
            </button>
          )}
          <a className="btn" href="#/kiosk" target="_blank" rel="noreferrer">{t('Otwórz kiosk')}</a>
        </div>
      </div>

      <section className="kpis" aria-label={t('Wskaźniki obecności')}>
        <div className="kpi">
          <div className="k">{t('Odbici / zaplanowani')}</div>
          <div className="v">{present} / {planned}</div>
        </div>
        <div className="kpi">
          <div className="k">{t('Spóźnienia / wcześniejsze wyjścia')}</div>
          <div className="v" style={{ color: count(['late', 'early', 'late_early']) ? 'var(--amber-ink)' : undefined }}>{count(['late', 'early', 'late_early'])}</div>
        </div>
        <div className="kpi">
          <div className="k">{t('Brak odbić')}</div>
          <div className="v" style={{ color: count(['missing', 'no_in', 'no_out']) ? 'var(--red-ink)' : undefined }}>{count(['missing', 'no_in', 'no_out'])}</div>
          <div className="d">{t('bez wejścia, wyjścia albo wcale')}</div>
        </div>
        <div className="kpi">
          <div className="k">{t('Poza grafikiem')}</div>
          <div className="v">{count(['unplanned'])}</div>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>{t('Plan a odbicia')}</h2>
          {canEdit && fixable.length > 0 && (
            <button
              type="button"
              className="btn small primary"
              title={t('Wpisuje brakujące wejścia i wyjścia o godzinach z grafiku')}
              onClick={() => void confirmPlan(fixable)}
            >
              ✓ {t('Zatwierdź wg grafiku wszystkich ({n})', { n: fixable.length })}
            </button>
          )}
          <label className="sub" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} />
            {t('tylko problemy')}
          </label>
        </div>
        {error && <div className="note red">{error}</div>}
        {shown.length === 0 && <div className="sub">{t('Nikt nie jest zaplanowany ani nie odbił się tego dnia.')}</div>}
        <div className="scroll-x">
          <table style={{ minWidth: 760 }}>
            <thead>
              <tr>
                <th>{t('Pracownik')}</th>
                <th>{t('Plan')}</th>
                <th>{t('Wejście')}</th>
                <th>{t('Wyjście')}</th>
                <th>{t('Czas')}</th>
                <th>{t('Status')}</th>
                <th>{t('Odbicia')}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.worker.id}>
                  <td>
                    <button type="button" className="link-btn" onClick={() => setOpenWorker(r.worker.id)}>{r.worker.name}</button> <TypeTag w={r.worker} />
                    <div className="sub">{t('bryg.')} {r.worker.brigade} · {state.lines.find((l) => l.id === r.worker.lineId)?.name}</div>
                  </td>
                  <td>{r.plan ? fmtRange(r.plan.start, r.plan.end - r.plan.start) : '—'}</td>
                  <td style={{ color: r.lateMin ? 'var(--amber-ink)' : undefined }}>{hourText(r.firstIn)}</td>
                  <td style={{ color: r.earlyMin ? 'var(--amber-ink)' : undefined }}>{hourText(r.lastOut)}</td>
                  <td>
                    {r.worked ? `${Math.floor(r.worked)} h ${String(Math.round((r.worked % 1) * 60)).padStart(2, '0')} min` : '—'}
                    {r.privateMin > 0 && <div className="sub" style={{ color: 'var(--amber-ink)' }}>{t('prywatne')} −{r.privateMin} min</div>}
                  </td>
                  <td>
                    <span className={`tag ${STATUS_TONE[r.status]}`}>
                      {r.absence ? t(r.absence.reason) : t(STATUS_LABEL[r.status])}
                      {r.lateMin ? ` +${r.lateMin} min` : ''}
                      {r.earlyMin ? ` −${r.earlyMin} min` : ''}
                    </span>
                  </td>
                  <td>
                    <div className="row" style={{ gap: 4, alignItems: 'center' }}>
                      {r.punches.map((p) => (
                        <span key={p.id} className={`tag ${p.dir === 'private_out' ? 'amber' : ''}`} title={`${t(DIR_LABEL[p.ret ? 'return' : p.dir])} · ${p.source === 'manual' ? t('dodane ręcznie') : p.source === 'plan' ? t('zatwierdzone wg grafiku') : p.source === 'badge' ? t('karta RCP') : p.source === 'tna' ? t('czytnik Comarch TNA') : `${t('kiosk')}: ${p.kiosk ?? ''}`}`}>
                          {p.dir === 'private_out' ? '↗' : p.dir === 'in' ? (p.ret ? '↩' : '→') : '←'} {fmtMin(p.min)}{p.date !== date ? ` (${fmtDate(p.date)})` : ''}{p.source === 'manual' ? ' ✎' : p.source === 'plan' ? ' ✓' : ''}
                          {canEdit && (
                            <button type="button" className="btn small ghost" style={{ padding: '0 4px' }} aria-label={t('Usuń odbicie')} onClick={() => void remove(r, p)}>×</button>
                          )}
                        </span>
                      ))}
                      {canEdit && planPunches(r, nowH).length > 0 && (
                        <button type="button" className="btn small primary" title={t('Wpisz brakujące odbicia o godzinach z grafiku')} onClick={() => void confirmPlan([r])}>
                          ✓ {t('wg grafiku')}
                        </button>
                      )}
                      {canEdit && <AddPunch row={r} onAdd={(d, h, n) => void add(r, d, h, n)} />}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="sub" style={{ marginTop: 8 }}>
          {t('Tolerancja 5 min. Odbicia do 4 h przed i po zmianie liczą się do tej zmiany; nocka kończy się następnego dnia. ✎ = dodane ręcznie, ✓ = zatwierdzone wg grafiku, ↗ = wyjście prywatne, ↩ = powrót.')}
        </div>
      </section>
      {live && <TnaLive tna={tnaLive} onClose={() => setLive(false)} />}
      {tna && <TnaImport onClose={() => setTna(false)} onDone={() => void reload()} />}
      {openWorker && <RcpWorker workerId={openWorker} date={date} onClose={() => setOpenWorker(null)} />}
    </>
  );
}
