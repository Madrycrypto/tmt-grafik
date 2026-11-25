import { useMemo, useState } from 'react';
import { monthDays, todayIso, weekday, WEEKDAY_SHORT } from '../domain/dates';
import { hrDailyCsv, hrMonthlyCsv, hrSummary } from '../domain/hrExport';
import type { HrFilter } from '../domain/hrExport';
import { TYPE_LABEL } from '../domain/types';
import { useApp } from '../data/AppContext';
import { Sheet } from '../ui';
import { downloadCsv } from './WorkerBulk';

export default function HrExportSheet({ onClose, month: initialMonth }: { onClose: () => void; month?: string }) {
  const { state } = useApp();
  const [f, setF] = useState<HrFilter>({ month: initialMonth ?? todayIso().slice(0, 7), lineId: 'all', who: 'all', includeInactive: false });
  const [format, setFormat] = useState<'monthly' | 'daily'>('monthly');
  const summary = useMemo(() => hrSummary(state, f), [state, f]);
  const agencies = [...new Set(state.workers.filter((w) => w.type === 'AG' && w.agency).map((w) => w.agency!))].sort();
  const days = monthDays(f.month);
  const total = (k: 'hours' | 'night' | 'sunday' | 'extraHours') => summary.reduce((s, x) => s + x[k], 0);

  const download = () => {
    const line = f.lineId === 'all' ? 'wszystkie-linie' : (state.lines.find((l) => l.id === f.lineId)?.name ?? '').replace(/\s+/g, '-');
    const who = f.who === 'all' ? '' : `-${f.who.replace(/^ag:/, '').replace(/\s+/g, '-')}`;
    const name = `kadry-${format === 'monthly' ? 'grafik' : 'lista-dzienna'}-${f.month}-${line}${who}.csv`;
    downloadCsv(name, format === 'monthly' ? hrMonthlyCsv(state, f) : hrDailyCsv(state, f));
  };

  return (
    <Sheet title="Eksport dla kadr" sub="Nazwisko i zmiana na każdy dzień według grafiku, z nieobecnościami i sumami godzin. Plik otwiera się w Excelu." onClose={onClose}>
      <div className="row">
        <label className="field">
          Miesiąc
          <input type="month" value={f.month} onChange={(e) => e.target.value && setF({ ...f, month: e.target.value })} />
        </label>
        <label className="field">
          Linia
          <select value={f.lineId} onChange={(e) => setF({ ...f, lineId: e.target.value })}>
            <option value="all">wszystkie</option>
            {state.lines.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Pracownicy
          <select value={f.who} onChange={(e) => setF({ ...f, who: e.target.value })}>
            <option value="all">wszyscy</option>
            {Object.entries(TYPE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
            {agencies.map((a) => (
              <option key={a} value={`ag:${a}`}>
                {a}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="row" role="radiogroup" aria-label="Format">
        <label className="tag" style={{ padding: '8px 12px', fontSize: 13, display: 'inline-flex', gap: 6, alignItems: 'center' }}>
          <input type="radio" checked={format === 'monthly'} onChange={() => setFormat('monthly')} />
          Tabela miesięczna (osoba × dzień)
        </label>
        <label className="tag" style={{ padding: '8px 12px', fontSize: 13, display: 'inline-flex', gap: 6, alignItems: 'center' }}>
          <input type="radio" checked={format === 'daily'} onChange={() => setFormat('daily')} />
          Lista dzienna (wiersz na dzień)
        </label>
      </div>
      <label className="sub" style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
        <input type="checkbox" checked={f.includeInactive} onChange={(e) => setF({ ...f, includeInactive: e.target.checked })} />
        uwzględnij nieaktywnych
      </label>

      <div className="row">
        <span className="tag">{summary.length} os.</span>
        <span className="tag">{total('hours')} h</span>
        <span className="tag">nocne {total('night')} h</span>
        <span className="tag">niedziela {total('sunday')} h</span>
        <span className="tag amber">dodatkowe {total('extraHours')} h</span>
      </div>

      <div className="scroll-x" style={{ maxHeight: 280, overflowY: 'auto' }}>
        <table style={{ minWidth: 220 + 7 * 64, fontSize: 12 }}>
          <thead>
            <tr>
              <th className="sticky-col">Nazwisko</th>
              {days.slice(0, 7).map((d) => (
                <th key={d} style={{ textAlign: 'center' }}>
                  {WEEKDAY_SHORT[weekday(d)]} {d.slice(8)}
                </th>
              ))}
              <th>…</th>
              <th>Godz.</th>
            </tr>
          </thead>
          <tbody>
            {summary.slice(0, 12).map((s) => (
              <tr key={s.worker.id}>
                <td className="sticky-col" style={{ fontWeight: 600 }}>{s.worker.name}</td>
                {s.days.slice(0, 7).map((d) => (
                  <td key={d.date} style={{ textAlign: 'center', color: d.absence ? 'var(--red-ink)' : d.code === 'W' ? 'var(--muted)' : undefined, fontWeight: d.extra ? 700 : 400 }}>
                    {d.code}
                  </td>
                ))}
                <td />
                <td style={{ fontWeight: 600 }}>{s.hours}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {summary.length > 12 && <div className="sub">Podgląd pokazuje 12 osób i pierwszy tydzień; plik zawiera wszystkich i cały miesiąc.</div>}
      <div className="note">
        07-15 = zmiana od 7:00 do 15:00 · * = dodatkowa zmiana poza grafikiem · W = wolne · L4 / UW / NN = nieobecności. Godziny nocne liczone dla pory 22:00–6:00.
      </div>
      <button type="button" className="btn success" disabled={!summary.length} onClick={download}>
        Pobierz plik dla kadr
      </button>
    </Sheet>
  );
}
