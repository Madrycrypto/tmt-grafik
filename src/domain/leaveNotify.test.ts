import { describe, expect, it } from 'vitest';
import { rejectedPush } from '../../supabase/functions/tmt-leave-notify/text';

describe('push o odrzuconym urlopie', () => {
  it('podaje datę w polsku i po chińsku', () => {
    expect(rejectedPush('2026-12-12', 'pl').body).toContain('12.12.2026');
    expect(rejectedPush('2026-12-12', 'pl').title).toBe('Zgłoszenie urlopu odrzucone');
    expect(rejectedPush('2026-12-12', 'zh').body).toContain('12.12.2026');
    expect(rejectedPush('2026-12-12', 'zh').title).not.toBe(rejectedPush('2026-12-12', 'pl').title);
  });
});
