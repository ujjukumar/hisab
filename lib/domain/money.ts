/** Money is integer paise everywhere in this app. ₹1,250.50 → 125050. */
export type Paise = number;

export type ParseResult =
  | { ok: true; value: Paise }
  | { ok: false; message: string };

/**
 * Parse what the owner typed into paise.
 * Accepts "1,250.50", "₹ 1250", "-300", "1250.5". Rejects more than 2 decimals.
 */
export function parsePaise(input: string): ParseResult {
  const cleaned = String(input ?? '')
    .replace(/[₹,\s]/g, '')
    .replace(/−/g, '-'); // U+2212 minus, in case a formatted value is pasted back

  if (cleaned === '') return { ok: false, message: 'Enter an amount.' };
  if (!/^-?\d*(\.\d*)?$/.test(cleaned) || cleaned === '-' || cleaned === '.') {
    return { ok: false, message: 'Enter an amount using digits, for example 1250.50.' };
  }

  const [whole = '', fraction] = cleaned.split('.');
  if (fraction !== undefined && fraction.length > 2) {
    return { ok: false, message: 'Amounts can have at most 2 decimal places.' };
  }

  const negative = whole.startsWith('-');
  const digits = negative ? whole.slice(1) : whole;
  const rupees = digits === '' ? 0 : Number(digits);
  const paise = Number((fraction ?? '').padEnd(2, '0'));

  if (!Number.isSafeInteger(rupees * 100 + paise)) {
    return { ok: false, message: 'That amount is too large.' };
  }

  const value = rupees * 100 + paise;
  return { ok: true, value: negative ? -value : value };
}

/** Parse and require a positive amount. Used by the transaction forms. */
export function parsePositivePaise(input: string): ParseResult {
  const result = parsePaise(input);
  if (!result.ok) return result;
  if (result.value <= 0) return { ok: false, message: 'Enter an amount greater than zero.' };
  return result;
}

/** Paise → rupees as a number. Only for display and chart maths, never for storage. */
export function toRupees(paise: Paise): number {
  return paise / 100;
}

/** Rupees (a number, e.g. from a chart or a seed script) → paise. */
export function fromRupees(rupees: number): Paise {
  return Math.round(rupees * 100);
}

/** The value a text input should show when editing an existing amount. */
export function paiseToInput(paise: Paise): string {
  const sign = paise < 0 ? '-' : '';
  const abs = Math.abs(paise);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}
