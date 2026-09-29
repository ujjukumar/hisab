/** Quote every text cell, and defuse anything a spreadsheet would run as a formula. */
export function cell(value: string | null): string {
  const text = value ?? '';
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

/** Paise as signed rupees with two decimals, e.g. -1234.50. */
export const rupees = (paise: number) => (paise / 100).toFixed(2);

/** A CSV download: a header line, then one line per row. */
export function csvResponse(filename: string, header: string, lines: string[]): Response {
  return new Response([header, ...lines].join('\r\n') + '\r\n', {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
