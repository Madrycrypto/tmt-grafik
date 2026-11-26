import { useMemo, useState } from 'react';
import { uid } from '../domain/actions';
import { WEEKDAY_LONG, WEEKDAY_SHORT, fmtRange, monthDays, todayIso, weekday } from '../domain/dates';
import { baseCode, brigadeMonth, gapsOnDay, patternShiftCodes, summarize } from '../domain/rota';
import type { RotaCell } from '../domain/rota';
import { OFF, holidaysOff, patternBrigades } from '../domain/types';
import type { BrigadeId, Exclusion } from '../domain/types';
import { useApp } from '../data/AppContext';
import { holidayName } from '../domain/holidays';
import { LineOptions, usePersistent } from '../ui';
import { monthNorm } from '../domain/norm';
import HrExportSheet from './HrExport';
import { t } from '../i18n';

const BRIGADE_COLOR: Record<BrigadeId, string> = { A: '#2457D6', B: '#E07A1F', C: '#0F8C7E', D: '#7A4FD0' };

export default function Grafik() {
  const { state, update } = useApp();
  const [month, setMonth] = useState(todayIso().slice(0, 7));
  const [scope, setScope] = usePersistent('grafik-line', 'all');
  // zakres: 'all', 'g:<grupa>' (linia główna, np. CFM) albo id linii
  const scopeLines = scope === 'all' ? state.lines : scope.startsWith('g:') ? state.lines.filter((l) => l.group === scope.slice(2)) : state.lines.filter((l) => l.id === scope);
  const scopePatterns = state.patterns.filter((p) => scope === 'all' || scopeLines.some((l) => !l.patternIds?.length || l.patternIds.includes(p.id)));
  const [patternId, setPatternId] = usePersistent('pattern', state.patterns[0]?.id ?? '');
  const pattern = scopePatterns.find((p) => p.id === patternId) ?? scopePatterns[0] ?? state.patterns[0];
  const norm = monthNorm(month);
  const groups = [...new Set(state.lines.map((l) => l.group).filter((g): g is string => !!g))];
  const days = monthDays(month);
  const label = (code: string) => t(code === OFF ? 'W' : (state.shiftDefs.find((s) => s.code === code)?.label ?? code));
  const colorOf = (code: string) => {
    const d = state.shiftDefs.find((x) => x.code === code);
    return d ? `c-${d.label}${d.hours}` : 'c-W';
  };
  const usedBy = (pid: string) =>
    scopeLines
      .filter((l) => !l.patternIds?.length || l.patternIds.includes(pid))
      .map((l) => l.name)
      .join(', ');

  const rows = useMemo(
    () => (pattern ? patternBrigades(pattern).map((b) => ({ b, cells: brigadeMonth(state, pattern.id, b, month) })) : []),
    [state, pattern, month],
  );
  const summary = useMemo(() => (pattern ? summarize(state, pattern.id, month) : []), [state, pattern, month]);
  const target = state.targets.find((t) => t.patternId === pattern?.id && t.month === month);
  const [hr, setHr] = useState(false);

  if (!pattern) return <div className="card empty">{t('Brak zdefiniowanych wzorców zmian (Ustawienia).')}</div>;
  const codes = patternShiftCodes(pattern);

  const cycle = (b: BrigadeId, c: RotaCell) => {
    const options = [...codes, OFF];
    const next = options[(options.indexOf(c.code) + 1) % options.length];
    const base = baseCode(pattern, b, c.date);
    update((d) => {
      d.rotaOverrides = d.rotaOverrides.filter((o) => !(o.patternId === pattern.id && o.brigade === b && o.date === c.date));
      if (next !== base) d.rotaOverrides.push({ id: uid('ro'), patternId: pattern.id, brigade: b, date: c.date, code: next });
    }, `Grafik ${pattern.name}: brygada ${b}, ${c.date} → ${label(next)}`);
  };

  const setTarget = (b: BrigadeId | 'all', value: string) => {
    const n = value === '' ? undefined : Math.max(0, Math.min(31, Number(value)));
    update((d) => {
      let t = d.targets.find((x) => x.patternId === pattern.id && x.month === month);
      if (!t) {
        t = { id: `${pattern.id}:${month}`, patternId: pattern.id, month, days: {} };
        d.targets.push(t);
      }
      for (const br of b === 'all' ? patternBrigades(pattern) : [b]) {
        if (n === undefined) delete t.days[br];
        else t.days[br] = n;
      }
    });
  };

  const membersOf = (b: BrigadeId) =>
    state.workers.filter((w) => w.active && w.patternId === pattern.id && w.brigade === b && (scope === 'all' || scopeLines.some((l) => l.id === w.lineId))).length;

  return (
    <>
      <div className="page-head">
        <div>
          <div className="sub">{t('Brygady: {n}', { n: patternBrigades(pattern).join(', ') })} · {t('kliknij komórkę, aby zmienić zmianę ręcznie')}</div>
          <h1>{t('Grafik brygad')}</h1>
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
          <label className="field">
            {t('System zmianowy')}
            <select value={pattern.id} onChange={(e) => setPatternId(e.target.value)}>
              {scopePatterns.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {usedBy(p.id) ? ` — ${usedBy(p.id)}` : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            {t('Miesiąc')}
            <input className="input" type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
          </label>
          <button type="button" className="btn primary" onClick={() => setHr(true)}>
            {t('Eksport dla kadr')}
          </button>
        </div>
      </div>
      {hr && <HrExportSheet month={month} onClose={() => setHr(false)} />}

      <section className="card">
        <div className="scroll-x">
          <table style={{ minWidth: 40 * days.length + 220, tableLayout: 'fixed' }}>
            <thead>
              <tr>
                <th className="sticky-col" style={{ width: 96 }}>{t('Brygada')}</th>
                {days.map((d) => (
                  <th key={d} title={holidayName(d) ?? ''} style={{ textAlign: 'center', width: 40, padding: '6px 2px', color: weekday(d) === 0 || holidayName(d) ? 'var(--red-ink)' : undefined }}>
                    {t(WEEKDAY_SHORT[weekday(d)])}
                    <br />
                    {d.slice(8)}
                  </th>
                ))}
                <th style={{ width: 150, textAlign: 'center' }} title={t('Wymiar czasu pracy w tym miesiącu: {h} h ({d} dni roboczych)', { h: norm.hours, d: norm.workdays })}>
                  {t('Dni · godz. / wymiar')}
                  <div className="sub" style={{ fontWeight: 400 }}>{t('wymiar')} {norm.hours} h</div>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ b, cells }) => {
                const s = summary.find((x) => x.brigade === b)!;
                return (
                  <tr key={b}>
                    <td className="sticky-col" style={{ fontWeight: 700 }}>
                      <span className="dot" style={{ background: BRIGADE_COLOR[b], marginRight: 6 }} />
                      {b}
                      <div className="sub" style={{ fontWeight: 400 }} title={t('pracownicy w tym systemie na wszystkich liniach')}>{membersOf(b)} os.</div>
                    </td>
                    {cells.map((c) => {
                      const cls =
                        c.status === 'excluded'
                          ? 'c-excluded'
                          : c.status === 'trimmed'
                            ? 'c-trimmed'
                            : c.status === 'holiday'
                              ? 'c-holiday'
                              : c.status === 'off'
                                ? 'c-W'
                                : colorOf(c.code);
                      const title =
                        c.status === 'holiday'
                          ? `${t('święto')}: ${t(holidayName(c.date) ?? '')}`
                          : c.status === 'excluded'
                          ? t('wyłączone (kalendarz zakładu)')
                          : c.status === 'trimmed'
                            ? t('dodatkowe wolne (cel dni)')
                            : c.overridden
                              ? t('zmienione ręcznie')
                              : '';
                      return (
                        <td key={c.date} style={{ padding: '4px 2px' }}>
                          <button type="button" className={`cell ${cls} ${c.overridden ? 'c-ov' : ''}`} title={`${c.date} ${label(c.code)} ${title}`} onClick={() => cycle(b, c)}>
                            {c.status === 'excluded' ? '✕' : c.status === 'trimmed' ? t('w') : c.status === 'holiday' ? t('Ś') : label(c.code)}
                          </button>
                        </td>
                      );
                    })}
                    <td style={{ textAlign: 'center', fontWeight: 600 }}>
                      {s.days}
                      {s.target !== undefined ? ` / ${s.target}` : ''} {t('dni')} · {s.hours} h
                      <div>
                        <span className={`tag ${s.hours < norm.hours ? 'red' : s.hours > norm.hours ? 'amber' : 'green'}`} title={s.hours < norm.hours ? t('Za mało godzin względem wymiaru — brakujące godziny trzeba dopełnić (np. na innej linii)') : s.hours > norm.hours ? t('Więcej godzin niż wymiar — nadgodziny albo odbiór dni wolnych') : t('Zgodnie z wymiarem')}>
                          {s.hours === norm.hours ? '✓' : `${s.hours > norm.hours ? '+' : '−'}${Math.abs(s.hours - norm.hours)} h`}
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
              <tr>
                <td className="sticky-col" style={{ fontWeight: 700, color: 'var(--red-ink)' }}>{t('Luki')}</td>
                {days.map((d) => {
                  const g = gapsOnDay(state, pattern.id, d);
                  return (
                    <td key={d} style={{ textAlign: 'center', fontSize: 11, fontWeight: 700, color: 'var(--red-ink)', padding: '4px 2px' }} title={g.length ? t('Brak brygady na zmianie — obsadź 12 h, agencją lub nadgodzinami') : ''}>
                      {g.map(label).join(' ')}
                    </td>
                  );
                })}
                <td />
              </tr>
            </tbody>
          </table>
        </div>
        <div className="legend" style={{ marginTop: 12 }}>
          {codes.map((c) => {
            const def = state.shiftDefs.find((s) => s.code === c);
            return (
              <span key={c}>
                <span className={`cell ${colorOf(c)}`}>{label(c)}</span>
                {def ? fmtRange(def.start, def.hours) : c}
              </span>
            );
          })}
          <span><span className="cell c-W">{t('W')}</span>{t('wolne')}</span>
          <span><span className="cell c-trimmed">{t('w')}</span>{t('dodatkowe wolne (cel dni)')}</span>
          <span><span className="cell c-excluded">✕</span>{t('wyłączone')}</span>
          <span><span className="cell c-holiday">{t('Ś')}</span>{t('święto ustawowe')}{holidaysOff(pattern) ? '' : ` (${t('ten system pracuje w święta')})`}</span>
          <span><span className="cell c-W c-ov">{t('R')}</span>{t('zmiana ręczna')}</span>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>{t('Bilans godzin')} — {month}</h2>
          <span className="sub">{t('wymiar czasu pracy: {h} h ({d} dni roboczych × 8 h)', { h: norm.hours, d: norm.workdays })}</span>
        </div>
        <div className="row" style={{ alignItems: 'stretch' }}>
          {rows.map(({ b, cells }) => {
            const s = summary.find((x) => x.brigade === b)!;
            const diff = s.hours - norm.hours;
            const lost = (st: string) => cells.filter((c) => c.status === st).reduce((h, c) => h + (state.shiftDefs.find((d) => d.code === c.code)?.hours ?? 0), 0);
            const excluded = lost('excluded');
            const holidays = lost('holiday');
            const trimmed = lost('trimmed');
            const n = membersOf(b);
            return (
              <div key={b} className="kpi" style={{ minWidth: 200, flex: '1 1 200px' }}>
                <div className="k">
                  <span className="dot" style={{ background: BRIGADE_COLOR[b], marginRight: 6 }} />
                  {t('Brygada')} {b} · {n} {t('os.')}
                </div>
                <div className="v" style={{ color: diff < 0 ? 'var(--red-ink)' : diff > 0 ? 'var(--amber-ink)' : 'var(--green-ink)' }}>
                  {diff === 0 ? '✓ 0 h' : `${diff > 0 ? '+' : '−'}${Math.abs(diff)} h`}
                </div>
                <div className="d">
                  {s.hours} h / {norm.hours} h
                  {excluded > 0 && <> · {t('wyłączenia')} −{excluded} h</>}
                  {holidays > 0 && <> · {t('święta')} −{holidays} h</>}
                  {trimmed > 0 && <> · {t('cel dni')} −{trimmed} h</>}
                </div>
                {diff < 0 && n > 0 && (
                  <div className="d" style={{ color: 'var(--red-ink)' }}>
                    {t('razem do dopełnienia: {h} h (≈ {s} zmian na osobę)', { h: -diff * n, s: Math.ceil(-diff / 8) })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <div className="split">
        <section className="card main-col">
          <div className="card-head">
            <h2>{t('Docelowa liczba dni pracy')} — {month}</h2>
          </div>
          <p className="sub" style={{ marginTop: 0 }}>
            {t('Generator zostawia każdej brygadzie dokładnie tyle dni, nadwyżkę zamienia na wolne rozłożone równomiernie. Puste pole = pełny cykl.')}
          </p>
          <div className="row">
            <label className="field" style={{ width: 120 }}>
              {t('Wszystkie')}
              <input type="number" min={0} max={31} placeholder={t('np. 20')} onBlur={(e) => e.target.value && setTarget('all', e.target.value)} />
            </label>
            {patternBrigades(pattern).map((b) => (
              <label key={b} className="field" style={{ width: 90 }}>
                Brygada {b}
                <input type="number" min={0} max={31} value={target?.days[b] ?? ''} onChange={(e) => setTarget(b, e.target.value)} />
              </label>
            ))}
          </div>
          {summary.some((s) => s.target !== undefined && s.days < s.target) && (
            <div className="note amber" style={{ marginTop: 10 }}>
              {t('Cykl daje mniej dni niż cel dla brygad:')} {summary.filter((s) => s.target !== undefined && s.days < s.target).map((s) => `${s.brigade} (${s.days}/${s.target})`).join(', ')}. {t('Dodaj zmiany ręcznie, klikając w komórki.')}
            </div>
          )}
          {summary.some((s) => s.weeksWithoutRest.length) && (
            <div className="note" style={{ marginTop: 10 }}>
              {t('Tygodnie z odpoczynkiem krótszym niż 35 h (Kodeks pracy dopuszcza 24 h przy zmianie zmiany, art. 133 § 2):')}{' '}
              {summary
                .filter((s) => s.weeksWithoutRest.length)
                .map((s) => `${s.brigade}: ${s.weeksWithoutRest.map((w) => `${t('od')} ${w.week.slice(8)}.${w.week.slice(5, 7)} (${w.rest} h)`).join(', ')}`)
                .join(' · ')}
            </div>
          )}
        </section>
        <Exclusions />
      </div>
    </>
  );
}

function Exclusions() {
  const { state, update } = useApp();
  const [kind, setKind] = useState<'weekly' | 'date'>('weekly');
  const [wd, setWd] = useState(0);
  const [date, setDate] = useState(todayIso());
  const [codes, setCodes] = useState<string[]>([]);
  const [note, setNote] = useState('');

  const describe = (e: Exclusion) =>
    `${e.kind === 'weekly' ? `${t('Co tydzień')}: ${t(WEEKDAY_LONG[e.weekday ?? 0])}` : `${t('Dzień')} ${e.date}`} — ${e.shiftCodes
      .map((c) => {
        const d = state.shiftDefs.find((s) => s.code === c);
        return d ? `${t(d.label)} ${fmtRange(d.start, d.hours)}` : c;
      })
      .join(', ')}`;

  const add = () => {
    if (!codes.length) return;
    const ex: Exclusion = { id: uid('ex'), kind, shiftCodes: codes, note: note || undefined, ...(kind === 'weekly' ? { weekday: wd } : { date }) };
    update((d) => {
      d.exclusions.push(ex);
    }, `Dodano wyłączenie: ${describe(ex)}`);
    setCodes([]);
    setNote('');
  };

  return (
    <section className="card side-col">
      <div className="card-head">
        <h2>{t('Kalendarz zakładu — wyłączenia')}</h2>
      </div>
      {state.exclusions.length === 0 && <div className="sub">{t('Brak wyłączeń.')}</div>}
      {state.exclusions.map((e) => (
        <div key={e.id} className="list-item">
          <div className="grow">
            <div style={{ fontWeight: 600, fontSize: 14 }}>{describe(e)}</div>
            {e.note && <div className="sub">{t(e.note)}</div>}
          </div>
          <button
            type="button"
            className="btn small"
            onClick={() =>
              update((d) => {
                d.exclusions = d.exclusions.filter((x) => x.id !== e.id);
              }, `Usunięto wyłączenie: ${describe(e)}`)
            }
          >
            {t('Usuń')}
          </button>
        </div>
      ))}
      <div className="stack" style={{ marginTop: 12 }}>
        <div className="row">
          <label className="field">
            {t('Rodzaj')}
            <select value={kind} onChange={(e) => setKind(e.target.value as 'weekly' | 'date')}>
              <option value="weekly">{t('co tydzień')}</option>
              <option value="date">{t('konkretny dzień')}</option>
            </select>
          </label>
          {kind === 'weekly' ? (
            <label className="field">
              {t('Dzień tygodnia')}
              <select value={wd} onChange={(e) => setWd(Number(e.target.value))}>
                {[1, 2, 3, 4, 5, 6, 0].map((i) => (
                  <option key={i} value={i}>
                    {t(WEEKDAY_LONG[i])}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label className="field">
              {t('Data')}
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
          )}
        </div>
        <div className="row" role="group" aria-label={t('Zmiany do wyłączenia')}>
          {state.shiftDefs.map((s) => (
            <label key={s.code} className="tag" style={{ display: 'inline-flex', gap: 6, alignItems: 'center', padding: '6px 10px', fontSize: 12 }}>
              <input
                type="checkbox"
                checked={codes.includes(s.code)}
                onChange={(e) => setCodes(e.target.checked ? [...codes, s.code] : codes.filter((c) => c !== s.code))}
              />
              {t(s.label)} {fmtRange(s.start, s.hours)}
            </label>
          ))}
        </div>
        <label className="field">
          Opis (opcjonalnie)
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('np. postój planowy, święto')} />
        </label>
        <button type="button" className="btn primary" disabled={!codes.length} onClick={add}>
          {t('Dodaj wyłączenie')}
        </button>
      </div>
    </section>
  );
}
