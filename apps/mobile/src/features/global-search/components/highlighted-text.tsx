import { memo, useMemo, type ReactElement } from 'react';
import { Text } from 'react-native';

import { buildSearchHighlightSegments, type HighlightSegment } from '@/src/utils/searchHighlight';

const HIGHLIGHT_CLASS = 'bg-yellow-300 text-yellow-950';

type HighlightedSegmentsProps = {
  segments: readonly HighlightSegment[];
  className: string;
  numberOfLines?: number;
};

/** For callers that already hold the segments, e.g. to check they are not empty. */
export const HighlightedSegments = memo(function HighlightedSegments({
  segments,
  className,
  numberOfLines = 1,
}: HighlightedSegmentsProps): ReactElement {
  return (
    <Text className={className} numberOfLines={numberOfLines}>
      {segments.map((segment, index) => (
        <Text
          key={`${segment.text}-${index}`}
          {...(segment.highlighted ? { className: HIGHLIGHT_CLASS } : {})}
        >
          {segment.text}
        </Text>
      ))}
    </Text>
  );
});

type HighlightedTextProps = {
  value: string;
  query: string;
  className: string;
  numberOfLines?: number;
};

export const HighlightedText = memo(function HighlightedText({
  value,
  query,
  ...text
}: HighlightedTextProps): ReactElement {
  const segments = useMemo(() => buildSearchHighlightSegments(value, query), [value, query]);
  return <HighlightedSegments segments={segments} {...text} />;
});
