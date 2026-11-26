import { useEffect, useState } from 'react';
import { t } from './i18n';

interface Toast {
  id: number;
  text: string;
  undo?: () => void | Promise<void>;
  tone?: 'ok' | 'warn';
}

let seq = 0;
let current: Toast | null = null;
const listeners = new Set<(t: Toast | null) => void>();
let timer: number | undefined;

/**
 * Krótki pasek na dole ekranu zamiast okienka „Czy na pewno?”: zmiana dzieje się od razu,
 * a „Cofnij” przez kilka sekund ją odwraca.
 */
export function toast(text: string, opts: { undo?: Toast['undo']; tone?: Toast['tone']; ms?: number } = {}): void {
  current = { id: ++seq, text, undo: opts.undo, tone: opts.tone };
  listeners.forEach((l) => l(current));
  window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    current = null;
    listeners.forEach((l) => l(null));
  }, opts.ms ?? (opts.undo ? 7000 : 3500));
}

export function ToastHost() {
  const [item, setItem] = useState<Toast | null>(current);
  useEffect(() => {
    listeners.add(setItem);
    return () => void listeners.delete(setItem);
  }, []);
  if (!item) return null;
  return (
    <div className={`toast ${item.tone ?? 'ok'}`} role="status" aria-live="polite">
      <span>{item.tone === 'warn' ? '⚠' : '✓'} {item.text}</span>
      {item.undo && (
        <button
          type="button"
          className="toast-undo"
          onClick={() => {
            const u = item.undo!;
            current = null;
            listeners.forEach((l) => l(null));
            void u();
          }}
        >
          {t('Cofnij')}
        </button>
      )}
      <button type="button" className="toast-x" aria-label={t('Zamknij')} onClick={() => setItem(null)}>
        ×
      </button>
    </div>
  );
}
