import Link from 'next/link';
import { ButtonLink } from '@/components/Button/Button';
import { SearchField, SelectField } from '@/components/Field/Field';
import {
  OpenFromUrl,
  RecordTransactionButton,
} from '@/components/InvestmentDrawer/InvestmentDrawer';
import { InvestmentTxnTable } from '@/components/InvestmentTxnTable/InvestmentTxnTable';
import { DurationField, FilterForm } from '@/components/TransactionFilters/TransactionFilters';
import { ACTION_LABELS, GROUPS } from '@/lib/domain/assets';
import {
  assetOptions,
  getInvestmentTxn,
  invTxnFilterParams,
  listInvestmentTxns,
  parseInvTxnFilters,
  type InvTxnFilters,
} from '@/lib/queries/investments';
import { paramReader, PAGE_SIZE } from '@/lib/queries/money';
import { INVESTMENT_ACTIONS } from '@/lib/validation/investments';

const href = (f: InvTxnFilters) => {
  const query = invTxnFilterParams(f).toString();
  return query ? `/investments/transactions?${query}` : '/investments/transactions';
};

export default async function InvestmentTransactionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const f = parseInvTxnFilters(params);
  const { rows, count } = listInvestmentTxns(f);
  const editId = paramReader(params).id('edit');
  const options = assetOptions();
  const filtered = Boolean(f.from || f.to || f.action || f.group || f.assetId || f.q);
  const exportQuery = invTxnFilterParams({ ...f, limit: PAGE_SIZE }).toString();

  return (
    <div className="wrap page-body">
      {editId && <OpenFromUrl row={getInvestmentTxn(editId)} />}
      <FilterForm
        path="/investments/transactions"
        label="Filter investment transactions"
        values={{
          from: f.from ?? '',
          to: f.to ?? '',
          action: f.action ?? '',
          group: f.group ?? '',
          asset: f.assetId ? String(f.assetId) : '',
          q: f.q,
        }}
      >
        <DurationField from={f.from ?? ''} to={f.to ?? ''} />
        <SelectField label="Action" name="action" defaultValue={f.action ?? ''}>
          <option value="">All actions</option>
          {INVESTMENT_ACTIONS.map((a) => (
            <option key={a} value={a}>
              {ACTION_LABELS[a]}
            </option>
          ))}
        </SelectField>
        <SelectField label="Group" name="group" defaultValue={f.group ?? ''}>
          <option value="">All groups</option>
          {GROUPS.map((g) => (
            <option key={g.key} value={g.key}>
              {g.title}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="Investment"
          name="asset"
          defaultValue={f.assetId ? String(f.assetId) : ''}
        >
          <option value="">All investments</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.archived ? `${o.name} (archived)` : o.name}
            </option>
          ))}
        </SelectField>
        <SearchField
          label="Search"
          name="q"
          placeholder="Investment or note"
          autoComplete="off"
          maxLength={100}
          defaultValue={f.q}
        />
      </FilterForm>

      <InvestmentTxnTable
        title={`Transactions (${count})`}
        actions={
          count > 0 && (
            <ButtonLink
              variant="secondary"
              icon="download"
              download
              href={`/api/export/investment-transactions${exportQuery ? `?${exportQuery}` : ''}`}
            >
              Export CSV
            </ButtonLink>
          )
        }
        rows={rows}
        empty={
          filtered ? (
            <>
              <p>No investment transactions match these filters.</p>
              <ButtonLink variant="secondary" href="/investments/transactions">
                Clear filters
              </ButtonLink>
            </>
          ) : (
            <>
              <p>No investment transactions yet. Record a buy or a deposit to start tracking.</p>
              <RecordTransactionButton />
            </>
          )
        }
      />

      {rows.length < count && (
        <p className="footnote">
          Showing {rows.length} of {count}.{' '}
          <Link href={href({ ...f, limit: f.limit + PAGE_SIZE })} scroll={false}>
            Show more
          </Link>
        </p>
      )}
      <p className="footnote">
        All amounts in ₹. Balance units are what you held right after each transaction.
      </p>
    </div>
  );
}
