import { memo, useCallback, useEffect, useRef, type ReactElement } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { Search, X } from 'lucide-react-native';

import { CHANNEL_TICKETS_SEARCH_BAR_HEIGHT, CHANNEL_TICKETS_TABLE_INSET } from '../constants';
import type { ChannelTicketsPalette } from '../types';

export type ChannelTicketsSearchBarProps = {
  query: string;
  placeholder: string;
  /** Server search / hydration in flight (local matches already show). */
  isSearching: boolean;
  errorMessage: string | null;
  palette: ChannelTicketsPalette;
  onChangeQuery: (query: string) => void;
  /** Leaves search mode entirely (clears the query and hides the bar). */
  onClose: () => void;
};

/**
 * Pure inline search bar shown under the header while search mode is on.
 * Mirrors the dashboard's table search box: type to filter the same table in
 * place; the status line reports the wider server search as it lands.
 */
export const ChannelTicketsSearchBar = memo(function ChannelTicketsSearchBar({
  query,
  placeholder,
  isSearching,
  errorMessage,
  palette,
  onChangeQuery,
  onClose,
}: ChannelTicketsSearchBarProps): ReactElement {
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    const timer = setTimeout(() => inputRef.current?.focus(), 120);
    return (): void => clearTimeout(timer);
  }, []);

  const handleClear = useCallback(() => {
    onChangeQuery('');
    inputRef.current?.focus();
  }, [onChangeQuery]);

  const statusLine = errorMessage ?? (isSearching ? 'Searching all tickets…' : null);

  return (
    <View
      style={{
        paddingHorizontal: CHANNEL_TICKETS_TABLE_INSET,
        paddingTop: CHANNEL_TICKETS_TABLE_INSET,
      }}
      testID='channel-tickets-search-bar'
    >
      <View
        className='flex-row items-center gap-2 rounded-xl bg-card px-3'
        style={{ height: CHANNEL_TICKETS_SEARCH_BAR_HEIGHT }}
      >
        <Search size={18} color={palette.secondary} strokeWidth={2} />
        <TextInput
          ref={inputRef}
          value={query}
          onChangeText={onChangeQuery}
          placeholder={placeholder}
          placeholderTextColor={palette.secondary}
          className='min-w-0 flex-1 text-[16px] text-foreground'
          style={{ color: palette.foreground }}
          accessibilityLabel='Search tickets'
          returnKeyType='search'
          autoCapitalize='none'
          autoCorrect={false}
        />
        {query.length > 0 ? (
          <Pressable
            accessibilityRole='button'
            accessibilityLabel='Clear search'
            hitSlop={8}
            onPress={handleClear}
            className='size-7 items-center justify-center rounded-full bg-foreground/10'
          >
            <X size={14} color={palette.foreground} strokeWidth={2.25} />
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole='button'
          accessibilityLabel='Close search'
          hitSlop={8}
          onPress={onClose}
          className='active:opacity-60'
        >
          <Text className='text-[14px] font-medium' style={{ color: palette.accent }}>
            Cancel
          </Text>
        </Pressable>
      </View>
      {statusLine ? (
        <Text
          className='mt-1.5 px-1 text-[12px]'
          style={{ color: errorMessage ? palette.urgent : palette.secondary }}
          numberOfLines={1}
        >
          {statusLine}
        </Text>
      ) : null}
    </View>
  );
});
