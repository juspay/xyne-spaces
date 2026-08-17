import type { MarkedMoment } from '../../../stores/recordingStore';
import type { LiveTranscriptVariant, MarkedMomentAnchors } from './LiveTranscriptList.types';

/**
 * Where the marked-moment dividers land. Kept here so every surface rendering the live
 * transcript places them by the same rule — a divider drawn above a different line in
 * the overlay than on the detail screen would be describing the same recording two
 * different ways.
 */
export function markedMomentAnchors(markedMoments: MarkedMoment[]): MarkedMomentAnchors {
  return {
    // Several moments can land on the same line; one divider is enough.
    markedTranscriptIds: new Set(
      markedMoments.map(moment => moment.transcriptId).filter(id => id !== null),
    ),
    hasLeadingMoment: markedMoments.some(moment => moment.transcriptId === null),
  };
}

/**
 * Nearest ancestor that actually scrolls, or null if nothing up the tree does.
 *
 * The panel variant renders its own viewport and can scroll it directly. The page
 * variant is dropped into whatever scroller its host provides, so following the
 * latest line means locating that ancestor at runtime.
 */
export function findScrollParent(node: HTMLElement | null): HTMLElement | null {
  let current = node?.parentElement ?? null;
  while (current) {
    const { overflowY } = window.getComputedStyle(current);
    if (overflowY === 'auto' || overflowY === 'scroll') return current;
    current = current.parentElement;
  }
  return null;
}

interface VariantStyles {
  root: string;
  searchWrapper: string;
  searchField: string;
  searchIconSize: number;
  searchInput: string;
  searchCounter: string;
  searchButton: string;
  list: string;
  /** Panel only — the page surface has no transcribing ticker. */
  ticker?: string;
}

/**
 * The two surfaces differ only in density and in who owns the scrolling, so the
 * layout decisions live in one table rather than as ternaries through the JSX.
 */
export const VARIANT_STYLES: Record<LiveTranscriptVariant, VariantStyles> = {
  panel: {
    root: 'flex min-h-0 flex-1 flex-col',
    searchWrapper: 'shrink-0 p-2.5',
    searchField:
      'flex h-8 items-center gap-1 rounded-lg border border-border bg-muted/30 px-2.5 text-muted-foreground shadow-xs',
    searchIconSize: 12,
    searchInput:
      'h-auto min-w-0 flex-1 rounded-none border-0 p-0 text-xs md:text-xs shadow-none placeholder:text-muted-foreground/75 focus-visible:border-transparent focus-visible:ring-0',
    searchCounter: 'shrink-0 text-[10px] tabular-nums text-muted-foreground',
    searchButton: 'size-5 rounded-full hover:bg-muted disabled:opacity-35',
    list: 'mt-auto space-y-2.5 text-sm leading-[21px] text-foreground/85',
    ticker: 'flex items-center gap-1 pt-3 text-xs italic text-muted-foreground/65',
  },
  page: {
    root: 'flex flex-col',
    searchWrapper: 'mb-4',
    searchField:
      'flex h-10 items-center gap-2 rounded-xl border border-border bg-muted/30 px-3.5 text-muted-foreground',
    searchIconSize: 14,
    searchInput:
      'h-auto min-w-0 flex-1 rounded-none border-0 p-0 text-sm shadow-none placeholder:text-muted-foreground/75 focus-visible:border-transparent focus-visible:ring-0',
    searchCounter: 'shrink-0 text-xs tabular-nums text-muted-foreground',
    searchButton: 'size-6 rounded-full hover:bg-muted disabled:opacity-35',
    list: 'space-y-5 text-base leading-7 text-foreground/90',
  },
};
