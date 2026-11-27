import { daysBetween } from './dates';
import type { AppState } from './types';

/** Od ilu dni przed terminem przypominamy (lista pokazuje też przeterminowane). */
export const WARN_DAYS = { contract: 30, medical: 30 } as const;
/** Lista terminów obejmuje tyle dni naprzód. */
export const LIST_DAYS = 60;

export type DeadlineKind = 'contract' | 'medical';

export interface Deadline {
  workerId: string;
  name: string;
  kind: DeadlineKind;
  date: string;
  /** dni do terminu; ujemne = termin minął */
  days: number;
  /** w oknie przypomnienia (WARN_DAYS) albo po terminie */
  urgent: boolean;
}

/** Umowy i badania lekarskie aktywnych pracowników, które kończą się w ciągu LIST_DAYS (lub już minęły). */
export function deadlines(state: AppState, today: string): Deadline[] {
  const out: Deadline[] = [];
  for (const w of state.workers) {
    if (!w.active) continue;
    for (const [kind, date] of [
      ['contract', w.contractEnd],
      ['medical', w.medicalExpiry],
    ] as const) {
      if (!date) continue;
      const days = daysBetween(today, date);
      if (days > LIST_DAYS) continue;
      out.push({ workerId: w.id, name: w.name, kind, date, days, urgent: days <= WARN_DAYS[kind] });
    }
  }
  return out.sort((a, b) => a.days - b.days || a.name.localeCompare(b.name, 'pl'));
}
