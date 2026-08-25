import { useCallback, useMemo, useRef, type RefObject } from 'react';
import useMeasure from '../../hooks/useMeasure';
import useOverflowFit from '../../hooks/useOverflowFit';
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
  filterTwinRef: (el: HTMLDivElement | null) => void;
  staticLeftRef: RefObject<HTMLDivElement | null>;
  actionsRestRef: RefObject<HTMLDivElement | null>;
  columnsWideTwinRef: RefObject<HTMLDivElement | null>;
  columnsNarrowTwinRef: RefObject<HTMLDivElement | null>;

  isColumnsLabelled: boolean;
  collapsedFilterIds: readonly CollapsibleFilterId[];
  hasCollapsedFilters: boolean;
  isFilterVisibleOnBar: (id: CollapsibleFilterId) => boolean;
}
export function useDeskToolbarOverflow({
  showColumnsPicker,
}: UseDeskToolbarOverflowOptions): UseDeskToolbarOverflowResult {
  const rowRef = useRef<HTMLDivElement>(null);
  const staticLeftRef = useRef<HTMLDivElement>(null);
  const twinRef = useRef<HTMLDivElement>(null);
  const actionsRestRef = useRef<HTMLDivElement>(null);
  const columnsWideTwinRef = useRef<HTMLDivElement>(null);
  const columnsNarrowTwinRef = useRef<HTMLDivElement>(null);

  const { width: rowWidth } = useMeasure({ ref: rowRef, observeResize: true });
  const { width: staticLeftWidth } = useMeasure({ ref: staticLeftRef, observeResize: true });
  const { width: actionsRestWidth } = useMeasure({ ref: actionsRestRef, observeResize: true });
  const { width: columnsWideWidth } = useMeasure({ ref: columnsWideTwinRef, observeResize: true });
  const { width: columnsNarrowWidth } = useMeasure({
    ref: columnsNarrowTwinRef,
    observeResize: true,
  });
  const { width: twinWidth } = useMeasure({ ref: twinRef, observeResize: true });
  const filtersNaturalWidth = Math.max(0, twinWidth - TOOLBAR_GAP);

  const columnsLabelWidth = showColumnsPicker
    ? Math.max(0, columnsWideWidth - columnsNarrowWidth)
    : 0;
  const actionsWidth =
    actionsRestWidth + (showColumnsPicker ? columnsNarrowWidth + TOOLBAR_GAP : 0);

  const filterBudget = Math.max(0, rowWidth - TOOLBAR_ROW_INSET - staticLeftWidth - actionsWidth);

  const isColumnsLabelled =
    showColumnsPicker && filterBudget - columnsLabelWidth >= filtersNaturalWidth;

  const filterFitWidth = Math.max(0, filterBudget - (isColumnsLabelled ? columnsLabelWidth : 0));

  const { measureRef, visibleCount } = useOverflowFit<HTMLDivElement>({
    itemCount: COLLAPSIBLE_FILTER_IDS.length,
    containerWidth: filterFitWidth,
    gap: TOOLBAR_GAP,
    minVisible: 0,
  });

  // The twin is measured by both useOverflowFit (per-child widths) and useMeasure (total).
  const filterTwinRef = useCallback(
    (el: HTMLDivElement | null): void => {
      measureRef.current = el;
      twinRef.current = el;
    },
    [measureRef],
  );

  const collapsedFilterIds = useMemo(
    () => COLLAPSIBLE_FILTER_IDS.slice(visibleCount),
    [visibleCount],
  );

  const isFilterVisibleOnBar = useCallback(
    (id: CollapsibleFilterId): boolean => COLLAPSIBLE_FILTER_IDS.indexOf(id) < visibleCount,
    [visibleCount],
  );

  return {
    rowRef,
    filterTwinRef,
    staticLeftRef,
    actionsRestRef,
    columnsWideTwinRef,
    columnsNarrowTwinRef,
    isColumnsLabelled,
    collapsedFilterIds,
    hasCollapsedFilters: collapsedFilterIds.length > 0,
    isFilterVisibleOnBar,
  };
}

export default useDeskToolbarOverflow;
