import { useEffect, useState } from 'react';

export type ThemePref = 'system' | 'light' | 'dark';
const KEY = 'tmt-theme';
const media = () => window.matchMedia?.('(prefers-color-scheme: dark)');

export function themePref(): ThemePref {
  const v = localStorage.getItem(KEY);
  return v === 'light' || v === 'dark' ? v : 'system';
}

/** Ustawia data-theme na <html>; „wg systemu” idzie za ustawieniem telefonu/komputera. */
export function applyTheme(pref: ThemePref = themePref()): void {
  const dark = pref === 'dark' || (pref === 'system' && !!media()?.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0b0e14' : '#1b2230');
}

/** Zmiana motywu systemu (np. telefon wieczorem przechodzi w ciemny) działa od razu. */
export function watchSystemTheme(): void {
  media()?.addEventListener?.('change', () => themePref() === 'system' && applyTheme());
}

export function useTheme(): [ThemePref, (p: ThemePref) => void] {
  const [pref, setPref] = useState<ThemePref>(themePref);
  useEffect(() => {
    const on = (e: StorageEvent) => e.key === KEY && (setPref(themePref()), applyTheme());
    window.addEventListener('storage', on);
    return () => window.removeEventListener('storage', on);
  }, []);
  return [
    pref,
    (p) => {
      if (p === 'system') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, p);
      setPref(p);
      applyTheme(p);
    },
  ];
}
