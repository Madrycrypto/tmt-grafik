import { monthDays, weekday } from './dates';
import { holidayName } from './holidays';

/**
 * Wymiar czasu pracy w miesiącu (Kodeks pracy art. 130): 8 h × dni pn–pt,
 * minus 8 h za każde święto przypadające w dzień inny niż niedziela.
 */
export function monthNorm(month: string): { hours: number; workdays: number } {
  let workdays = 0;
  let holidaysOffSunday = 0;
  for (const d of monthDays(month)) {
    const wd = weekday(d);
    const hol = !!holidayName(d);
    if (wd >= 1 && wd <= 5) workdays++;
    if (hol && wd !== 0) holidaysOffSunday++;
  }
  const net = workdays - holidaysOffSunday;
  return { hours: net * 8, workdays: net };
}
