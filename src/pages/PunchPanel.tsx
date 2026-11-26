import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '../data/AppContext';
import { callApi, toOutcome } from '../rcp/api';
import PunchResult from '../rcp/PunchResult';
import type { PunchOutcome } from '../rcp/PunchResult';
import { t } from '../i18n';

export interface Scan {
  k: string;
  private: boolean;
}

/** Kod z kiosku: …#/odbij?k=…&p=1 (p = wyjście prywatne). Działa też dla tekstu z wbudowanego skanera. */
export function parseScan(text: string): Scan | null {
  const m = text.match(/#\/odbij\?(.*)$/);
  if (!m) return null;
  const q = new URLSearchParams(m[1]);
  const k = q.get('k');
  return k ? { k, private: q.get('p') === '1' } : null;
}

export function scannedToken(): Scan | null {
  return parseScan(location.hash);
}

export function clearScan(): void {
  history.replaceState(null, '', location.pathname + location.search + '#/');
}

/** Odbicie zapisuje się od razu po zeskanowaniu — pracownik nic nie wybiera. */
export default function PunchPanel({ scan, onDone }: { scan: Scan; onDone: () => void }) {
  const { backend } = useApp();
  const [outcome, setOutcome] = useState<PunchOutcome | null>(null);
  const sent = useRef<string | null>(null);

  useEffect(() => {
    const db = backend.client;
    if (!db || sent.current === scan.k) return;
    sent.current = scan.k;
    void callApi(db, { action: 'punch', k: scan.k, p: scan.private ? 1 : 0 }).then((r) => setOutcome(toOutcome(r)));
  }, [backend, scan]);

  const undo = useCallback(async () => {
    const db = backend.client;
    const id = outcome?.punch?.id;
    if (!db || !id) return;
    const r = await callApi(db, { action: 'unpunch', id });
    if (r.error) alert(t('Nie udało się cofnąć — poproś przełożonego o poprawkę w RCP.'));
    onDone();
  }, [backend, outcome, onDone]);

  if (!outcome) return <div className="punch-result wait">{t('Zapisuję odbicie…')}</div>;
  return <PunchResult outcome={outcome} onUndo={outcome.punch && !outcome.duplicate ? () => void undo() : undefined} onClose={onDone} />;
}
