import { useState, useEffect, useRef } from 'react';
import { selectGridLayout, type GridLayout } from './gridLayouts';

export function useGridLayout(
  participantCount: number,
  maxTiles?: number,
): {
  containerRef: React.RefObject<HTMLDivElement | null>;
  layout: GridLayout;
} {
  const containerRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<GridLayout>({
    columns: 1,
    rows: 1,
    maxTiles: 1,
    minWidth: 0,
    minHeight: 0,
  });

  useEffect(() => {
    if (!containerRef.current) return;

    const updateLayout = (): void => {
      if (!containerRef.current) return;
      const { width, height } = containerRef.current.getBoundingClientRect();
      const newLayout = selectGridLayout(participantCount, width, height, maxTiles);
      setLayout(newLayout);
    };

    const resizeObserver = new ResizeObserver(updateLayout);
    resizeObserver.observe(containerRef.current);
    updateLayout();

    return (): void => resizeObserver.disconnect();
  }, [participantCount, maxTiles]);

  return { containerRef, layout };
}
