import { useMemo } from 'react';
import { addDays, monthDays, todayIso } from '../domain/dates';
import { attendanceRows, shiftComparison, sumRows, topAbsences, transfers, trend } from '../domain/stats';
import type { AttendanceRow } from '../domain/stats';
import { useApp } from '../data/AppContext';
import { usePunches } from '../data/punches';
import { LineOptions, usePersistent } from '../ui';
import { t } from '../i18n';

const pct = (x: number) => `${(x * 100).toFixed(1).replace('.', ',')}%`;
const num = (x: number) => (Math.round(x * 10) / 10).toString().replace('.', ',');
const tone = (rate: number) => (rate >= 0.1 ? 'red' : rate >= 0.05 ? 'amber' : 'green');
const REASONS = ['L4', 'UW', 'NN', 'INNE'] as const;

export default function Statystyki() {
  const { state } = useApp();
  const [month, setMonth] = usePersistent('stat-month', todayIso().slice(0, 7));
  const [scope, setScope] = usePersistent('stat-line', 'all');
  const lines = useMemo(() => {
    const ls = scope === 'all' ? state.lines : scope.startsWith('g:') ? state.lines.filter((l) => l.group === scope.slice(2)) : state.lines.filter((l) => l.id === scope);
    return ls.map((l) => l.id);
  }, [state.lines, scope]);
  const groups = [...new Set(state.lines.map((l) => l.group).filter((g): g is string => !!g))];
  const days = monthDays(month);
  const { punches } = usePunches(addDays(days[0], -1), addDays(days[days.length - 1], 1));
  const hasRcp = punches.length > 0;

  const rows = useMemo(() => attendanceRows(state, month, lines, hasRcp ? punches : undefined), [state, month, lines, punches, hasRcp]);
  const total = useMemo(() => sumRows(rows), [rows]);
  const compare = useMemo(() => shiftComparison(state, month, lines), [state, month, lines]);
  const moves = useMemo(() => transfers(state, month, lines), [state, month, lines]);
  const absentees = useMemo(() => topAbsences(state, month, lines), [state, month, lines]);
  const tr = useMemo(() => trend(state, month, lines), [state, month, lines]);
  const maxRate = Math.max(0.01, ...tr.map((p) => p.absentRate));
  const maxExtra = Math.max(1, ...tr.map((p) => p.extraHours));
  const movedDays = moves.reduce((s, r) => s + r.days, 0);

  const reasonCell = (r: AttendanceRow, k: string) => r.byReason[k] ?? 0;

  return (
    <>
      <div className="page-head">
        <div>
          <div className="sub">{t('Według grafiku, nieobecności i przypisań; odbicia RCP, gdy są')}</div>
          <h1>{t('Statystyki')}</h1>
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
            {t('Miesiąc')}
            <input className="input" type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
          </label>
        </div>
      </div>

      <div className="kpis">
        <div className="kpi">
          <div className="k">{t('Nieobecności')}</div>
          <div className="v">{pct(total.absentRate)}</div>
          <div className="d">{total.absent} {t('z')} {total.planned} {t('zaplanowanych zmian')}</div>
        </div>
        <div className="kpi">
          <div className="k">{t('Godziny utracone')}</div>
          <div className="v">{total.lostHours} h</div>
          <div className="d">{t('z')} {total.plannedHours} h {t('planu')}</div>
        </div>
        <div className="kpi">
          <div className="k">{t('Zmiany dodatkowe')}</div>
          <div className="v">{total.extraHours} h</div>
          <div className="d">{total.extraShifts} {t('zmian poza grafikiem')}</div>
        </div>
        <div className="kpi">
          <div className="k">{t('Praca poza własną linią')}</div>
          <div className="v">{movedDays}</div>
          <div className="d">{t('dni z przeniesieniem')}</div>
        </div>
      </div>

      <section className="card" style={{ marginTop: 14 }}>
        <div className="card-head">
          <h2>{t('Obecność według brygad')}</h2>
          <span className="sub">{t('Procent liczony od zmian zaplanowanych w grafiku')}</span>
        </div>
        <div className="scroll-x">
          <table style={{ minWidth: 760 }}>
            <thead>
              <tr>
                <th>{t('Linia · brygada')}</th>
                <th style={{ textAlign: 'right' }}>{t('Osób')}</th>
                <th style={{ textAlign: 'right' }}>{t('Plan (zmian)')}</th>
                <th style={{ textAlign: 'right' }}>{t('Nieobecni')}</th>
                <th>{t('Nieobecności')}</th>
                {REASONS.map((k) => (
                  <th key={k} style={{ textAlign: 'right' }}>{k}</th>
                ))}
                <th style={{ textAlign: 'right' }}>{t('Godz. utracone')}</th>
                <th style={{ textAlign: 'right' }}>{t('Dodatkowe (h)')}</th>
                {hasRcp && <th style={{ textAlign: 'right' }}>{t('Punktualność RCP')}</th>}
              </tr>
            </thead>
            <tbody>
              {[...rows, total].map((r) => (
                <tr key={r.key} style={r.key === 'total' ? { fontWeight: 700, background: 'var(--line-soft)' } : undefined}>
                  <td style={{ fontWeight: 600 }}>{t(r.label)}</td>
                  <td style={{ textAlign: 'right' }}>{r.people}</td>
                  <td style={{ textAlign: 'right' }}>{r.planned}</td>
                  <td style={{ textAlign: 'right' }}>{r.absent}</td>
                  <td>
                    <span className={`tag ${tone(r.absentRate)}`}>{pct(r.absentRate)}</span>
                  </td>
                  {REASONS.map((k) => (
                    <td key={k} style={{ textAlign: 'right', color: reasonCell(r, k) ? undefined : 'var(--muted)' }}>{reasonCell(r, k)}</td>
                  ))}
                  <td style={{ textAlign: 'right' }}>{r.lostHours}</td>
                  <td style={{ textAlign: 'right' }}>{r.extraHours}</td>
                  {hasRcp && (
                    <td style={{ textAlign: 'right' }} title={r.rcp ? `${t('spóźnienia')}: ${r.rcp.late} (${r.rcp.lateMin} min) · ${t('wcześniejsze wyjścia')}: ${r.rcp.early} · ${t('brak odbicia')}: ${r.rcp.missing}` : ''}>
                      {r.rcp ? `${Math.round((r.rcp.ok / Math.max(1, r.rcp.checked)) * 100)}% (${r.rcp.ok}/${r.rcp.checked})` : '—'}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!hasRcp && <div className="sub" style={{ marginTop: 8 }}>{t('Brak odbić RCP w tym miesiącu — punktualność pojawi się po pierwszych odbiciach.')}</div>}
      </section>

      <section className="card" style={{ marginTop: 14 }}>
        <div className="card-head">
          <h2>{t('Porównanie zmian na linii')}</h2>
          <span className="sub">{t('Luka = stanowisko bez wymaganej obsady kwalifikowanej; brak zastępcy = tylko jedna taka osoba')}</span>
        </div>
        <div className="scroll-x">
          <table style={{ minWidth: 760 }}>
            <thead>
              <tr>
                <th>{t('Linia')}</th>
                <th>{t('Zmiana')}</th>
                <th style={{ textAlign: 'right' }}>{t('Dni pracy')}</th>
                <th style={{ textAlign: 'right' }}>{t('Śr. zaplanowanych')}</th>
                <th style={{ textAlign: 'right' }}>{t('Śr. obecnych')}</th>
                <th>{t('Nieobecności')}</th>
                <th style={{ textAlign: 'right' }}>{t('Wymagane')}</th>
                <th style={{ textAlign: 'right' }}>{t('Dni z luką')}</th>
                <th style={{ textAlign: 'right' }}>{t('Brak zastępcy (dni)')}</th>
                <th style={{ textAlign: 'right' }}>{t('Dodatkowe')}</th>
              </tr>
            </thead>
            <tbody>
              {compare.map((c, i) => {
                const first = i === 0 || compare[i - 1].lineId !== c.lineId;
                const worst = Math.max(...compare.filter((x) => x.lineId === c.lineId).map((x) => x.gapDays));
                return (
                  <tr key={`${c.lineId}-${c.code}`} style={first ? { borderTop: '2px solid var(--line)' } : undefined}>
                    <td style={{ fontWeight: 600 }}>{first ? c.lineName : ''}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <span className={`cell c-${c.label}${c.code.replace(/\D/g, '')}`} style={{ width: 28, height: 24, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{c.label}</span>
                        {c.window}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>{c.workDays}</td>
                    <td style={{ textAlign: 'right' }}>{num(c.avgScheduled)}</td>
                    <td style={{ textAlign: 'right' }}>{num(c.avgPresent)}</td>
                    <td>
                      <span className={`tag ${tone(c.absentRate)}`}>{pct(c.absentRate)}</span>
                    </td>
                    <td style={{ textAlign: 'right' }}>{c.required || '—'}</td>
                    <td style={{ textAlign: 'right' }}>
                      {c.required ? <span className={`tag ${c.gapDays === 0 ? 'green' : c.gapDays === worst && worst > 0 ? 'red' : 'amber'}`}>{c.gapDays}</span> : '—'}
                    </td>
                    <td style={{ textAlign: 'right' }}>{c.required ? c.soleDays : '—'}</td>
                    <td style={{ textAlign: 'right' }}>{c.extraShifts}</td>
                  </tr>
                );
              })}
              {!compare.length && (
                <tr>
                  <td colSpan={10} className="sub">{t('Brak zmian w grafiku dla tego zakresu i miesiąca.')}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid-2" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14, marginTop: 14 }}>
        <section className="card">
          <div className="card-head">
            <h2>{t('Przeniesienia między liniami')}</h2>
            <span className="sub">{t('Z przypisań na stanowiska — bez osobnego zgłaszania')}</span>
          </div>
          <div className="scroll-x">
            <table>
              <thead>
                <tr>
                  <th>{t('Pracownik')}</th>
                  <th>{t('Z → na')}</th>
                  <th style={{ textAlign: 'right' }}>{t('Dni')}</th>
                </tr>
              </thead>
              <tbody>
                {moves.slice(0, 12).map((r) => (
                  <tr key={`${r.workerId}-${r.to}`}>
                    <td style={{ fontWeight: 600 }}>{r.name}</td>
                    <td title={r.stations.join(', ')}>
                      {r.from} → {r.to}
                    </td>
                    <td style={{ textAlign: 'right' }}>{r.days}</td>
                  </tr>
                ))}
                {!moves.length && (
                  <tr>
                    <td colSpan={3} className="sub">{t('Nikt nie pracował poza własną linią.')}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <h2>{t('Najwięcej nieobecności')}</h2>
            <span className="sub">{t('Dni zaplanowanej pracy')}</span>
          </div>
          <div className="scroll-x">
            <table>
              <thead>
                <tr>
                  <th>{t('Pracownik')}</th>
                  <th>{t('Linia')}</th>
                  <th>{t('Powód')}</th>
                  <th style={{ textAlign: 'right' }}>{t('Dni')}</th>
                </tr>
              </thead>
              <tbody>
                {absentees.map((r) => (
                  <tr key={r.workerId}>
                    <td style={{ fontWeight: 600 }}>{r.name}</td>
                    <td>{r.line}</td>
                    <td>{Object.entries(r.byReason).map(([k, v]) => `${k} ${v}`).join(' · ')}</td>
                    <td style={{ textAlign: 'right' }}>{r.days}</td>
                  </tr>
                ))}
                {!absentees.length && (
                  <tr>
                    <td colSpan={4} className="sub">{t('Brak nieobecności w tym miesiącu.')}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <section className="card" style={{ marginTop: 14 }}>
        <div className="card-head">
          <h2>{t('Trend — ostatnie 6 miesięcy')}</h2>
          <span className="sub">{t('Nieobecności (% zaplanowanych zmian) i godziny dodatkowe')}</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, minmax(0, 1fr))', gap: 10, alignItems: 'end' }}>
          {tr.map((p) => (
            <div key={p.month} style={{ textAlign: 'center' }}>
              <div style={{ display: 'flex', gap: 4, alignItems: 'end', justifyContent: 'center', height: 90 }}>
                <div title={`${t('Nieobecności')}: ${pct(p.absentRate)}`} style={{ width: 18, height: `${Math.max(3, (p.absentRate / maxRate) * 90)}px`, background: 'var(--red, #d64545)', borderRadius: 3 }} />
                <div title={`${t('Dodatkowe (h)')}: ${p.extraHours}`} style={{ width: 18, height: `${Math.max(3, (p.extraHours / maxExtra) * 90)}px`, background: 'var(--accent, #2457d6)', borderRadius: 3 }} />
              </div>
              <div style={{ fontSize: 12, fontWeight: p.month === month ? 700 : 400, marginTop: 4 }}>{p.month.slice(2).replace('-', '/')}</div>
              <div className="sub">{pct(p.absentRate)} · {p.extraHours} h</div>
            </div>
          ))}
        </div>
        <div className="sub" style={{ marginTop: 8 }}>
          <span style={{ color: 'var(--red, #d64545)' }}>■</span> {t('nieobecności')} · <span style={{ color: 'var(--accent, #2457d6)' }}>■</span> {t('godziny dodatkowe')}
        </div>
      </section>
    </>
  );
}
