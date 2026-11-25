import { zh } from './i18n.zh';

export type Lang = 'pl' | 'zh';
const KEY = 'tmt-grafik-lang';

function initial(): Lang {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'pl' || v === 'zh') return v;
  } catch {
    /* brak localStorage: język z przeglądarki */
  }
  return typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('zh') ? 'zh' : 'pl';
}

export let lang: Lang = initial();
if (typeof document !== 'undefined') document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'pl';

/** Zmiana języka przeładowuje aplikację, żeby wszystkie teksty (także w logice) były spójne. */
export function setLang(l: Lang): void {
  try {
    localStorage.setItem(KEY, l);
  } catch {
    /* tryb prywatny */
  }
  lang = l;
  location.reload();
}

/** Tłumaczenie po polskim tekście źródłowym; {nazwa} w tekście podmieniane z vars. */
export function t(text: string, vars?: Record<string, string | number>): string {
  // „tekst#kontekst” rozróżnia to samo polskie słowo w różnych miejscach
  let out = lang === 'zh' && zh[text] !== undefined ? zh[text] : text.split('#')[0];
  if (vars) for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(String(v));
  return out;
}
