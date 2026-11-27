export type BrigadeId = 'A' | 'B' | 'C' | 'D';
export const BRIGADES: BrigadeId[] = ['A', 'B', 'C', 'D'];

/** PL = pracownik TMT (PL), CN = pracownik TMT (Chiny), AG = agencja */
export type WorkerType = 'PL' | 'CN' | 'AG';

/** Kod zmiany „wolne” w sekwencji rotacji. */
export const OFF = 'W';

export interface ShiftDef {
  code: string;
  label: string;
  /** godzina rozpoczęcia 0–23; zmiana należy do dnia, w którym się zaczyna */
  start: number;
  hours: number;
  /**
   * godziny należne bez pracy (np. skrócona nocka, bo linia stoi na maintenance):
   * pracownik ich nie przepracowuje, ale liczą się do wymiaru i są płatne
   */
  credit?: number;
}

export interface Pattern {
  id: string;
  name: string;
  /** kolejne dni cyklu: kody zmian lub 'W' */
  sequence: string[];
  /** przesunięcie każdej brygady w cyklu */
  offsets: Record<BrigadeId, number>;
  /** dzień, od którego liczony jest cykl (indeks 0) */
  anchor: string;
  /** brygady używane w tym systemie (domyślnie A–D) */
  brigades?: BrigadeId[];
  /** czy w święta ustawowe linia nie pracuje; domyślnie tak dla systemów poniżej 4 brygad */
  holidaysOff?: boolean;
  /** okres rozliczeniowy czasu pracy w miesiącach (1, 3, 4, 6, 12); domyślnie 1 */
  settlementMonths?: number;
  /** pierwszy miesiąc okresu rozliczeniowego, od którego liczą się kolejne okresy (RRRR-MM) */
  settlementStart?: string;
}

export interface Exclusion {
  id: string;
  kind: 'weekly' | 'date';
  /** 0 = niedziela … 6 = sobota */
  weekday?: number;
  date?: string;
  shiftCodes: string[];
  note?: string;
}

export interface Line {
  id: string;
  name: string;
  /** linia główna, np. „CFM” dla podlinii Lutowanie / Moduły / Rdzenie */
  group?: string;
  /** systemy zmianowe (wzorce) używane na linii; brak = wszystkie */
  patternIds?: string[];
}

export interface Station {
  id: string;
  lineId: string;
  name: string;
  /** ilu kwalifikowanych ludzi musi być na stanowisku w każdej godzinie */
  required: number;
  /** minimalny poziom matrycy, który samodzielnie obsadza stanowisko */
  minLevel: number;
  order: number;
  /** stanowiska, których operator może jednocześnie obsłużyć to stanowisko (np. OP50-2 dla OP51/52) */
  pairWith?: string[];
  /** stanowisko specjalne (★), np. do premii za pracę na nim */
  special?: boolean;
}

export interface SkillEntry {
  level: number;
  expires?: string;
}

export interface Worker {
  id: string;
  name: string;
  type: WorkerType;
  agency?: string;
  patternId: string;
  brigade: BrigadeId;
  lineId: string;
  homeStationId: string | null;
  active: boolean;
  skills: Record<string, SkillEntry>;
  /** login do aplikacji pracownika */
  email?: string;
  /** długość zmiany pracownika, gdy inna niż w systemie linii (np. 12 h w systemie 8 h) */
  shiftHours?: number;
  /** stanowiska, które pracownik stale obsługuje razem ze swoim stanowiskiem */
  alsoStationIds?: string[];
  /** pozostała pula urlopu wypoczynkowego w dniach (np. z systemu kadrowego), do planowania urlopów */
  leaveDays?: number;
  /** data zatrudnienia (RRRR-MM-DD) */
  hireDate?: string;
  /** koniec obecnej umowy; brak = umowa bezterminowa albo nie wpisano */
  contractEnd?: string;
  /** do kiedy ważne badanie lekarskie dopuszczające do pracy (sama data, bez wyniku) */
  medicalExpiry?: string;
}

export type AbsenceReason = 'L4' | 'UW' | 'NN' | 'INNE';

export interface Absence {
  id: string;
  workerId: string;
  from: string;
  to: string;
  reason: AbsenceReason;
  note?: string;
}

/** Zmiana obsady na jeden dzień: przesunięcie, dodatkowa zmiana albo rezerwa. */
export interface Assignment {
  id: string;
  date: string;
  workerId: string;
  lineId: string;
  /** null = rezerwa linii */
  stationId: string | null;
  /** ustawione dla dodatkowej zmiany (pracownik normalnie ma wolne) */
  extraShift?: { start: number; hours: number };
  /** zmiana w grafiku na ten dzień z innymi godzinami (np. 12 h zamiast 8 h) — nie jest dodatkową zmianą */
  shift?: { start: number; hours: number };
  /** stanowiska obsługiwane tego dnia równocześnie ze stanowiskiem głównym; [] = żadne */
  alsoStationIds?: string[];
  source: 'manual' | 'replacement';
}

/** Ręczna zmiana komórki grafiku brygady. */
export interface RotaOverride {
  id: string;
  patternId: string;
  brigade: BrigadeId;
  date: string;
  code: string;
}

/** Docelowa liczba dni pracy brygad w miesiącu dla danego wzorca. */
export interface Target {
  id: string;
  patternId: string;
  month: string;
  days: Partial<Record<BrigadeId, number>>;
}

export interface HistoryEntry {
  id: string;
  at: string;
  user: string;
  text: string;
}

export interface AppState {
  shiftDefs: ShiftDef[];
  patterns: Pattern[];
  exclusions: Exclusion[];
  targets: Target[];
  lines: Line[];
  stations: Station[];
  workers: Worker[];
  absences: Absence[];
  assignments: Assignment[];
  rotaOverrides: RotaOverride[];
  history: HistoryEntry[];
}

export function patternBrigades(p: Pattern | undefined): BrigadeId[] {
  return p?.brigades?.length ? p.brigades : BRIGADES;
}

export function holidaysOff(p: Pattern | undefined): boolean {
  if (!p) return false;
  return p.holidaysOff ?? patternBrigades(p).length < 4;
}

export function linePatterns(state: AppState, lineId: string): Pattern[] {
  const line = state.lines.find((l) => l.id === lineId);
  const ids = line?.patternIds;
  return ids?.length ? state.patterns.filter((p) => ids.includes(p.id)) : state.patterns;
}

/** Czy stanowiska mogą być obsłużone przez jedną osobę (relacja symetryczna). */
export function canPair(state: AppState, a: string, b: string): boolean {
  if (a === b) return false;
  const sa = state.stations.find((s) => s.id === a);
  const sb = state.stations.find((s) => s.id === b);
  return !!sa && !!sb && (!!sa.pairWith?.includes(b) || !!sb.pairWith?.includes(a));
}

export const COLLECTIONS = [
  'shiftDefs',
  'patterns',
  'exclusions',
  'targets',
  'lines',
  'stations',
  'workers',
  'absences',
  'assignments',
  'rotaOverrides',
  'history',
] as const satisfies readonly (keyof AppState)[];

export type CollectionName = (typeof COLLECTIONS)[number];

export const TYPE_LABEL: Record<WorkerType, string> = { PL: 'PL', CN: 'CN', AG: 'Agencja' };
export const REASON_LABEL: Record<AbsenceReason, string> = {
  L4: 'L4',
  UW: 'Urlop',
  NN: 'Nieobecność nieusprawiedliwiona',
  INNE: 'Inne',
};
export const LEVEL_LABEL = ['brak', 'w szkoleniu', 'pod nadzorem', 'samodzielny', 'ekspert / trener'];
