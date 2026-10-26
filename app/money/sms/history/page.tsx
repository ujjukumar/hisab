import Link from 'next/link';
import { ChipLinks } from '@/components/Chips/Chips';
import {
  Amount,
  DataTable,
  DateCell,
  DescCell,
  NameCell,
  tableSortFromParams,
  tableSortHref,
  type Column,
} from '@/components/DataTable/DataTable';
import { MonthPicker } from '@/components/MonthPicker/MonthPicker';
import { Tag } from '@/components/Tag/Tag';
import { currentMonth, isValidMonth, monthLabel, type IsoMonth } from '@/lib/domain/dates';
import { formatAmount, MINUS } from '@/lib/domain/format';
import { formatReceived } from '@/lib/domain/smsReview';
import { smsHistory, smsRuleRows, type SmsOutcome } from '@/lib/queries/sms';
import styles from './page.module.css';

type Row = ReturnType<typeof smsHistory>[number];
type OutcomeFilter = 'all' | SmsOutcome;

const PATH = '/money/sms/history';

const OUTCOMES: { value: OutcomeFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'auto', label: 'Imported automatically' },
  { value: 'approved', label: 'Approved by you' },
  { value: 'rejected', label: 'Rejected' },
];

const OUTCOME_TAGS: Record<SmsOutcome, { label: string; tone: 'primary' | 'neutral' | 'quiet' }> = {
  auto: { label: 'Imported automatically', tone: 'primary' },
  approved: { label: 'Approved by you', tone: 'neutral' },
  rejected: { label: 'Rejected', tone: 'quiet' },
};

function parseOutcome(value: string | null): OutcomeFilter {
  return OUTCOMES.some((o) => o.value === value) ? (value as OutcomeFilter) : 'all';
}

/** History links keep only what differs from the default view: this month, every outcome. */
function historyHref(view: {
  month: IsoMonth;
  outcome: OutcomeFilter;
  rule: number | null;
  current: IsoMonth;
}): string {
  const params = new URLSearchParams();
  if (view.rule) params.set('rule', String(view.rule));
  else if (view.month !== view.current) params.set('month', view.month);
  if (view.outcome !== 'all') params.set('outcome', view.outcome);
  const query = params.toString();
  return query ? `${PATH}?${query}` : PATH;
}

function amountCell(row: Row) {
  if (row.amount === null) return null;
  if (row.outcome === 'rejected') return <Amount tone="muted">{formatAmount(row.amount)}</Amount>;
  // Transfers are grey and unsigned, as in Transactions.
  if (row.transactionType === 'transfer') {
    return <Amount tone="muted">{formatAmount(row.amount)}</Amount>;
  }
  return row.direction === 'income' ? (
    <Amount tone="pos">+{formatAmount(row.amount)}</Amount>
  ) : (
    <Amount>
      {MINUS}
      {formatAmount(row.amount)}
    </Amount>
  );
}

export default async function SmsHistoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const params = new URLSearchParams(
    Object.entries(raw).flatMap(([key, value]) =>
      typeof value === 'string' ? [[key, value]] : [],
    ),
  );
  const now = new Date();
  const current = currentMonth(now);
  const monthParam = params.get('month') ?? '';
  const month = isValidMonth(monthParam) ? monthParam : current;
  const outcome = parseOutcome(params.get('outcome'));
  const ruleId = Number(params.get('rule'));
  const rule =
    Number.isSafeInteger(ruleId) && ruleId > 0
      ? (smsRuleRows().find((r) => r.id === ruleId) ?? null)
      : null;
  const href = (view: Partial<{ month: IsoMonth; outcome: OutcomeFilter; rule: number | null }>) =>
    historyHref({ month, outcome, rule: rule?.id ?? null, current, ...view });

  const all = smsHistory({ month, ruleId: rule?.id ?? null });
  const counts: Record<OutcomeFilter, number> = {
    all: all.length,
    auto: 0,
    approved: 0,
    rejected: 0,
  };
  for (const row of all) counts[row.outcome] += 1;
  const rows = outcome === 'all' ? all : all.filter((row) => row.outcome === outcome);
  const sort = tableSortFromParams(params, ['received', 'sender', 'amount']) ?? {
    key: 'received',
    dir: 'desc' as const,
  };

  const columns: Column<Row>[] = [
    {
      key: 'received',
      header: 'Received',
      align: 'l',
      sortable: true,
      sortValue: (row) => row.receivedAt,
      cell: (row) => <DateCell>{formatReceived(row.receivedAt, now)}</DateCell>,
    },
    {
      key: 'sender',
      header: 'Sender',
      align: 'l',
      sortable: true,
      sortValue: (row) => row.sender,
      cell: (row) => <span className={styles.sender}>{row.sender}</span>,
    },
    {
      key: 'description',
      header: 'Description',
      align: 'l',
      cell: (row) =>
        row.outcome === 'rejected' ? (
          <span className="muted">Not added</span>
        ) : row.description === null ? (
          <span className="muted">Transaction removed</span>
        ) : (
          <DescCell
            desc={row.description}
            note={row.transactionType === 'transfer' ? 'Transfer' : undefined}
          />
        ),
    },
    {
      key: 'outcome',
      header: 'Outcome',
      align: 'l',
      cell: (row) => (
        <Tag tone={OUTCOME_TAGS[row.outcome].tone}>{OUTCOME_TAGS[row.outcome].label}</Tag>
      ),
    },
    {
      key: 'rule',
      header: 'Rule',
      align: 'l',
      cell: (row) =>
        row.ruleId && row.ruleName ? (
          <NameCell href={href({ rule: row.ruleId, outcome: 'all' })} name={row.ruleName} />
        ) : (
          null
        ),
    },
    {
      key: 'amount',
      header: 'Amount',
      sortable: true,
      sortValue: (row) => row.amount,
      cell: amountCell,
    },
  ];

  const period = rule ? 'by this rule' : `in ${monthLabel(month)}`;
  const empty =
    outcome !== 'all' && all.length > 0 ? (
      <>
        <p>
          No {OUTCOMES.find((o) => o.value === outcome)!.label.toLowerCase()} SMS {period}.
        </p>
        <Link href={href({ outcome: 'all' })} scroll={false}>
          Show all {all.length}
        </Link>
      </>
    ) : rule ? (
      <p>This rule hasn&apos;t imported any SMS yet. Matching messages will appear here.</p>
    ) : (
      <p>
        No SMS processed in {monthLabel(month)}. Approved and imported messages will appear here.
      </p>
    );

  return (
    <>
      <div className={styles.bar}>
        {rule ? (
          <p className={styles.ruleNote}>
            Every SMS imported by <strong>{rule.name}</strong>.{' '}
            <Link href={PATH} scroll={false}>
              Show all SMS
            </Link>
          </p>
        ) : (
          <MonthPicker month={month} current={current} href={(m) => href({ month: m })} />
        )}
        <ChipLinks
          label="Outcome"
          items={OUTCOMES.map((o) => ({
            href: href({ outcome: o.value }),
            label: o.label,
            count: counts[o.value],
            current: outcome === o.value,
          }))}
        />
      </div>

      <DataTable
        title={rule ? rule.name : monthLabel(month)}
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        sort={sort}
        sortHref={(key, dir) => tableSortHref(PATH, params.toString(), key, dir)}
        empty={empty}
      />

      <p className="footnote">
        All amounts in ₹. Original SMS text is erased after a decision; Hisaab keeps the sender,
        amount and outcome.
      </p>
    </>
  );
}
