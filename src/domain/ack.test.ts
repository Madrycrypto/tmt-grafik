import { describe, expect, it } from 'vitest';
import { ackPush } from '../../supabase/functions/tmt-ack/ack';
import { ackStatus } from './messages';

describe('potwierdzenie odbioru wiadomości', () => {
  it('mała grupa: push przy każdym potwierdzeniu, z licznikiem', () => {
    const p = ackPush({ title: 'Zmiana grafiku', total: 1, confirmed: 1, names: ['Jan Kowalski'] }, 'pl')!;
    expect(p.body).toBe('Jan Kowalski potwierdził(a) odbiór (1/1)');
    expect(p.title).toContain('Zmiana grafiku');
  });
  it('duża grupa: cisza do ostatniego potwierdzenia, potem jeden push', () => {
    expect(ackPush({ title: null, total: 40, confirmed: 17, names: ['A'] }, 'pl')).toBeNull();
    expect(ackPush({ title: null, total: 40, confirmed: 40, names: ['B'] }, 'pl')!.body).toContain('Wszyscy');
  });
  it('bez nowych potwierdzeń nic nie wysyła (ponowne kliknięcie)', () => {
    expect(ackPush({ title: 't', total: 2, confirmed: 2, names: [] }, 'pl')).toBeNull();
  });
  it('status: kto potwierdził (z czasem) i kto jeszcze nie', () => {
    const s = ackStatus({ worker_ids: ['a', 'b', 'c'] }, [
      { message_id: 'm', worker_id: 'b', read_at: '2026-11-27T10:00:00Z' },
      { message_id: 'm', worker_id: 'x', read_at: '2026-11-27T10:01:00Z' },
    ]);
    expect(s.confirmed).toEqual([{ id: 'b', at: '2026-11-27T10:00:00Z' }]);
    expect(s.pending).toEqual(['a', 'c']);
  });
});
