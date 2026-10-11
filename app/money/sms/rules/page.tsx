import { SmsRules, type SmsRuleRow } from '@/components/SmsRules/SmsRules';
import { formatReceived, senderLabel } from '@/lib/domain/smsReview';
import { listAccounts, listCategories } from '@/lib/queries/money';
import { smsRuleRows } from '@/lib/queries/sms';

export default function SmsRulesPage() {
  const now = new Date();
  const accounts = listAccounts().map(({ id, name, archived }) => ({ id, name, archived }));
  const categories = listCategories().map(({ id, name, kind, archived }) => ({
    id,
    name,
    kind,
    archived,
  }));
  const name = (list: { id: number; name: string }[], id: number | null) =>
    id === null ? null : (list.find((item) => item.id === id)?.name ?? 'Missing');

  const rows: SmsRuleRow[] = smsRuleRows().map((rule) => ({
    id: rule.id,
    name: rule.name,
    sender: senderLabel(rule.senderPattern),
    accountId: rule.accountId,
    account: name(accounts, rule.accountId) ?? 'Missing',
    incomeCategoryId: rule.incomeCategoryId,
    incomeTransferAccountId: rule.incomeTransferAccountId,
    income:
      rule.incomeTransferAccountId !== null
        ? `Transfer from ${name(accounts, rule.incomeTransferAccountId)}`
        : name(categories, rule.incomeCategoryId),
    expenseCategoryId: rule.expenseCategoryId,
    expenseTransferAccountId: rule.expenseTransferAccountId,
    expense:
      rule.expenseTransferAccountId !== null
        ? `Transfer to ${name(accounts, rule.expenseTransferAccountId)}`
        : name(categories, rule.expenseCategoryId),
    enabled: rule.enabled === 1,
    imported: rule.imported,
    lastUsed: rule.lastUsed ? formatReceived(rule.lastUsed, now) : null,
    lastUsedAt: rule.lastUsed,
  }));

  return (
    <>
      <SmsRules rows={rows} accounts={accounts} categories={categories} />
      <p className="footnote">
        Rules import SMS that match a sender and wording you approved before. Turning a rule off
        sends its matches to Review instead.
      </p>
    </>
  );
}
