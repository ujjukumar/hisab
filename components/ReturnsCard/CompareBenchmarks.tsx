'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import styles from './ReturnsCard.module.css';

export function CompareBenchmarks({ items }: { items: { id: number; name: string }[] }) {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const selected = new Set((params.get('compare') ?? '').split(',').map(Number));
  return <div className={styles.compare} role="group" aria-label="Compare with">
    <span>Compare with</span>
    {items.map(({ id, name }) => <button key={id} type="button" aria-pressed={selected.has(id)}
      onClick={() => {
        const next = new URLSearchParams(params.toString());
        const chosen = new Set(selected);
        if (chosen.has(id)) chosen.delete(id);
        else chosen.add(id);
        if (chosen.size) next.set('compare', [...chosen].join(','));
        else next.delete('compare');
        router.replace(`${path}?${next}`, { scroll: false });
      }}>{name}</button>)}
  </div>;
}