/**
 * Writes a small .xls (BIFF8 in an OLE compound file) for tests, so fixtures are built from
 * invented data in code rather than checked in as binary files.
 * Strings go to the shared string table, numbers to NUMBER records, and `{ rk }` cells (a raw RK
 * value) to RK, or MULRK when two or more sit side by side.
 */

export type WriteCell = string | number | { rk: number } | null;

type Options = {
  /** Largest SST record body; smaller values force the strings into CONTINUE records. */
  sstChunk?: number;
  /** Pad the workbook stream to at least this many bytes (4096 and up skips the mini stream). */
  padTo?: number;
};

const u16 = (n: number) => {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n);
  return b;
};
const u32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0);
  return b;
};
const record = (type: number, body: Buffer) => Buffer.concat([u16(type), u16(body.length), body]);
const bof = (dt: number) => record(0x0809, Buffer.concat([u16(0x0600), u16(dt), Buffer.alloc(12)]));
const eof = () => record(0x000a, Buffer.alloc(0));

function sstRecords(strings: string[], limit: number): Buffer[] {
  let cur = [...u32(strings.length), ...u32(strings.length)];
  const chunks = [cur];
  const fresh = () => {
    cur = [];
    chunks.push(cur);
  };
  for (const s of strings) {
    const high = /[^\x00-\xff]/.test(s);
    if (cur.length + 3 > limit) fresh();
    cur.push(...u16(s.length), high ? 1 : 0);
    let bytes = [...Buffer.from(s, high ? 'utf16le' : 'latin1')];
    const width = high ? 2 : 1;
    while (bytes.length) {
      const room = Math.floor((limit - cur.length) / width) * width;
      if (room === 0) {
        // A string cut in two starts again with its flags byte.
        fresh();
        cur.push(high ? 1 : 0);
        continue;
      }
      cur.push(...bytes.slice(0, room));
      bytes = bytes.slice(room);
    }
  }
  return chunks.map((c, i) => record(i === 0 ? 0x00fc : 0x003c, Buffer.from(c)));
}

function cellRecords(rows: WriteCell[][], sst: Map<string, number>): Buffer[] {
  const out: Buffer[] = [];
  rows.forEach((cells, r) => {
    for (let c = 0; c < cells.length; c++) {
      const v = cells[c];
      if (v === null || v === undefined) continue;
      if (typeof v === 'string') {
        if (!sst.has(v)) sst.set(v, sst.size);
        out.push(record(0x00fd, Buffer.concat([u16(r), u16(c), u16(0), u32(sst.get(v) ?? 0)])));
      } else if (typeof v === 'number') {
        const b = Buffer.alloc(8);
        b.writeDoubleLE(v);
        out.push(record(0x0203, Buffer.concat([u16(r), u16(c), u16(0), b])));
      } else {
        let end = c;
        while (typeof cells[end + 1] === 'object' && cells[end + 1] !== null) end++;
        const rks = (cells.slice(c, end + 1) as { rk: number }[]).map((x) =>
          Buffer.concat([u16(0), u32(x.rk)]),
        );
        out.push(
          end === c
            ? record(0x027e, Buffer.concat([u16(r), u16(c), ...rks]))
            : record(0x00bd, Buffer.concat([u16(r), u16(c), ...rks, u16(end)])),
        );
        c = end;
      }
    }
  });
  return out;
}

function workbook(sheets: { name: string; rows: WriteCell[][] }[], options: Options): Buffer {
  const sst = new Map<string, number>();
  const bodies = sheets.map((s) => Buffer.concat([bof(0x10), ...cellRecords(s.rows, sst), eof()]));
  const boundsheet = (name: string, pos: number) =>
    record(
      0x0085,
      Buffer.concat([u32(pos), Buffer.from([0, 0, name.length, 1]), Buffer.from(name, 'utf16le')]),
    );
  const tail = Buffer.concat([...sstRecords([...sst.keys()], options.sstChunk ?? 8224), eof()]);
  // BOUNDSHEET records hold each sheet's offset, so work out the globals' length first.
  const head = bof(0x05);
  let pos =
    head.length + sheets.reduce((n, s) => n + boundsheet(s.name, 0).length, 0) + tail.length;
  const globals = sheets.map((s, i) => {
    const b = boundsheet(s.name, pos);
    pos += bodies[i]?.length ?? 0;
    return b;
  });
  const data = Buffer.concat([head, ...globals, tail, ...bodies]);
  return data.length >= (options.padTo ?? 0)
    ? data
    : Buffer.concat([data, Buffer.alloc((options.padTo ?? 0) - data.length)]);
}

