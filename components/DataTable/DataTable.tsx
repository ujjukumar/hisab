import Link from 'next/link';
import type { ReactNode } from 'react';
import { Icon } from '@/components/Icon/Icon';
import styles from './DataTable.module.css';

export type SortDirection = 'asc' | 'desc';

export type Column<T> = {
  key: string;
  header: ReactNode;
  /** Small uppercase line under the header, e.g. 'per unit'. */
  sub?: ReactNode;
  align?: 'l' | 'r';
  sortable?: boolean;
  cell: (row: T) => ReactNode;
};

export type DataTableProps<T> = {
  title?: ReactNode;
  actions?: ReactNode;
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string | number;
  /** Current sort. Headers become links built by `sortHref`. */
  sort?: { key: string; dir: SortDirection };
  sortHref?: (key: string, dir: SortDirection) => string;
  /** Shown in place of the body when there are no rows. */
  empty?: ReactNode;
  footer?: ReactNode;
  /** Per-row actions menu in the last column. */
  menu?: (row: T) => ReactNode;
  /** Narrower minimum width, used by the money table. */
  narrow?: boolean;
};

export function DataTable<T>({
  title,
  actions,
  columns,
  rows,
  rowKey,
  sort,
  sortHref,
  empty,
  footer,
  menu,
  narrow,
}: DataTableProps<T>) {
  const span = columns.length + (menu ? 1 : 0);

  return (
    <div className={styles.tableCard}>
      {(title || actions) && (
        <div className={styles.head}>
          {title && <h2 className={styles.title}>{title}</h2>}
          {actions && <div className={styles.headActions}>{actions}</div>}
        </div>
      )}
      <div className={styles.scroll}>
        <table className={`${styles.tbl} ${narrow ? styles.money : ''}`}>
          <thead>
            <tr>
              {columns.map((col) => {
                const active = sort?.key === col.key;
                const ariaSort = active
                  ? sort.dir === 'asc'
                    ? 'ascending'
                    : 'descending'
                  : undefined;
                const nextDir: SortDirection = active && sort.dir === 'desc' ? 'asc' : 'desc';
                const label = (
                  <>
                    <span>{col.header}</span>
                    {col.sub && <span className={styles.sub}>{col.sub}</span>}
                  </>
                );
                return (
                  <th
                    key={col.key}
                    className={col.align === 'l' ? 'l' : undefined}
                    aria-sort={ariaSort}
                    scope="col"
                  >
                    {col.sortable && sortHref ? (
                      <Link className={styles.thBtn} href={sortHref(col.key, nextDir)}>
                        {label}
                        <Icon name="sort" className={styles.sort} />
                      </Link>
                    ) : (
                      label
                    )}
                  </th>
                );
              })}
              {menu && (
                <th className={styles.menuCol} scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr className={styles.emptyRow}>
                <td colSpan={span}>{empty ?? 'Nothing here yet'}</td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={rowKey(row)}>
                  {columns.map((col) => (
                    <td key={col.key} className={col.align === 'l' ? 'l' : 'r'}>
                      {col.cell(row)}
                    </td>
                  ))}
                  {menu && <td className="r">{menu(row)}</td>}
                </tr>
              ))
            )}
          </tbody>
          {footer && rows.length > 0 && <tfoot>{footer}</tfoot>}
        </table>
      </div>
    </div>
  );
}

/* ---------- cell helpers, so pages do not repeat the class names ---------- */

export function Amount({
  children,
  tone,
  sub,
  subTone,
}: {
  children: ReactNode;
  tone?: 'pos' | 'neg' | 'muted' | '';
  sub?: ReactNode;
  subTone?: 'pos' | 'neg' | '';
}) {
  return (
    <>
      <span className={`${styles.cellMain} ${tone ?? ''}`}>{children}</span>
      {sub && <span className={`${styles.cellSub} ${subTone ?? ''}`}>{sub}</span>}
    </>
  );
}

export function NameCell({
  href,
  name,
  sub,
  color,
}: {
  href?: string;
  name: ReactNode;
  sub?: ReactNode;
  color?: string;
}) {
  return (
    <span className={styles.nameCell}>
      {color && <i className="dot" style={{ background: color }} aria-hidden="true" />}
      <span>
        {href ? (
          <Link className={styles.nameLink} href={href}>
            {name}
          </Link>
        ) : (
          <span className={styles.desc}>{name}</span>
        )}
        {sub && <span className={styles.nameSub}>{sub}</span>}
      </span>
    </span>
  );
}

export function DescCell({ desc, note }: { desc: ReactNode; note?: ReactNode }) {
  return (
    <>
      <span className={styles.desc}>{desc}</span>
      {note && <span className={styles.nameSub}>{note}</span>}
    </>
  );
}

export function DateCell({ children }: { children: ReactNode }) {
  return <span className={styles.dateCell}>{children}</span>;
}

export function CategoryChip({ name, color }: { name: ReactNode; color?: string }) {
  return (
    <span className={styles.catChip}>
      {color && <i className="dot" style={{ background: color }} aria-hidden="true" />}
      {name}
    </span>
  );
}

/** The filter row above a table. `label` names it as a search landmark. */
export function Filters({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <div className={styles.filters} role={label ? 'search' : undefined} aria-label={label}>
      {children}
    </div>
  );
}

export const tableStyles = styles;
