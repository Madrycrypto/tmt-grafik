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

export function linePatterns(state: AppState, lineId: string): Pattern[] {
  const line = state.lines.find((l) => l.id === lineId);
  const ids = line?.patternIds;
  return ids?.length ? state.patterns.filter((p) => ids.includes(p.id)) : state.patterns;
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
