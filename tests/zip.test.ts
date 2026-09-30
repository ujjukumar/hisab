import { inflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { zip } from '@/lib/zip';

/** Read a zip back through its central directory, the way unzip tools do. */
function unzip(archive: Buffer): Record<string, string> {
  const end = archive.length - 22;
  expect(archive.readUInt32LE(end)).toBe(0x06054b50);
  const count = archive.readUInt16LE(end + 10);
  let at = archive.readUInt32LE(end + 16);
  const out: Record<string, string> = {};
  for (let i = 0; i < count; i++) {
    expect(archive.readUInt32LE(at)).toBe(0x02014b50);
    const size = archive.readUInt32LE(at + 24);
    const nameLength = archive.readUInt16LE(at + 28);
    const local = archive.readUInt32LE(at + 42);
    const name = archive.subarray(at + 46, at + 46 + nameLength).toString('utf8');
    expect(archive.readUInt32LE(local)).toBe(0x04034b50);
    const packedSize = archive.readUInt32LE(local + 18);
    const start = local + 30 + archive.readUInt16LE(local + 26);
    const data = inflateRawSync(archive.subarray(start, start + packedSize));
    expect(data.length).toBe(size);
    out[name] = data.toString('utf8');
    at += 46 + nameLength;
  }
  return out;
}

describe('zip', () => {
  it('stores each file so it reads back exactly', () => {
    const files = [
      { name: 'accounts.csv', text: 'id,name\r\n1,"Deccan Bank savings"\r\n' },
      { name: 'notes – ₹.txt', text: '₹1,00,000 − fees\n'.repeat(500) },
      { name: 'empty.csv', text: '' },
    ];
    expect(unzip(zip(files))).toEqual(Object.fromEntries(files.map((f) => [f.name, f.text])));
  });

  it('makes a valid empty archive', () => {
    expect(unzip(zip([]))).toEqual({});
  });
});
