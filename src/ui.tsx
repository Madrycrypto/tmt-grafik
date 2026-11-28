import { useTheme } from './theme';
import type { ThemePref } from './theme';
import { useEffect, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { fmtRange } from './domain/dates';
import type { Deadline } from './domain/deadlines';
import type { AppState, ShiftDef, Worker } from './domain/types';
import { LEVEL_LABEL, TYPE_LABEL } from './domain/types';
import { lang, setLang, t } from './i18n';

const PATHS: Record<string, ReactNode> = {
  obsada: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18M9 4v16" /></>,
  grafik: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></>,
  matrix: <><path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" /></>,
  ludzie: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5" /><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.8c1.8.8 3 2.6 3.5 5.2" /></>,
  linie: <><path d="M3 7h18M3 12h18M3 17h18" /><circle cx="7" cy="7" r="1.5" /><circle cx="15" cy="12" r="1.5" /><circle cx="10" cy="17" r="1.5" /></>,
  historia: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  ustawienia: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>,
  rcp: <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h3v3H8zM13 8h3M13 11h3M8 15h8" /></>,
  wiadomosci: <><path d="M4 5h16v11H9l-5 4z" /><path d="M8 9h8M8 12h5" /></>,
  urlopy: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4M9 15l2 2 4-4" /></>,
  statystyki: <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>,
  wiecej: <><circle cx="5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" /></>,
  close: <><path d="M6 6l12 12M18 6L6 18" /></>,
  plus: <><path d="M12 5v14M5 12h14" /></>,
};

export function Icon({ name }: { name: keyof typeof PATHS | string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {PATHS[name]}
    </svg>
  );
}

export function Sheet({ title, sub, onClose, children, wide }: { title: ReactNode; sub?: ReactNode; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);
  return (
    <div className="overlay" onClick={onClose}>
      <div className={wide ? 'sheet wide' : 'sheet'} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <div>
            <h2>{title}</h2>
            {sub && <div className="sub">{sub}</div>}
          </div>
          <button type="button" className="btn ghost small" aria-label={t('Zamknij')} onClick={onClose}>
            <span style={{ width: 20, height: 20, display: 'inline-flex' }}>
              <Icon name="close" />
            </span>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Kółko ćwiartkowe (Harvey ball): 0 = puste, 1 = ćwiartka … 4 = pełne. */
export function Ball({ value, size = 22 }: { value: number; size?: number }) {
  const a = (Math.max(0, Math.min(4, value)) * Math.PI) / 2;
  const x = 11 + 9 * Math.sin(a);
  const y = 11 - 9 * Math.cos(a);
  return (
    <svg viewBox="0 0 22 22" width={size} height={size} aria-hidden="true" style={{ display: 'block' }}>
      <circle cx="11" cy="11" r="9" fill="none" stroke="currentColor" strokeWidth="1.6" opacity={value ? 1 : 0.3} />
      {value >= 4 ? (
        <circle cx="11" cy="11" r="9" fill="currentColor" />
      ) : value > 0 ? (
        <path d={`M11 11 L11 2 A9 9 0 ${value > 2 ? 1 : 0} 1 ${x.toFixed(2)} ${y.toFixed(2)} Z`} fill="currentColor" />
      ) : null}
    </svg>
  );
}

/** Poziom w matrycy jako kółko ćwiartkowe; z `min` poziom poniżej wymaganego jest wyróżniony. */
export function Level({ value, min, title }: { value: number; min?: number; title?: string }) {
  const tip = title ?? `${t('Poziom')} ${value}: ${t(LEVEL_LABEL[value] ?? '')}`;
  const tone = value === 0 ? 'lv0' : min !== undefined && value < min ? 'lv-low' : 'lv-ok';
  return (
    <span className={`lv ${tone}`} title={tip} aria-label={tip}>
      <Ball value={value} />
    </span>
  );
}

/**
 * Komórka matrycy z rozwijaną listą poziomów 0–4 (kółka ćwiartkowe).
 * Klawiatura: cyfra 0–4 ustawia poziom od razu, Enter/spacja otwiera listę.
 */
export function LevelPicker({ value, min, title, onChange }: { value: number; min?: number; title?: string; onChange: (level: number) => void }) {
  // lista jest „fixed”, żeby przewijana tabela jej nie ucinała
  const [pos, setPos] = useState<{ x: number; y: number; up: boolean } | null>(null);
  const open = pos !== null;
  const setOpen = (v: boolean) => !v && setPos(null);
  useEffect(() => {
    if (!open) return;
    const close = () => setPos(null);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setPos(null);
    window.addEventListener('click', close);
    window.addEventListener('keydown', esc);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('keydown', esc);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);
  const tone = value === 0 ? 'lv0' : min !== undefined && value < min ? 'lv-low' : 'lv-ok';
  return (
    <span className="lv-pick">
      <button
        type="button"
        className={`lv lv-btn ${tone}`}
        title={title}
        aria-label={title}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          if (open) return setPos(null);
          const r = e.currentTarget.getBoundingClientRect();
          const up = r.bottom + 200 > window.innerHeight;
          setPos({ x: Math.min(Math.max(r.left + r.width / 2, 100), window.innerWidth - 100), y: up ? window.innerHeight - r.top + 2 : r.bottom + 2, up });
        }}
        onKeyDown={(e) => {
          if (/^[0-4]$/.test(e.key)) {
            e.preventDefault();
            onChange(Number(e.key));
            setOpen(false);
          }
        }}
      >
        <Ball value={value} />
        <span className="lv-caret">▾</span>
      </button>
      {pos && (
        <span className="lv-menu" role="listbox" style={pos.up ? { left: pos.x, bottom: pos.y } : { left: pos.x, top: pos.y }} onClick={(e) => e.stopPropagation()}>
          {[0, 1, 2, 3, 4].map((l) => (
            <button
              key={l}
              type="button"
              role="option"
              aria-selected={l === value}
              className={`lv-opt ${l === value ? 'on' : ''}`}
              onClick={() => {
                onChange(l);
                setOpen(false);
              }}
            >
              <Ball value={l} size={20} />
              <span>
                {l} · {t(LEVEL_LABEL[l])}
              </span>
            </button>
          ))}
        </span>
      )}
    </span>
  );
}

export function TypeTag({ w }: { w: Worker }) {
  const cls = w.type === 'CN' ? 'red' : w.type === 'AG' ? 'blue' : 'green';
  return <span className={`tag ${cls}`}>{w.type === 'AG' && w.agency ? w.agency : t(TYPE_LABEL[w.type])}</span>;
}

/** Stan zapamiętany w przeglądarce (wybrana linia, data itp.). */
export function usePersistent<T>(key: string, initial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    try {
      const raw = localStorage.getItem('ui:' + key);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });
  const set = (next: T) => {
    setV(next);
    try {
      localStorage.setItem('ui:' + key, JSON.stringify(next));
    } catch {
      /* tryb prywatny: wybór działa do odświeżenia */
    }
  };
  return [v, set];
}

export function shiftLabel(def: ShiftDef): string {
  return `${t(def.label)} · ${fmtRange(def.start, def.hours)} (${def.hours} h)`;
}

/** Przełącznik języka PL / 中文. */
export function LangSwitch({ dark }: { dark?: boolean }) {
  const base: CSSProperties = { border: 0, background: 'transparent', cursor: 'pointer', padding: '4px 6px', borderRadius: 6, fontSize: 12, fontWeight: 600 };
  const on = dark ? { background: '#2a3447', color: '#fff' } : { background: 'var(--accent-soft)', color: 'var(--accent)' };
  const off = { color: dark ? '#9eabc2' : 'var(--muted)' };
  return (
    <span role="group" aria-label="Język / 语言" style={{ display: 'inline-flex', gap: 2 }}>
      <button type="button" style={{ ...base, ...(lang === 'pl' ? on : off) }} onClick={() => lang !== 'pl' && setLang('pl')}>
        PL
      </button>
      <button type="button" style={{ ...base, ...(lang === 'zh' ? on : off) }} onClick={() => lang !== 'zh' && setLang('zh')}>
        中文
      </button>
    </span>
  );
}

/** Przełącznik motywu: jasny / wg systemu / ciemny. */
export function ThemeSwitch({ dark }: { dark?: boolean }) {
  const [pref, setPref] = useTheme();
  const base: CSSProperties = { border: 0, background: 'transparent', cursor: 'pointer', padding: '4px 7px', borderRadius: 6, fontSize: 13, lineHeight: 1 };
  const on = dark ? { background: '#2a3447', color: '#fff' } : { background: 'var(--accent-soft)', color: 'var(--accent)' };
  const off = { color: dark ? '#9eabc2' : 'var(--muted)' };
  const opts: [ThemePref, string, string][] = [
    ['light', '☀', t('Motyw jasny')],
    ['system', '◐', t('Motyw wg systemu')],
    ['dark', '☾', t('Motyw ciemny')],
  ];
  return (
    <span role="group" aria-label={t('Motyw')} style={{ display: 'inline-flex', gap: 2 }}>
      {opts.map(([p, icon, label]) => (
        <button key={p} type="button" title={label} aria-label={label} aria-pressed={pref === p} style={{ ...base, ...(pref === p ? on : off) }} onClick={() => setPref(p)}>
          {icon}
        </button>
      ))}
    </span>
  );
}

/** Zmiana 8 h obejmująca bieżącą godzinę — domyślne okno pulpitu. */
export function currentWindowCode(state: AppState): string {
  const h = new Date().getHours();
  const defs = state.shiftDefs.filter((d) => d.hours === 8);
  const hit = defs.find((d) => (h >= d.start && h < d.start + d.hours) || (h + 24 >= d.start && h + 24 < d.start + d.hours));
  return (hit ?? state.shiftDefs[0])?.code ?? '';
}

export function LineSelect({ state, value, onChange }: { state: AppState; value: string; onChange: (v: string) => void }) {
  return (
    <label className="field">
      {t('Linia')}
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <LineOptions state={state} />
      </select>
    </label>
  );
}

/** Opcje linii pogrupowane według linii głównej (np. CFM → Lutowanie, Moduły, Rdzenie). */
export function LineOptions({ state }: { state: AppState }) {
  const groups = new Map<string, AppState['lines']>();
  for (const l of [...state.lines].sort((a, b) => (a.group ?? '').localeCompare(b.group ?? '') || a.name.localeCompare(b.name))) {
    const g = l.group ?? '';
    groups.set(g, [...(groups.get(g) ?? []), l]);
  }
  return (
    <>
      {[...groups].map(([g, ls]) => {
        const opts = ls.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name}
          </option>
        ));
        return g ? (
          <optgroup key={g} label={g}>
            {opts}
          </optgroup>
        ) : (
          // linia główna bez grupy (np. Injection) wygląda jak grupa HVAC czy CFM
          ls.map((l) => (
            <optgroup key={l.id} label={l.name}>
              <option value={l.id}>{l.name}</option>
            </optgroup>
          ))
        );
      })}
    </>
  );
}

