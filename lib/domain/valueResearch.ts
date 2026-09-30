import { Decimal } from 'decimal.js';
import type { Asset } from '@/lib/db/schema';
import type { Cell, Sheet } from '@/lib/xls';
import { defaultAssetClass } from './assets';
import { SHORT_MONTHS, addDays, isValidDate, makeDate, type IsoDate } from './dates';
import { formatDate } from './format';
import { unitsAmount } from './holdings';
import type { Paise } from './money';

/** Reads the transaction history Value Research downloads as .xls (PLAN section 11, phase 7). */

export type VrType = 'mutual_fund' | 'stock' | 'etf';

export type VrRow = {
  sheet: string;
  /** Row number as the spreadsheet shows it, for messages. */
  line: number;
  date: IsoDate;
  name: string;
  isin: string;
  type: VrType;
  /** Folio or demat account, when the file has one. */
  accountRef: string | null;
  action: 'buy' | 'sell';
  units: string;
  price: string;
  /** Units × price, as stored on investment transactions. */
  amount: Paise;
  fees: Paise;
  /** The file's price didn't match its amount, so the price was worked out from the amount. */
  priceAdjusted: boolean;
};

export type VrSkipped = { sheet: string; line: number; reason: string };

export type VrFile = { rows: VrRow[]; skipped: VrSkipped[]; problems: string[] };

export const NOT_VR =
  "That file isn't a Value Research transaction history. Download it again from Value Research as Excel.";

const COLUMNS = {
  date: ['Transaction Date'],
  name: ['Scheme Name', 'Stock/ETF Name'],
  ref: ['Folio Number', 'Demat A/c'],
  type: ['Transaction Type'],
  amount: ['Amount'],
  units: ['Units', 'Quantity'],
  price: ['NAV', 'Price'],
  isin: ['ISIN'],
} as const;

const text = (cell: Cell | undefined) =>
  cell === null || cell === undefined ? '' : String(cell).trim();

/** A number cell, or a number written as text with commas or ₹. */
function num(cell: Cell | undefined): number {
  if (typeof cell === 'number') return cell;
  const s = text(cell).replace(/[₹,\s]/g, '');
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : NaN;
}

/** `07-Apr-25`, `07-Apr-2025`, or an Excel date number. */
export function parseVrDate(cell: Cell | undefined): IsoDate | null {
  if (typeof cell === 'number') {
    return cell > 0 && cell < 2958466 ? addDays('1899-12-30', Math.floor(cell)) : null;
  }
  const [, day = '', mon = '', yy = ''] =
    /^(\d{1,2})-([A-Za-z]{3})-(\d{2}|\d{4})$/.exec(text(cell)) ?? [];
  const month = SHORT_MONTHS.findIndex((s) => s.toLowerCase() === mon.toLowerCase()) + 1;
  const year = yy.length === 2 ? 2000 + Number(yy) : Number(yy);
  const date = makeDate(year, month, Number(day));
  return month > 0 && isValidDate(date) ? date : null;
}

/** A best guess from the name; the owner can change it before importing. */
export function guessAssetClass(name: string, type: VrType): Asset['assetClass'] {
  if (/gold/i.test(name)) return 'gold';
  if (/silver/i.test(name)) return 'other';
  if (/liquid|gilt|debt|bond|overnight|money market|corporate|psu/i.test(name)) return 'debt';
  return defaultAssetClass(type);
}

