import { memo, useCallback, useMemo, type ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';

import { haptics } from '@/src/utils/haptics';
import { FileText, Hash, MessageCircle, Mic, Paperclip, Ticket, User } from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';
import type { DisplaySearchResult } from '@/src/types/search';
import {
  buildSearchHighlightSegments,
  collapseSegmentsToPlainText,
} from '@/src/utils/searchHighlight';
import { formatSearchResultTimestamp } from '../../utils/format-search-timestamp';
import { HighlightedSegments } from '../highlighted-text';

interface SearchResultRowProps {
  result: DisplaySearchResult;
  query: string;
  onPress: (result: DisplaySearchResult) => void;
}

const ResultIcon = ({
  result,
  color,
}: {
  result: DisplaySearchResult;
  color: string;
}): ReactElement => {
  if (result.type === 'user') {
    return <User size={16} color={color} />;
  }
  if (result.type === 'channel') {
    return <Hash size={16} color={color} />;
  }
  if (result.type === 'conversation') {
    return <MessageCircle size={16} color={color} />;
  }
  if (result.type === 'ticket') {
    return <Ticket size={16} color={color} />;
  }
  if (result.searchContext?.subApp === 'transcript') {
    return <Mic size={16} color={color} />;
  }
  if (result.searchContext?.subApp === 'canvas') {
    return <FileText size={16} color={color} />;
  }
  return <Paperclip size={16} color={color} />;
};

/** The row every remote hit renders as — messages, tickets and files. */
export const SearchResultRow = memo(function SearchResultRow({
  result,
  query,
  onPress,
}: SearchResultRowProps): ReactElement {
  const muted = useCSSVariable('--color-secondary-foreground') as string;

  const titleSegments = useMemo(
    () => buildSearchHighlightSegments(result.title, query),
    [query, result.title],
  );
  const subtitleSegments = useMemo(
    () => buildSearchHighlightSegments(result.subtitle, query),
    [query, result.subtitle],
  );
  const contextSegments = useMemo(
    () => buildSearchHighlightSegments(result.context, query),
    [query, result.context],
  );

  const hasSubtitle = useMemo(
    () => collapseSegmentsToPlainText(subtitleSegments).length > 0,
    [subtitleSegments],
  );
  const hasContext = useMemo(
    () => collapseSegmentsToPlainText(contextSegments).length > 0,
    [contextSegments],
  );

  const timestamp = useMemo(
    () =>
      formatSearchResultTimestamp({
        createdAtTimestamp: result.searchContext?.createdAtTimestamp,
        metadataTimestamp: result.metadata.timestamp,
      }),
    [result.metadata.timestamp, result.searchContext?.createdAtTimestamp],
  );

  const showTimestamp =
    timestamp.length > 0 &&
    (result.type === 'conversation' || result.type === 'ticket' || result.type === 'attachment');

  const handlePress = useCallback(() => onPress(result), [onPress, result]);

  return (
    <Pressable
      onPress={handlePress}
      onPressIn={(): void => {
        void haptics.buttonTap();
      }}
      className='mx-2 mt-1 px-2 py-2.5 rounded-lg active:bg-foreground/5'
    >
      <View className='flex-row items-start gap-2.5'>
        <View className='w-6 pt-0.5 items-center'>
          <ResultIcon result={result} color={muted} />
        </View>

        <View className='flex-1 min-w-0'>
          <View className='flex-row items-start gap-2'>
            <View className='flex-1 min-w-0'>
              <HighlightedSegments
                segments={titleSegments}
                className='text-[16px] font-semibold text-foreground'
              />
            </View>
            {showTimestamp ? (
              <Text className='shrink-0 pt-0.5 text-[12px] text-secondary-foreground'>
                {timestamp}
              </Text>
            ) : null}
          </View>
          {hasSubtitle && (
            <HighlightedSegments
              segments={subtitleSegments}
              className='mt-0.5 text-[14px] text-secondary-foreground'
            />
          )}
          {hasContext && (
            <HighlightedSegments
              segments={contextSegments}
              className='mt-1 text-[13px] text-secondary-foreground'
              numberOfLines={2}
            />
          )}
        </View>
      </View>
    </Pressable>
  );
});