const END = 0xfffffffe;
const FREE = 0xffffffff;
const FATSECT = 0xfffffffd;

/** Wrap a stream as `Workbook` in a version 3 OLE file with 512-byte sectors. */
function ole(stream: Buffer): Buffer {
  const mini = stream.length < 4096;
  const pad = (b: Buffer, to: number) =>
    Buffer.concat([b, Buffer.alloc((to - (b.length % to)) % to)]);
  const placed = pad(stream, mini ? 64 : 512);
  const miniFat = mini
    ? pad(
        Buffer.concat(
          Array.from({ length: placed.length / 64 }, (_, i) =>
            u32(i === placed.length / 64 - 1 ? END : i + 1),
          ),
        ),
        512,
      )
    : Buffer.alloc(0);
  const dataSectors = pad(placed, 512).length / 512;
  const miniFatSectors = miniFat.length / 512;
  const others = 1 + miniFatSectors + dataSectors;
  const fatSectors = Math.ceil(others / 127);
  const dirAt = fatSectors;
  const miniFatAt = dirAt + 1;
  const dataAt = miniFatAt + miniFatSectors;

  const fat: number[] = [];
  for (let i = 0; i < fatSectors; i++) fat.push(FATSECT);
  fat.push(END);
  for (let i = 0; i < miniFatSectors; i++)
    fat.push(i === miniFatSectors - 1 ? END : miniFatAt + i + 1);
  for (let i = 0; i < dataSectors; i++) fat.push(i === dataSectors - 1 ? END : dataAt + i + 1);
  while (fat.length < fatSectors * 128) fat.push(FREE);

  const entry = (name: string, type: number, start: number, size: number, child: number) => {
    const e = Buffer.alloc(128);
    e.write(name, 0, 'utf16le');
    e.writeUInt16LE((name.length + 1) * 2, 0x40);
    e[0x42] = type;
    e[0x43] = 1;
    e.writeUInt32LE(FREE, 0x44);
    e.writeUInt32LE(FREE, 0x48);
    e.writeUInt32LE(child >>> 0, 0x4c);
    e.writeUInt32LE(start >>> 0, 0x74);
    e.writeUInt32LE(size, 0x78);
    return e;
  };
  const dir = Buffer.concat([
    entry('Root Entry', 5, mini ? dataAt : END, mini ? placed.length : 0, 1),
    entry('Workbook', 2, mini ? 0 : dataAt, stream.length, FREE),
    Buffer.alloc(256),
  ]);

  const header = Buffer.alloc(512);
  Buffer.from('d0cf11e0a1b11ae1', 'hex').copy(header, 0);
  header.writeUInt16LE(0x3e, 0x18);
  header.writeUInt16LE(3, 0x1a);
  header.writeUInt16LE(0xfffe, 0x1c);
  header.writeUInt16LE(9, 0x1e);
  header.writeUInt16LE(6, 0x20);
  header.writeUInt32LE(fatSectors, 0x2c);
  header.writeUInt32LE(dirAt, 0x30);
  header.writeUInt32LE(4096, 0x38);
  header.writeUInt32LE(mini ? miniFatAt : END, 0x3c);
  header.writeUInt32LE(miniFatSectors, 0x40);
  header.writeUInt32LE(END, 0x44);
  for (let i = 0; i < 109; i++) header.writeUInt32LE(i < fatSectors ? i : FREE, 0x4c + i * 4);

  return Buffer.concat([header, Buffer.concat(fat.map(u32)), dir, miniFat, pad(placed, 512)]);
}

export function writeXls(
  sheets: { name: string; rows: WriteCell[][] }[],
  options: Options = {},
): Buffer {
  return ole(workbook(sheets, options));
}
