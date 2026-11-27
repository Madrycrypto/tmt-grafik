import { strToU8, zipSync } from 'fflate';

/**
 * Minimalny zapis .xlsx (bez zależności od dużych bibliotek): komórki z kolorami i ramkami,
 * scalanie, szerokości kolumn oraz ustawienia wydruku (A4 poziomo, 1 strona wszerz,
 * powtarzane nagłówki, podział stron). Wystarcza do grafiku do wydrukowania.
 */

export interface XStyle {
  bold?: boolean;
  italic?: boolean;
  size?: number;
  /** kolor tekstu RRGGBB */
  color?: string;
  /** kolor tła RRGGBB */
  bg?: string;
  align?: 'left' | 'center' | 'right';
  valign?: 'top' | 'center';
  wrap?: boolean;
  border?: boolean;
}

export interface XCell {
  v: string | number | null;
  s?: XStyle;
}

export interface XSheet {
  name: string;
  rows: (XCell | null)[][];
  colWidths?: number[];
  /** wysokości wierszy w punktach, klucz = numer wiersza od 1 */
  rowHeights?: Record<number, number>;
  /** scalenia w zapisie A1, np. "A1:F1" */
  merges?: string[];
  /** liczba zamrożonych wierszy / kolumn */
  freeze?: { rows: number; cols: number };
  /** wiersze (od 1) powtarzane na każdej stronie wydruku */
  printTitleRows?: [number, number];
  /** po tych wierszach (od 1) zaczyna się nowa strona */
  pageBreaksAfter?: number[];
  footerLeft?: string;
}