/** Zakres linii wspólny dla wszystkich zakładek: 'all', 'g:<linia główna>' albo id linii. Zapamiętany między zakładkami. */
export function useScope(state: AppState): [string, (v: string) => void] {
  const [raw, setRaw] = usePersistent('scope', 'all');
  const ok = raw === 'all' || (raw.startsWith('g:') ? state.lines.some((l) => l.group === raw.slice(2)) : state.lines.some((l) => l.id === raw));
  return [ok ? raw : 'all', setRaw];
}

/** Linie należące do zakresu. */
export function scopeLineIds(state: AppState, scope: string): string[] {
  const ls = scope === 'all' ? state.lines : scope.startsWith('g:') ? state.lines.filter((l) => l.group === scope.slice(2)) : state.lines.filter((l) => l.id === scope);
  return ls.map((l) => l.id);
}

/** Wybór jednej linii (Obsada, Matrix) zgodny ze wspólnym zakresem: przy grupie zostaje własna linia, jeśli do niej należy. */
export function useLine(state: AppState): [string, (v: string) => void] {
  const [scope, setScope] = useScope(state);
  const [own, setOwn] = usePersistent('line', state.lines[0]?.id ?? '');
  const first = state.lines[0]?.id ?? '';
  const ownValid = state.lines.some((l) => l.id === own) ? own : first;
  let line = ownValid;
  if (scope !== 'all' && !scope.startsWith('g:')) line = scope;
  else if (scope.startsWith('g:')) {
    const inGroup = scopeLineIds(state, scope);
    if (!inGroup.includes(ownValid)) line = inGroup[0] ?? ownValid;
  }
  return [
    line,
    (v: string) => {
      setOwn(v);
      setScope(v);
    },
  ];
}

