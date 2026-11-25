import { addDays } from './dates';

/** Niedziela Wielkanocna (algorytm Meeusa/Jonesa/Butchera). */
export function easter(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

const cache = new Map<number, Map<string, string>>();

/** Dni ustawowo wolne od pracy w Polsce (ustawa z 18.01.1951; Wigilia od 2025 r.). */
export function polishHolidays(year: number): Map<string, string> {
  const hit = cache.get(year);
  if (hit) return hit;
  const y = String(year);
  const e = easter(year);
  const list: [string, string][] = [
    [`${y}-01-01`, 'Nowy Rok'],
    [`${y}-01-06`, 'Trzech Króli'],
    [e, 'Wielkanoc'],
    [addDays(e, 1), 'Poniedziałek Wielkanocny'],
    [`${y}-05-01`, 'Święto Pracy'],
    [`${y}-05-03`, 'Święto Konstytucji 3 Maja'],
    [addDays(e, 49), 'Zielone Świątki'],
    [addDays(e, 60), 'Boże Ciało'],
    [`${y}-08-15`, 'Wniebowzięcie NMP'],
    [`${y}-11-01`, 'Wszystkich Świętych'],
    [`${y}-11-11`, 'Święto Niepodległości'],
    ...(year >= 2025 ? ([[`${y}-12-24`, 'Wigilia']] as [string, string][]) : []),
    [`${y}-12-25`, 'Boże Narodzenie'],
    [`${y}-12-26`, 'Drugi dzień Bożego Narodzenia'],
  ];
  const map = new Map(list);
  cache.set(year, map);
  return map;
}

export function holidayName(date: string): string | undefined {
  return polishHolidays(Number(date.slice(0, 4))).get(date);
}
