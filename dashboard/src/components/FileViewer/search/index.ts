export { FileSearchProvider, useFileSearchContext } from './FileSearchContext';
export { FileSearchControls } from './FileSearchControls';
export { FindBar } from './FindBar';
export { HighlightedText } from './HighlightedText';
export { useLineSearch, useMatchScroll } from './useLineSearch';
export { useGridSearch, useSheetsSearch, useGridMatchScroll, cellKey } from './useGridSearch';
export { useDomSearch } from './useDomSearch';
export { injectMarks, splitTextByRanges, MATCH_CLASS, ACTIVE_MATCH_CLASS } from './htmlHighlight';
export type { TextSegment } from './htmlHighlight';
export {
  buildMatcher,
  findMatchesInLines,
  findMatchesInGrid,
  findMatchesInText,
  groupMatchesByRow,
  groupMatchesByCell,
} from './searchEngine';
export { DEFAULT_SEARCH_OPTIONS, MAX_MATCHES, MIN_QUERY_LENGTH } from './types';
export type { HighlightRange, SearchMatch, SearchOptions } from './types';
