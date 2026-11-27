import type { TrainingRecord } from './training';

export interface ReportInput {
  workerName: string;
  lineText: string;
  brigade: string;
  generated: string;
  /** stanowiska pracownika z poziomem z Matrixa */
  stations: { id: string; name: string; level: number }[];
  records: TrainingRecord[];
  /** podpisane linki do skanów (id wpisu → url); brak = skanu nie ma lub jest PDF */
  imageUrls: Record<string, string>;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const dmy = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;

/** Karta szkoleń do wydruku/PDF dla audytora: tabela stopni z podpisami, braki wyróżnione i skany na kolejnych stronach. */
export function trainingReportHtml(r: ReportInput): string {
  const rows: string[] = [];
  let missing = 0;
  for (const s of r.stations) {
    const mine = r.records.filter((x) => x.station_id === s.id);
    const top = Math.max(s.level, ...mine.map((x) => x.level));
    for (let l = 1; l <= top; l++) {
      const recs = mine.filter((x) => x.level === l);
      if (!recs.length) {
        missing++;
        rows.push(`<tr class="miss"><td>${esc(s.name)}</td><td>${l}/4</td><td colspan="3">BRAK DOKUMENTU</td></tr>`);
        continue;
      }
      for (const x of recs) {
        const doc = x.file_path ? (r.imageUrls[x.id] ? 'skan w załączniku' : 'plik PDF (w systemie)') : 'bez skanu';
        rows.push(`<tr><td>${esc(s.name)}</td><td>${l}/4</td><td>${dmy(x.trained_on)}</td><td>${esc(x.signed_by ?? '—')}</td><td>${doc}${x.note ? ` · ${esc(x.note)}` : ''}</td></tr>`);
      }
    }
  }
  const names = new Map(r.stations.map((s) => [s.id, s.name]));
  const pages = r.records
    .filter((x) => r.imageUrls[x.id])
    .map((x) => `<section class="scan"><div class="cap">${esc(names.get(x.station_id) ?? x.station_id)} · ${x.level}/4 · ${dmy(x.trained_on)}${x.signed_by ? ` · ${esc(x.signed_by)}` : ''}</div><img src="${esc(r.imageUrls[x.id])}" alt=""></section>`)
    .join('');
  return `<!doctype html><html lang="pl"><head><meta charset="utf-8"><title>Karta szkoleń — ${esc(r.workerName)}</title>
<style>
@page { size: A4; margin: 14mm; }
body { margin: 0; font-family: Arial, sans-serif; color: #111; font-size: 10pt; }
h1 { font-size: 16pt; margin: 0 0 2mm; } .meta { color: #555; margin-bottom: 5mm; }
table { border-collapse: collapse; width: 100%; } th, td { border: 1px solid #999; padding: 1.5mm 2mm; text-align: left; }
th { background: #eee; } tr.miss td { background: #fdecd8; font-weight: bold; }
.sum { margin: 4mm 0; font-weight: bold; }
.scan { break-before: page; } .cap { margin-bottom: 3mm; font-weight: bold; } .scan img { max-width: 100%; max-height: 235mm; display: block; }
</style></head><body>
<h1>Karta szkoleń — ${esc(r.workerName)}</h1>
<div class="meta">${esc(r.lineText)} · brygada ${esc(r.brigade)} · wygenerowano ${esc(r.generated)}</div>
<div class="sum">${missing ? `Braki dokumentów: ${missing}` : 'Komplet dokumentów dla wszystkich stopni'}</div>
<table><thead><tr><th>Stanowisko</th><th>Stopień</th><th>Data</th><th>Podpisali</th><th>Dokument</th></tr></thead><tbody>${rows.join('') || '<tr><td colspan="5">Brak stanowisk z poziomem.</td></tr>'}</tbody></table>
${pages}
<script>window.onload=()=>setTimeout(()=>window.print(),400)</script></body></html>`;
}
