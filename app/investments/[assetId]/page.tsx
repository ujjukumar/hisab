import { notFound } from 'next/navigation';
import { Card } from '@/components/Card/Card';
import { LineChart } from '@/components/charts/LineChart';
import { LegendInline, LegendKey } from '@/components/charts/Tip';
import {
  HoldingRowMenu,
  RecordTransactionButton,
  FetchPricesButton,
  UpdateValuesButton,
} from '@/components/InvestmentDrawer/InvestmentDrawer';
import { InvestmentTxnTable } from '@/components/InvestmentTxnTable/InvestmentTxnTable';
import { PageHead } from '@/components/PageHead/PageHead';
import { Rows } from '@/components/Rows/Rows';
import { InvestmentChange } from '@/components/StatStrip/InvestmentChange';
import { ASSET_TYPE_LABELS, COMPOUNDING_LABELS, GROUPS, maskRef } from '@/lib/domain/assets';
import { today } from '@/lib/domain/dates';
import {
  formatDate,
  formatDay,
  formatINR,
  formatINRSigned,
  formatReturn,
  formatUnits,
  gainClass,
} from '@/lib/domain/format';
import { PERIODS, investmentPeriodRows } from '@/lib/domain/performance';
import { fdValue } from '@/lib/domain/valuation';
import {
  assetOptions,
  holdingHistory,
  listInvestmentTxns,
  parseInvTxnFilters,
  portfolio,
  portfolioData,
} from '@/lib/queries/investments';
import { financialYearStartMonth } from '@/lib/queries/settings';

export default async function HoldingPage({ params }: { params: Promise<{ assetId: string }> }) {
  const id = Number((await params).assetId);
  const date = today();
  const row = Number.isInteger(id) ? portfolio(date).find((r) => r.asset.id === id) : undefined;
  const option = assetOptions().find((o) => o.id === id);
  if (!row || !option) notFound();

  const yearStart = await financialYearStartMonth();
  const data = portfolioData();
  const changes = PERIODS.map((period) => {
    const result = investmentPeriodRows(data, period, date, yearStart)
      .find((r) => r.row.asset.id === id);
    return { period, gain: result?.gain ?? 0, absolute: result?.absolute ?? null };
  });

  const { asset, holding } = row;
  const group = GROUPS.find((g) => g.key === row.group);
  const units = asset.valuation === 'units';
  const { rows } = listInvestmentTxns({ ...parseInvTxnFilters({}), assetId: id }, { all: true });
  const history = holdingHistory(id).map((p) => ({
    label: formatDate(p.date),
    short: formatDay(p.date),
    invested: p.invested,
    worth: p.worth,
  }));
  const ref = maskRef(asset.accountRef);

  return (
    <>
      <PageHead
        title={asset.name}
        sub={[ASSET_TYPE_LABELS[asset.type], ref, asset.archived ? 'Archived' : '']
          .filter(Boolean)
          .join(' · ')}
        actions={
          <>
            <RecordTransactionButton assetId={id} />
            {!row.sold && (units ? (
              <FetchPricesButton variant="button" ids={[id]} label="Fetch price" />
            ) : asset.valuation === 'manual' ? (
              <UpdateValuesButton variant="button" ids={[id]} label="Update value" />
            ) : null)}
            <HoldingRowMenu asset={option} compact />
          </>
        }
        statsVariant="three"
        stats={[
          {
            label: 'Current value',
            value: formatINR(row.value),
            aside: units
              ? `${formatUnits(holding.units.toNumber(), holding.units.isInteger() ? 0 : 3)} ${group?.unitWord ?? 'units'}, ${formatINR(row.sold ? 0 : holding.cost)} invested`
              : `${formatINR(holding.cost)} invested`,
          },
          { label: 'Change in period', value: <InvestmentChange changes={changes} /> },
          {
            label: row.sold ? 'Realised gain' : 'Total return',
            value: formatINRSigned(row.totalReturn),
            aside: formatReturn(row.ret),
            tone: gainClass(row.totalReturn),
            asideTone: gainClass((row.ret?.rate ?? 0) * 100),
          },
        ]}
      />
      <div className="wrap page-body">
        <div className="grid">
          <Card
            span={asset.valuation === 'fd' ? 8 : 12}
            title="Invested and worth"
            sub={units ? 'At each recorded price' : 'At each statement and transaction'}
            action={
              <LegendInline>
                <LegendKey color="var(--c1)">Invested</LegendKey>
                <LegendKey color="var(--c2)">Worth</LegendKey>
              </LegendInline>
            }
          >
            <LineChart points={history} />
          </Card>
          {asset.valuation === 'fd' && (
            <Card span={4} title="Deposit details">
              <Rows
                rows={[
                  { key: 'p', name: 'Principal', amount: formatINR(holding.cost) },
                  {
                    key: 'r',
                    name: 'Interest rate',
                    amount: `${asset.interestRate ?? '0'}% a year`,
                  },
                  {
                    key: 'c',
                    name: 'Interest added',
                    amount: COMPOUNDING_LABELS[asset.compounding ?? 'quarterly'],
                  },
                  {
                    key: 's',
                    name: 'Start date',
                    amount: asset.startDate ? formatDate(asset.startDate) : '—',
                  },
                  {
                    key: 'm',
                    name: 'Maturity date',
                    amount: asset.maturityDate ? formatDate(asset.maturityDate) : '—',
                  },
                  {
                    key: 'v',
                    name: 'Maturity value',
                    total: true,
                    amount:
                      asset.maturityDate && asset.startDate && holding.cost > 0
                        ? formatINR(
                            fdValue({
                              principal: holding.cost,
                              rate: asset.interestRate ?? '0',
                              compounding: asset.compounding,
                              start: asset.startDate,
                              maturity: asset.maturityDate,
                              date: asset.maturityDate,
                            }),
                          )
                        : '—',
                  },
                ]}
              />
            </Card>
          )}
        </div>

        <InvestmentTxnTable
          title={`Transactions (${rows.length})`}
          rows={rows}
          showAsset={false}
          empty={
            <>
              <p>No transactions for this investment yet. Record one to start tracking it.</p>
              <RecordTransactionButton assetId={id} />
            </>
          }
        />
        <p className="footnote">All amounts in ₹.{asset.note && <> Note: {asset.note}</>}</p>
      </div>
    </>
  );
}
