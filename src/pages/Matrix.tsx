import { toast } from '../toast';
import { useMemo, useState } from 'react';
import { level } from '../domain/coverage';
import { autoAssign } from '../domain/autoAssign';
import { BRIGADES, LEVEL_LABEL } from '../domain/types';
import { useApp } from '../data/AppContext';
import { useLabels } from '../data/labels';
import { Level, LevelPicker, LineSelect, TypeTag, useLine, usePersistent } from '../ui';
import { t } from '../i18n';
import { WorkerEditor } from './Pracownicy';
import { useTraining } from '../data/training';
import { missingCsv, missingRows } from '../domain/training';
import { downloadCsv } from './WorkerBulk';

export default function Matrix() {
  const lb = useLabels();
  const { state, update, undo, canEdit, backend } = useApp();
  const { records } = useTraining();
  // znacznik braku dokumentu pokazujemy tylko z bazą; w trybie demo nie ma skąd wziąć wpisów
  const docsOn = !!backend.client;
  const docSet = useMemo(() => new Set(records.map((r) => `${r.worker_id}|${r.station_id}|${r.level}`)), [records]);
  const missingDoc = (workerId: string, stationId: string, lv: number) => docsOn && [1, 2, 3, 4].some((l) => l <= lv && !docSet.has(`${workerId}|${stationId}|${l}`));
  const [lineId, setLineId] = useLine(state);
  const [brigade, setBrigade] = useState<string>('all');
  const [others, setOthers] = useState(false);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [view, setView] = usePersistent<'line' | 'group' | 'plant'>('matrix-view', 'line');

  const line = state.lines.find((l) => l.id === lineId);
  const viewLines = useMemo(() => {
    const ls = view === 'plant' ? state.lines : view === 'group' && line?.group ? state.lines.filter((l) => l.group === line.group) : state.lines.filter((l) => l.id === lineId);
    return [...ls].sort((a, b) => (a.group ?? '').localeCompare(b.group ?? '') || a.name.localeCompare(b.name));
  }, [state, view, line, lineId]);
  const lineStations = useMemo(() => state.stations.filter((s) => s.lineId === lineId).sort((a, b) => a.order - b.order), [state, lineId]);
  const stations = useMemo(
    () => viewLines.flatMap((l) => state.stations.filter((s) => s.lineId === l.id).sort((a, b) => a.order - b.order)),
    [state, viewLines],
  );
  const wide = viewLines.length > 1;
  const people = useMemo(
    () =>
      state.workers
        .filter((w) => w.active)
        .filter((w) => viewLines.some((l) => l.id === w.lineId) || (others && stations.some((s) => level(w, s.id) > 0)))
        .filter((w) => brigade === 'all' || w.brigade === brigade)
        .filter((w) => !query || w.name.toLowerCase().includes(query.toLowerCase()))
        .sort((a, b) => (wide ? (a.lineId ?? '').localeCompare(b.lineId ?? '') : 0) || a.brigade.localeCompare(b.brigade) || a.name.localeCompare(b.name)),
    [state, viewLines, others, stations, brigade, query, wide],
  );

  const setLevel = (workerId: string, stationId: string, next: number) => {
    const w = state.workers.find((x) => x.id === workerId)!;
    if (level(w, stationId) === next) return;
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

  const lineWorkers = state.workers.filter((w) => w.active && w.lineId === lineId);
  const misplaced = lineWorkers.filter((w) => {
    const home = lineStations.find((st) => st.id === w.homeStationId);
    return home && level(w, home.id) < home.minLevel && lineStations.some((st) => level(w, st.id) >= st.minLevel);
  });

  const fixHomes = () => {
    const changes: { id: string; name: string; to: string }[] = [];
    for (const b of BRIGADES) {
      const crew = lineWorkers.filter((w) => w.brigade === b);
      if (!crew.length) continue;
      for (const p of autoAssign(crew, lineStations)) {
        const w = crew.find((x) => x.id === p.workerId)!;
        if (!misplaced.includes(w) || !p.stationId) continue;
        changes.push({ id: w.id, name: w.name, to: p.stationId });
      }
    }
    if (!changes.length) return;
    const name = (id: string) => lineStations.find((st) => st.id === id)?.name ?? '?';
    update((d) => {
      for (const c of changes) d.workers.find((x) => x.id === c.id)!.homeStationId = c.to;
    }, 'Stanowiska macierzyste wg matrycy: ' + changes.map((c) => `${c.name} → ${name(c.to)}`).join('; '));
    toast(t('Zmieniono stanowisko macierzyste: {n} os.', { n: changes.length }), { undo });
  };

  return (
    <>
      {misplaced.length > 0 && (
        <div className="note amber row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <span>
            {t('{n} os. ma stanowisko macierzyste, na którym nie ma kwalifikacji:', { n: misplaced.length })}{' '}
            <b>{misplaced.map((w) => w.name).join(', ')}</b>
          </span>
          <button type="button" className="btn small primary" onClick={fixHomes}>
            {t('Ustaw macierzyste wg matrycy')}
          </button>
        </div>
      )}
      <div className="page-head">
        <div>
          <div className="sub">{t('Kliknij kółko i wybierz poziom z listy')}</div>
          <h1>{t('Matrix kompetencji')}</h1>
        </div>
        <div className="row">
          <label className="field">
            {t('Zakres')}
            <select value={view} onChange={(e) => setView(e.target.value as 'line' | 'group' | 'plant')}>
              <option value="line">{t('jedna linia')}</option>
              <option value="group" disabled={!line?.group}>{line?.group ? t('linia główna: {g}', { g: line.group }) : t('linia główna')}</option>
              <option value="plant">{lb.plant}</option>
            </select>
          </label>
          {view !== 'plant' && <LineSelect state={state} value={lineId} onChange={setLineId} />}
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
          {docsOn && (
            <button
              type="button"
              className="btn"
              title={t('Lista osób ze stopniem w Matrixie bez dokumentu szkolenia (dla widocznych osób)')}
              onClick={() => {
                const rows = missingRows(people, records, (id) => state.lines.find((l) => l.id === id)?.name ?? id, (id) => state.stations.find((s) => s.id === id)?.name ?? id);
                if (!rows.length) {
                  toast(t('Wszystkie widoczne osoby mają komplet dokumentów.'));
                  return;
                }
                downloadCsv(`braki-szkolen-${new Date().toISOString().slice(0, 10)}.csv`, missingCsv(rows));
              }}
            >
              ⬇ {t('Braki dokumentów (CSV)')}
            </button>
          )}
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
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span aria-hidden style={{ width: 22, height: 22, borderRadius: 4, background: 'var(--accent-soft)', border: '1px solid var(--line)' }} /> {t('stanowisko macierzyste')}
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Level value={2} min={3} /> {t('poniżej minimum stanowiska')}
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <b aria-hidden>★</b> {t('stanowisko specjalne')}
            </span>
            {docsOn && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <span aria-hidden style={{ width: 8, height: 8, borderRadius: 8, background: '#d9822b', display: 'inline-block' }} /> {t('brak dokumentu szkolenia')}
              </span>
            )}
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
                {wide && (
                  <tr>
                    <th className="sticky-col" />
                    {viewLines.map((l) => {
                      const n = stations.filter((s) => s.lineId === l.id).length;
                      return n ? (
                        <th key={l.id} colSpan={n} style={{ textAlign: 'center', borderLeft: '2px solid var(--line)', background: 'var(--accent-soft)' }}>
                          {l.group ? `${l.group} · ` : ''}
                          {l.name}
                        </th>
                      ) : null;
                    })}
                  </tr>
                )}
                <tr>
                  <th className="sticky-col">{t('Pracownik')}</th>
                  {stations.map((s) => (
                    <th key={s.id} style={{ textAlign: 'center', whiteSpace: 'normal', minWidth: 90 }}>
                      {s.name}{' '}
                      <button
                        type="button"
                        className={`star-btn ${s.special ? 'on' : ''}`}
                        disabled={!canEdit}
                        title={s.special ? t('Stanowisko specjalne ★ — kliknij, aby zdjąć') : t('Oznacz jako stanowisko specjalne ★')}
                        aria-pressed={!!s.special}
                        onClick={() => {
                          update((d) => {
                            const st = d.stations.find((x) => x.id === s.id)!;
                            if (st.special) delete st.special;
                            else st.special = true;
                          }, `Stanowisko ${s.name}: ${s.special ? 'zwykłe' : 'specjalne ★'}`);
                          toast(s.special ? t('{s}: zwykłe stanowisko', { s: s.name }) : t('{s}: stanowisko specjalne ★', { s: s.name }), { undo });
                        }}
                      >
                        {s.special ? '★' : '☆'}
                      </button>
                      <div style={{ fontWeight: 400 }}>{t('min.')} {s.minLevel}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {people.map((w) => (
                  <tr key={w.id}>
                    <td className="sticky-col">
                      <button type="button" className="link-btn" title={t('Otwórz kartę pracownika')} onClick={() => setOpen(w.id)}>
                        {w.name}
                      </button>
                      <TypeTag w={w} /> <span className="sub">{t('bryg.')} {w.brigade} · {state.patterns.find((p) => p.id === w.patternId)?.name.match(/\d+ h/)?.[0]}</span>
                      {(wide || w.lineId !== lineId) && <span className="tag" style={{ marginLeft: 4 }}>{state.lines.find((l) => l.id === w.lineId)?.name}</span>}
                    </td>
                    {stations.map((s) => (
                      <td key={s.id} style={{ textAlign: 'center', position: 'relative', background: w.homeStationId === s.id ? 'var(--accent-soft)' : undefined }}>
                        {missingDoc(w.id, s.id, level(w, s.id)) && (
                          <span title={t('Brak dokumentu szkolenia — otwórz kartę pracownika')} style={{ position: 'absolute', top: 6, right: '28%', width: 8, height: 8, borderRadius: 8, background: '#d9822b' }} />
                        )}
                        {canEdit ? (
                          <LevelPicker
                            value={level(w, s.id)}
                            min={s.minLevel}
                            onChange={(l) => setLevel(w.id, s.id, l)}
                            title={`${w.name} — ${s.name}: ${t('Poziom')} ${level(w, s.id)} (${t(LEVEL_LABEL[level(w, s.id)])})`}
                          />
                        ) : (
                          <Level value={level(w, s.id)} min={s.minLevel} title={`${w.name} — ${s.name}: ${t('Poziom')} ${level(w, s.id)}`} />
                        )}
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
        <div className="sub" style={{ marginTop: 8 }}>{t('Niebieskie tło = stanowisko macierzyste pracownika.')} {t('Kliknij kółko, aby wybrać poziom (albo wpisz cyfrę 0–4). Pomarańczowe = poniżej minimum stanowiska. ★ = stanowisko specjalne.')} {t('Kliknij nazwisko, aby otworzyć kartę pracownika.')}</div>
      </section>
      {open && <WorkerEditor workerId={open} onClose={() => setOpen(null)} />}
    </>
  );
}
