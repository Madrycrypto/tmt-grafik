import { describe, expect, it } from 'vitest';
import { applyChanges, diffState } from './undo';
import { demoState } from './seed';

describe('cofanie zmian', () => {
  it('cofa i ponawia dodanie, zmianę i usunięcie', () => {
    const prev = demoState();
    const next = structuredClone(prev);
    next.workers[0].name = 'Zmieniony';
    const gone = next.workers.pop()!;
    next.absences.push({ id: 'ab1', workerId: next.workers[1].id, from: '2026-12-01', to: '2026-12-01', reason: 'L4' });
    const changes = diffState(prev, next);
    expect(changes).toHaveLength(3);

    const undone = structuredClone(next);
    expect(applyChanges(undone, changes, 'undo')).toBe(0);
    expect(undone.workers.find((w) => w.id === prev.workers[0].id)!.name).toBe(prev.workers[0].name);
    expect(undone.workers.some((w) => w.id === gone.id)).toBe(true);
    expect(undone.absences.some((a) => a.id === 'ab1')).toBe(false);

    const redone = structuredClone(undone);
    expect(applyChanges(redone, changes, 'redo')).toBe(0);
    expect(redone.workers.find((w) => w.id === prev.workers[0].id)!.name).toBe('Zmieniony');
    expect(redone.workers.some((w) => w.id === gone.id)).toBe(false);
  });

  it('nie nadpisuje rekordu, który ktoś zmienił w międzyczasie', () => {
    const prev = demoState();
    const next = structuredClone(prev);
    next.workers[0].name = 'Moja zmiana';
    const changes = diffState(prev, next);
    const remote = structuredClone(next);
    remote.workers[0].name = 'Zmiana kolegi';
    expect(applyChanges(remote, changes, 'undo')).toBe(1);
    expect(remote.workers[0].name).toBe('Zmiana kolegi');
  });
});
