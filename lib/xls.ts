/**
 * Reads cell values from an Excel 97–2003 workbook (.xls: BIFF8 records inside an OLE compound
 * file), which is what Value Research downloads. Values only: no formats, styles or formulas.
 * ponytail: only shared strings (LABELSST), NUMBER, RK and MULRK cells; no .xlsx, BIFF5, formula
 * results or embedded charts. Add them here if Value Research changes what it writes.
 */

export type Cell = string | number | null;
export type Sheet = { name: string; rows: Cell[][] };

/** A file that can't be read. The message is shown to the owner as is. */
export class XlsError extends Error {}

const NOT_XLS =
  "That file can't be read as an Excel workbook. Choose the .xls file Value Research downloads.";

/** Sector ids at or above this are markers (end of chain, free, FAT), not sectors. */
const MAX_SECTOR = 0xfffffffa;

const BOF = 0x0809;
const EOF = 0x000a;
const CONTINUE = 0x003c;
const BOUNDSHEET = 0x0085;
const SST = 0x00fc;
const LABELSST = 0x00fd;
const NUMBER = 0x0203;
const RK = 0x027e;
const MULRK = 0x00bd;

export function readXls(buf: Buffer): Sheet[] {
  try {
    const data = workbookStream(buf);
    const { sheets, strings } = readGlobals(data);
    return sheets.map((s) => ({ name: s.name, rows: readSheet(data, s.pos, strings) }));
  } catch (error) {
    // Out-of-range reads on a damaged file land here too.
    if (error instanceof XlsError) throw error;
    throw new XlsError(NOT_XLS);
  }
}

/** Follow a sector chain, refusing loops. */
function chain(start: number, next: (n: number) => number, read: (n: number) => Buffer): Buffer {
  const parts: Buffer[] = [];
  const seen = new Set<number>();
  for (let n = start; n < MAX_SECTOR; n = next(n)) {
    if (seen.has(n)) throw new XlsError(NOT_XLS);
    seen.add(n);
    parts.push(read(n));
  }
  return Buffer.concat(parts);
}

/** The `Workbook` stream out of the OLE container. */
function workbookStream(buf: Buffer): Buffer {
  if (buf.length < 512 || buf.readBigUInt64BE(0) !== 0xd0cf11e0a1b11ae1n) {
    throw new XlsError(NOT_XLS);
  }
  const shift = buf.readUInt16LE(0x1e);
  if (shift !== 9 && shift !== 12) throw new XlsError(NOT_XLS);
  const size = 1 << shift;
  const count = Math.ceil((buf.length - size) / size);
  const sector = (n: number) => {
    if (n >= count) throw new XlsError(NOT_XLS);
    return buf.subarray((n + 1) * size, (n + 2) * size);
  };

  // The FAT's own sectors: the first 109 are listed in the header, the rest in the DIFAT chain.
  const fatIds: number[] = [];
  for (let i = 0; i < 109; i++) fatIds.push(buf.readUInt32LE(0x4c + i * 4));
  const seen = new Set<number>();
  for (let d = buf.readUInt32LE(0x44); d < MAX_SECTOR;) {
    if (seen.has(d)) throw new XlsError(NOT_XLS);
    seen.add(d);
    const s = sector(d);
    for (let i = 0; i < size / 4 - 1; i++) fatIds.push(s.readUInt32LE(i * 4));
    d = s.readUInt32LE(size - 4);
  }
  const fat = Buffer.concat(
    fatIds
      .filter((id) => id < MAX_SECTOR)
      .slice(0, buf.readUInt32LE(0x2c))
      .map(sector),
  );
  const fatNext = (n: number) => fat.readUInt32LE(n * 4);

  const dir = chain(buf.readUInt32LE(0x30), fatNext, sector);
  const entries: { name: string; type: number; start: number; size: number }[] = [];
  for (let o = 0; o + 128 <= dir.length; o += 128) {
    const nameBytes = Math.min(64, dir.readUInt16LE(o + 0x40));
    entries.push({
      name: dir.toString('utf16le', o, o + Math.max(0, nameBytes - 2)),
      type: dir.readUInt8(o + 0x42),
      start: dir.readUInt32LE(o + 0x74),
      size: dir.readUInt32LE(o + 0x78),
    });
  }
  const root = entries[0];
  const entry = entries.find((e) => e.type === 2 && e.name === 'Workbook');
  if (root?.type !== 5 || !entry) throw new XlsError(NOT_XLS);

  let data: Buffer;
  if (entry.size < buf.readUInt32LE(0x38)) {
    // Small streams live in the mini stream, in 64-byte sectors with their own FAT.
    const miniFat = chain(buf.readUInt32LE(0x3c), fatNext, sector);
    const mini = chain(root.start, fatNext, sector);
    data = chain(
      entry.start,
      (n) => miniFat.readUInt32LE(n * 4),
      (n) => mini.subarray(n * 64, n * 64 + 64),
    );
  } else {
    data = chain(entry.start, fatNext, sector);
  }
  if (data.length < entry.size) throw new XlsError(NOT_XLS);
  return data.subarray(0, entry.size);
}

