import { describe, expect, it } from 'vitest';
import { trainingReportHtml } from './trainingReport';
import type { TrainingRecord } from './training';

const rec = (over: Partial<TrainingRecord>): TrainingRecord => ({
  id: 'r1', worker_id: 'w', station_id: 's1', level: 1, trained_on: '2026-03-02', signed_by: 'Kowalski <lider>', note: null, file_path: 'w/r1.jpg', created_by: null, created_at: '', ...over,
});
const base = { workerName: 'Jan "Test" Nowak', lineText: 'HVAC · Flame', brigade: 'A', generated: '27.11.2026', stations: [{ id: 's1', name: 'OP10', level: 3 }] };

describe('raport karty szkoleń', () => {
  it('wyróżnia braki, liczy je i wstawia skan', () => {
    const html = trainingReportHtml({ ...base, records: [rec({}), rec({ id: 'r3', level: 3, file_path: null })], imageUrls: { r1: 'https://x/y.jpg' } });
    expect(html).toContain('Braki dokumentów: 1');
    expect(html).toContain('<tr class="miss"><td>OP10</td><td>2/4</td>');
    expect(html).toContain('02.03.2026');
    expect(html).toContain('<img src="https://x/y.jpg"');
    expect(html).toContain('bez skanu');
  });
  it('komplet daje komunikat bez braków, a tekst użytkownika jest zabezpieczony', () => {
    const html = trainingReportHtml({ ...base, stations: [{ id: 's1', name: 'OP10', level: 1 }], records: [rec({})], imageUrls: {} });
    expect(html).toContain('Komplet dokumentów');
    expect(html).not.toContain('<lider>');
    expect(html).toContain('Kowalski &lt;lider&gt;');
    expect(html).toContain('Jan &quot;Test&quot; Nowak');
    expect(html).toContain('plik PDF (w systemie)');
  });
});
