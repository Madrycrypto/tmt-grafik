import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useApp } from '../data/AppContext';
import { deleteMessage, sendMessage, useMessages, usePhones } from '../data/messages';
import { todayIso, addDays } from '../domain/dates';
import { ackStatus, audienceLabel, recipients, shiftOptions, shiftRange } from '../domain/messages';
import type { Audience, Message, MessageRead } from '../domain/messages';
import { BRIGADES } from '../domain/types';
import type { BrigadeId } from '../domain/types';
import { toast } from '../toast';
import { t } from '../i18n';

type Kind = Audience['kind'];
const KINDS: [Kind, string][] = [
  ['workers', 'Wybrane osoby'],
  ['shift', 'Zmiana'],
  ['line', 'Linia / brygada'],
  ['group', 'Grupa'],
  ['all', 'Wszyscy'],
];

/** Wiadomości od przełożonego: wysyłka z powiadomieniem na telefon i kto już potwierdził odbiór. */
export default function Wiadomosci() {
  const { state, backend, canEdit } = useApp();
  const [params] = useSearchParams();
  const preset = params.get('do');
  const phones = usePhones();
  const { messages, reads, loading, error } = useMessages(100);

  const groups = useMemo(() => [...new Set(state.lines.map((l) => l.group || l.name))].sort(), [state.lines]);
  const [kind, setKind] = useState<Kind>(preset ? 'workers' : 'shift');
  const [ids, setIds] = useState<string[]>(preset ? [preset] : []);
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState(groups[0] ?? '');
  const [lineId, setLineId] = useState(state.lines[0]?.id ?? '');
  const [brigade, setBrigade] = useState<BrigadeId | ''>('');
  const [date, setDate] = useState(todayIso());
  const [shiftLine, setShiftLine] = useState('');
  const opts = shiftOptions(state, date, shiftLine || undefined);
  const [startSel, setStartSel] = useState<number | null>(null);
  const start = opts.find((o) => o.start === startSel)?.start ?? opts[0]?.start;

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [important, setImportant] = useState(false);
  const [busy, setBusy] = useState(false);

  const aud: Audience | null =
    kind === 'all'
      ? { kind }
      : kind === 'group'
        ? { kind, group }
        : kind === 'line'
          ? { kind, lineId, ...(brigade ? { brigade } : {}) }
          : kind === 'shift'
            ? start === undefined
              ? null
              : { kind, date, start, ...(shiftLine ? { lineId: shiftLine } : {}) }
            : { kind, ids };
  const who = aud ? recipients(state, aud) : [];
  const withPhone = who.filter((w) => phones.has(w.id)).length;

  const send = async () => {
    if (!backend.client || !aud || !who.length || !body.trim()) return;
    setBusy(true);
    try {
      const r = await sendMessage(backend.client, {
        title: title.trim(),
        body: body.trim(),
        audience: audienceLabel(state, aud),
        workerIds: who.map((w) => w.id),
        important,
      });
      toast(t('Wysłano do {n} osób · na telefon: {p}', { n: r.recipients, p: r.phones }), { tone: 'ok' });
      setBody('');
      setTitle('');
      setImportant(false);
    } catch (e) {
      toast(t('Nie wysłano: {e}', { e: e instanceof Error ? e.message : String(e) }), { tone: 'warn', ms: 8000 });
    } finally {
      setBusy(false);
    }
  };

  const found = query.trim()
    ? state.workers.filter((w) => w.active && w.name.toLowerCase().includes(query.trim().toLowerCase()) && !ids.includes(w.id)).slice(0, 8)
    : [];
  const name = (id: string) => state.workers.find((w) => w.id === id)?.name ?? '?';

  return (
    <>
      <div className="page-head">
        <div>
          <div className="sub">{t('Komunikat trafia na telefon pracownika jako powiadomienie i zostaje w jego aplikacji. Każdy pracownik musi potwierdzić odbiór; Ty widzisz to na żywo, a przy wiadomości do najwyżej 5 osób dostajesz powiadomienie o każdym potwierdzeniu (przy większej grupie — gdy potwierdzi ostatnia).')}</div>
          <h1>{t('Wiadomości')}</h1>
        </div>
      </div>

      {!backend.client && <div className="note amber">{t('Wiadomości działają po połączeniu z bazą w chmurze.')}</div>}

      {canEdit && (
        <section className="card stack">
          <div className="row" style={{ gap: 6 }}>
            {KINDS.map(([k, label]) => (
              <button key={k} type="button" className={`btn small ${kind === k ? 'primary' : ''}`} onClick={() => setKind(k)}>
                {t(label)}
              </button>
            ))}
          </div>

          {kind === 'workers' && (
            <div className="stack" style={{ gap: 6 }}>
              <div className="row" style={{ gap: 6 }}>
                {ids.map((id) => (
                  <button key={id} type="button" className="btn small" onClick={() => setIds(ids.filter((x) => x !== id))} title={t('Usuń z adresatów')}>
                    {name(id)} ✕
                  </button>
                ))}
              </div>
              <input
                className="input"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('Wpisz nazwisko…')}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && found[0]) {
                    setIds([...ids, found[0].id]);
                    setQuery('');
                  }
                }}
              />
              {found.length > 0 && (
                <div className="row" style={{ gap: 6 }}>
                  {found.map((w) => (
                    <button
                      key={w.id}
                      type="button"
                      className="btn small ghost"
                      onClick={() => {
                        setIds([...ids, w.id]);
                        setQuery('');
                      }}
                    >
                      + {w.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {kind === 'shift' && (
            <div className="row">
              <label className="field">
                {t('Dzień')}
                <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
              </label>
              <div className="row" style={{ gap: 6, alignItems: 'flex-end' }}>
                {[todayIso(), addDays(todayIso(), 1)].map((d, i) => (
                  <button key={d} type="button" className={`btn small ${d === date ? 'primary' : ''}`} onClick={() => setDate(d)}>
                    {i === 0 ? t('dziś') : t('jutro')}
                  </button>
                ))}
              </div>
              <label className="field grow">
                {t('Linia')}
                <select value={shiftLine} onChange={(e) => setShiftLine(e.target.value)}>
                  <option value="">{t('wszystkie linie')}</option>
                  {state.lines.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.group ? `${l.group} · ` : ''}
                      {l.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="row" style={{ gap: 6, alignItems: 'flex-end', width: '100%' }}>
                {opts.length === 0 && <span className="sub">{t('Tego dnia nikt nie pracuje.')}</span>}
                {opts.map((o) => (
                  <button key={o.start} type="button" className={`btn small ${o.start === start ? 'primary' : ''}`} onClick={() => setStartSel(o.start)}>
                    {shiftRange(o.start, o.end)} · {o.count}
                  </button>
                ))}
              </div>
            </div>
          )}

          {kind === 'line' && (
            <div className="row">
              <label className="field grow">
                {t('Linia')}
                <select value={lineId} onChange={(e) => setLineId(e.target.value)}>
                  {state.lines.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.group ? `${l.group} · ` : ''}
                      {l.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="row" style={{ gap: 6, alignItems: 'flex-end' }}>
                {(['', ...BRIGADES] as (BrigadeId | '')[]).map((b) => (
                  <button key={b || 'all'} type="button" className={`btn small ${brigade === b ? 'primary' : ''}`} onClick={() => setBrigade(b)}>
                    {b || t('wszystkie brygady')}
                  </button>
                ))}
              </div>
            </div>
          )}

          {kind === 'group' && (
            <div className="row" style={{ gap: 6 }}>
              {groups.map((g) => (
                <button key={g} type="button" className={`btn small ${group === g ? 'primary' : ''}`} onClick={() => setGroup(g)}>
                  {g}
                </button>
              ))}
            </div>
          )}

          <input className="input" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} placeholder={t('Temat (opcjonalnie), np. Zmiana godzin w piątek')} />
          <textarea
            className="input"
            rows={4}
            maxLength={2000}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={t('Treść wiadomości…')}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void send();
            }}
          />
          <label className="switch-row">
            <input type="checkbox" checked={important} onChange={(e) => setImportant(e.target.checked)} />
            <span>{t('Ważne — powiadomienie zostaje na ekranie telefonu, aż pracownik je otworzy')}</span>
          </label>
          <div className="row" style={{ alignItems: 'center', justifyContent: 'space-between' }}>
            <span className="sub">
              {who.length === 0
                ? t('Brak adresatów')
                : t('Do {n} osób · powiadomienie na telefon dostanie {p}', { n: who.length, p: withPhone })}
              {who.length > withPhone && who.length > 0 && <> · {t('pozostali zobaczą po otwarciu aplikacji')}</>}
            </span>
            <button type="button" className="btn primary" disabled={busy || !who.length || !body.trim() || !backend.client} onClick={() => void send()}>
              {busy ? t('Wysyłanie…') : t('Wyślij')}
            </button>
          </div>
          {kind !== 'workers' && who.length > 0 && who.length <= 40 && <div className="sub">{who.map((w) => w.name).join(', ')}</div>}
        </section>
      )}

      <section className="card">
        <div className="card-head">
          <h2>{t('Wysłane')}</h2>
        </div>
        {error && <div className="note red">{error}</div>}
        {!loading && messages.length === 0 && <div className="empty">{t('Jeszcze nic nie wysłano.')}</div>}
        {messages.map((m) => (
          <SentItem key={m.id} m={m} reads={reads.filter((r) => r.message_id === m.id)} name={name} canEdit={canEdit} />
        ))}
      </section>
    </>
  );
}

function SentItem({ m, reads, name, canEdit }: { m: Message; reads: MessageRead[]; name: (id: string) => string; canEdit: boolean }) {
  const { backend } = useApp();
  const [open, setOpen] = useState(false);
  const { confirmed, pending: unread } = ackStatus(m, reads);
  const all = unread.length === 0;
  return (
    <div className="list-item" style={{ alignItems: 'flex-start' }}>
      <div className="sub" style={{ width: 150, flex: '0 0 150px' }}>
        {new Date(m.created_at).toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' })}
        <br />
        {m.author}
      </div>
      <div className="grow stack" style={{ gap: 4 }}>
        <div className="row" style={{ gap: 6, alignItems: 'center' }}>
          {m.important && <span className="tag red">{t('ważne')}</span>}
          <span className="tag blue">{m.audience}</span>
          <button type="button" className={`tag ${all ? 'green' : 'amber'}`} style={{ border: 0, cursor: 'pointer' }} onClick={() => setOpen(!open)}>
            {t('potwierdziło {r} / {n}', { r: confirmed.length, n: m.worker_ids.length })}
          </button>
        </div>
        {m.title && <b>{m.title}</b>}
        <div style={{ fontSize: 14, whiteSpace: 'pre-wrap' }}>{m.body}</div>
        {open && (
          <div className="sub">
            {confirmed.length > 0 && (
              <div>
                {t('Potwierdzili:')} {confirmed.map((c) => `${name(c.id)} (${new Date(c.at).toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' })})`).join(', ')}
              </div>
            )}
            {all ? t('Wszyscy potwierdzili.') : <div>{t('Jeszcze nie potwierdzili:')} {unread.map(name).join(', ')}</div>}
          </div>
        )}
      </div>
      {canEdit && backend.client && (
        <button
          type="button"
          className="btn small ghost"
          title={t('Usuń wiadomość')}
          onClick={() => {
            if (!confirm(t('Usunąć tę wiadomość? Zniknie też z telefonów pracowników.'))) return;
            void deleteMessage(backend.client!, m.id).catch((e) => toast(String(e), { tone: 'warn' }));
          }}
        >
          ✕
        </button>
      )}
    </div>
  );
}
