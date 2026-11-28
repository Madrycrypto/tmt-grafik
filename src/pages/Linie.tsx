import { toast } from '../toast';
import { useState } from 'react';
import { uid } from '../domain/actions';
import { patternBrigades } from '../domain/types';
import { canPair } from '../domain/types';
import type { Station } from '../domain/types';
import { useApp } from '../data/AppContext';
import { t } from '../i18n';
import { usePersistent } from '../ui';

export default function Linie() {
  const { state, update } = useApp();
  const [newLine, setNewLine] = useState('');

  const addLine = () => {
    const name = newLine.trim();
    if (!name) return;
    update((d) => {
      d.lines.push({ id: uid('l'), name });
    }, `Dodano linię: ${name}`);
    setNewLine('');
  };

  // state.lines jest już w kolejności z pola „Kolejność”
  const groups = state.lines
    .reduce<[string, typeof state.lines][]>((acc, l) => {
      // linia główna bez grupy (np. Injection) ma własny nagłówek zamiast „Pozostałe linie”
      const g = l.group ?? `~${l.id}`;
      const hit = acc.find((x) => x[0] === g);
      if (hit) hit[1].push(l);
      else acc.push([g, [l]]);
      return acc;
    }, []);
  const [open, setOpen] = usePersistent('linie-open', groups[0]?.[0] ?? '');

  return (
    <>
      <div className="page-head">
        <div>
          <div className="sub">{t('Aplikacja jest uniwersalna: dodaj dowolne linie i stanowiska')}</div>
          <h1>{t('Linie i stanowiska')}</h1>
        </div>
        <div className="row">
          <label className="field">
            {t('Nowa linia')}
            <input value={newLine} onChange={(e) => setNewLine(e.target.value)} placeholder={t('np. CFM 2')} onKeyDown={(e) => e.key === 'Enter' && addLine()} />
          </label>
          <button type="button" className="btn primary" disabled={!newLine.trim()} onClick={addLine}>
            {t('Dodaj linię')}
          </button>
        </div>
      </div>
      {state.lines.length > 0 && groups.length > 1 && <div className="sub">{t('Kliknij grupę, aby ją rozwinąć — pozostałe się zwiną.')}</div>}
      {state.lines.length === 0 && <div className="card empty">{t('Brak linii. Dodaj pierwszą powyżej.')}</div>}
      {groups.map(([g, lines]) => {
        const isOpen = open === g || groups.length === 1;
        const people = state.workers.filter((w) => w.active && lines.some((l) => l.id === w.lineId)).length;
        return (
          <section key={g} className="stack">
            <button type="button" className="group-head" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? '' : g)}>
              <span className="chev">{isOpen ? '▾' : '▸'}</span>
              <h2>{g.startsWith('~') ? lines[0].name : g}</h2>
              <span className="sub">
                {g.startsWith('~') ? '' : `${lines.map((l) => l.name).join(', ')} · `}{people} {t('os.')}
              </span>
            </button>
            {isOpen && lines.map((l) => <LineCard key={l.id} lineId={l.id} />)}
          </section>
        );
      })}
    </>
  );
}

