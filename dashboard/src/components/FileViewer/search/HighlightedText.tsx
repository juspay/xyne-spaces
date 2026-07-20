import React, { memo } from 'react';
import {
  ACTIVE_MATCH_ATTR,
  ACTIVE_MATCH_CLASS,
  MATCH_CLASS,
  splitTextByRanges,
} from './htmlHighlight';
import type { HighlightRange } from './types';

interface HighlightedTextProps {
  text: string;
  ranges: HighlightRange[] | undefined;
  /** Rendered when `text` is empty, to keep empty lines from collapsing. */
  fallback?: string;
}

/**
 * Renders plain text with search matches wrapped in <mark>. For viewers that
 * render text directly; CodeViewer instead injects marks into its highlight.js
 * HTML (see htmlHighlight.injectMarks).
 */
export const HighlightedText: React.FC<HighlightedTextProps> = memo(
  ({ text, ranges, fallback = '' }) => {
    if (!ranges?.length) return <>{text || fallback}</>;

    return (
      <>
        {splitTextByRanges(text, ranges).map((segment, index) =>
          segment.isMatch ? (
            <mark
              key={index}
              className={segment.isActive ? ACTIVE_MATCH_CLASS : MATCH_CLASS}
              // The scroll logic finds the active match by this attribute.
              {...(segment.isActive && { [ACTIVE_MATCH_ATTR]: 'true' })}
            >
              {segment.text}
            </mark>
          ) : (
            <React.Fragment key={index}>{segment.text}</React.Fragment>
          ),
        )}
      </>
    );
  },
);

HighlightedText.displayName = 'HighlightedText';
