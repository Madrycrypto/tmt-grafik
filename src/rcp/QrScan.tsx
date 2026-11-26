import { useEffect, useRef, useState } from 'react';
import QrScanner from 'qr-scanner';
import { t } from '../i18n';

/**
 * Podgląd kamery, który czyta kody QR. Ten sam kod odczytany ponownie w ciągu
 * `repeatMs` jest ignorowany, żeby trzymanie karty przed kamerą nie dawało serii odbić.
 */
export default function QrScan({ onCode, facing = 'environment', paused = false, repeatMs = 4000 }: { onCode: (text: string) => void; facing?: 'environment' | 'user'; paused?: boolean; repeatMs?: number }) {
  const video = useRef<HTMLVideoElement>(null);
  const scanner = useRef<QrScanner | null>(null);
  const last = useRef<{ text: string; at: number } | null>(null);
  const cb = useRef(onCode);
  cb.current = onCode;
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!video.current) return;
    const s = new QrScanner(
      video.current,
      (r) => {
        const now = Date.now();
        if (last.current && last.current.text === r.data && now - last.current.at < repeatMs) return;
        last.current = { text: r.data, at: now };
        cb.current(r.data);
      },
      { preferredCamera: facing, highlightScanRegion: true, highlightCodeOutline: true, maxScansPerSecond: 8, returnDetailedScanResult: true },
    );
    scanner.current = s;
    s.start().catch(() => setError(t('Brak dostępu do kamery. Zezwól na kamerę w przeglądarce i odśwież stronę.')));
    return () => {
      s.destroy();
      scanner.current = null;
    };
  }, [facing, repeatMs]);

  useEffect(() => {
    const s = scanner.current;
    if (!s) return;
    if (paused) s.pause();
    else void s.start().catch(() => undefined);
  }, [paused]);

  return (
    <div className="qr-scan">
      <video ref={video} muted playsInline />
      {error && <div className="note red">{error}</div>}
    </div>
  );
}
