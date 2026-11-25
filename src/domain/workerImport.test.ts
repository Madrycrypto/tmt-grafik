import { describe, expect, it } from 'vitest';
import { demoState } from './seed';
import { applyImport, matchNames, parseDelimited, planImport, removeWorkers, workersCsv } from './workerImport';

describe('import listy pracowników', () => {
  it('czyta CSV z polskiego Excela (średnik, cudzysłowy, BOM)', () => {
    const rows = parseDelimited('﻿Imię i nazwisko;Linia\r\n"Nowak; Jan";HVAC 1\r\n');
    expect(rows).toEqual([['Imię i nazwisko', 'Linia'], ['Nowak; Jan', 'HVAC 1']]);
  });

  it('czyta wklejkę z Excela (tabulatory)', () => {
    expect(parseDelimited('a\tb\nc\td')).toEqual([['a', 'b'], ['c', 'd']]);
  });

  it('nowi pracownicy, typ CN dostaje 12 h, poziomy z kolumn stanowisk, błędne wiersze odrzucone', () => {
    const s = demoState();
    const rows = parseDelimited(
      [
        'Pracownik;Typ;Brygada;Linia;Stanowisko;Lutowanie;Pakowanie',
        'Testowy Adam;PL;A;HVAC 1;Lutowanie;3;2',
        'Li Test;CN;b;hvac 1;;;4',
        'Bez Linii;PL;C;Linia X;;;',
        'Zła Brygada;PL;E;HVAC 1;;;',
      ].join('\n'),
    );
    const { items } = planImport(s, rows, false);
    expect(items.map((i) => i.action)).toEqual(['new', 'new', 'error', 'error']);
    const [adam, li] = items;
    expect(adam.worker?.patternId).toBe('p8');
    expect(adam.worker?.homeStationId).toBe('hvac1-s2');
    expect(adam.worker?.skills['hvac1-s2'].level).toBe(3);
    expect(adam.worker?.skills['hvac1-s6'].level).toBe(2);
    expect(li.worker?.patternId).toBe('p12');
    expect(li.worker?.brigade).toBe('B');
    const before = s.workers.length;
    applyImport(s, items);
    expect(s.workers.length).toBe(before + 2);
  });

  it('istniejący: błąd bez zgody na aktualizację, z nią — aktualizacja tej samej osoby', () => {
    const s = demoState();
    const w = s.workers[0];
    const rows = parseDelimited(`Imię i nazwisko;Brygada\n${w.name};D`);
    expect(planImport(s, rows, false).items[0].action).toBe('error');
    const { items } = planImport(s, rows, true);
    expect(items[0]).toMatchObject({ action: 'update' });
    expect(items[0].worker).toMatchObject({ id: w.id, brigade: 'D', lineId: w.lineId });
  });

  it('eksport → import daje te same dane (round-trip)', () => {
    const s = demoState();
    const csv = workersCsv(s, s.workers);
    const { items } = planImport(s, parseDelimited(csv), true);
    expect(items.every((i) => i.action === 'update')).toBe(true);
    for (const it of items) {
      const orig = s.workers.find((w) => w.id === it.worker!.id)!;
      expect(it.worker).toEqual({ ...orig, agency: orig.agency });
    }
  });
});

describe('usuwanie listą', () => {
  it('dopasowuje nazwiska w dowolnej kolejności i bez polskich znaków, zgłasza brakujących', () => {
    const s = demoState();
    const [a, b] = s.workers;
    const reversed = a.name.split(' ').reverse().join(' ');
    const { found, missing } = matchNames(s, `Pracownik\n${reversed}\n${b.name.toUpperCase()}\nNieznany Ktoś`);
    expect(found.map((w) => w.id)).toEqual([a.id, b.id]);
    expect(missing).toEqual(['Nieznany Ktoś']);
  });

  it('usunięcie czyści też przypisania i nieobecności', () => {
    const s = demoState();
    const w = s.workers[0];
    s.absences.push({ id: 'a', workerId: w.id, from: '2026-12-01', to: '2026-12-01', reason: 'L4' });
    s.assignments.push({ id: 'b', workerId: w.id, date: '2026-12-01', lineId: w.lineId, stationId: null, source: 'manual' });
    removeWorkers(s, new Set([w.id]));
    expect(s.workers.some((x) => x.id === w.id)).toBe(false);
    expect(s.absences.length + s.assignments.length).toBe(0);
  });
});
