/**
 * Zero-dependency XLSX generator.
 *
 * An .xlsx file is a ZIP archive containing XML files that follow the
 * Open XML SpreadsheetML specification.  This module constructs the
 * required XML files by hand and packages them into a valid ZIP using
 * only Node.js built-ins (`zlib`, `crypto`).
 *
 * Public API:
 *   buildXlsx(opts) → Buffer   (complete .xlsx file bytes)
 */

import { deflateRawSync, crc32 } from "node:zlib";

// ── CRC-32 (already in zlib) ────────────────────────────────────────────

// ── Tiny helpers ─────────────────────────────────────────────────────────

/** Escape text for safe XML embedding. */
function xmlEsc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Convert a 0-based column index to an Excel column letter (A, B, …, AA, …). */
function colLetter(i: number): string {
  let s = "";
  let n = i;
  while (n >= 0) {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  }
  return s;
}

// ── ZIP construction ─────────────────────────────────────────────────────
//
// We build a minimal valid ZIP file (local-header + data, central directory,
// end-of-central-directory).  No external libraries are needed.

interface ZipEntry {
  name: string; // path inside the archive, e.g. "xl/worksheets/sheet1.xml"
  data: Uint8Array; // raw (uncompressed) XML bytes
}

/**
 * Build a ZIP archive from the given entries.  Deflation is applied to every
 * entry.  The produced file follows APPNOTE 6.3.9.
 */
function buildZip(entries: ZipEntry[]): Buffer {
  const localHeaders: Buffer[] = [];
  const centralHeaders: Buffer[] = [];
  const datas: Buffer[] = [];

  let offset = 0;

  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.name, "utf-8");
    const compressed = deflateRawSync(entry.data, { level: 6 });
    const crc = crc32(entry.data); // returns a number
    const sizeRaw = entry.data.length;
    const sizeComp = compressed.length;

    // Local file header (30 + name)
    const lh = Buffer.alloc(30 + nameBytes.length);
    lh.writeUInt32LE(0x04034b50, 0); // signature
    lh.writeUInt16LE(20, 4); // version needed (2.0)
    lh.writeUInt16LE(0, 6); // flags
    lh.writeUInt16LE(8, 8); // compression: deflate
    lh.writeUInt16LE(0, 10); // mod time
    lh.writeUInt16LE(0, 12); // mod date
    lh.writeUInt32LE(crc >>> 0, 14); // crc-32
    lh.writeUInt32LE(sizeComp, 18); // compressed size
    lh.writeUInt32LE(sizeRaw, 22); // uncompressed size
    lh.writeUInt16LE(nameBytes.length, 26); // name length
    lh.writeUInt16LE(0, 28); // extra field length
    nameBytes.copy(lh, 30);

    // Central directory header (46 + name)
    const ch = Buffer.alloc(46 + nameBytes.length);
    ch.writeUInt32LE(0x02014b50, 0); // signature
    ch.writeUInt16LE(20, 4); // version made by
    ch.writeUInt16LE(20, 6); // version needed
    ch.writeUInt16LE(0, 8); // flags
    ch.writeUInt16LE(8, 10); // compression
    ch.writeUInt16LE(0, 12); // mod time
    ch.writeUInt16LE(0, 14); // mod date
    ch.writeUInt32LE(crc >>> 0, 16); // crc-32
    ch.writeUInt32LE(sizeComp, 20); // compressed
    ch.writeUInt32LE(sizeRaw, 24); // uncompressed
    ch.writeUInt16LE(nameBytes.length, 28); // name length
    ch.writeUInt16LE(0, 30); // extra length
    ch.writeUInt16LE(0, 32); // comment length
    ch.writeUInt16LE(0, 34); // disk start
    ch.writeUInt16LE(0, 36); // internal attrs
    ch.writeUInt32LE(0, 38); // external attrs
    ch.writeUInt32LE(offset, 42); // local header offset
    nameBytes.copy(ch, 46);

    localHeaders.push(lh);
    centralHeaders.push(ch);
    datas.push(compressed);
    offset += lh.length + compressed.length;
  }

  const cdOffset = offset;
  const cdSize = centralHeaders.reduce((s, b) => s + b.length, 0);

  // End of central directory (22 bytes, no comment)
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4); // disk
  eocd.writeUInt16LE(0, 6); // disk with cd
  eocd.writeUInt16LE(entries.length, 8); // entries on disk
  eocd.writeUInt16LE(entries.length, 10); // total entries
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(cdOffset, 16);
  eocd.writeUInt16LE(0, 20); // comment length

  // Build the archive: each local header is immediately followed by its
  // compressed data ([localHeader1, data1, localHeader2, data2, …]), then
  // the central directory, then the end-of-central-directory record.
  const body: Buffer[] = [];
  for (let i = 0; i < entries.length; i++) {
    body.push(localHeaders[i], datas[i]);
  }
  return Buffer.concat([...body, ...centralHeaders, eocd]);
}

// ── XLSX XML builders ────────────────────────────────────────────────────

function contentTypesXml(strings: string[]): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;
}

function rootRels(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;
}

function workbookXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
          xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Directory" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`;
}

function workbookRels(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;
}

