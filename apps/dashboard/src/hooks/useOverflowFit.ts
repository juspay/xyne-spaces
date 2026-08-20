import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import useMeasure from './useMeasure';

interface UseOverflowFitOptions {
  itemCount: number;
  containerWidth: number;
  gap: number;
  minVisible?: number;
}

interface UseOverflowFitResult<T extends HTMLElement> {
  /** Attach to an invisible twin: every item at natural width, plus a "+N" sample last. */
  measureRef: RefObject<T | null>;
  visibleCount: number;
}

export function useOverflowFit<T extends HTMLElement = HTMLElement>({
  itemCount,
  containerWidth,
  gap,
  minVisible = 0,
}: UseOverflowFitOptions): UseOverflowFitResult<T> {
  const measureRef = useRef<T>(null);
  const { width: measuredWidth } = useMeasure({ ref: measureRef, observeResize: true });
  const [visibleCount, setVisibleCount] = useState(itemCount);

  useLayoutEffect(() => {
    const twin = measureRef.current;
    if (!twin || containerWidth <= 0) return;

    // Last child is the "+N" sample.
    const children = Array.from(twin.children) as HTMLElement[];
    const overflowWidth = children[children.length - 1]?.getBoundingClientRect().width ?? 0;
    const widths = children.slice(0, -1).map(child => child.getBoundingClientRect().width);

    let used = 0;
    let count = 0;
    for (const width of widths) {
      const next = used + width + (count > 0 ? gap : 0);
      if (next > containerWidth) break;
      used = next;
      count += 1;
    }

    // Reserve room for the "+N" chip too.
    if (count < widths.length) {
      while (count > minVisible && used + gap + overflowWidth > containerWidth) {
        count -= 1;
        used -= (widths[count] ?? 0) + (count > 0 ? gap : 0);
      }
    }

    setVisibleCount(Math.max(minVisible, count));
  }, [containerWidth, measuredWidth, itemCount, gap, minVisible]);

  return { measureRef, visibleCount };
}

export default useOverflowFit;
