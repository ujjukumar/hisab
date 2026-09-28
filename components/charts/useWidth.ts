'use client';

import { useEffect, useState, type RefObject } from 'react';

/** The element's current width, so the charts can lay themselves out like the mockup. */
export function useWidth(ref: RefObject<HTMLElement | null>, fallback = 640): number {
  const [width, setWidth] = useState(fallback);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(el);
    setWidth(el.clientWidth);
    return () => observer.disconnect();
  }, [ref]);

  return Math.max(280, width);
}