function stylesXml(): string {
  // Minimal styles: header row bold + grey fill, auto-filter ready.
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2">
    <font><sz val="11"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><name val="Calibri"/></font>
  </fonts>
  <fills count="3">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF4472C4"/></patternFill></fill>
  </fills>
  <borders count="1">
    <border><left/><right/><top/><bottom/><diagonal/></border>
  </borders>
  <cellStyleXfs count="1">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
  </cellStyleXfs>
  <cellXfs count="3">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
  </cellXfs>
</styleSheet>`;
}

function sharedStringsXml(strings: string[]): string {
  const items = strings
    .map(
      (s) => `  <si><t>${xmlEsc(s)}</t></si>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
     count="${strings.length}" uniqueCount="${strings.length}">
${items}
</sst>`;
}

function sheet1Xml(
  cols: string[],
  rows: (string | undefined)[][],
  stringMap: Map<string, number>,
): string {
  const totalRows = rows.length + 1; // +1 header
  const lastCol = colLetter(cols.length - 1);

  // Build column widths (auto-fit: max of header length and 12 chars minimum)
  const colWidths = cols.map((c) => {
    const maxData = rows.reduce(
      (m, r) => Math.max(m, String(r[cols.indexOf(c)] ?? "").length),
      12,
    );
    return Math.min(Math.max(c.length + 2, maxData + 2, 12), 60);
  });

  let xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
           xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <cols>
${colWidths
  .map(
    (w, i) =>
      `    <col min="${i + 1}" max="${i + 1}" width="${w}" bestFit="1" customWidth="1"/>`,
  )
  .join("\n")}
  </cols>
  <sheetData>`;

  // Header row (row 1) — style index 1 = bold + blue fill
  xml += `\n    <row r="1">`;
  for (let c = 0; c < cols.length; c++) {
    const ref = `${colLetter(c)}1`;
    const si = stringMap.get(cols[c])!;
    xml += `<c r="${ref}" t="s" s="1"><v>${si}</v></c>`;
  }
  xml += `</row>`;

  // Data rows (row 2…)
  for (let r = 0; r < rows.length; r++) {
    const rowNum = r + 2;
    xml += `\n    <row r="${rowNum}">`;
    for (let c = 0; c < cols.length; c++) {
      const ref = `${colLetter(c)}${rowNum}`;
      const val = rows[r][c] ?? "";
      const si = stringMap.get(val);
      if (si != null) {
        xml += `<c r="${ref}" t="s"><v>${si}</v></c>`;
      } else {
        // Empty cell
        xml += `<c r="${ref}"/>`;
      }
    }
    xml += `</row>`;
  }

  xml += `
  </sheetData>
  <autoFilter ref="A1:${lastCol}${totalRows}"/>
</worksheet>`;
  return xml;
}

// ── Public API ───────────────────────────────────────────────────────────

export interface XlsxResult {
  filename: string;
  data: string; // base64-encoded .xlsx bytes
}

export interface XlsxError {
  error: string;
}

/**
 * Build an .xlsx file from tabular data.
 *
 * @param columns  Ordered column headers.
 * @param rows     2-D array of cell values (one sub-array per data row).
 * @param sheetName  Name shown on the sheet tab (max 31 chars).
 * @param filePrefix  Filename prefix; date is appended automatically.
 */
export function buildXlsx(opts: {
  columns: string[];
  rows: (string | undefined)[][];
  sheetName?: string;
  filePrefix?: string;
}): XlsxResult | XlsxError {
  const { columns, rows, sheetName = "Directory", filePrefix = "hrs-directory" } = opts;
  if (columns.length === 0) return { error: "No columns to export." };

  // Collect all unique strings for the shared string table.
  const allStrings: string[] = [];
  const stringMap = new Map<string, number>();

  function addString(s: string): number {
    let idx = stringMap.get(s);
    if (idx == null) {
      idx = allStrings.length;
      allStrings.push(s);
      stringMap.set(s, idx);
    }
    return idx;
  }

  // Index every column header.
  for (const h of columns) addString(h);

  // Index every cell value.
  for (const row of rows) {
    for (const cell of row) {
      if (cell != null && cell !== "") addString(cell);
    }
  }

  const entries: ZipEntry[] = [
    { name: "[Content_Types].xml", data: Buffer.from(contentTypesXml(allStrings), "utf-8") },
    { name: "_rels/.rels", data: Buffer.from(rootRels(), "utf-8") },
    { name: "xl/workbook.xml", data: Buffer.from(workbookXml(), "utf-8") },
    { name: "xl/_rels/workbook.xml.rels", data: Buffer.from(workbookRels(), "utf-8") },
    { name: "xl/styles.xml", data: Buffer.from(stylesXml(), "utf-8") },
    { name: "xl/sharedStrings.xml", data: Buffer.from(sharedStringsXml(allStrings), "utf-8") },
    { name: "xl/worksheets/sheet1.xml", data: Buffer.from(sheet1Xml(columns, rows, stringMap), "utf-8") },
  ];

  // Also rename the sheet tab (the workbook.xml <sheet name="…"/> is set to
  // "Directory" by default — truncate to 31 chars for Excel compat).
  const truncName = sheetName.slice(0, 31);
  // Rebuild workbook.xml with the correct name if non-default.
  if (truncName !== "Directory") {
    const wbEntry = entries.find((e) => e.name === "xl/workbook.xml");
    if (wbEntry) {
      wbEntry.data = Buffer.from(
        workbookXml().replace('name="Directory"', `name="${xmlEsc(truncName)}"`),
        "utf-8",
      );
    }
  }

  const zip = buildZip(entries);
  const date = new Date().toISOString().slice(0, 10);
  return {
    filename: `${filePrefix}-${date}.xlsx`,
    data: zip.toString("base64"),
  };
}
