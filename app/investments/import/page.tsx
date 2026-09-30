import { Card } from '@/components/Card/Card';
import { ImportForm } from '@/components/ImportForm/ImportForm';
import { PageHead } from '@/components/PageHead/PageHead';
import { listAccounts } from '@/lib/queries/money';

export default function ImportPage() {
  const accounts = listAccounts()
    .filter((a) => !a.archived)
    .map(({ id, name }) => ({ id, name }));

  return (
    <>
      <PageHead title="Import transactions" sub="From a Value Research transaction history" />
      <div className="wrap page-body">
        <Card
          title="Choose the file"
          sub="In your Value Research portfolio, open Transaction History, choose All-time and download it as Excel (.xls). Checking the file changes nothing."
        >
          <ImportForm accounts={accounts} />
        </Card>
        <p className="footnote">
          Buys and sales of funds, stocks and ETFs are imported; each fund is matched by its ISIN,
          so importing the same file again adds nothing twice. A backup is saved before anything
          changes.
        </p>
      </div>
    </>
  );
}
