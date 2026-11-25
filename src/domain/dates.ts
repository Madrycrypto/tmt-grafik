const DAY_MS = 86_400_000;

function toUtc(d: string): number {
  const [y, m, day] = d.split('-').map(Number);
  return Date.UTC(y, m - 1, day);
}

function fromUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(d: string, n: number): string {
  return fromUtc(toUtc(d) + n * DAY_MS);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((toUtc(b) - toUtc(a)) / DAY_MS);
}

/** 0 = niedziela … 6 = sobota */
export function weekday(d: string): number {
  return new Date(toUtc(d)).getUTCDay();
}

export function monthDays(month: string): string[] {
  const first = `${month}-01`;
  const out: string[] = [];
  for (let d = first; d.startsWith(month); d = addDays(d, 1)) out.push(d);
  return out;
}

export function todayIso(): string {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

export const WEEKDAY_SHORT = ['Nd', 'Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'So'];
export const WEEKDAY_LONG = ['niedziela', 'poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota'];

export function fmtHour(h: number): string {
  return String(((h % 24) + 24) % 24).padStart(2, '0') + ':00';
}

export function fmtRange(start: number, hours: number): string {
  return `${fmtHour(start)}–${fmtHour(start + hours)}`;
}

export function fmtDate(d: string): string {
  const [, m, day] = d.split('-');
  return `${WEEKDAY_SHORT[weekday(d)]} ${day}.${m}`;
}

export function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}
