import { useMemo, type ReactElement } from 'react';
import { HighlightedText } from '@/components/FileViewer/search/HighlightedText';
import { buildMatcher, findMatchesInText } from '@/components/FileViewer/search/searchEngine';
import {
  DEFAULT_SEARCH_OPTIONS,
  MAX_MATCHES,
  type HighlightRange,
} from '@/components/FileViewer/search/types';

export function HighlightMatch({ text, query }: { text: string; query: string }): ReactElement {
  const ranges = useMemo<HighlightRange[]>(() => {
    const matcher = buildMatcher(query.trim(), DEFAULT_SEARCH_OPTIONS);
    if (!matcher) return [];

    const found: HighlightRange[] = [];
    findMatchesInText(text, matcher, (start, end) => {
      found.push({ start, end, isActive: false });
      return found.length < MAX_MATCHES;
    });
    return found;
  }, [text, query]);

  return <HighlightedText text={text} ranges={ranges} />;
}
