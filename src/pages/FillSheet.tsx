import { useMemo, useState } from 'react';
import { toast } from '../toast';
import { useApp } from '../data/AppContext';
import { setAssignment, stationName } from '../domain/actions';
import { fmtDate, fmtRange, todayIso } from '../domain/dates';
import { fillProposals } from '../domain/fill';
import type { Worker } from '../domain/types';
import { Sheet } from '../ui';
import { t } from '../i18n';

/** Propozycje dodatkowych zmian dla ludzi z niedoborem godzin (na liniach, gdzie są luki). */
export default function FillSheet({ month, workers, onClose }: { month: string; workers: Worker[]; onClose: () => void }) {
  const { state, update, undo, backend } = useApp();
  const today = todayIso();
  const { deficits, proposals } = useMemo(
    () => fillProposals(state, month, { workers, from: today }),
    [state, month, workers, today],
  );
  const key = (i: number) => `${proposals[i].worker.id}|${proposals[i].date}`;
  const [off, setOff] = useState<Set<string>>(new Set());
  const chosen = proposals.filter((_, i) => !off.has(key(i)));
  const lineName = (id: string) => state.lines.find((l) => l.id === id)?.name ?? '';

  const apply = () => {
    update(
      (d) => {
        for (const p of chosen) {
          setAssignment(d, { date: p.date, workerId: p.worker.id, lineId: p.lineId, stationId: p.stationId, extraShift: { start: p.start, hours: p.hours }, source: 'manual' });
        }
      },
      `Dopełnienie godzin (${month}): ` + chosen.map((p) => `${p.worker.name} ${p.date} ${lineName(p.lineId)}/${stationName(state, p.stationId)}`).join('; '),
    );
    if (backend.client) {
      const ws = [...new Map(chosen.map((p) => [p.worker.id, p.worker])).values()];
      const noApp = ws.filter((w) => !w.email);
      const msg = [
        ws.length > noApp.length ? t('Powiadomienie o zmianie dostanie: {n} (za ok. 10 s; Cofnij je wstrzymuje)', { n: ws.filter((w) => w.email).map((w) => w.name).join(', ') }) : '',
        noApp.length ? t('Bez aplikacji — powiedz osobiście: {n}', { n: noApp.map((w) => w.name).join(', ') }) : '',
      ].filter(Boolean).join('. ');
      toast(msg, { undo, tone: noApp.length ? 'warn' : 'ok', ms: 9000 });
    }
    onClose();
  };

  return (
    <Sheet title={t('Dopełnij godziny')} sub={t('Dodatkowe zmiany w dni wolne — tam, gdzie na innych liniach brakuje ludzi, a pracownik ma kwalifikacje (poziom ≥ min) i 11 h odpoczynku.')} onClose={onClose}>
      {deficits.length === 0 && <div className="note green">{t('Nikomu z tej grupy nie brakuje godzin w okresie rozliczeniowym.')}</div>}
      {deficits.map((d) => {
        const mine = proposals.map((p, i) => ({ p, i })).filter((x) => x.p.worker.id === d.worker.id);
        const covered = mine.filter((x) => !off.has(key(x.i))).reduce((h, x) => h + x.p.hours, 0);
        return (
          <div key={d.worker.id} className="stack" style={{ borderBottom: '1px solid var(--line)', paddingBottom: 10, marginBottom: 10 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <b>{d.worker.name}</b>
              <span className={`tag ${covered >= d.missing ? 'green' : 'red'}`}>
                {t('brakuje {h} h', { h: d.missing })}
                {covered ? ` · ${t('dopełnione {h} h', { h: covered })}` : ''}
              </span>
            </div>
            {mine.length === 0 && (
              <div className="sub">{t('Brak luk na stanowiskach, na których ma kwalifikacje, w jego dni wolne. Rozważ przeszkolenie (Matrix → cały zakład).')}</div>
            )}
            {mine.map(({ p, i }) => (
              <label key={key(i)} className="list-item" style={{ cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={!off.has(key(i))}
                  onChange={(e) => {
                    const n = new Set(off);
                    if (e.target.checked) n.delete(key(i));
                    else n.add(key(i));
                    setOff(n);
                  }}
                />
                <span style={{ width: 70, fontWeight: 600 }}>{fmtDate(p.date)}</span>
                <span className="grow">
                  {fmtRange(p.start, p.hours)} · {lineName(p.lineId)} / <b>{stationName(state, p.stationId)}</b>
                </span>
                <span className="tag">{t('poz.')} {p.worker.skills[p.stationId]?.level}</span>
              </label>
            ))}
          </div>
        );
      })}
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button type="button" className="btn" onClick={onClose}>{t('Anuluj')}</button>
        <button type="button" className="btn primary" disabled={!chosen.length} onClick={apply}>
          {t('Dodaj zaznaczone zmiany ({n})', { n: chosen.length })}
        </button>
      </div>
    </Sheet>
  );
}
