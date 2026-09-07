import { useCallback, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import useMeasure from '../../hooks/useMeasure';
import {
  COLLAPSIBLE_FILTER_IDS,
  TOOLBAR_GAP,
  TOOLBAR_ROW_INSET,
  type CollapsibleFilterId,
} from './DeskFilterTrigger';

interface UseDeskToolbarOverflowOptions {
  showColumnsPicker: boolean;
}

interface UseDeskToolbarOverflowResult {
  rowRef: RefObject<HTMLDivElement | null>;
  filterTwinRef: RefObject<HTMLDivElement | null>;
  staticLeftRef: RefObject<HTMLDivElement | null>;
  actionsRestRef: RefObject<HTMLDivElement | null>;
  columnsWideTwinRef: RefObject<HTMLDivElement | null>;
  columnsNarrowTwinRef: RefObject<HTMLDivElement | null>;

  isColumnsLabelled: boolean;
  collapsedFilterIds: readonly CollapsibleFilterId[];
  hasCollapsedFilters: boolean;
  isFilterVisibleOnBar: (id: CollapsibleFilterId) => boolean;
}

interface ToolbarFit {
  visibleCount: number;
  isColumnsLabelled: boolean;
}

const widthOf = (el: Element | null | undefined): number => el?.getBoundingClientRect().width ?? 0;

export function useDeskToolbarOverflow({
  showColumnsPicker,
}: UseDeskToolbarOverflowOptions): UseDeskToolbarOverflowResult {
  const rowRef = useRef<HTMLDivElement>(null);
  const filterTwinRef = useRef<HTMLDivElement>(null);
  const staticLeftRef = useRef<HTMLDivElement>(null);
  const actionsRestRef = useRef<HTMLDivElement>(null);
  const columnsWideTwinRef = useRef<HTMLDivElement>(null);
  const columnsNarrowTwinRef = useRef<HTMLDivElement>(null);

  // The row is the only element whose width changes on its own (Ask AI, sidebar, window), so
  // it is the only one worth observing. Its updates also re-render us, which re-runs the pass.
  const { width: rowWidth } = useMeasure({ ref: rowRef, observeResize: true });

  const [fit, setFit] = useState<ToolbarFit>({
    visibleCount: COLLAPSIBLE_FILTER_IDS.length,
    isColumnsLabelled: true,
  });

  useLayoutEffect(() => {
    const triggers = Array.from(filterTwinRef.current?.children ?? []).map(widthOf);
    if (rowWidth <= 0 || triggers.length === 0) return;

    const filtersNaturalWidth =
      triggers.reduce((sum, w) => sum + w, 0) + TOOLBAR_GAP * (triggers.length - 1);

    const columnsNarrowWidth = showColumnsPicker ? widthOf(columnsNarrowTwinRef.current) : 0;
    const columnsLabelWidth = showColumnsPicker
      ? Math.max(0, widthOf(columnsWideTwinRef.current) - columnsNarrowWidth)
      : 0;

    const actionsWidth =
      widthOf(actionsRestRef.current) + (showColumnsPicker ? columnsNarrowWidth + TOOLBAR_GAP : 0);

    const budget = Math.max(
      0,
      rowWidth - TOOLBAR_ROW_INSET - widthOf(staticLeftRef.current) - actionsWidth,
    );

    const isColumnsLabelled =
      showColumnsPicker && budget - columnsLabelWidth >= filtersNaturalWidth;
    const available = Math.max(0, budget - (isColumnsLabelled ? columnsLabelWidth : 0));

    let used = 0;
    let visibleCount = 0;
    for (const width of triggers) {
      const next = used + width + (visibleCount > 0 ? TOOLBAR_GAP : 0);
      if (next > available) break;
      used = next;
      visibleCount += 1;
    }

    setFit(prev =>
      prev.visibleCount === visibleCount && prev.isColumnsLabelled === isColumnsLabelled
        ? prev
        : { visibleCount, isColumnsLabelled },
    );
  });

  const collapsedFilterIds = useMemo(
    () => COLLAPSIBLE_FILTER_IDS.slice(fit.visibleCount),
    [fit.visibleCount],
  );

  const isFilterVisibleOnBar = useCallback(
    (id: CollapsibleFilterId): boolean => COLLAPSIBLE_FILTER_IDS.indexOf(id) < fit.visibleCount,
    [fit.visibleCount],
  );

  return {
    rowRef,
    filterTwinRef,
    staticLeftRef,
    actionsRestRef,
    columnsWideTwinRef,
    columnsNarrowTwinRef,
    isColumnsLabelled: fit.isColumnsLabelled,
    collapsedFilterIds,
    hasCollapsedFilters: collapsedFilterIds.length > 0,
    isFilterVisibleOnBar,
  };
}

export default useDeskToolbarOverflow;
