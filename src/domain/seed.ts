import type { AppState, BrigadeId, Station, Worker, WorkerType } from './types';
import { buildSystem } from './templates';
import { BRIGADES, patternBrigades } from './types';

/** Podstawowa konfiguracja zmian i wzorców — wspólna dla trybu demo i nowej bazy. */
export function baseConfig(): Pick<AppState, 'shiftDefs' | 'patterns' | 'exclusions'> {
  return {
    shiftDefs: [
      { code: 'R8', label: 'R', start: 7, hours: 8 },
      { code: 'P8', label: 'P', start: 15, hours: 8 },
      { code: 'N8', label: 'N', start: 23, hours: 8 },
      { code: 'D12', label: 'D', start: 7, hours: 12 },
      { code: 'N12', label: 'N', start: 19, hours: 12 },
    ],
    patterns: [
      {
        id: 'p8',
        name: 'System 8 h (R-R-P-P-N-N-W-W)',
        sequence: ['R8', 'R8', 'P8', 'P8', 'N8', 'N8', 'W', 'W'],
        offsets: { A: 0, B: 6, C: 4, D: 2 },
        anchor: '2026-01-05',
      },
      {
        id: 'p12',
        name: 'System 12 h (D-D-N-N-W-W-W-W)',
        sequence: ['D12', 'D12', 'N12', 'N12', 'W', 'W', 'W', 'W'],
        offsets: { A: 0, B: 6, C: 4, D: 2 },
        anchor: '2026-01-05',
      },
    ],
    exclusions: [{ id: 'ex-sun-night', kind: 'weekly', weekday: 0, shiftCodes: ['N8', 'N12'], note: 'Niedziela — nie pracujemy w nocy' }],
  };
}

export function emptyState(): AppState {
  return {
    ...baseConfig(),
    targets: [],
    lines: [],
    stations: [],
    workers: [],
    absences: [],
    assignments: [],
    rotaOverrides: [],
    history: [],
  };
}

function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

const FIRST = ['Jan', 'Piotr', 'Anna', 'Tomasz', 'Katarzyna', 'Marek', 'Agnieszka', 'Paweł', 'Magdalena', 'Michał', 'Ewa', 'Krzysztof', 'Monika', 'Adam', 'Joanna', 'Łukasz', 'Barbara', 'Rafał', 'Natalia', 'Grzegorz'];
const LAST_M = ['Kowalski', 'Nowak', 'Wiśniewski', 'Wójcik', 'Kowalczyk', 'Kamiński', 'Lewandowski', 'Zieliński', 'Szymański', 'Woźniak', 'Dąbrowski', 'Kozłowski', 'Jankowski', 'Mazur', 'Kwiatkowski'];
const CN = ['Wang Lei', 'Li Na', 'Zhang Wei', 'Liu Yang', 'Chen Jie', 'Yang Fan', 'Zhao Min', 'Huang Bo', 'Zhou Xin', 'Wu Hao', 'Xu Ming', 'Sun Li', 'Ma Tao', 'Zhu Lin', 'Hu Jun', 'Guo Qiang'];

function feminine(last: string): string {
  return last.endsWith('ski') || last.endsWith('cki') ? last.slice(0, -1) + 'a' : last;
}

interface LineSpec {
  id: string;
  name: string;
  /** systemy zmianowe linii: 8 h i (opcjonalnie) 12 h */
  pattern8: string;
  pattern12?: string;
  stations: [string, number][];
  /** stanowiska domowe pracowników 8 h w każdej brygadzie (null = rezerwa) */
  crew8: (number | null)[];
  /** stanowiska domowe pracowników 12 h w każdej brygadzie */
  crew12: number[];
  /** indeks w crew8, który obsadza agencja */
  agency8?: number;
  agency12?: number;
}

