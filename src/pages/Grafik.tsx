import { toast } from '../toast';
import { useMemo, useState } from 'react';
import { uid } from '../domain/actions';
import { WEEKDAY_LONG, WEEKDAY_SHORT, fmtRange, monthDays, todayIso, weekday } from '../domain/dates';
import { baseCode, brigadeMonth, gapsOnDay, patternShiftCodes, summarize } from '../domain/rota';
import type { RotaCell } from '../domain/rota';
import { OFF, holidaysOff, patternBrigades } from '../domain/types';
import type { BrigadeId, Exclusion, Pattern } from '../domain/types';
import { useApp } from '../data/AppContext';
import { holidayName } from '../domain/holidays';
import { LineOptions, usePersistent } from '../ui';
import { monthNorm } from '../domain/norm';
import { patternPeriod, periodLabel, periodMonths, SETTLEMENT_OPTIONS } from '../domain/settlement';
import { BRIGADE_COLOR, buildPrintWorkbook, printFileName } from '../domain/printExport';
import { downloadXlsx } from './WorkerBulk';
import HrExportSheet from './HrExport';
import FillSheet from './FillSheet';
import { t } from '../i18n';


export default function Grafik() {
  const { state, update, undo } = useApp();
  const [month, setMonth] = useState(todayIso().slice(0, 7));
  const [scope, setScope] = usePersistent('grafik-line', 'all');
  // zakres: 'all', 'g:<grupa>' (linia główna, np. CFM) albo id linii
  const scopeLines = scope === 'all' ? state.lines : scope.startsWith('g:') ? state.lines.filter((l) => l.group === scope.slice(2)) : state.lines.filter((l) => l.id === scope);
  const scopePatterns = state.patterns.filter((p) => scope === 'all' || scopeLines.some((l) => !l.patternIds?.length || l.patternIds.includes(p.id)));
  const [patternId, setPatternId] = usePersistent('pattern', state.patterns[0]?.id ?? '');
  const pattern = scopePatterns.find((p) => p.id === patternId) ?? scopePatterns[0] ?? state.patterns[0];
  const norm = monthNorm(month);
  const shiftH = (pattern && state.shiftDefs.find((d) => patternShiftCodes(pattern).includes(d.code))?.hours) || 8;
  // dni potrzebne do wymiaru; przy 12 h w dół, żeby nie przekroczyć wymiaru
  const normDays = Math.floor(norm.hours / shiftH);
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
  // to samo bez limitu dni — ile daje sam cykl
  const fullSummary = useMemo(
    () => (pattern ? summarize({ ...state, targets: state.targets.filter((x) => !(x.patternId === pattern.id && x.month === month)) }, pattern.id, month) : []),
    [state, pattern, month],
  );
  const target = state.targets.find((t) => t.patternId === pattern?.id && t.month === month);
  // okres rozliczeniowy systemu: bilans liczony za wszystkie jego miesiące
  const period = patternPeriod(pattern, month);
  // podgląd dla kierownika: dłuższy horyzont (6/12 mies.) bez zmiany oficjalnego okresu
  const [view, setView] = usePersistent('bilans-widok', 'okres');
  const viewN = view === 'okres' ? 0 : Number(view);
  const span = viewN > period.length ? periodMonths(month, viewN, pattern?.settlementStart) : period;
  const preview = span !== period;
  const periodSummaries = useMemo(
    () => (pattern ? span.map((m) => ({ month: m, norm: monthNorm(m).hours, rows: summarize(state, pattern.id, m) })) : []),
    [state, pattern, span.join()], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const [hr, setHr] = useState(false);
  const [fill, setFill] = useState(false);

  if (!pattern) return <div className="card empty">{t('Brak zdefiniowanych wzorców zmian (Ustawienia).')}</div>;
  const codes = patternShiftCodes(pattern);

  const printXlsx = () => {
    const scopeName = scope === 'all' ? 'Cały zakład' : scope.startsWith('g:') ? scope.slice(2) : (scopeLines[0]?.name ?? '');
    const bytes = buildPrintWorkbook(state, { patternId: pattern.id, month, scopeName, lineIds: scopeLines.map((l) => l.id) });
    downloadXlsx(printFileName(scopeName, pattern.name, month), bytes);
  };

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
    }, `Limit dni ${pattern.name} ${month}: ${b === 'all' ? 'wszystkie' : b} = ${n ?? 'pełny cykl'}`);
  };

  const membersOf = (b: BrigadeId) =>
    state.workers.filter((w) => w.active && w.patternId === pattern.id && w.brigade === b && (scope === 'all' || scopeLines.some((l) => l.id === w.lineId))).length;

  /** Przy wyborze całej linii: liczba osób brygady w każdej podlinii (Lutowanie 4 · Rdzenie 8 · Moduły 29). */
  const byLine = (b: BrigadeId) =>
    scopeLines
      .map((l) => ({ id: l.id, name: l.name, n: state.workers.filter((w) => w.active && w.patternId === pattern.id && w.brigade === b && w.lineId === l.id).length }))
      .filter((x) => x.n > 0);

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
          <button type="button" className="btn" onClick={printXlsx} title={t('Plik .xlsx ustawiony do wydruku na A4: brygady i lista pracowników, każda brygada na osobnej stronie')}>
            {t('Eksport do Excela (druk)')}
          </button>
          <button type="button" className="btn primary" onClick={() => setHr(true)}>
            {t('Eksport dla kadr')}
          </button>
        </div>
      </div>
      {hr && <HrExportSheet month={month} onClose={() => setHr(false)} />}
      {fill && (
        <FillSheet
          month={month}
          workers={state.workers.filter((w) => w.active && w.patternId === pattern.id && (scope === 'all' || scopeLines.some((l) => l.id === w.lineId)))}
          onClose={() => setFill(false)}
        />
      )}

      <section className="card">
        <div className="scroll-x">
          <table style={{ minWidth: 40 * days.length + 220, tableLayout: 'fixed' }}>
            <thead>
              <tr>
                <th className="sticky-col" style={{ width: 130 }}>{t('Brygada')}</th>
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
                      {byLine(b).length > 1 &&
                        byLine(b).map((x) => (
                          <div key={x.id} className="sub" style={{ fontWeight: 400, whiteSpace: 'nowrap' }}>
                            {x.name} · {x.n}
                          </div>
                        ))}
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
                {def?.credit ? ` (+${def.credit} h ${t('należne, postój')})` : ''}
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
          <h2>
            {t('Bilans godzin')} — {span.length > 1 ? periodLabel(span) : month}
          </h2>
          <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            {t('Okres rozliczeniowy')}
            <select
              value={pattern.settlementMonths ?? 1}
              onChange={(e) => {
                const n = Number(e.target.value);
                update((d) => {
                  const p = d.patterns.find((x) => x.id === pattern.id)!;
                  p.settlementMonths = n;
                  if (n === 1) delete p.settlementStart;
                }, `Okres rozliczeniowy ${pattern.name}: ${n} mies.`);
                toast(t('Okres rozliczeniowy: {n} mies.', { n }), { undo });
              }}
            >
              {SETTLEMENT_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n === 1 ? t('1 miesiąc') : n === 12 ? t('12 miesięcy (rok)') : t('{n} miesiące', { n })}
                </option>
              ))}
            </select>
          </label>
          {period.length > 1 && (
            <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }} title={t('Pierwszy miesiąc okresu — od niego liczą się kolejne okresy')}>
              {t('od')}
              <input
                type="month"
                value={pattern.settlementStart ?? period[0]}
                onChange={(e) =>
                  e.target.value &&
                  update((d) => void (d.patterns.find((x) => x.id === pattern.id)!.settlementStart = e.target.value), `Początek okresu rozliczeniowego ${pattern.name}: ${e.target.value}`)
                }
                style={{ width: 150 }}
              />
            </label>
          )}
          <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }} title={t('Tylko podgląd dla planowania — rozliczenie w kadrach zostaje według okresu rozliczeniowego')}>
            {t('Podgląd')}
            <select value={view} onChange={(e) => setView(e.target.value)}>
              <option value="okres">{t('okres rozliczeniowy')}</option>
              <option value="6">{t('6 miesięcy')}</option>
              <option value="12">{t('12 miesięcy')}</option>
            </select>
          </label>
          <span className="sub">
            {span.length > 1
              ? t(preview ? 'wymiar w podglądzie: {h} h · w tym miesiącu {m} h' : 'wymiar w okresie: {h} h · w tym miesiącu {m} h', { h: periodSummaries.reduce((x, p) => x + p.norm, 0), m: norm.hours })
              : t('wymiar czasu pracy: {h} h ({d} dni roboczych × 8 h)', { h: norm.hours, d: norm.workdays })}
          </span>
          <button type="button" className="btn small primary" title={t('Zaproponuj dodatkowe zmiany na innych liniach dla osób, którym brakuje godzin')} onClick={() => setFill(true)}>
            {t('Dopełnij godziny')}
          </button>
        </div>
        {(() => {
          const per = rows.map(({ b }) => ({ n: membersOf(b), h: periodSummaries.reduce((x, p) => x + (p.rows.find((r) => r.brigade === b)?.credit ?? 0), 0) }));
          const total = per.reduce((x, p) => x + p.h * p.n, 0);
          const perPerson = Math.max(0, ...per.map((p) => p.h));
          return perPerson > 0 ? (
            <div className="note amber" style={{ marginBottom: 10 }}>
              {t('Godziny należne bez pracy (postój na maintenance) w {p}: do {h} h na osobę', { p: span.length > 1 ? periodLabel(span) : month, h: perPerson })}
              {total > 0 ? ` · ${t('razem dla tej grupy: {h} h do zapłaty', { h: total })}` : ` · ${t('dodaj ludzi do brygad, żeby policzyć sumę dla grupy')}`}
            </div>
          ) : null;
        })()}
        <div className="row" style={{ alignItems: 'stretch' }}>
          {rows.map(({ b, cells }) => {
            const s = summary.find((x) => x.brigade === b)!;
            const perMonth = periodSummaries.map((p) => ({ month: p.month, diff: (p.rows.find((x) => x.brigade === b)?.hours ?? 0) - p.norm }));
            const periodHours = periodSummaries.reduce((x, p) => x + (p.rows.find((r) => r.brigade === b)?.hours ?? 0), 0);
            const periodNorm = periodSummaries.reduce((x, p) => x + p.norm, 0);
            const diff = span.length > 1 ? periodHours - periodNorm : s.hours - norm.hours;
            // w podglądzie dłuższym niż okres: bilans każdego oficjalnego okresu osobno
            const chips = preview
              ? [...new Set(span.map((m) => patternPeriod(pattern, m).join()))].map((key) => {
                  const ms = key.split(',');
                  const d = perMonth.filter((x) => ms.includes(x.month)).reduce((h, x) => h + x.diff, 0);
                  return { key, label: periodLabel(ms).replace(/ \d{4}/g, ''), diff: d, current: ms.includes(month), title: periodLabel(ms) };
                })
              : perMonth.map((m) => ({ key: m.month, label: periodLabel([m.month]).split(' ')[0], diff: m.diff, current: m.month === month, title: m.month }));
            const monthDiff = s.hours - norm.hours;
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
                {span.length > 1 && (
                  <div className="d">
                    {periodHours} h / {periodNorm} h {preview ? t('w podglądzie') : t('w okresie')}
                    {preview && <div>{t('okresy rozliczeniowe:')}</div>}
                    <div className="row" style={{ gap: 4, marginTop: 4 }}>
                      {chips.map((c) => (
                        <span
                          key={c.key}
                          className={`tag ${c.diff < 0 ? 'red' : c.diff > 0 ? 'amber' : 'green'}`}
                          style={{ outline: c.current ? '2px solid currentColor' : undefined }}
                          title={c.title}
                        >
                          {c.label} {c.diff === 0 ? '0' : `${c.diff > 0 ? '+' : '−'}${Math.abs(c.diff)}`}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                <div className="d">
                  {span.length > 1 && <>{t('ten miesiąc')}: {monthDiff > 0 ? '+' : monthDiff < 0 ? '−' : ''}{Math.abs(monthDiff)} h · </>}
                  {s.hours} h / {norm.hours} h
                  {excluded > 0 && <> · {t('wyłączenia')} −{excluded} h</>}
                  {holidays > 0 && <> · {t('święta')} −{holidays} h</>}
                  {trimmed > 0 && <> · {t('cel dni')} −{trimmed} h</>}
                </div>
                {(() => {
                  // godziny należne bez pracy w okresie (np. skrócona nocka na maintenance)
                  const credit = periodSummaries.reduce((x, p) => x + (p.rows.find((r) => r.brigade === b)?.credit ?? 0), 0) || (span.length > 1 ? 0 : s.credit);
                  return credit > 0 ? (
                    <div className="d" title={t('Godziny, których pracownik nie przepracowuje (linia stoi), ale liczą się do wymiaru i są płatne')}>
                      {t('w tym należne bez pracy: {h} h na osobę', { h: credit })}
                      {n > 0 && <> · {t('razem {h} h', { h: credit * n })}</>}
                    </div>
                  ) : null;
                })()}
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
            <h2>{t('Ile dni pracuje brygada')} — {month}</h2>
          </div>
          <p className="sub" style={{ marginTop: 0 }}>
            {t('Gdy cykl daje więcej dni niż wymiar, ustaw limit — nadmiarowe dni zamienią się na wolne (niebieskie „w” w grafiku), rozłożone równo w miesiącu.')}
          </p>
          <div className="row" style={{ marginBottom: 10 }}>
            <button
              type="button"
              className="btn primary"
              title={t('Wymiar {h} h ÷ zmiana {s} h', { h: norm.hours, s: shiftH })}
              onClick={() => {
                setTarget('all', String(normDays));
                toast(t('Każda brygada pracuje {d} dni ({h} h).', { d: normDays, h: normDays * shiftH }), { undo });
              }}
            >
              {t('Wyrównaj do wymiaru: {d} dni', { d: normDays })}
            </button>
            {target && Object.keys(target.days).length > 0 && (
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setTarget('all', '');
                  toast(t('Przywrócono pełny cykl.'), { undo });
                }}
              >
                {t('Pełny cykl (bez limitu)')}
              </button>
            )}
          </div>
          <table>
            <thead>
              <tr>
                <th>{t('Brygada')}</th>
                <th>{t('Z cyklu')}</th>
                <th>{t('Limit dni')}</th>
                <th>{t('Efekt')}</th>
              </tr>
            </thead>
            <tbody>
              {patternBrigades(pattern).map((b) => {
                const full = fullSummary.find((x) => x.brigade === b);
                const now = summary.find((x) => x.brigade === b);
                return (
                  <tr key={b}>
                    <td>
                      <span className="dot" style={{ background: BRIGADE_COLOR[b], marginRight: 6 }} />
                      <b>{b}</b>
                    </td>
                    <td>
                      {full?.days} {t('dni')} · {full?.hours} h
                    </td>
                    <td>
                      <input
                        className="input"
                        style={{ width: 80 }}
                        type="number"
                        min={0}
                        max={31}
                        placeholder={String(full?.days ?? '')}
                        aria-label={t('Limit dni brygady {b}', { b })}
                        value={target?.days[b] ?? ''}
                        onChange={(e) => setTarget(b, e.target.value)}
                      />
                    </td>
                    <td className="sub">
                      {target?.days[b] === undefined
                        ? t('pełny cykl')
                        : now && full && now.days < full.days
                          ? t('{n} dni na wolne → {h} h', { n: full.days - now.days, h: now.hours })
                          : `${now?.hours ?? 0} h`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
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
        <Exclusions pattern={pattern} />
      </div>
    </>
  );
}

function Exclusions({ pattern }: { pattern: Pattern }) {
  const { state, update, undo } = useApp();
  const used = new Set(patternShiftCodes(pattern));
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

  const sameDay = (e: Exclusion) => e.kind === kind && (kind === 'weekly' ? e.weekday === wd : e.date === date);

  const add = () => {
    if (!codes.length) return;
    const existing = state.exclusions.find(sameDay);
    const fresh = codes.filter((c) => !existing?.shiftCodes.includes(c));
    if (!fresh.length) {
      toast(t('Takie wyłączenie już jest.'), { tone: 'warn' });
      return;
    }
    const ex: Exclusion = existing
      ? { ...existing, shiftCodes: [...existing.shiftCodes, ...fresh], note: note || existing.note }
      : { id: uid('ex'), kind, shiftCodes: codes, note: note || undefined, ...(kind === 'weekly' ? { weekday: wd } : { date }) };
    update((d) => {
      // ten sam dzień = jeden wpis; nowe zmiany dopisujemy do istniejącego
      d.exclusions = existing ? d.exclusions.map((x) => (x.id === existing.id ? ex : x)) : [...d.exclusions, ex];
    }, `${existing ? 'Rozszerzono' : 'Dodano'} wyłączenie: ${describe(ex)}`);
    const hits = fresh.filter((c) => used.has(c));
    toast(
      hits.length
        ? t('Dodano wyłączenie — bilans godzin uwzględnia je od razu.')
        : t('Dodano, ale ten system ({p}) nie ma takiej zmiany — jego bilans się nie zmieni.', { p: pattern.name }),
      { undo, tone: hits.length ? 'ok' : 'warn' },
    );
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
            onClick={() => {
              update((d) => {
                d.exclusions = d.exclusions.filter((x) => x.id !== e.id);
              }, `Usunięto wyłączenie: ${describe(e)}`);
              toast(t('Usunięto wyłączenie'), { undo });
            }}
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
        <div className="sub">{t('Zmiany systemu „{p}” są wyróżnione; wyszarzone należą do innych systemów.', { p: pattern.name })}</div>
        <div className="row" role="group" aria-label={t('Zmiany do wyłączenia')}>
          {[...state.shiftDefs].sort((a, b) => Number(used.has(b.code)) - Number(used.has(a.code))).map((s) => (
            <label
              key={s.code}
              className={`tag ${used.has(s.code) ? 'blue' : ''}`}
              title={used.has(s.code) ? undefined : t('Ta zmiana nie występuje w wybranym systemie')}
              style={{ display: 'inline-flex', gap: 6, alignItems: 'center', padding: '6px 10px', fontSize: 12, opacity: used.has(s.code) ? 1 : 0.55 }}
            >
              <input
                type="checkbox"
                checked={codes.includes(s.code)}
                onChange={(e) => setCodes(e.target.checked ? [...codes, s.code] : codes.filter((c) => c !== s.code))}
              />
              {t(s.label)} {fmtRange(s.start, s.hours)}
              {!used.has(s.code) && <span style={{ fontWeight: 400 }}>· {t('inny system')}</span>}
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
