'use client';

import { useState } from 'react';
import { Card } from '@/components/Card/Card';
import { SelectField } from '@/components/Field/Field';
import { GainLoseTiles, type Mover } from '@/components/GainLoseTiles/GainLoseTiles';
import styles from './MoversCard.module.css';

/** Top gainers and losers since each holding's previous price, filtered and sorted in the browser. */
export function MoversCard({
  movers,
  groups,
  sub,
}: {
  movers: (Mover & { group: string })[];
  /** The investment groups that have movers, for the filter. */
  groups: { key: string; title: string }[];
  sub: string;
}) {
  const [group, setGroup] = useState('');
  const [sort, setSort] = useState<'value' | 'percent'>('value');
  const key = sort === 'value' ? 'gain' : 'percent';
  const pool = movers.filter((m) => !group || m.group === group);
  const gainers = pool.filter((m) => m.gain > 0).sort((a, b) => b[key] - a[key]);
  const losers = pool.filter((m) => m.gain < 0).sort((a, b) => a[key] - b[key]);

  return (
    <Card title="Top gainers & losers" sub={sub} span={7}>
      <div className={styles.filters}>
        <SelectField
          id="movers-group"
          label="Investment type"
          value={group}
          onChange={(event) => setGroup(event.target.value)}
        >
          <option value="">All investments</option>
          {groups.map((g) => (
            <option key={g.key} value={g.key}>
              {g.title}
            </option>
          ))}
        </SelectField>
        <SelectField
          id="movers-sort"
          label="Sort by"
          value={sort}
          onChange={(event) => setSort(event.target.value === 'percent' ? 'percent' : 'value')}
        >
          <option value="value">Return value</option>
          <option value="percent">Return %</option>
        </SelectField>
      </div>
      <GainLoseTiles gainers={gainers.slice(0, 3)} losers={losers.slice(0, 3)} />
    </Card>
  );
}
