import { parseDelimited } from '../domain/workerImport';

/** Wartość komórki: tekst albo liczba (Excel zapisuje daty i godziny jako liczby dni). */
export type Cell = string | number;
export type Table = Cell[][];

/**
 * Czyta pierwszy arkusz z pliku .xlsx, .csv/.txt albo „.xls”, który jest tabelą HTML
 * (tak eksportuje większość aplikacji webowych). Bez zewnętrznych bibliotek: .xlsx to zip
 * z plikami XML, rozpakowywany wbudowanym DecompressionStream.
 */
export async function readTable(name: string, bytes: Uint8Array): Promise<Table> {
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return readXlsx(bytes);
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) {
    throw new Error('OLD_XLS');
  }
  const text = decode(bytes);
  const head = text.slice(0, 2000).toLowerCase();
  if (head.includes('<table') || head.includes('<html')) return readHtml(text);
  if (head.includes('<workbook') || head.includes('urn:schemas-microsoft-com:office:spreadsheet')) return readSpreadsheetMl(text);
  void name;
  return parseDelimited(text);
}

function decode(bytes: Uint8Array): string {
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  // pliki z polskiego Excela bywają w Windows-1250
  if (utf8.includes('�')) return new TextDecoder('windows-1250').decode(bytes);
  return utf8.replace(/^﻿/, '');
}

function readHtml(text: string): Table {
  const doc = new DOMParser().parseFromString(text, 'text/html');
  const table = [...doc.querySelectorAll('table')].sort((a, b) => b.rows.length - a.rows.length)[0];
  if (!table) return [];
  return [...table.rows].map((r) => [...r.cells].map((c) => (c.textContent ?? '').trim()));
}

function readSpreadsheetMl(text: string): Table {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const rows = [...doc.getElementsByTagName('Row')];
  return rows.map((r) => {
    const out: Cell[] = [];
    for (const c of [...r.getElementsByTagName('Cell')]) {
      const idx = c.getAttribute('ss:Index');
      if (idx) while (out.length < Number(idx) - 1) out.push('');
      out.push((c.getElementsByTagName('Data')[0]?.textContent ?? '').trim());
    }
    return out;
  });
}

// ---------- .xlsx (zip) ----------

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Pliki z archiwum zip (metody 0 = bez kompresji i 8 = deflate). */
export async function unzip(bytes: Uint8Array, want: (name: string) => boolean): Promise<Map<string, string>> {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('BAD_ZIP');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out = new Map<string, string>();
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('BAD_ZIP');
    const method = dv.getUint16(p + 10, true);
    const size = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (!want(name)) continue;
    const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    const raw = bytes.subarray(start, start + size);
    const data = method === 0 ? raw : method === 8 ? await inflate(raw) : null;
    if (data) out.set(name, new TextDecoder().decode(data));
  }
  return out;
}

function colIndex(ref: string): number {
  let n = 0;
  for (const ch of ref.replace(/\d+$/, '')) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

async function readXlsx(bytes: Uint8Array): Promise<Table> {
  const files = await unzip(bytes, (n) => n === 'xl/sharedStrings.xml' || n === 'xl/workbook.xml' || n === 'xl/_rels/workbook.xml.rels' || /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
  const xml = (s: string) => new DOMParser().parseFromString(s, 'application/xml');
  const shared = files.get('xl/sharedStrings.xml')
    ? [...xml(files.get('xl/sharedStrings.xml')!).getElementsByTagName('si')].map((si) => [...si.getElementsByTagName('t')].map((t) => t.textContent ?? '').join(''))
    : [];
  // pierwszy arkusz wg kolejności w skoroszycie
  let sheetPath = [...files.keys()].filter((n) => n.startsWith('xl/worksheets/')).sort()[0];
  const wb = files.get('xl/workbook.xml');
  const rels = files.get('xl/_rels/workbook.xml.rels');
  if (wb && rels) {
    const first = xml(wb).getElementsByTagName('sheet')[0];
    const rid = first?.getAttribute('r:id') ?? first?.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    const target = [...xml(rels).getElementsByTagName('Relationship')].find((r) => r.getAttribute('Id') === rid)?.getAttribute('Target');
    if (target) sheetPath = 'xl/' + target.replace(/^\/?xl\//, '').replace(/^\//, '');
  }
  const sheet = sheetPath ? files.get(sheetPath) : undefined;
  if (!sheet) return [];
  const table: Table = [];
  for (const row of [...xml(sheet).getElementsByTagName('row')]) {
    const r = Number(row.getAttribute('r') ?? table.length + 1) - 1;
    const cells: Cell[] = [];
    for (const c of [...row.getElementsByTagName('c')]) {
      const i = c.getAttribute('r') ? colIndex(c.getAttribute('r')!) : cells.length;
      const tp = c.getAttribute('t');
      const v = c.getElementsByTagName('v')[0]?.textContent ?? '';
      let val: Cell;
      if (tp === 's') val = shared[Number(v)] ?? '';
      else if (tp === 'inlineStr') val = [...c.getElementsByTagName('t')].map((t) => t.textContent ?? '').join('');
      else if (tp === 'str' || tp === 'b' || tp === 'e') val = v;
      else val = v === '' ? '' : Number(v);
      while (cells.length < i) cells.push('');
      cells[i] = val;
    }
    while (table.length < r) table.push([]);
    table[r] = cells;
  }
  return table;
}