function LineCard({ lineId }: { lineId: string }) {
  const { state, update, undo } = useApp();
  const line = state.lines.find((l) => l.id === lineId)!;
  const stations = state.stations.filter((s) => s.lineId === lineId).sort((a, b) => a.order - b.order);
  const [name, setName] = useState('');
  const crew = state.workers.filter((w) => w.lineId === lineId && w.active).length;

  const patch = (id: string, p: Partial<Station>) =>
    update((d) => {
      const s = d.stations.find((x) => x.id === id);
      if (s) Object.assign(s, p);
    });

  const pair = (a: string, b: string, on: boolean) => {
    const na = stations.find((x) => x.id === a)?.name;
    const nb = stations.find((x) => x.id === b)?.name;
    update((d) => {
      for (const st of d.stations) {
        if (st.id !== a && st.id !== b) continue;
        const other = st.id === a ? b : a;
        const list = (st.pairWith ?? []).filter((x) => x !== other);
        if (on && st.id === a) list.push(other);
        st.pairWith = list.length ? list : undefined;
      }
    }, on ? `Stanowiska łączone: ${na} + ${nb}` : `Koniec łączenia: ${na} + ${nb}`);
  };

  const addStation = () => {
    const n = name.trim();
    if (!n) return;
    update((d) => {
      d.stations.push({ id: uid('s'), lineId, name: n, required: 1, minLevel: 3, order: stations.length });
    }, `${line.name}: dodano stanowisko ${n}`);
    setName('');
  };

  const removeStation = (s: Station) => {
    update((d) => {
      d.stations = d.stations.filter((x) => x.id !== s.id);
      for (const w of d.workers) {
        if (w.homeStationId === s.id) w.homeStationId = null;
        if (w.alsoStationIds) w.alsoStationIds = w.alsoStationIds.filter((x) => x !== s.id);
        delete w.skills[s.id];
      }
      d.assignments = d.assignments.filter((a) => a.stationId !== s.id);
      for (const a of d.assignments) if (a.alsoStationIds) a.alsoStationIds = a.alsoStationIds.filter((x) => x !== s.id);
      for (const o of d.stations) if (o.pairWith) o.pairWith = o.pairWith.filter((x) => x !== s.id);
    }, `${line.name}: usunięto stanowisko ${s.name}`);
  };

  const move = (s: Station, dir: -1 | 1) => {
    const other = stations[stations.indexOf(s) + dir];
    if (!other) return;
    update((d) => {
      const a = d.stations.find((x) => x.id === s.id)!;
      const b = d.stations.find((x) => x.id === other.id)!;
      [a.order, b.order] = [b.order, a.order];
    });
  };

  const switchSystem = (patternId: string) => {
    const p = state.patterns.find((x) => x.id === patternId);
    if (!p) return;
    const brig = patternBrigades(p);
    const chosen = line.patternIds?.length ? line.patternIds : [patternId];
    const who = state.workers.filter((w) => w.lineId === lineId && w.active && !chosen.includes(w.patternId));
    const moved = who.filter((w) => !brig.includes(w.brigade));
    const msg = moved.length
      ? ' ' + t('{n} os. jest w brygadach, których ten system nie ma ({list}) — trafią do brygady {b}.', { n: moved.length, list: [...new Set(moved.map((w) => w.brigade))].join(', '), b: brig[0] })
      : '';
    const ids = new Set(who.map((w) => w.id));
    update((d) => {
      for (const w of d.workers) {
        if (!ids.has(w.id)) continue;
        w.patternId = patternId;
        if (!brig.includes(w.brigade)) w.brigade = brig[0];
      }
    }, `${line.name}: ${who.length} os. przeniesiono do systemu ${p.name}`);
    toast(t('Przeniesiono {n} os. do systemu „{s}”.', { n: who.length, s: p.name }) + msg, { undo });
  };

  const removeLine = () => {
    if (crew > 0) return toast(t('Na linii jest {n} aktywnych pracowników. Najpierw przenieś ich na inną linię.', { n: crew }), { tone: 'warn' });
    update((d) => {
      d.lines = d.lines.filter((x) => x.id !== lineId);
      d.stations = d.stations.filter((x) => x.lineId !== lineId);
    }, `Usunięto linię ${line.name}`);
    toast(t('Usunięto linię {name}', { name: line.name }), { undo });
  };

  return (
    <section className="card">
      <div className="card-head">
        <div className="row" style={{ alignItems: 'center' }}>
          <input
            className="input"
            style={{ fontWeight: 700, fontSize: 16, width: 200 }}
            aria-label={t('Nazwa linii')}
            defaultValue={line.name}
            onBlur={(e) =>
              e.target.value.trim() &&
              e.target.value.trim() !== line.name &&
              update((d) => {
                d.lines.find((x) => x.id === lineId)!.name = e.target.value.trim();
              }, `Zmiana nazwy linii: ${line.name} → ${e.target.value.trim()}`)
            }
          />
          <input
            className="input"
            style={{ width: 140 }}
            aria-label={t('Linia główna')}
            placeholder={t('Linia główna')}
            defaultValue={line.group ?? ''}
            onBlur={(e) => {
              const g = e.target.value.trim();
              if (g === (line.group ?? '')) return;
              update((d) => {
                d.lines.find((x) => x.id === lineId)!.group = g || undefined;
              }, `${line.name}: ${t('Linia główna')} → ${g || '—'}`);
            }}
          />
          <input
            className="input"
            type="number"
            min={1}
            style={{ width: 90 }}
            aria-label={t('Kolejność')}
            placeholder={t('Kolejność')}
            title={t('Kolejność wyświetlania: 1, 2, 3… Grupa idzie wg najmniejszej liczby swoich linii.')}
            defaultValue={line.order ?? ''}
            onBlur={(e) => {
              const n = e.target.value.trim() === '' ? undefined : Math.max(1, Math.round(Number(e.target.value)));
              if (n === line.order || (n !== undefined && Number.isNaN(n))) return;
              update((d) => {
                d.lines.find((x) => x.id === lineId)!.order = n;
              }, `${line.name}: ${t('Kolejność')} → ${n ?? '—'}`);
            }}
          />
          <span className="sub">{t('{n} pracowników', { n: crew })}</span>
        </div>
        <button type="button" className="btn small" onClick={removeLine}>
          {t('Usuń linię')}
        </button>
      </div>
      <div className="stack" style={{ marginBottom: 12 }}>
        <div className="sub">{t('System zmianowy linii (można zaznaczyć kilka, np. 8 h i 12 h na tej samej linii):')}</div>
        <div className="row">
          {state.patterns.map((p) => {
            const on = !line.patternIds?.length || line.patternIds.includes(p.id);
            return (
              <label key={p.id} className={`tag ${on ? 'blue' : ''}`} style={{ display: 'inline-flex', gap: 6, alignItems: 'center', padding: '6px 10px', fontSize: 12 }}>
                <input
                  type="checkbox"
                  checked={on}
                  onChange={(e) =>
                    update((d) => {
                      const l = d.lines.find((x) => x.id === lineId)!;
                      const cur = l.patternIds?.length ? l.patternIds : d.patterns.map((x) => x.id);
                      l.patternIds = e.target.checked ? [...new Set([...cur, p.id])] : cur.filter((x) => x !== p.id);
                    }, `${line.name}: ${e.target.checked ? 'dodano' : 'usunięto'} system ${p.name}`)
                  }
                />
                {p.name}
                {(() => {
                  const n = state.workers.filter((w) => w.lineId === lineId && w.active && w.patternId === p.id).length;
                  return n ? <b>· {n} {t('os.')}</b> : null;
                })()}
              </label>
            );
          })}
        </div>
        {(() => {
          const chosen = state.patterns.filter((p) => line.patternIds?.includes(p.id));
          const outside = state.workers.filter((w) => w.lineId === lineId && w.active && chosen.length > 0 && !chosen.some((p) => p.id === w.patternId));
          if (!outside.length) return null;
          return (
            <div className="note amber row" style={{ alignItems: 'center', gap: 8 }}>
              <span>
                {t('{n} os. tej linii pracuje w systemie, którego nie zaznaczono.', { n: outside.length })}
              </span>
              {chosen.map((p) => (
                <button key={p.id} type="button" className="btn small primary" onClick={() => switchSystem(p.id)}>
                  {t('Przenieś do: {s}', { s: p.name })}
                </button>
              ))}
            </div>
          );
        })()}
        <span className="sub">{t('Nowy system (np. 2 zmiany 06–14 / 14–22) dodasz w Ustawienia → Systemy zmianowe.')}</span>
      </div>
      <div className="scroll-x">
        <table className="tbl-cards" style={{ minWidth: 560 }}>
          <thead>
            <tr>
              <th>{t('Stanowisko')}</th>
              <th style={{ width: 120 }}>{t('Ludzi na godz.')}</th>
              <th style={{ width: 150 }}>{t('Min. poziom')}</th>
              <th title={t('Jedna osoba może obsłużyć oba stanowiska naraz')}>{t('Łączy z')}</th>
              <th style={{ width: 170 }} />
            </tr>
          </thead>
          <tbody>
            {stations.map((s, i) => (
              <tr key={s.id}>
                <td className="full" style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                  <button
                    type="button"
                    className={`star-btn ${s.special ? 'on' : ''}`}
                    title={s.special ? t('Stanowisko specjalne ★ — kliknij, aby zdjąć') : t('Oznacz jako stanowisko specjalne ★')}
                    aria-pressed={!!s.special}
                    onClick={() => patch(s.id, { special: !s.special || undefined })}
                  >
                    {s.special ? '★' : '☆'}
                  </button>
                  <input className="input" style={{ width: '100%' }} aria-label={t('Nazwa stanowiska')} defaultValue={s.name} onBlur={(e) => e.target.value.trim() && e.target.value !== s.name && patch(s.id, { name: e.target.value.trim() })} />
                </td>
                <td data-l={t('Ludzi na godz.')}>
                  <input className="input" type="number" min={1} max={20} style={{ width: 80 }} aria-label={t('Wymagana liczba osób')} value={s.required} onChange={(e) => patch(s.id, { required: Math.max(1, Number(e.target.value) || 1) })} />
                </td>
                <td data-l={t('Min. poziom')}>
                  <select className="input" aria-label={t('Minimalny poziom')} value={s.minLevel} onChange={(e) => patch(s.id, { minLevel: Number(e.target.value) })}>
                    {[1, 2, 3, 4].map((l) => (
                      <option key={l} value={l}>
                        {l}
                        {l === 3 ? ` (${t('standard')})` : ''}
                      </option>
                    ))}
                  </select>
                </td>
                <td data-l={t('Łączy z')}>
                  <div className="row" style={{ gap: 4, alignItems: 'center' }}>
                    {stations.filter((o) => canPair(state, s.id, o.id)).map((o) => (
                      <span key={o.id} className="tag">
                        {o.name}{' '}
                        <button type="button" className="btn small ghost" style={{ padding: '0 4px' }} aria-label={t('Usuń łączenie z {n}', { n: o.name })} onClick={() => pair(s.id, o.id, false)}>×</button>
                      </span>
                    ))}
                    <select className="input" aria-label={t('Dodaj stanowisko łączone')} value="" onChange={(e) => e.target.value && pair(s.id, e.target.value, true)}>
                      <option value="">+</option>
                      {stations.filter((o) => o.id !== s.id && !canPair(state, s.id, o.id)).map((o) => (
                        <option key={o.id} value={o.id}>{o.name}</option>
                      ))}
                    </select>
                  </div>
                </td>
                <td className="full" style={{ whiteSpace: 'nowrap' }}>
                  <button type="button" className="btn small ghost" aria-label={t('W górę')} disabled={i === 0} onClick={() => move(s, -1)}>↑</button>
                  <button type="button" className="btn small ghost" aria-label={t('W dół')} disabled={i === stations.length - 1} onClick={() => move(s, 1)}>↓</button>
                  <button type="button" className="btn small" onClick={() => removeStation(s)}>{t('Usuń')}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        <input className="input grow" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('Nowe stanowisko')} aria-label={t('Nowe stanowisko')} onKeyDown={(e) => e.key === 'Enter' && addStation()} />
        <button type="button" className="btn" disabled={!name.trim()} onClick={addStation}>
          {t('Dodaj stanowisko')}
        </button>
      </div>
    </section>
  );
}
