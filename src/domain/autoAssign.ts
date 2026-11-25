import { level } from './coverage';
import type { Station, Worker } from './types';

export interface Placement {
  workerId: string;
  /** null = rezerwa (brak stanowiska, na którym jest potrzebny i ma kwalifikacje) */
  stationId: string | null;
}

/**
 * Rozstawia ludzi na stanowiska według matrycy: najpierw obsadza jak najwięcej
 * wymaganych miejsc, przy tym zostawia ludzi na stanowisku macierzystym, gdzie się da.
 * Nadwyżka z kwalifikacją na macierzystym zostaje tam; reszta idzie do rezerwy.
 */
export function autoAssign(workers: Worker[], stations: Station[], current?: Map<string, string | null>): Placement[] {
  const slots: Station[] = [];
  for (const st of [...stations].sort((a, b) => a.order - b.order)) for (let i = 0; i < st.required; i++) slots.push(st);
  const ok = (w: Worker, st: Station) => level(w, st.id) >= st.minLevel;
  const pref = (w: Worker) => current?.get(w.id) ?? w.homeStationId;

  const slotOf = new Map<string, number>();
  const holder: (string | undefined)[] = slots.map(() => undefined);
  // 1. ludzie zostają tam, gdzie już są (albo na macierzystym), jeśli mają kwalifikację
  for (const w of workers) {
    const i = slots.findIndex((st, k) => holder[k] === undefined && st.id === pref(w) && ok(w, st));
    if (i >= 0) {
      holder[i] = w.id;
      slotOf.set(w.id, i);
    }
  }
  const byId = new Map(workers.map((w) => [w.id, w]));
  // 2. ścieżki powiększające (Kuhn): wolne miejsca obsadzamy, przesuwając ludzi tylko gdy trzeba
  const tryPlace = (w: Worker, seen: Set<number>): boolean => {
    const order = slots.map((_, i) => i).sort((a, b) => level(w, slots[b].id) - level(w, slots[a].id));
    for (const i of order) {
      if (seen.has(i) || !ok(w, slots[i])) continue;
      seen.add(i);
      const h = holder[i];
      if (h === undefined || tryPlace(byId.get(h)!, seen)) {
        if (slotOf.has(w.id)) holder[slotOf.get(w.id)!] = undefined;
        holder[i] = w.id;
        slotOf.set(w.id, i);
        return true;
      }
    }
    return false;
  };
  // najmniej uniwersalni pierwsi — wszechstronni zostają na końcu jako uzupełnienie
  const flex = (w: Worker) => stations.filter((st) => ok(w, st)).length;
  for (const w of [...workers].sort((a, b) => flex(a) - flex(b))) {
    if (!slotOf.has(w.id)) tryPlace(w, new Set());
  }
  return workers.map((w) => {
    const i = slotOf.get(w.id);
    if (i !== undefined) return { workerId: w.id, stationId: slots[i].id };
    const home = stations.find((st) => st.id === pref(w));
    return { workerId: w.id, stationId: home && ok(w, home) ? home.id : null };
  });
}
