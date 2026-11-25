import { useMemo, useState } from 'react';
import { uid } from '../domain/actions';
import { plannedShift, absenceOn } from '../domain/coverage';
import { addDays, fmtDate, fmtRange, todayIso } from '../domain/dates';
import { BRIGADES, REASON_LABEL, TYPE_LABEL, canPair, linePatterns, patternBrigades } from '../domain/types';
import type { AbsenceReason, Worker, WorkerType } from '../domain/types';
import { workersCsv } from '../domain/workerImport';
import { useApp } from '../data/AppContext';
import { Icon, Sheet, TypeTag, LineOptions } from '../ui';
import { BulkButtons, ImportSheet, RemoveListSheet, downloadCsv } from './WorkerBulk';
import HrExportSheet from './HrExport';
import { inviteWorkers, printCards, revokeWorker, useAccounts } from './Invites';
import type { Account, InviteResult } from './Invites';
import { t } from '../i18n';

function emptyWorker(lineId: string, patternId: string): Worker {
  return { id: uid('w'), name: '', type: 'PL', patternId, brigade: 'A', lineId, homeStationId: null, active: true, skills: {} };
}

function newWorkerFor(state: Parameters<typeof linePatterns>[0], lineId: string): Worker {
  return emptyWorker(lineId, linePatterns(state, lineId)[0]?.id ?? state.patterns[0]?.id ?? '');
}

