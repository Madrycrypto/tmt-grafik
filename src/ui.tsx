import { useTheme } from './theme';
import type { ThemePref } from './theme';
import { useEffect, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { fmtRange } from './domain/dates';
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

export function Sheet({ title, sub, onClose, children }: { title: ReactNode; sub?: ReactNode; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);
  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
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

export function Level({ value, onClick, title }: { value: number; onClick?: () => void; title?: string }) {
  const label = value ? String(value) : '–';
  const tip = title ?? `${t('Poziom')} ${value}: ${t(LEVEL_LABEL[value] ?? '')}`;
  if (onClick)
    return (
      <button type="button" className={`lv lv${value}`} onClick={onClick} title={tip} aria-label={tip}>
        {label}
      </button>
    );
  return (
    <span className={`lv lv${value}`} title={tip}>
      {label}
    </span>
  );
}

export function TypeTag({ w }: { w: Worker }) {
  const cls = w.type === 'CN' ? 'blue' : w.type === 'AG' ? 'amber' : '';
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
          opts
        );
      })}
    </>
  );
}

export function useLine(state: AppState): [string, (v: string) => void] {
  const [lineId, setLineId] = usePersistent('line', state.lines[0]?.id ?? '');
  const valid = state.lines.some((l) => l.id === lineId) ? lineId : (state.lines[0]?.id ?? '');
  return [valid, setLineId];
}
