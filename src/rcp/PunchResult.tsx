import { useEffect, useState } from 'react';
import { DIR_LABEL } from '../domain/punches';
import type { Punch } from '../domain/punches';
import { t } from '../i18n';

export interface PunchOutcome {
  punch?: Punch & { name?: string };
  duplicate?: boolean;
  error?: string;
  name?: string;
}

const ERRORS: Record<string, string> = {
  expired: 'Kod wygasł — zeskanuj go jeszcze raz.',
  not_employee: 'To konto nie jest kontem pracownika.',
  unauthorized: 'Zaloguj się ponownie.',
  not_in: 'Najpierw odbij wejście — wyjście prywatne jest tylko z terenu zakładu.',
  unknown_badge: 'Nieznana karta. Zgłoś się do przełożonego.',
  not_tmt: 'To nie jest kod TMT.',
  network: 'Brak połączenia. Spróbuj jeszcze raz.',
};

export function errorText(code?: string): string {
  return t(ERRORS[code ?? ''] ?? 'Nie udało się odbić. Spróbuj jeszcze raz.');
}

/** Duży kolorowy ekran wyniku: zielony wejście/powrót, czerwony wyjście, żółty wyjście prywatne. */
export default function PunchResult({ outcome, onUndo, onClose, autoCloseMs }: { outcome: PunchOutcome; onUndo?: () => void; onClose: () => void; autoCloseMs?: number }) {
  const p = outcome.punch;
  const kind = outcome.error ? 'error' : p?.dir === 'private_out' ? 'private' : p?.dir === 'out' ? 'out' : 'in';
  const [undoLeft, setUndoLeft] = useState(onUndo ? 10 : 0);

  useEffect(() => {
    navigator.vibrate?.(outcome.error ? [80, 60, 80] : 120);
    if (!autoCloseMs) return;
    const id = window.setTimeout(onClose, autoCloseMs);
    return () => window.clearTimeout(id);
  }, [outcome, autoCloseMs, onClose]);

  useEffect(() => {
    if (!undoLeft) return;
    const id = window.setTimeout(() => setUndoLeft((n) => n - 1), 1000);
    return () => window.clearTimeout(id);
  }, [undoLeft]);

  const time = p ? new Date(p.at).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Warsaw' }) : '';
  const title = outcome.error ? t('Nie zapisano') : t(DIR_LABEL[p?.ret ? 'return' : (p?.dir ?? 'in')]);
  return (
    <div className={`punch-result ${kind}`} role="alert" onClick={onClose}>
      <div className="pr-icon">{outcome.error ? '!' : kind === 'out' ? '←' : kind === 'private' ? '↗' : '→'}</div>
      <div className="pr-title">{title}</div>
      {p && <div className="pr-time">{time}</div>}
      {(p?.name || outcome.name) && <div className="pr-name">{p?.name ?? outcome.name}</div>}
      {outcome.error && <div className="pr-msg">{errorText(outcome.error)}</div>}
      {outcome.duplicate && <div className="pr-msg">{t('To odbicie było już zapisane przed chwilą.')}</div>}
      {onUndo && undoLeft > 0 && !outcome.error && !outcome.duplicate && (
        <button
          type="button"
          className="btn pr-undo"
          onClick={(e) => {
            e.stopPropagation();
            onUndo();
          }}
        >
          {t('Pomyłka? Cofnij ({s} s)', { s: undoLeft })}
        </button>
      )}
      <div className="pr-hint">{t('Dotknij, aby zamknąć')}</div>
    </div>
  );
}