const LINES: LineSpec[] = [
  {
    id: 'hvac1',
    name: 'HVAC 1',
    pattern8: 'p8',
    pattern12: 'p12',
    stations: [['Montaż parownika', 1], ['Lutowanie', 1], ['Test szczelności', 1], ['Montaż wentylatora', 1], ['Kontrola końcowa', 1], ['Pakowanie', 1]],
    crew8: [0, 1, 3, 5, null],
    crew12: [2, 4],
    agency8: 3,
  },
  {
    id: 'hvac2',
    name: 'HVAC 2',
    pattern8: 'p8',
    pattern12: 'p12',
    stations: [['Montaż obudowy', 1], ['Montaż wiązki', 1], ['Test funkcjonalny', 1], ['Pakowanie', 1], ['Etykietowanie', 1]],
    crew8: [0, 1, 3, 4, null],
    crew12: [2],
  },
  {
    id: 'cfm1',
    name: 'CFM 1',
    pattern8: 'sys2_8_06',
    stations: [['Wtrysk / prasa', 1], ['Montaż modułu', 2], ['Kontrola wizualna', 1], ['Pakowanie', 1]],
    crew8: [0, 1, 1, 2, 3, null],
    crew12: [],
    agency8: 4,
  },
];

export function demoState(): AppState {
  const rand = rng(20261125);
  const s = emptyState();
  // CFM pracuje na 2 zmianach pn–pt: 06–14 / 14–22
  const cfm = buildSystem(s, { kind: '2', hours: 8, start: 6 });
  if (!('error' in cfm)) {
    s.shiftDefs.push(...cfm.shiftDefs);
    s.patterns.push(cfm.pattern);
  }
  let pl = 0;
  let cn = 0;
  const nextName = (type: WorkerType): string => {
    if (type === 'CN') return CN[cn++ % CN.length] + (cn > CN.length ? ` ${Math.ceil(cn / CN.length)}` : '');
    const i = pl++;
    const first = FIRST[i % FIRST.length];
    const last = LAST_M[(i * 7) % LAST_M.length];
    const isF = ['Anna', 'Katarzyna', 'Agnieszka', 'Magdalena', 'Ewa', 'Monika', 'Joanna', 'Barbara', 'Natalia'].includes(first);
    return `${isF ? feminine(last) : last} ${first}`;
  };

  for (const spec of LINES) {
    s.lines.push({ id: spec.id, name: spec.name, patternIds: [spec.pattern8, ...(spec.pattern12 ? [spec.pattern12] : [])] });
    const stations: Station[] = spec.stations.map(([name, required], i) => ({
      id: `${spec.id}-s${i + 1}`,
      lineId: spec.id,
      name,
      required,
      minLevel: 3,
      order: i,
    }));
    s.stations.push(...stations);

    const make = (brigade: BrigadeId, home: number | null, type: WorkerType, patternId: string): Worker => {
      const skills: Worker['skills'] = {};
      for (const st of stations) {
        const r = rand();
        const lv = r < 0.25 ? 0 : r < 0.4 ? 1 : r < 0.6 ? 2 : r < 0.9 ? 3 : 4;
        if (lv > 0) skills[st.id] = { level: lv };
      }
      if (home !== null) skills[stations[home].id] = { level: rand() < 0.35 ? 4 : 3 };
      return {
        id: `w${s.workers.length + 1}`,
        name: nextName(type),
        type,
        agency: type === 'AG' ? (rand() < 0.5 ? 'Agencja Bałtyk' : 'Agencja Północ') : undefined,
        patternId,
        brigade,
        lineId: spec.id,
        homeStationId: home === null ? null : stations[home].id,
        active: true,
        skills,
      };
    };

    const brig8 = patternBrigades(s.patterns.find((p) => p.id === spec.pattern8));
    for (const b of BRIGADES) {
      if (brig8.includes(b)) spec.crew8.forEach((home, i) => s.workers.push(make(b, home, i === spec.agency8 ? 'AG' : 'PL', spec.pattern8)));
      if (spec.pattern12) spec.crew12.forEach((home, i) => s.workers.push(make(b, home, i === spec.agency12 ? 'AG' : 'CN', spec.pattern12!)));
    }
  }
  return s;
}
