// Logika integracji z Comarch TNA Public API (bez sieci — testowana w src/domain/tnaApi.test.ts).
// Dokumentacja: https://tna.comarch.com/public-api/

export interface TnaUser {
  userHash: string;
  nameAndLastname?: string;
  email?: string;
  state?: string;
}

export interface TnaScan {
  timestamp: number;
  direction: string;
  entry?: { description?: string; building?: { description?: string } };
}

export interface WorkerRef {
  id: string;
  name: string;
  email?: string;
  active?: boolean;
}

export function norm(v: unknown): string {
  return String(v ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ł/g, 'l')
    .replace(/Ł/g, 'L')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Łączy konta TNA z pracownikami aplikacji: najpierw ręczne powiązania, potem e-mail,
 * potem imię i nazwisko w dowolnej kolejności („Jan Kowalski” = „Kowalski Jan”).
 */
export function matchUsers(users: TnaUser[], workers: WorkerRef[], links: Record<string, string> = {}): { map: Map<string, string>; unmatched: TnaUser[] } {
  const byEmail = new Map<string, string>();
  const byName = new Map<string, string>();
  for (const w of workers) {
    if (w.email) byEmail.set(w.email.trim().toLowerCase(), w.id);
    const n = norm(w.name);
    byName.set(n, w.id);
    byName.set(n.split(' ').reverse().join(' '), w.id);
  }
  const map = new Map<string, string>();
  const unmatched: TnaUser[] = [];
  for (const u of users) {
    const id = links[u.userHash] ?? (u.email ? byEmail.get(u.email.trim().toLowerCase()) : undefined) ?? byName.get(norm(u.nameAndLastname));
    if (id) map.set(u.userHash, id);
    else unmatched.push(u);
  }
  return { map, unmatched };
}

export type Dir = 'in' | 'out';

export function dirOf(direction: string): Dir | null {
  const d = direction.toUpperCase();
  if (d === 'IN' || d === 'ENTRY' || d === 'ENTER') return 'in';
  if (d === 'OUT' || d === 'EXIT') return 'out';
  return null;
}

/** Czas lokalny (Europe/Warsaw): data i minuty od północy. */
export function localParts(d: Date): { date: string; min: number } {
  const f = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, min: Number(p.hour) * 60 + Number(p.minute) };
}

/**
 * Odbicie TNA → odbicie aplikacji. Identyfikator taki sam jak przy imporcie z pliku,
 * więc odbicie z API i z pliku nigdy się nie zdublują.
 */
export function toPunch(scan: TnaScan, workerId: string) {
  const dir = dirOf(scan.direction);
  if (!dir || !Number.isFinite(scan.timestamp)) return null;
  // API podaje sekundy; gdyby kiedyś przyszły milisekundy — rozpoznaj po wielkości
  const ms = scan.timestamp > 1e12 ? scan.timestamp : scan.timestamp * 1000;
  const at = new Date(ms);
  const { date, min } = localParts(at);
  const place = [scan.entry?.building?.description, scan.entry?.description].filter(Boolean).join(' / ');
  return {
    id: `tna-${workerId}-${date}-${min}-${dir}`,
    workerId,
    at: at.toISOString(),
    date,
    min,
    dir,
    source: 'tna' as const,
    ...(place ? { kiosk: place } : {}),
  };
}
