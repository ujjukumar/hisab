import { notFound } from 'next/navigation';
import { Card } from '@/components/Card/Card';
import { LineChart } from '@/components/charts/LineChart';
import { LegendInline, LegendKey } from '@/components/charts/Tip';
import {
  HoldingRowMenu,
  RecordTransactionButton,
  UpdatePricesButton,
} from '@/components/InvestmentDrawer/InvestmentDrawer';
import { InvestmentTxnTable } from '@/components/InvestmentTxnTable/InvestmentTxnTable';
import { PageHead } from '@/components/PageHead/PageHead';
import { Rows } from '@/components/Rows/Rows';
import { ASSET_TYPE_LABELS, COMPOUNDING_LABELS, GROUPS, maskRef } from '@/lib/domain/assets';
import {
  formatDate,
  formatDay,
  formatINR,
  formatINRSigned,
  formatPercentNoPlus,
  formatReturn,
  formatUnits,
  gainClass,
} from '@/lib/domain/format';
import { fdValue } from '@/lib/domain/valuation';
import {
  assetOptions,
  holdingHistory,
  listInvestmentTxns,
  parseInvTxnFilters,
  portfolio,
} from '@/lib/queries/investments';

export default async function HoldingPage({ params }: { params: Promise<{ assetId: string }> }) {
  const id = Number((await params).assetId);
  const row = Number.isInteger(id) ? portfolio().find((r) => r.asset.id === id) : undefined;
  const option = assetOptions().find((o) => o.id === id);
  if (!row || !option) notFound();

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
            {asset.valuation !== 'fd' && !row.sold && (
              <UpdatePricesButton
                variant="button"
                ids={[id]}
                label={units ? 'Update price' : 'Update value'}
              />
            )}
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
          row.sinceLast
            ? {
                label: `Since ${formatDay(row.sinceLast.since)}`,
                value: formatINRSigned(row.sinceLast.change),
                aside: formatPercentNoPlus(
                  (row.sinceLast.change / row.sinceLast.previousValue) * 100,
                ),
                tone: gainClass(row.sinceLast.change),
                asideTone: gainClass(row.sinceLast.change),
              }
            : {
                label: 'Since last update',
                value: '—',
                aside: units ? 'Needs two prices' : 'Not priced',
              },
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
            sub={units ? 'At each price you entered' : 'At each statement and transaction'}
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
