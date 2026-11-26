import { fmtRange } from './dates';
import { OFF } from './types';
import type { AppState, BrigadeId, Pattern, ShiftDef } from './types';

export type SystemKind = '1' | '2' | '3' | '3L' | '3LS' | '4';

export const SYSTEM_LABEL: Record<SystemKind, string> = {
  '1': '1 zmiana (pn–pt)',
  '2': '2 zmiany (pn–pt, rotacja co tydzień)',
  '3': '3 zmiany (pn–pt, rotacja co tydzień)',
  '3L': '3 zmiany lekkie (4 brygady pn–pt, maks. 3 nocki w tygodniu)',
  '3LS': '3 zmiany lekkie + sobota rano (4 brygady, maks. 3 nocki, pełny wymiar)',
  '4': '4 brygady — ruch ciągły (7 dni)',
};

export interface SystemSpec {
  kind: SystemKind;
  hours: 8 | 12;
  /** godzina rozpoczęcia pierwszej zmiany */
  start: number;
}

const ANCHOR_MONDAY = '2026-01-05';

/** Buduje wzorzec rotacji i brakujące definicje zmian dla wybranego systemu. */
export function buildSystem(state: AppState, spec: SystemSpec): { shiftDefs: ShiftDef[]; pattern: Pattern } | { error: string } {
  const { kind, hours, start } = spec;
  const light = kind === '3L' || kind === '3LS';
  if (hours === 12 && (kind === '3' || light)) return { error: 'System 3-zmianowy jest tylko dla zmian 8 h (3 × 8 h = doba).' };
  const count = kind === '4' ? (hours === 8 ? 3 : 2) : light ? 3 : Number(kind);
  const labels = (hours === 8 ? ['R', 'P', 'N'] : ['D', 'N']).slice(0, count);
  const slots = labels.map((label, i) => ({ label, start: (start + i * hours) % 24 }));
  const newDefs: ShiftDef[] = [];
  const codes = slots.map(({ label, start: st }) => {
    const existing = [...state.shiftDefs, ...newDefs].find((d) => d.start === st && d.hours === hours && d.label === label);
    if (existing) return existing.code;
    const code = `${label}${hours}_${String(st).padStart(2, '0')}`;
    newDefs.push({ code, label, start: st, hours });
    return code;
  });
  const week = (c: string) => [c, c, c, c, c, OFF, OFF];
  let sequence: string[];
  let offsets: Record<BrigadeId, number>;
  let brigades: BrigadeId[];
  if (kind === '1') {
    sequence = week(codes[0]);
    offsets = { A: 0, B: 0, C: 0, D: 0 };
    brigades = ['A'];
  } else if (kind === '2') {
    sequence = [...week(codes[0]), ...week(codes[1])];
    offsets = { A: 0, B: 7, C: 0, D: 0 };
    brigades = ['A', 'B'];
  } else if (kind === '3') {
    sequence = [...week(codes[0]), ...week(codes[1]), ...week(codes[2])];
    offsets = { A: 0, B: 14, C: 7, D: 0 };
    brigades = ['A', 'B', 'C'];
  } else if (light) {
    // Cztery role tygodniowe, każda brygada przechodzi przez wszystkie w 4 tygodnie.
    // Kolejność zmian w tygodniu tylko rośnie (R → P → N), więc zawsze jest ≥ 11 h odpoczynku;
    // nocki: 3 w jednym tygodniu, 2 w drugim, potem 2 tygodnie bez nocek.
    const [R, P, N] = codes;
    sequence = [
      // wariant z sobotą: po tygodniu nocek sobota rano (8 h) — 20 dni na 4 tygodnie, pełny wymiar
      ...[N, N, N, OFF, R, kind === '3LS' ? R : OFF, OFF],
      ...[R, R, P, N, N, OFF, OFF],
      ...[P, P, P, P, P, OFF, OFF],
      ...[R, R, R, R, R, OFF, OFF],
    ];
    offsets = { A: 0, B: 7, C: 14, D: 21 };
    brigades = ['A', 'B', 'C', 'D'];
  } else {
    sequence = hours === 8 ? [codes[0], codes[0], codes[1], codes[1], codes[2], codes[2], OFF, OFF] : [codes[0], codes[0], codes[1], codes[1], OFF, OFF, OFF, OFF];
    offsets = { A: 0, B: 6, C: 4, D: 2 };
    brigades = ['A', 'B', 'C', 'D'];
  }
  const times = slots.map((s) => fmtRange(s.start, hours)).join(' / ');
  const name =
    kind === '3LS'
      ? `3 zmiany lekkie 8 h + sobota rano, 4 brygady, maks. 3 nocki, pełny wymiar (${times})`
      : kind === '3L'
      ? `3 zmiany lekkie 8 h pn–pt, 4 brygady, maks. 3 nocki (${times})`
      : `${SYSTEM_LABEL[kind].split(' (')[0]} ${hours} h${kind === '4' ? '' : ' pn–pt'} (${times})`;
  const id = `sys${kind}_${hours}_${String(start).padStart(2, '0')}`;
  if (state.patterns.some((p) => p.id === id)) return { error: 'Taki system już istnieje.' };
  return { shiftDefs: newDefs, pattern: { id, name, sequence, offsets, anchor: ANCHOR_MONDAY, brigades, ...(light ? { holidaysOff: true } : {}) } };
}