const esc = (s: string) =>
  // eslint-disable-next-line no-control-regex
  s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function colName(i: number): string {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

export const ref = (row: number, col: number) => `${colName(col)}${row}`;

class Styles {
  private fonts: string[] = ['<font><sz val="10"/><name val="Calibri"/></font>'];
  private fills: string[] = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'];
  private borders: string[] = ['<border><left/><right/><top/><bottom/><diagonal/></border>'];
  private xfs: string[] = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'];
  private index = new Map<string, number>();

  private slot(list: string[], xml: string): number {
    const i = list.indexOf(xml);
    if (i >= 0) return i;
    list.push(xml);
    return list.length - 1;
  }

  id(s?: XStyle): number {
    if (!s) return 0;
    const key = JSON.stringify(s);
    const hit = this.index.get(key);
    if (hit !== undefined) return hit;
    const font = this.slot(
      this.fonts,
      `<font>${s.bold ? '<b/>' : ''}${s.italic ? '<i/>' : ''}<sz val="${s.size ?? 10}"/>${s.color ? `<color rgb="FF${s.color}"/>` : ''}<name val="Calibri"/></font>`,
    );
    const fill = s.bg ? this.slot(this.fills, `<fill><patternFill patternType="solid"><fgColor rgb="FF${s.bg}"/><bgColor indexed="64"/></patternFill></fill>`) : 0;
    const edge = (n: string) => `<${n} style="thin"><color rgb="FF9AA3B2"/></${n}>`;
    const border = s.border ? this.slot(this.borders, `<border>${edge('left')}${edge('right')}${edge('top')}${edge('bottom')}<diagonal/></border>`) : 0;
    const align = `<alignment horizontal="${s.align ?? 'left'}" vertical="${s.valign ?? 'center'}"${s.wrap ? ' wrapText="1"' : ''}/>`;
    const xf = `<xf numFmtId="0" fontId="${font}" fillId="${fill}" borderId="${border}" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">${align}</xf>`;
    this.xfs.push(xf);
    const id = this.xfs.length - 1;
    this.index.set(key, id);
    return id;
  }

  xml(): string {
    return (
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      `<fonts count="${this.fonts.length}">${this.fonts.join('')}</fonts>` +
      `<fills count="${this.fills.length}">${this.fills.join('')}</fills>` +
      `<borders count="${this.borders.length}">${this.borders.join('')}</borders>` +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      `<cellXfs count="${this.xfs.length}">${this.xfs.join('')}</cellXfs>` +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
      '</styleSheet>'
    );
  }
}

function sheetXml(sh: XSheet, styles: Styles): string {
  const maxCol = Math.max(1, ...sh.rows.map((r) => r.length));
  const data = sh.rows
    .map((row, r) => {
      const h = sh.rowHeights?.[r + 1];
      const cells = row
        .map((c, i) => {
          if (!c) return '';
          const a = ref(r + 1, i);
          const s = styles.id(c.s);
          if (c.v === null || c.v === '') return `<c r="${a}" s="${s}"/>`;
          if (typeof c.v === 'number') return `<c r="${a}" s="${s}"><v>${c.v}</v></c>`;
          return `<c r="${a}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${esc(c.v)}</t></is></c>`;
        })
        .join('');
      return `<row r="${r + 1}"${h ? ` ht="${h}" customHeight="1"` : ''}>${cells}</row>`;
    })
    .join('');
  const cols = sh.colWidths?.length ? `<cols>${sh.colWidths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
  const fr = sh.freeze;
  const pane = fr && (fr.rows || fr.cols)
    ? `<pane${fr.cols ? ` xSplit="${fr.cols}"` : ''}${fr.rows ? ` ySplit="${fr.rows}"` : ''} topLeftCell="${ref(fr.rows + 1, fr.cols)}" activePane="${fr.rows && fr.cols ? 'bottomRight' : fr.rows ? 'bottomLeft' : 'topRight'}" state="frozen"/>`
    : '';
  const merges = sh.merges?.length ? `<mergeCells count="${sh.merges.length}">${sh.merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : '';
  const breaks = sh.pageBreaksAfter?.length
    ? `<rowBreaks count="${sh.pageBreaksAfter.length}" manualBreakCount="${sh.pageBreaksAfter.length}">${sh.pageBreaksAfter.map((r) => `<brk id="${r}" max="16383" man="1"/>`).join('')}</rowBreaks>`
    : '';
  const footer = `<headerFooter><oddFooter>&amp;L${esc(sh.footerLeft ?? '')}&amp;RStrona &amp;P z &amp;N</oddFooter></headerFooter>`;
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>' +
    `<dimension ref="A1:${ref(Math.max(1, sh.rows.length), maxCol - 1)}"/>` +
    `<sheetViews><sheetView workbookViewId="0" showGridLines="0">${pane}</sheetView></sheetViews>` +
    '<sheetFormatPr defaultRowHeight="15"/>' +
    cols +
    `<sheetData>${data}</sheetData>` +
    merges +
    '<printOptions horizontalCentered="1"/>' +
    '<pageMargins left="0.3" right="0.3" top="0.4" bottom="0.5" header="0.2" footer="0.25"/>' +
    '<pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>' +
    footer +
    breaks +
    '</worksheet>'
  );
}

/** Zwraca bajty pliku .xlsx. */
export function writeXlsx(sheets: XSheet[]): Uint8Array {
  const styles = new Styles();
  const sheetFiles = sheets.map((s) => sheetXml(s, styles));
  const names = sheets.map((s) => s.name.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31));
  const titles = sheets
    .map((s, i) => (s.printTitleRows ? `<definedName name="_xlnm.Print_Titles" localSheetId="${i}">'${esc(names[i])}'!$${s.printTitleRows[0]}:$${s.printTitleRows[1]}</definedName>` : ''))
    .join('');
  const NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
        '</Types>',
    ),
    '_rels/.rels': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${NS}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ),
    'xl/workbook.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${NS}"><sheets>` +
        names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
        `</sheets>${titles ? `<definedNames>${titles}</definedNames>` : ''}</workbook>`,
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${NS}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
        `<Relationship Id="rId${sheets.length + 1}" Type="${NS}/styles" Target="styles.xml"/></Relationships>`,
    ),
    'xl/styles.xml': strToU8(styles.xml()),
  };
  sheetFiles.forEach((x, i) => (files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(x)));
  return zipSync(files);
}
