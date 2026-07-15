import type { ReactElement } from 'react';
import type { TextSearchMatch } from '../../../hooks/useTextSearch';

export interface HighlightedTextProps {
  text: string;
  matches: TextSearchMatch[];
  /** Current item index */
  itemIndex: number;
  /** Global index of the currently focused match */
  currentMatchIndex: number;
  /** Ref map to store match element references for scroll-to-match */
  matchRefs: React.MutableRefObject<Map<number, HTMLElement>>;
  /** CSS class for the current/focused match highlight */
  currentMatchClassName?: string;
  /** CSS class for other match highlights */
  otherMatchClassName?: string;
}

/**
 * Renders text with highlighted search matches.
 */
export function HighlightedText({
  text,
  matches,
  itemIndex,
  currentMatchIndex,
  matchRefs,
  currentMatchClassName = 'bg-destructive/20 text-destructive',
  otherMatchClassName = 'bg-yellow-200',
}: HighlightedTextProps): ReactElement {
  // Filter and enrich matches for this item with their global indices
  const itemMatches = matches
    .map((match, globalIndex) => ({ ...match, globalIndex }))
    .filter(match => match.itemIndex === itemIndex)
    .sort((a, b) => a.start - b.start);

  if (itemMatches.length === 0) {
    return <>{text}</>;
  }

  const parts: ReactElement[] = [];
  let lastEnd = 0;

  itemMatches.forEach((match, i) => {
    // Text before this match
    if (match.start > lastEnd) {
      parts.push(<span key={`text-${i}`}>{text.slice(lastEnd, match.start)}</span>);
    }

    // Highlighted match
    const isCurrent = match.globalIndex === currentMatchIndex;
    const globalIdx = match.globalIndex;
    parts.push(
      <mark
        key={`match-${i}`}
        ref={el => {
          if (el) {
            matchRefs.current.set(globalIdx, el);
          } else {
            // Cleanup when element unmounts
            matchRefs.current.delete(globalIdx);
          }
        }}
        className={`rounded-sm px-0.5 -mx-0.5 ${isCurrent ? currentMatchClassName : otherMatchClassName}`}
      >
        {text.slice(match.start, match.end)}
      </mark>,
    );

    lastEnd = match.end;
  });

  // Remaining text after last match
  if (lastEnd < text.length) {
    parts.push(<span key='text-end'>{text.slice(lastEnd)}</span>);
  }

  return <>{parts}</>;
}