function* records(data: Buffer, from: number) {
  for (let o = from; o + 4 <= data.length;) {
    const type = data.readUInt16LE(o);
    const body = data.subarray(o + 4, o + 4 + data.readUInt16LE(o + 2));
    o += 4 + body.length;
    yield { type, body };
  }
}

function checkBof(type: number, body: Buffer) {
  if (type !== BOF || body.readUInt16LE(0) !== 0x0600) throw new XlsError(NOT_XLS);
}

/** Sheet names and positions, and the shared strings. */
function readGlobals(data: Buffer) {
  const sheets: { name: string; pos: number }[] = [];
  let strings: string[] = [];
  let sst: Buffer[] | null = null;
  let first = true;
  for (const { type, body } of records(data, 0)) {
    if (first) {
      checkBof(type, body);
      first = false;
      continue;
    }
    if (sst && type === CONTINUE) {
      sst.push(body);
      continue;
    }
    if (sst) {
      strings = readSst(sst);
      sst = null;
    }
    if (type === SST) sst = [body];
    // Worksheets only (type 0); charts and macro sheets are skipped.
    else if (type === BOUNDSHEET && body[5] === 0) {
      const high = body.readUInt8(7) & 1;
      const end = 8 + body.readUInt8(6) * (high ? 2 : 1);
      sheets.push({
        pos: body.readUInt32LE(0),
        name: body.toString(high ? 'utf16le' : 'latin1', 8, end),
      });
    } else if (type === EOF) break;
  }
  if (first) throw new XlsError(NOT_XLS);
  return { sheets, strings };
}

/**
 * The shared string table. It can run on into CONTINUE records; a string cut in two starts
 * again with a fresh flags byte saying whether the rest is one or two bytes a character.
 */
function readSst(chunks: Buffer[]): string[] {
  let i = 0;
  let pos = 0;
  const chunk = () => {
    const c = chunks[i];
    if (!c) throw new XlsError(NOT_XLS);
    return c;
  };
  const take = (n: number): Buffer => {
    const out: Buffer[] = [];
    while (n > 0) {
      if (pos >= chunk().length) {
        i++;
        pos = 0;
        continue;
      }
      const part = chunk().subarray(pos, pos + n);
      out.push(part);
      pos += part.length;
      n -= part.length;
    }
    return Buffer.concat(out);
  };
  const chars = (cch: number, high: number): string => {
    let s = '';
    while (cch > 0) {
      if (pos >= chunk().length) {
        i++;
        pos = 0;
        high = take(1).readUInt8(0) & 1;
      }
      const width = high ? 2 : 1;
      const n = Math.min(cch, Math.floor((chunk().length - pos) / width));
      if (n === 0) throw new XlsError(NOT_XLS);
      s += chunk().toString(high ? 'utf16le' : 'latin1', pos, pos + n * width);
      pos += n * width;
      cch -= n;
    }
    return s;
  };

  const count = take(8).readUInt32LE(4);
  const strings: string[] = [];
  for (let k = 0; k < count; k++) {
    const cch = take(2).readUInt16LE(0);
    const flags = take(1).readUInt8(0);
    const runs = flags & 8 ? take(2).readUInt16LE(0) : 0;
    const ext = flags & 4 ? take(4).readUInt32LE(0) : 0;
    strings.push(chars(cch, flags & 1));
    // Formatting runs and phonetic data aren't needed.
    take(runs * 4 + ext);
  }
  return strings;
}

/** An RK number: a 30-bit integer or the top of a double, maybe times 100. */
function rk(v: number): number {
  let n: number;
  if (v & 2) n = v >> 2;
  else {
    const b = Buffer.alloc(8);
    b.writeUInt32LE((v & ~3) >>> 0, 4);
    n = b.readDoubleLE(0);
  }
  return v & 1 ? n / 100 : n;
}

function readSheet(data: Buffer, pos: number, strings: string[]): Cell[][] {
  const rows: Cell[][] = [];
  const set = (row: number, col: number, value: Cell) => {
    (rows[row] ??= [])[col] = value;
  };
  let first = true;
  for (const { type, body } of records(data, pos)) {
    if (first) {
      checkBof(type, body);
      first = false;
      continue;
    }
    const row = () => body.readUInt16LE(0);
    const col = () => body.readUInt16LE(2);
    switch (type) {
      case LABELSST:
        set(row(), col(), strings[body.readUInt32LE(6)] ?? null);
        break;
      case NUMBER:
        set(row(), col(), body.readDoubleLE(6));
        break;
      case RK:
        set(row(), col(), rk(body.readInt32LE(6)));
        break;
      case MULRK:
        for (let k = 0; 4 + k * 6 + 6 <= body.length - 2; k++) {
          set(row(), col() + k, rk(body.readInt32LE(4 + k * 6 + 2)));
        }
        break;
      case EOF:
        // Fill the gaps so every row is a plain array.
        return Array.from(rows, (r) => Array.from(r ?? [], (v) => v ?? null));
    }
  }
  throw new XlsError(NOT_XLS);
}
