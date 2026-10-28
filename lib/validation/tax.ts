import { z } from 'zod';
import { parsePaise } from '@/lib/domain/money';

/** An amount of zero or more; empty means `empty`. */
const amount = <T extends number | null>(empty: T) =>
  z.preprocess(
    (v) => v ?? '',
    z.string().transform((s, ctx): number | T => {
      if (s.trim() === '') return empty;
      const r = parsePaise(s);
      if (!r.ok) {
        ctx.addIssue({ code: 'custom', message: r.message });
        return z.NEVER;
      }
      if (r.value < 0) {
        ctx.addIssue({ code: 'custom', message: 'Enter zero or more.' });
        return z.NEVER;
      }
      return r.value;
    }),
  );

export const taxYearSchema = z.object({
  year: z.coerce.number({ error: 'Choose a financial year.' }).int().min(2000).max(2100),
  grossSalary: amount(null),
  salaryTds: amount(null),
  otherTds: amount(0),
  taxPaid: amount(0),
  otherIncome: amount(0),
  interestOverride: amount(null),
  dividendOverride: amount(null),
});

export type TaxYearInput = z.infer<typeof taxYearSchema>;
