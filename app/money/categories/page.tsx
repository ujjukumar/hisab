import Link from 'next/link';
import { CategoriesTables } from '@/components/CategoriesTables/CategoriesTables';
import { listCategoriesWithTotals } from '@/lib/queries/money';

export default async function CategoriesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const showArchived = (await searchParams).archived === '1';
  const { rows, yearLabel } = await listCategoriesWithTotals();
  const archived = rows.filter((c) => c.archived).length;

  return (
    <div className="wrap page-body stack">
      {archived > 0 && (
        <p className="tbl-note" style={{ margin: 0 }}>
          {showArchived ? (
            <Link className="linkish" href="/money/categories">
              Hide archived categories
            </Link>
          ) : (
            <>
              {archived === 1
                ? '1 archived category is hidden.'
                : `${archived} archived categories are hidden.`}{' '}
              <Link className="linkish" href="/money/categories?archived=1">
                Show archived categories
              </Link>
            </>
          )}
        </p>
      )}
      <CategoriesTables
        rows={showArchived ? rows : rows.filter((c) => !c.archived)}
        yearLabel={yearLabel}
      />
      <p className="footnote" style={{ margin: 0 }}>
        All amounts in ₹. Figures are for the {yearLabel} financial year. Archived categories are
        hidden from the transaction form but keep their history.
      </p>
    </div>
  );
}
