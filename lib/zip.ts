import { crc32, deflateRawSync, inflateRawSync } from 'node:zlib';

/**
 * A plain .zip of small text files, built with node:zlib so the full export needs no zip library.
 * ponytail: no zip64, so the archive and each file must stay under 4 GB; far beyond one owner's data.
 */
export function zip(files: { name: string; text: string }[], now = new Date()): Buffer {
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8');
    const data = Buffer.from(file.text, 'utf8');
    const packed = deflateRawSync(data);
    // Fields shared by the local and central headers: version, UTF-8 names, deflate, time, date, crc, sizes.
    const common = Buffer.alloc(26);
    common.writeUInt16LE(20, 0);
    common.writeUInt16LE(0x0800, 2);
    common.writeUInt16LE(8, 4);
    common.writeUInt16LE(time, 6);
    common.writeUInt16LE(date, 8);
    common.writeUInt32LE(crc32(data), 10);
    common.writeUInt32LE(packed.length, 14);
    common.writeUInt32LE(data.length, 18);
    common.writeUInt16LE(name.length, 22);

    const local = Buffer.concat([u32(0x04034b50), common, name, packed]);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    common.copy(central, 6);
    central.writeUInt32LE(offset, 42);
    locals.push(local);
    centrals.push(central, name);
    offset += local.length;
  }

  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

/**
 * The first file in a .zip, such as NSE's one-file bhavcopy. Sizes come from the central directory,
 * because some zips leave them out of the local header. Throws when it isn't a zip it can read.
 */
export function unzipFirst(buf: Buffer): Buffer {
  const end = buf.lastIndexOf(u32(0x06054b50));
  if (end < 0 || end + 22 > buf.length) throw new Error('Not a zip file.');
  const cd = buf.readUInt32LE(end + 16);
  if (cd + 46 > buf.length || buf.readUInt32LE(cd) !== 0x02014b50)
    throw new Error('Not a zip file.');
  const method = buf.readUInt16LE(cd + 10);
  const size = buf.readUInt32LE(cd + 20);
  const local = buf.readUInt32LE(cd + 42);
  if (local + 30 > buf.length || buf.readUInt32LE(local) !== 0x04034b50) {
    throw new Error('Not a zip file.');
  }
  const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
  const data = buf.subarray(start, start + size);
  if (method === 0) return data;
  if (method === 8) return inflateRawSync(data);
  throw new Error('Unsupported zip compression.');
}

function u32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
}
