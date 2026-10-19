import { memo, type ReactElement } from 'react';
import { Text } from 'react-native';

import { buildSearchHighlightSegments, type HighlightSegment } from '@/src/utils/searchHighlight';

/** Gmail-style match highlight — yellow wash + dark text. */
const SEARCH_HIGHLIGHT_CLASS = 'bg-yellow-300 text-yellow-950';

type TicketsSearchHighlightedTextProps = {
  value?: string | null;
  query: string;
  className: string;
  numberOfLines?: number;
};

function Segments({
  segments,
  className,
  numberOfLines,
}: {
  segments: HighlightSegment[];
  className: string;
  numberOfLines?: number;
}): ReactElement {
  return (
    <Text className={className} numberOfLines={numberOfLines}>
      {segments.map((segment, index) => (
        <Text
          key={`${index}-${segment.text.slice(0, 12)}`}
          {...(segment.highlighted ? { className: SEARCH_HIGHLIGHT_CLASS } : {})}
        >
          {segment.text}
        </Text>
      ))}
    </Text>
  );
}

/**
 * Renders Vespa `<hi>` / query-match spans with Gmail yellow highlights.
 */
export const TicketsSearchHighlightedText = memo(function TicketsSearchHighlightedText({
  value,
  query,
  className,
  numberOfLines,
}: TicketsSearchHighlightedTextProps) {
  const segments = buildSearchHighlightSegments(value, query);

  if (segments.length === 0) {
    return (
      <Text className={className} numberOfLines={numberOfLines}>
        {value ?? ''}
      </Text>
    );
  }

  return (
    <Segments
      segments={segments}
      className={className}
      {...(numberOfLines !== undefined ? { numberOfLines } : {})}
    />
  );
});