/** Lista umów i badań lekarskich, które się kończą lub już minęły; w trybie compact tylko baner z odnośnikiem. */
export function DeadlinesCard({ items, onOpen, compact }: { items: Deadline[]; onOpen?: (workerId: string) => void; compact?: boolean }) {
  const urgent = items.filter((x) => x.urgent);
  if (!urgent.length) return null;
  const kind = (k: Deadline['kind']) => (k === 'contract' ? t('umowa') : t('badanie lekarskie'));
  const when = (d: number) => (d < 0 ? t('minęło {n} dni temu', { n: -d }) : d === 0 ? t('dzisiaj') : t('za {n} dni', { n: d }));
  const tone = (d: number) => (d <= 14 ? 'red' : 'amber');
  if (compact)
    return (
      <a href="#/pracownicy" className="card" style={{ display: 'block', marginBottom: 14, textDecoration: 'none', color: 'inherit' }}>
        <b>{urgent.length}</b> {t('terminów umów i badań lekarskich w ciągu 30 dni')} — {urgent.filter((x) => x.days < 0).length > 0 ? <span className="tag red">{t('są po terminie')}</span> : t('zobacz listę w Pracownikach')}
      </a>
    );
  return (
    <section className="card" style={{ marginBottom: 14 }}>
      <div className="card-head">
        <h2>{t('Terminy umów i badań')}</h2>
        <span className="sub">{t('Przypomnienie na 30 dni przed końcem; po terminie pozostaje na liście')}</span>
      </div>
      <table>
        <tbody>
          {items.map((x) => (
            <tr key={`${x.workerId}-${x.kind}`} style={onOpen ? { cursor: 'pointer' } : undefined} onClick={() => onOpen?.(x.workerId)}>
              <td style={{ fontWeight: 600 }}>{x.name}</td>
              <td>{kind(x.kind)}</td>
              <td>{x.date}</td>
              <td>
                <span className={`tag ${x.urgent ? tone(x.days) : ''}`}>{when(x.days)}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