export function parseValueResearch(sheets: Sheet[]): VrFile {
  const rows: VrRow[] = [];
  const skipped: VrSkipped[] = [];
  const problems: string[] = [];
  let found = false;

  for (const sheet of sheets) {
    const headerAt = sheet.rows.findIndex((r) => {
      const cells = r.map(text);
      return cells.includes('Transaction Date') && cells.includes('ISIN');
    });
    if (headerAt < 0) continue;
    found = true;
    const header = (sheet.rows[headerAt] ?? []).map(text);
    const col = Object.fromEntries(
      Object.entries(COLUMNS).map(([key, names]) => [
        key,
        header.findIndex((h) => (names as readonly string[]).includes(h)),
      ]),
    ) as Record<keyof typeof COLUMNS, number>;
    const missing = (Object.keys(COLUMNS) as (keyof typeof COLUMNS)[]).find(
      (k) => k !== 'ref' && col[k] < 0,
    );
    if (missing) {
      problems.push(
        `${sheet.name} has no ${COLUMNS[missing].join(' or ')} column. Download the file again.`,
      );
      continue;
    }
    const funds = header[col.name] === 'Scheme Name';

    const sheetRows: VrRow[] = [];
    let sum = 0;
    let total: number | null = null;
    for (let r = headerAt + 1; r < sheet.rows.length; r++) {
      const cells = sheet.rows[r] ?? [];
      if (cells.every((c) => text(c) === '')) break;
      if (text(cells[0]).endsWith(' Total')) {
        total = Math.round(num(cells[col.amount]) * 100);
        break;
      }
      const line = r + 1;
      const skip = (reason: string) => skipped.push({ sheet: sheet.name, line, reason });
      const signed = num(cells[col.amount]);
      if (Number.isFinite(signed)) sum += Math.round(signed * 100);

      const kind = text(cells[col.type]);
      const action = /^Investment in/i.test(kind)
        ? 'buy'
        : kind === 'Sell/Redemption'
          ? 'sell'
          : null;
      if (!action) {
        skip(`“${kind || 'No type'}” isn't imported. Add it by hand if you need it.`);
        continue;
      }
      const date = parseVrDate(cells[col.date]);
      if (!date) {
        skip(`The date “${text(cells[col.date])}” can't be read.`);
        continue;
      }
      const isin = text(cells[col.isin]).toUpperCase();
      if (!/^IN[A-Z0-9]{10}$/.test(isin)) {
        skip(`The ISIN “${isin}” isn't valid.`);
        continue;
      }
      const name = text(cells[col.name]);
      const unitsRaw = num(cells[col.units]);
      const priceRaw = num(cells[col.price]);
      if (!name || !Number.isFinite(signed) || signed === 0) {
        skip('It has no name or amount.');
        continue;
      }
      if (!Number.isFinite(unitsRaw) || unitsRaw === 0) {
        skip(`${formatDate(date)} has no units. Add it by hand if you need it.`);
        continue;
      }

      const amount = Math.abs(Math.round(signed * 100));
      const units = new Decimal(Math.abs(unitsRaw)).toDecimalPlaces(6).toString();
      const chargesFor = (price: string) =>
        action === 'buy' ? amount - unitsAmount(units, price) : unitsAmount(units, price) - amount;
      let price =
        Number.isFinite(priceRaw) && priceRaw > 0
          ? new Decimal(priceRaw).toDecimalPlaces(6).toString()
          : null;
      let priceAdjusted = false;
      // Charges can't be negative, so when they would be, the price is worked out from the amount.
      // Rounded towards zero charges, so the money moved still equals the file's amount exactly.
      if (price === null || chargesFor(price) < 0) {
        price = new Decimal(amount)
          .div(100)
          .div(units)
          .toDecimalPlaces(6, action === 'buy' ? Decimal.ROUND_DOWN : Decimal.ROUND_UP)
          .toString();
        priceAdjusted = true;
      }
      const fees = chargesFor(price);
      sheetRows.push({
        sheet: sheet.name,
        line,
        date,
        name,
        isin,
        type: funds ? 'mutual_fund' : isin.startsWith('INE') ? 'stock' : 'etf',
        accountRef: col.ref >= 0 ? text(cells[col.ref]) || null : null,
        action,
        units,
        price,
        amount: unitsAmount(units, price),
        fees,
        priceAdjusted,
      });
    }
    if (total !== null && total !== sum) {
      problems.push(`The totals in ${sheet.name} don't add up. Download the file again.`);
    }
    // The file lists each investment newest first; reversing keeps same-day rows in their true order.
    rows.push(...sheetRows.reverse());
  }

  if (!found) problems.push(NOT_VR);
  // Stable, so rows on the same day stay in file order.
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { rows, skipped, problems };
}
