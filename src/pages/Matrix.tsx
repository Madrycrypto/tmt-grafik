import { useMemo, useState } from 'react';
import { level } from '../domain/coverage';
import { BRIGADES, LEVEL_LABEL } from '../domain/types';
import { useApp } from '../data/AppContext';
import { Level, LineSelect, TypeTag, useLine } from '../ui';
import { t } from '../i18n';

export default function Matrix() {
  const { state, update } = useApp();
  const [lineId, setLineId] = useLine(state);
  const [brigade, setBrigade] = useState<string>('all');
  const [others, setOthers] = useState(false);
  const [query, setQuery] = useState('');

  const stations = useMemo(() => state.stations.filter((s) => s.lineId === lineId).sort((a, b) => a.order - b.order), [state, lineId]);
  const people = useMemo(
    () =>
      state.workers
        .filter((w) => w.active)
        .filter((w) => w.lineId === lineId || (others && stations.some((s) => level(w, s.id) > 0)))
        .filter((w) => brigade === 'all' || w.brigade === brigade)
        .filter((w) => !query || w.name.toLowerCase().includes(query.toLowerCase()))
        .sort((a, b) => a.brigade.localeCompare(b.brigade) || a.name.localeCompare(b.name)),
    [state, lineId, others, stations, brigade, query],
  );

  const setLevel = (workerId: string, stationId: string) => {
    const w = state.workers.find((x) => x.id === workerId)!;
    const next = (level(w, stationId) + 1) % 5;
    const st = state.stations.find((s) => s.id === stationId)!;
    update((d) => {
      const dw = d.workers.find((x) => x.id === workerId)!;
      if (next === 0) delete dw.skills[stationId];
      else dw.skills[stationId] = { ...dw.skills[stationId], level: next };
    }, `Matrix: ${w.name} — ${st.name}: poziom ${next}`);
  };

  const coverage = (stationId: string, minLevel: number) => {
    const present = BRIGADES.filter((b) => people.some((w) => w.brigade === b));
    const per = present.map((b) => people.filter((w) => w.brigade === b && level(w, stationId) >= minLevel).length);
    return brigade === 'all' ? per : [people.filter((w) => level(w, stationId) >= minLevel).length];
  };

  return (
    <>
      <div className="page-head">
        <div>
          <div className="sub">{t('Kliknij poziom, aby go zmienić (0 → 1 → 2 → 3 → 4)')}</div>
          <h1>{t('Matrix kompetencji')}</h1>
        </div>
        <div className="row">
          <LineSelect state={state} value={lineId} onChange={setLineId} />
          <label className="field">
            {t('Brygada')}
            <select value={brigade} onChange={(e) => setBrigade(e.target.value)}>
              <option value="all">{t('wszystkie')}</option>
              {BRIGADES.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            {t('Szukaj')}
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('nazwisko')} />
          </label>
        </div>
      </div>

      <section className="card">
        <div className="card-head">
          <div className="legend">
            {[1, 2, 3, 4].map((l) => (
              <span key={l} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Level value={l} /> {t(LEVEL_LABEL[l])}
              </span>
            ))}
          </div>
          <label className="sub" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={others} onChange={(e) => setOthers(e.target.checked)} />
            {t('pokaż osoby z innych linii z kwalifikacjami')}
          </label>
        </div>
        {stations.length === 0 ? (
          <div className="empty">{t('Ta linia nie ma stanowisk.')}</div>
        ) : (
          <div className="scroll-x">
            <table style={{ minWidth: 200 + stations.length * 88 }}>
              <thead>
                <tr>
                  <th className="sticky-col">{t('Pracownik')}</th>
                  {stations.map((s) => (
                    <th key={s.id} style={{ textAlign: 'center', whiteSpace: 'normal', minWidth: 90 }}>
                      {s.name}
                      <div style={{ fontWeight: 400 }}>{t('min.')} {s.minLevel}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {people.map((w) => (
                  <tr key={w.id}>
                    <td className="sticky-col">
                      <div style={{ fontWeight: 600 }}>{w.name}</div>
                      <TypeTag w={w} /> <span className="sub">{t('bryg.')} {w.brigade} · {state.patterns.find((p) => p.id === w.patternId)?.name.match(/\d+ h/)?.[0]}</span>
                      {w.lineId !== lineId && <span className="tag" style={{ marginLeft: 4 }}>{state.lines.find((l) => l.id === w.lineId)?.name}</span>}
                    </td>
                    {stations.map((s) => (
                      <td key={s.id} style={{ textAlign: 'center', background: w.homeStationId === s.id ? 'var(--accent-soft)' : undefined }}>
                        <Level value={level(w, s.id)} onClick={() => setLevel(w.id, s.id)} title={`${w.name} — ${s.name}: ${t('Poziom')} ${level(w, s.id)}`} />
                      </td>
                    ))}
                  </tr>
                ))}
                <tr style={{ background: '#f7f8fa' }}>
                  <td className="sticky-col" style={{ fontWeight: 700, background: '#f7f8fa' }}>
                    {t('Osoby z poz. ≥ min')}
                    <div className="sub" style={{ fontWeight: 400 }}>{brigade === 'all' ? `${BRIGADES.filter((b) => people.some((w) => w.brigade === b)).join(' · ')} (${t('cel: min. 2')})` : t('cel: min. 2')}</div>
                  </td>
                  {stations.map((s) => {
                    const c = coverage(s.id, s.minLevel);
                    return (
                      <td key={s.id} style={{ textAlign: 'center', fontWeight: 700, fontSize: 12 }}>
                        {c.map((n, i) => (
                          <span key={i} style={{ color: n < 2 ? 'var(--red-ink)' : 'var(--green-ink)', margin: '0 2px' }}>
                            {n}
                          </span>
                        ))}
                      </td>
                    );
                  })}
                </tr>
              </tbody>
            </table>
          </div>
        )}
        <div className="sub" style={{ marginTop: 8 }}>{t('Niebieskie tło = stanowisko macierzyste pracownika.')}</div>
      </section>
    </>
  );
}
