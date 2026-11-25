import { uid } from './actions';
import { t } from '../i18n';
import { BRIGADES, linePatterns, patternBrigades } from './types';
import type { AppState, BrigadeId, Worker, WorkerType } from './types';

export type Cell = string | number | boolean | Date | null | undefined;

export function norm(v: Cell): string {
  return String(v ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ł/g, 'l')
    .replace(/Ł/g, 'L')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** CSV/TSV z Excela: separator wykrywany z pierwszej linii (tab, średnik albo przecinek). */
export function parseDelimited(text: string): string[][] {
  const clean = text.replace(/^﻿/, '');
  const first = clean.split(/\r?\n/, 1)[0] ?? '';
  const sep = first.includes('\t') ? '\t' : first.split(';').length >= first.split(',').length ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (quoted) {
      if (ch === '"' && clean[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === sep) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && clean[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

const HEADERS: Record<string, string[]> = {
  name: ['imie i nazwisko', 'nazwisko i imie', 'pracownik', 'nazwisko', 'name', 'osoba', '姓名', '员工'],
  type: ['typ', 'rodzaj', 'typ pracownika', '类型'],
  agency: ['agencja', 'nazwa agencji', '劳务公司', '中介'],
  system: ['system', 'system pracy', 'czas pracy', 'godziny', 'zmiana h', '班制'],
  brigade: ['brygada', 'bryg', 'bryg.', 'grupa', '班组'],
  line: ['linia', '产线', '线体'],
  station: ['stanowisko', 'stanowisko macierzyste', '工位'],
  active: ['aktywny', 'status', '在职', '状态'],
};

export interface ImportItem {
  row: number;
  name: string;
  action: 'new' | 'update' | 'error';
  errors: string[];
  warnings: string[];
  worker?: Worker;
  skills: number;
}

function parseType(v: string, agency: string): WorkerType | null {
  const t = norm(v);
  if (!t) return agency ? 'AG' : null;
  if (['pl', 'polak', 'polska', 'tmt', 'tmt pl', '波方', '波兰'].includes(t)) return 'PL';
  if (['cn', 'chiny', 'chinczyk', 'tmt cn', 'china', '中方', '中国'].includes(t)) return 'CN';
  if (t.startsWith('ag') || t.includes('agencj') || t.includes('劳务')) return 'AG';
  return null;
}

function hoursOfPattern(state: AppState, p: AppState['patterns'][number]): number | undefined {
  return state.shiftDefs.find((s) => s.code === p.sequence.find((c) => c !== 'W'))?.hours;
}

/** System po nazwie albo po samych godzinach („8h”) — wtedy najpierw systemy linii pracownika. */
function patternFor(state: AppState, v: string, lineId?: string): string | null {
  const t = norm(v);
  if (!t) return null;
  const exact = state.patterns.find((p) => norm(p.name) === t || p.id === t);
  if (exact) return exact.id;
  const hours = Number(t.replace(/[^0-9]/g, ''));
  if (!hours || /[a-z]{3,}/.test(t.replace(/\b(h|godz|godzin|zmiana)\b/g, ''))) return null;
  const pool = lineId ? [...linePatterns(state, lineId), ...state.patterns] : state.patterns;
  return pool.find((p) => hoursOfPattern(state, p) === hours)?.id ?? null;
}

function patternByHours(state: AppState, hours: number, lineId?: string): string | undefined {
  const pool = lineId ? [...linePatterns(state, lineId), ...state.patterns] : state.patterns;
  return pool.find((p) => hoursOfPattern(state, p) === hours)?.id;
}

function parseActive(v: string): boolean | null {
  const t = norm(v);
  if (!t) return null;
  if (['nie', 'n', '0', 'false', 'nieaktywny', 'zwolniony', '否', '离职'].includes(t)) return false;
  return true;
}

/** Plan importu listy pracowników (bez zmiany stanu). Pierwszy wiersz to nagłówki. */
export function planImport(state: AppState, rows: Cell[][], updateExisting: boolean): { items: ImportItem[]; problem?: string } {
  if (rows.length < 2) return { items: [], problem: t('Plik musi mieć wiersz nagłówków i co najmniej jednego pracownika.') };
  const head = rows[0].map(norm);
  const col: Record<string, number> = {};
  for (const [key, names] of Object.entries(HEADERS)) {
    const i = head.findIndex((h) => names.includes(h));
    if (i >= 0) col[key] = i;
  }
  if (col.name === undefined) return { items: [], problem: t('Brak kolumny „Imię i nazwisko” (albo „Pracownik”).') };
  const known = new Set(Object.values(col));
  const skillCols = head.map((h, i) => ({ h, i })).filter((x) => !known.has(x.i) && x.h);

  const byName = new Map(state.workers.map((w) => [norm(w.name), w]));
  const seen = new Set<string>();
  const get = (r: Cell[], k: string) => (col[k] === undefined ? '' : String(r[col[k]] ?? '').trim());

  const items = rows.slice(1).map((r, idx): ImportItem => {
    const name = get(r, 'name').replace(/\s+/g, ' ');
    const item: ImportItem = { row: idx + 2, name, action: 'error', errors: [], warnings: [], skills: 0 };
    if (!name) {
      item.errors.push(t('brak nazwiska'));
      return item;
    }
    const key = norm(name);
    if (seen.has(key)) {
      item.errors.push(t('powtórzone w pliku'));
      return item;
    }
    seen.add(key);
    const existing = byName.get(key);
    if (existing && !updateExisting) {
      item.errors.push(t('już istnieje (zaznacz „aktualizuj istniejących”)'));
      return item;
    }

    const agency = get(r, 'agency');
    const typeRaw = get(r, 'type');
    const type = parseType(typeRaw, agency) ?? existing?.type ?? 'PL';
    if (typeRaw && !parseType(typeRaw, agency)) item.warnings.push(t('nieznany typ „{raw}” → {type}', { raw: typeRaw, type }));

    const lineRaw = get(r, 'line');
    const line = lineRaw ? state.lines.find((l) => norm(l.name) === norm(lineRaw)) : state.lines.find((l) => l.id === existing?.lineId);
    if (!line) item.errors.push(lineRaw ? t('nieznana linia „{raw}” (dodaj ją w Linie i stanowiska)', { raw: lineRaw }) : t('brak linii'));

    const sysRaw = get(r, 'system');
    let patternId = patternFor(state, sysRaw, line?.id) ?? (sysRaw ? undefined : existing?.patternId);
    if (!patternId) patternId = (type === 'CN' ? patternByHours(state, 12, line?.id) : patternByHours(state, 8, line?.id)) ?? state.patterns[0]?.id;
    if (sysRaw && !patternFor(state, sysRaw, line?.id)) item.warnings.push(t('nieznany system „{raw}”', { raw: sysRaw }));
    if (!patternId) item.errors.push(t('brak wzorców zmian w ustawieniach'));

    const bRaw = get(r, 'brigade').toUpperCase().replace(/^BRYG(ADA)?\.?\s*/, '');
    const brigade = (BRIGADES as string[]).includes(bRaw) ? (bRaw as BrigadeId) : existing?.brigade;
    if (!brigade) item.errors.push(bRaw ? t('brygada „{raw}” (dozwolone A–D)', { raw: bRaw }) : t('brak brygady'));

    if (brigade && patternId && !patternBrigades(state.patterns.find((p) => p.id === patternId)).includes(brigade))
      item.warnings.push(t('brygada {b} nie występuje w tym systemie zmianowym', { b: brigade }));

    if (item.errors.length || !line || !brigade || !patternId) return item;

    const stations = state.stations.filter((s) => s.lineId === line.id);
    const stRaw = get(r, 'station');
    let homeStationId = existing && existing.lineId === line.id ? existing.homeStationId : null;
    if (col.station !== undefined) {
      const st = stations.find((s) => norm(s.name) === norm(stRaw));
      homeStationId = st?.id ?? null;
      if (stRaw && !st && !['rezerwa', '-'].includes(norm(stRaw))) item.warnings.push(t('stanowisko „{raw}” nie istnieje na {line} → rezerwa', { raw: stRaw, line: line.name }));
    }

    const skills = { ...(existing?.skills ?? {}) };
    for (const { h, i } of skillCols) {
      const st = stations.find((s) => norm(s.name) === h);
      if (!st) continue;
      const raw = String(r[i] ?? '').trim();
      if (raw === '') continue;
      const lv = Number(raw.replace(',', '.'));
      if (!Number.isInteger(lv) || lv < 0 || lv > 4) {
        item.warnings.push(t('poziom „{raw}” na {station} pominięty (0–4)', { raw, station: st.name }));
        continue;
      }
      if (lv === 0) delete skills[st.id];
      else skills[st.id] = { ...skills[st.id], level: lv };
      item.skills++;
    }

    const active = parseActive(get(r, 'active')) ?? existing?.active ?? true;
    item.worker = {
      id: existing?.id ?? uid('w'),
      name,
      type,
      agency: type === 'AG' ? agency || existing?.agency : undefined,
      patternId,
      brigade,
      lineId: line.id,
      homeStationId,
      active,
      skills,
    };
    item.action = existing ? 'update' : 'new';
    return item;
  });
  return { items };
}

export function applyImport(state: AppState, items: ImportItem[]): void {
  for (const it of items) {
    if (!it.worker || it.action === 'error') continue;
    const i = state.workers.findIndex((w) => w.id === it.worker!.id);
    if (i >= 0) state.workers[i] = it.worker;
    else state.workers.push(it.worker);
  }
}

/** Dopasowanie listy nazwisk (po jednym w wierszu, kolejność imię/nazwisko dowolna). */
export function matchNames(state: AppState, text: string): { found: Worker[]; missing: string[] } {
  const rows = parseDelimited(text);
  const index = new Map<string, Worker>();
  for (const w of state.workers) {
    index.set(norm(w.name), w);
    index.set(norm(w.name).split(' ').reverse().join(' '), w);
  }
  const found = new Map<string, Worker>();
  const missing: string[] = [];
  rows.forEach((r, i) => {
    const raw = String(r[0] ?? '').trim();
    if (!raw) return;
    if (i === 0 && HEADERS.name.includes(norm(raw))) return;
    const w = index.get(norm(raw));
    if (w) found.set(w.id, w);
    else missing.push(raw);
  });
  return { found: [...found.values()], missing };
}

export function removeWorkers(state: AppState, ids: Set<string>): void {
  state.workers = state.workers.filter((w) => !ids.has(w.id));
  state.assignments = state.assignments.filter((a) => !ids.has(a.workerId));
  state.absences = state.absences.filter((a) => !ids.has(a.workerId));
}

function csvCell(v: string | number): string {
  const s = String(v);
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Lista pracowników jako CSV dla polskiego Excela (średnik, BOM). Ten sam format przyjmuje import. */
export function workersCsv(state: AppState, workers: Worker[]): string {
  const stationNames = [...new Set([...state.stations].sort((a, b) => a.order - b.order).map((s) => s.name))];
  const systemOf = (w: Worker) => state.patterns.find((x) => x.id === w.patternId)?.name ?? '';
  const head = ['Imię i nazwisko', 'Typ', 'Agencja', 'System', 'Brygada', 'Linia', 'Stanowisko', 'Aktywny', ...stationNames];
  const lines = workers.map((w) => {
    const lineStations = state.stations.filter((s) => s.lineId === w.lineId);
    return [
      w.name,
      w.type === 'AG' ? 'Agencja' : w.type,
      w.agency ?? '',
      systemOf(w),
      w.brigade,
      state.lines.find((l) => l.id === w.lineId)?.name ?? '',
      state.stations.find((s) => s.id === w.homeStationId)?.name ?? 'rezerwa',
      w.active ? 'tak' : 'nie',
      ...stationNames.map((n) => {
        const st = lineStations.find((s) => s.name === n);
        return st ? (w.skills[st.id]?.level ?? 0) : '';
      }),
    ];
  });
  return '﻿' + [head, ...lines].map((r) => r.map(csvCell).join(';')).join('\r\n');
}
