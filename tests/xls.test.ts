import { describe, expect, it } from 'vitest';
import { XlsError, readXls } from '@/lib/xls';
import { writeXls } from './helpers/xlsWriter';

const sheets = [
  {
    name: 'Mutual Funds & SIFs',
    rows: [
      ['Name: Sample Owner'],
      [],
      ['Transaction Date', 'Scheme Name', 'Amount'],
      ['07-Apr-25', 'Meridian Flexi Cap Fund Direct-Growth', 5000.25],
      [null, null, -1234.5],
    ],
  },
  { name: 'Stocks & ETFs', rows: [['Kaveri Power ₹20.00', 12]] },
];

describe('readXls', () => {
  it('reads sheet names, strings and numbers, with gaps as null', () => {
    const book = readXls(writeXls(sheets));
    expect(book.map((s) => s.name)).toEqual(['Mutual Funds & SIFs', 'Stocks & ETFs']);
    expect(book[0]?.rows).toEqual([
      ['Name: Sample Owner'],
      [],
      ['Transaction Date', 'Scheme Name', 'Amount'],
      ['07-Apr-25', 'Meridian Flexi Cap Fund Direct-Growth', 5000.25],
      [null, null, -1234.5],
    ]);
    expect(book[1]?.rows).toEqual([['Kaveri Power ₹20.00', 12]]);
  });

  it('reads RK and MULRK numbers: integers, hundredths and short doubles', () => {
    const rows = [
      [{ rk: (42 << 2) | 2 }],
      [null, { rk: (1234 << 2) | 3 }, { rk: ((-7 << 2) | 2) >>> 0 }, { rk: 0x3ff80000 }],
    ];
    expect(readXls(writeXls([{ name: 'S', rows }]))[0]?.rows).toEqual([
      [42],
      [null, 12.34, -7, 1.5],
    ]);
  });

  it('joins strings split across CONTINUE records, one and two bytes a character', () => {
    const long = 'Banyan Short Duration Fund Direct Plan Growth Option';
    const wide = 'Saffron ₹ Liquid Fund — Direct Plan ₹ Growth';
    const rows = [[long, wide, 'Harbor', wide.slice(0, 5)]];
    for (const sstChunk of [16, 17, 23, 40]) {
      expect(readXls(writeXls([{ name: 'S', rows }], { sstChunk }))[0]?.rows).toEqual(rows);
    }
  });

  it('reads a workbook big enough to skip the mini stream', () => {
    const rows = Array.from({ length: 200 }, (_, i) => [`Row ${i}`, i * 1.5]);
    const book = readXls(writeXls([{ name: 'S', rows }], { padTo: 20000 }));
    expect(book[0]?.rows).toHaveLength(200);
    expect(book[0]?.rows[199]).toEqual(['Row 199', 298.5]);
  });

  it('refuses files that are not .xls', () => {
    expect(() => readXls(Buffer.alloc(0))).toThrow(XlsError);
    expect(() => readXls(Buffer.from('Date,Amount\n2025-04-07,100\n'))).toThrow(XlsError);
    expect(() => readXls(Buffer.from('PK\x03\x04 an xlsx is a zip'))).toThrow(XlsError);
    const cut = writeXls(sheets);
    expect(() => readXls(cut.subarray(0, 1024))).toThrow(XlsError);
  });

  it('refuses a sector chain that loops back on itself', () => {
    const file = Buffer.from(writeXls([{ name: 'S', rows: [['x']] }], { padTo: 8192 }));
    const dir = file.readUInt32LE(0x30);
    const start = file.readUInt32LE((dir + 1) * 512 + 128 + 0x74);
    // Point the workbook's second sector back at its first.
    file.writeUInt32LE(start, 512 + (start + 1) * 4);
    expect(() => readXls(file)).toThrow(XlsError);
  });
});