function WorkerForm({
  initial,
  onClose,
  account,
  onInvite,
  onRevoke,
}: {
  initial: Worker;
  onClose: () => void;
  account?: Account;
  onInvite?: (w: Worker) => void;
  onRevoke?: (w: Worker) => void;
}) {
  const { state, update } = useApp();
  const [w, setW] = useState<Worker>(initial);
  const isNew = !state.workers.some((x) => x.id === initial.id);
  const stations = state.stations.filter((s) => s.lineId === w.lineId);
  const set = <K extends keyof Worker>(k: K, v: Worker[K]) => setW({ ...w, [k]: v });
  const systems = linePatterns(state, w.lineId);
  const systemOptions = systems.some((p) => p.id === w.patternId) ? systems : [...systems, ...state.patterns.filter((p) => p.id === w.patternId)];
  const brigadeOptions = patternBrigades(state.patterns.find((p) => p.id === w.patternId));

  const save = () => {
    if (!w.name.trim()) return;
    const clean = { ...w, name: w.name.trim(), agency: w.type === 'AG' ? w.agency : undefined, email: w.email?.trim().toLowerCase() || undefined };
    update((d) => {
      const i = d.workers.findIndex((x) => x.id === w.id);
      if (i >= 0) d.workers[i] = clean;
      else d.workers.push(clean);
    }, `${isNew ? 'Dodano' : 'Zmieniono'} pracownika: ${clean.name}`);
    onClose();
  };

  const remove = () => {
    if (!confirm(t('Usunąć {name} razem z jego matrycą? Zamiast tego możesz oznaczyć go jako nieaktywnego.', { name: w.name }))) return;
    update((d) => {
      d.workers = d.workers.filter((x) => x.id !== w.id);
      d.assignments = d.assignments.filter((a) => a.workerId !== w.id);
      d.absences = d.absences.filter((a) => a.workerId !== w.id);
    }, `Usunięto pracownika: ${w.name}`);
    onClose();
  };

  return (
    <Sheet title={isNew ? t('Nowy pracownik') : w.name} onClose={onClose}>
      <label className="field">
        {t('Imię i nazwisko')}
        <input value={w.name} onChange={(e) => set('name', e.target.value)} autoFocus />
      </label>
      <div className="row">
        <label className="field grow">
          {t('Typ')}
          <select value={w.type} onChange={(e) => set('type', e.target.value as WorkerType)}>
            {Object.entries(TYPE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {t(v)}
              </option>
            ))}
          </select>
        </label>
        {w.type === 'AG' && (
          <label className="field grow">
            {t('Agencja')}
            <input value={w.agency ?? ''} onChange={(e) => set('agency', e.target.value)} />
          </label>
        )}
      </div>
      <div className="row">
        <label className="field grow">
          {t('System czasu pracy')}
          <select
            value={w.patternId}
            onChange={(e) => {
              const b = patternBrigades(state.patterns.find((p) => p.id === e.target.value));
              setW({ ...w, patternId: e.target.value, brigade: b.includes(w.brigade) ? w.brigade : b[0] });
            }}
          >
            {systemOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          {t('Brygada')}
          <select value={w.brigade} onChange={(e) => set('brigade', e.target.value as Worker['brigade'])}>
            {brigadeOptions.map((b) => (
              <option key={b}>{b}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="row">
        <label className="field grow">
          {t('Linia')}
          <select
            value={w.lineId}
            onChange={(e) => {
              const sys = linePatterns(state, e.target.value);
              const keep = sys.some((p) => p.id === w.patternId);
              const pid = keep ? w.patternId : (sys[0]?.id ?? w.patternId);
              const b = patternBrigades(state.patterns.find((p) => p.id === pid));
              setW({ ...w, lineId: e.target.value, homeStationId: null, patternId: pid, brigade: b.includes(w.brigade) ? w.brigade : b[0] });
            }}
          >
            <LineOptions state={state} />
          </select>
        </label>
        <label className="field grow">
          {t('Stanowisko macierzyste')}
          <select value={w.homeStationId ?? ''} onChange={(e) => set('homeStationId', e.target.value || null)}>
            <option value="">{t('rezerwa')}</option>
            {stations.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="row">
        <label className="field grow">
          {t('Długość zmiany')}
          <select value={w.shiftHours ?? ''} onChange={(e) => set('shiftHours', e.target.value ? Number(e.target.value) : undefined)}>
            <option value="">{t('wg systemu zmianowego')}</option>
            <option value={8}>8 h</option>
            <option value={12}>12 h</option>
          </select>
        </label>
        <label className="field grow">
          {t('E-mail (login do aplikacji)')}
          <input type="email" value={w.email ?? ''} onChange={(e) => set('email', e.target.value)} placeholder="jan.kowalski@gmail.com" />
        </label>
      </div>
      {w.homeStationId && stations.some((s) => canPair(state, w.homeStationId!, s.id)) && (
        <div className="field">
          {t('Stale obsługuje też')}
          <div className="row" style={{ gap: 12 }}>
            {stations.filter((s) => canPair(state, w.homeStationId!, s.id)).map((s) => (
              <label key={s.id} className="sub" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                <input
                  type="checkbox"
                  checked={!!w.alsoStationIds?.includes(s.id)}
                  onChange={(e) => {
                    const list = (w.alsoStationIds ?? []).filter((x) => x !== s.id);
                    if (e.target.checked) list.push(s.id);
                    set('alsoStationIds', list.length ? list : undefined);
                  }}
                />
                {s.name}
              </label>
            ))}
          </div>
        </div>
      )}
      {w.shiftHours && (
        <div className="sub">{t('12 h w systemie 8 h: zmiana poranna 07–19, popołudniowa 11–23, nocna 19–07. Pojedynczy dzień zmienisz w Obsadzie przyciskiem „→ 12 h”.')}</div>
      )}
      <label className="sub" style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
        <input type="checkbox" checked={w.active} onChange={(e) => set('active', e.target.checked)} />
        {t('aktywny (nieaktywni nie są planowani)')}
      </label>
      {!isNew && onInvite && (
        <div className="note stack" style={{ gap: 6 }}>
          <b>{t('Aplikacja na telefon')}</b>
          {account ? (
            account.code ? (
              <span>
                {t('Zaproszony')} ({account.email}) · {t('Kod aktywacyjny')}: <b style={{ fontFamily: 'monospace', letterSpacing: 2 }}>{account.code}</b>
              </span>
            ) : (
              <span>{t('Ma konto w aplikacji')} ({account.email})</span>
            )
          ) : (
            <span>{w.email ? t('Jeszcze nie zaproszony.') : t('Wpisz e-mail i zapisz, potem zaproś.')}</span>
          )}
          <div className="row">
            <button type="button" className="btn small primary" disabled={!initial.email || initial.email !== w.email?.trim().toLowerCase()} onClick={() => onInvite(initial)}>
              {account ? t('Nowy kod + kartka') : t('Zaproś + kartka')}
            </button>
            {account && onRevoke && (
              <button type="button" className="btn small" onClick={() => confirm(t('Odebrać dostęp {email}?', { email: account.email })) && onRevoke(initial)}>
                {t('Odbierz dostęp')}
              </button>
            )}
          </div>
        </div>
      )}
      {!isNew && (
        <a className="btn small" href={`#/podglad/${initial.id}`}>
          {t('Podgląd aplikacji pracownika')}
        </a>
      )}
      {!isNew && <WorkerAbsences worker={w} />}
      <div className="row">
        <button type="button" className="btn primary grow" onClick={save} disabled={!w.name.trim()}>
          {t('Zapisz')}
        </button>
        {!isNew && (
          <button type="button" className="btn" onClick={remove}>
            {t('Usuń')}
          </button>
        )}
      </div>
    </Sheet>
  );
}

function WorkerAbsences({ worker }: { worker: Worker }) {
  const { state, update } = useApp();
  const [from, setFrom] = useState(todayIso());
  const [to, setTo] = useState(todayIso());
  const [reason, setReason] = useState<AbsenceReason>('UW');
  const list = state.absences.filter((a) => a.workerId === worker.id).sort((a, b) => b.from.localeCompare(a.from));
  const next = Array.from({ length: 7 }, (_, i) => addDays(todayIso(), i));

  return (
    <div className="stack">
      <h3>{t('Najbliższe 7 dni')}</h3>
      <div className="row" style={{ gap: 6 }}>
        {next.map((d) => {
          const s = plannedShift(state, worker, d);
          const ab = absenceOn(state, worker.id, d);
          return (
            <span key={d} className={`tag ${ab ? 'red' : s ? 'green' : ''}`} style={{ padding: '6px 8px' }}>
              {fmtDate(d)}: {ab ? ab.reason : s ? fmtRange(s.start, s.end - s.start) : t('wolne')}
            </span>
          );
        })}
      </div>
      <h3>{t('Nieobecności (urlop, L4)')}</h3>
      <div className="row">
        <label className="field">
          {t('Od')}
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="field">
          {t('Do')}
          <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
        </label>
        <label className="field">
          {t('Powód')}
          <select value={reason} onChange={(e) => setReason(e.target.value as AbsenceReason)}>
            {Object.entries(REASON_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {t(v)}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="btn"
          disabled={!from || !to || to < from}
          onClick={() =>
            update((d) => {
              d.absences.push({ id: uid('ab'), workerId: worker.id, from, to, reason });
            }, `Nieobecność: ${worker.name} ${from}–${to} (${reason})`)
          }
        >
          {t('Dodaj')}
        </button>
      </div>
      {list.slice(0, 8).map((a) => (
        <div key={a.id} className="list-item">
          <span className="grow">
            {a.from === a.to ? a.from : `${a.from} – ${a.to}`} · {t(REASON_LABEL[a.reason])}
          </span>
          <button
            type="button"
            className="btn small"
            onClick={() =>
              update((d) => {
                d.absences = d.absences.filter((x) => x.id !== a.id);
              }, `Usunięto nieobecność: ${worker.name} ${a.from}`)
            }
          >
            {t('Usuń')}
          </button>
        </div>
      ))}
    </div>
  );
}

/** Karta pracownika do otwarcia z innych ekranów (Matrix, Obsada). */
export function WorkerEditor({ workerId, onClose }: { workerId: string; onClose: () => void }) {
  const { state, backend } = useApp();
  const acc = useAccounts();
  const worker = state.workers.find((w) => w.id === workerId);
  if (!worker) return null;
  return (
    <WorkerForm
      initial={worker}
      account={acc.accounts.get(worker.id)}
      onInvite={
        acc.enabled && backend.client
          ? (w) =>
              void inviteWorkers(backend.client!, [w]).then((r) => {
                void acc.reload();
                if (r.invited.length) printCards(state, r.invited);
              })
          : undefined
      }
      onRevoke={acc.enabled && backend.client ? (w) => void revokeWorker(backend.client!, w.id).then(() => acc.reload()) : undefined}
      onClose={onClose}
    />
  );
}

export default function Pracownicy() {
  const { state, update } = useApp();
  const [editing, setEditing] = useState<Worker | null>(null);
  const [query, setQuery] = useState('');
  const [line, setLine] = useState('all');
  const [type, setType] = useState('all');
  const [brig, setBrig] = useState('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sheet, setSheet] = useState<'import' | 'remove' | 'hr' | null>(null);
  const { backend } = useApp();
  const acc = useAccounts();
  const [inviteInfo, setInviteInfo] = useState<string | null>(null);

  const invite = async (ws: Worker[]) => {
    if (!backend.client) return;
    setInviteInfo(null);
    try {
      const r: InviteResult = await inviteWorkers(backend.client, ws);
      await acc.reload();
      if (r.invited.length) printCards(state, r.invited);
      setInviteInfo(
        t('Zaproszono: {n}.', { n: r.invited.length }) +
          (r.skipped.length ? ' ' + t('Pominięto: {list}', { list: r.skipped.map((s) => `${s.worker.name} (${s.reason})`).join(', ') }) : ''),
      );
    } catch (e) {
      setInviteInfo(e instanceof Error ? e.message : String(e));
    }
  };

  const reprint = () => {
    const rows = state.workers
      .map((w) => ({ w, a: acc.accounts.get(w.id) }))
      .filter((x): x is { w: Worker; a: Account } => !!x.a?.code && (!x.a.expires || new Date(x.a.expires) > new Date()))
      .filter((x) => selected.size === 0 || selected.has(x.w.id))
      .map((x) => ({ worker: x.w, email: x.a.email, code: x.a.code! }));
    if (!rows.length) return setInviteInfo(t('Brak ważnych kodów do wydruku. Zaproś pracowników albo wygeneruj nowe kody.'));
    printCards(state, rows);
  };

  const list = useMemo(
    () =>
      state.workers
        .filter((w) => (line === 'all' || w.lineId === line) && (type === 'all' || w.type === type) && (brig === 'all' || w.brigade === brig))
        .filter((w) => !query || w.name.toLowerCase().includes(query.toLowerCase()))
        .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name)),
    [state, query, line, type, brig],
  );
  const chosen = state.workers.filter((w) => selected.has(w.id));
  const allVisible = list.length > 0 && list.every((w) => selected.has(w.id));

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };
  const toggleAll = () => setSelected(allVisible ? new Set() : new Set([...selected, ...list.map((w) => w.id)]));

  const bulkSet = (patch: Partial<Worker>, text: string) => {
    const ids = new Set(selected);
    update((d) => {
      for (const w of d.workers) {
        if (!ids.has(w.id)) continue;
        if (patch.lineId && patch.lineId !== w.lineId) w.homeStationId = null;
        Object.assign(w, patch);
      }
    }, `${text} (${ids.size} os.)`);
  };

  return (
    <>
      <div className="page-head">
        <div>
          <div className="sub">{t('{a} aktywnych · {n} łącznie', { a: state.workers.filter((w) => w.active).length, n: state.workers.length })}</div>
          <h1>{t('Pracownicy')}</h1>
        </div>
        <div className="row">
          <button
            type="button"
            className="btn primary"
            disabled={!state.lines.length}
            onClick={() => setEditing(newWorkerFor(state, line !== 'all' ? line : state.lines[0].id))}
          >
            <span style={{ width: 18, height: 18, display: 'inline-flex' }}>
              <Icon name="plus" />
            </span>
            {t('Dodaj')}
          </button>
          <button type="button" className="btn" onClick={() => setSheet('import')}>
            {t('Import listy')}
          </button>
          <button type="button" className="btn" onClick={() => downloadCsv(`pracownicy-${todayIso()}.csv`, workersCsv(state, list))}>
            {t('Eksport')} ({list.length})
          </button>
          <button type="button" className="btn" onClick={() => setSheet('remove')}>
            {t('Usuń listą')}
          </button>
          <button type="button" className="btn" onClick={() => setSheet('hr')}>
            {t('Eksport dla kadr')}
          </button>
          {acc.enabled && (
            <button type="button" className="btn" onClick={reprint}>
              {t('Kartki z kodami')}
            </button>
          )}
        </div>
      </div>

      <section className="card">
        <div className="row" style={{ marginBottom: 8 }}>
          <label className="field grow" style={{ minWidth: 160 }}>
            {t('Szukaj')}
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('nazwisko')} />
          </label>
          <label className="field">
            {t('Linia')}
            <select value={line} onChange={(e) => setLine(e.target.value)}>
              <option value="all">{t('wszystkie')}</option>
              <LineOptions state={state} />
            </select>
          </label>
          <label className="field">
            {t('Brygada')}
            <select value={brig} onChange={(e) => setBrig(e.target.value)}>
              <option value="all">{t('wszystkie')}</option>
              {BRIGADES.map((b) => (
                <option key={b}>{b}</option>
              ))}
            </select>
          </label>
          <label className="field">
            {t('Typ')}
            <select value={type} onChange={(e) => setType(e.target.value)}>
              <option value="all">{t('wszyscy')}</option>
              {Object.entries(TYPE_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {t(v)}
                </option>
              ))}
            </select>
          </label>
        </div>

        {inviteInfo && <div className="note" style={{ marginBottom: 8 }}>{inviteInfo}</div>}
        {selected.size > 0 && (
          <div className="note" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 8, background: 'var(--accent-soft)' }}>
            <b style={{ color: 'var(--accent)' }}>{t('Zaznaczono')}: {selected.size}</b>
            <select className="input" aria-label={t('Zmień brygadę zaznaczonym')} value="" onChange={(e) => e.target.value && bulkSet({ brigade: e.target.value as Worker['brigade'] }, `Zmiana brygady na ${e.target.value}`)}>
              <option value="">{t('Brygada →')}</option>
              {BRIGADES.map((b) => (
                <option key={b}>{b}</option>
              ))}
            </select>
            <select className="input" aria-label={t('Przenieś zaznaczonych na linię')} value="" onChange={(e) => e.target.value && bulkSet({ lineId: e.target.value }, `Przeniesienie na ${state.lines.find((l) => l.id === e.target.value)?.name}`)}>
              <option value="">{t('Linia →')}</option>
              <LineOptions state={state} />
            </select>
            <button type="button" className="btn small" onClick={() => bulkSet({ active: true }, 'Aktywowano')}>
              {t('Aktywuj')}
            </button>
            {acc.enabled && (
              <button type="button" className="btn small primary" onClick={() => void invite(chosen)}>
                {t('Zaproś do aplikacji')} ({chosen.filter((w) => w.email).length})
              </button>
            )}
            <BulkButtons small workers={chosen} update={update} onDone={() => setSelected(new Set())} />
            <button type="button" className="btn small ghost" onClick={() => setSelected(new Set())}>
              {t('Odznacz')}
            </button>
          </div>
        )}

        {list.length === 0 ? (
          <div className="empty">{t('Brak pracowników. Dodaj ręcznie albo zaimportuj listę z Excela.')}</div>
        ) : (
          <label className="list-item sub" style={{ cursor: 'pointer' }}>
            <input type="checkbox" checked={allVisible} onChange={toggleAll} style={{ width: 20, height: 20 }} />
            {t('zaznacz wszystkich widocznych')} ({list.length})
          </label>
        )}
        {list.map((w) => (
          <div key={w.id} className="list-item" style={{ opacity: w.active ? 1 : 0.55, flexWrap: 'nowrap' }}>
            <input type="checkbox" aria-label={`Zaznacz ${w.name}`} checked={selected.has(w.id)} onChange={() => toggle(w.id)} style={{ width: 20, height: 20, flex: '0 0 20px' }} />
            <button type="button" onClick={() => setEditing(w)} style={{ flex: 1, minWidth: 0, background: 'none', border: 0, textAlign: 'left', cursor: 'pointer', padding: 0 }}>
              <b>{w.name}</b> <TypeTag w={w} /> {!w.active && <span className="tag">{t('nieaktywny')}</span>}
              <div className="sub">
                {state.lines.find((l) => l.id === w.lineId)?.name} · {state.stations.find((s) => s.id === w.homeStationId)?.name ?? t('rezerwa')} ·{' '}
                {state.patterns.find((p) => p.id === w.patternId)?.name.match(/\d+ h/)?.[0]}
              </div>
            </button>
            {acc.push.has(w.id) && (
              <span className="tag green" title={t('Powiadomienia włączone ✓')}>
                📱
              </span>
            )}
            {acc.enabled && w.email && !acc.accounts.has(w.id) && <span className="tag">{t('bez konta')}</span>}
            {acc.accounts.get(w.id)?.code && <span className="tag amber">{t('kod')}: {acc.accounts.get(w.id)!.code}</span>}
            {acc.accounts.has(w.id) && !acc.accounts.get(w.id)!.code && <span className="tag blue">{t('aplikacja')}</span>}
            <span className="tag">{t('Bryg.')} {w.brigade}</span>
          </div>
        ))}
      </section>
      {editing && (
        <WorkerForm
          initial={editing}
          account={acc.accounts.get(editing.id)}
          onInvite={acc.enabled ? (w) => void invite([w]) : undefined}
          onRevoke={
            acc.enabled && backend.client
              ? (w) => void revokeWorker(backend.client!, w.id).then(() => acc.reload())
              : undefined
          }
          onClose={() => setEditing(null)}
        />
      )}
      {sheet === 'import' && <ImportSheet onClose={() => setSheet(null)} />}
      {sheet === 'remove' && <RemoveListSheet onClose={() => setSheet(null)} />}
      {sheet === 'hr' && <HrExportSheet onClose={() => setSheet(null)} />}
    </>
  );
}
