import { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ListRenderItem,
} from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedProps,
  useAnimatedStyle,
  type SharedValue,
} from 'react-native-reanimated';
import { X } from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';

import { ChevronLeftIcon } from '@/src/components/icons';
import { useHeaderHeight } from '@/src/hooks/useHeaderHeight';
import type { DisplaySearchResult } from '@/src/types/search';

import { useDeskTicketSearch } from '../hooks/use-desk-ticket-search';
import {
  TicketsSearchEmptyState,
  TicketsSearchResultItem,
  TicketsSearchSkeleton,
} from './tickets-search';
import { HeaderIconButton } from '@/src/components/ui/header-icon-button';

const AnimatedTextInput = Animated.createAnimatedComponent(TextInput);

type TicketsSearchOverlayProps = {
  progress: SharedValue<number>;
  isOpen: boolean;
  channelId: string;
  channelName: string;
  onClose: () => void;
};

/**
 * Full-screen overlay morph — NOT an Expo Router screen.
 * All geometry/opacity runs on the UI thread via `progress`.
 */
export const TicketsSearchOverlay = memo(function TicketsSearchOverlay({
  progress,
  isOpen,
  channelId,
  channelName,
  onClose,
}: TicketsSearchOverlayProps) {
  const inputRef = useRef<TextInput>(null);
  const { topSafeHeight, headerHeight } = useHeaderHeight();
  const foreground = useCSSVariable('--color-foreground') as string;
  const muted = useCSSVariable('--color-muted') as string;

  const [query, setQuery] = useState('');
  const { results, isSearching, errorMessage, hasQuery } = useDeskTicketSearch(
    channelId,
    query,
    isOpen,
  );

  const placeholder = `Search in ${channelName.trim() || 'Desk'}`;
  const showClear = query.length > 0;
  /** First load: no rows yet → skeleton. Later loads keep stale rows + "Searching…". */
  const showInitialSkeleton = hasQuery && isSearching && results.length === 0;
  const showSubsequentSearching = hasQuery && isSearching && results.length > 0;

  useEffect(() => {
    if (!isOpen) {
      inputRef.current?.blur();
      setQuery('');
      return;
    }
    const t = setTimeout(() => inputRef.current?.focus(), 180);
    return () => clearTimeout(t);
  }, [isOpen]);

  const rootStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.2, 1], [0, 1, 1], Extrapolation.CLAMP),
    transform: [
      {
        scale: interpolate(progress.value, [0, 1], [0.98, 1], Extrapolation.CLAMP),
      },
    ],
  }));

  const headerBarStyle = useAnimatedStyle(() => ({
    marginHorizontal: interpolate(progress.value, [0, 1], [52, 0], Extrapolation.CLAMP),
    borderRadius: interpolate(progress.value, [0, 1], [22, 0], Extrapolation.CLAMP),
  }));

  const backStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0.35, 1], [0, 1], Extrapolation.CLAMP),
  }));

  const animatedInputProps = useAnimatedProps(() => ({
    editable: progress.value > 0.85,
  }));

  const handleClose = useCallback(() => {
    Keyboard.dismiss();
    onClose();
  }, [onClose]);

  const handleClear = useCallback(() => {
    setQuery('');
    inputRef.current?.focus();
  }, []);

  const renderItem = useCallback<ListRenderItem<DisplaySearchResult>>(
    ({ item }) => (
      <TicketsSearchResultItem
        result={item}
        query={query}
        channelId={channelId}
        onNavigate={handleClose}
      />
    ),
    [query, channelId, handleClose],
  );

  const keyExtractor = useCallback((item: DisplaySearchResult) => item.id, []);

  const listHeader = (() => {
    if (!hasQuery || results.length === 0) return null;
    return (
      <View className='px-4 pb-2 pt-3'>
        <Text className='text-[12px] font-semibold uppercase tracking-wide text-muted'>
          {showSubsequentSearching
            ? 'Searching…'
            : `Results${results.length > 0 ? ` (${results.length})` : ''}`}
        </Text>
      </View>
    );
  })();

  const listEmpty = (() => {
    if (!hasQuery) {
      return (
        <TicketsSearchEmptyState
          title='Search emails in this desk'
          subtitle='Find tickets by subject, sender, or body text'
        />
      );
    }
    if (showInitialSkeleton) {
      return <TicketsSearchSkeleton />;
    }
    if (errorMessage) {
      return <TicketsSearchEmptyState title='Search failed' subtitle={errorMessage} />;
    }
    return (
      <TicketsSearchEmptyState
        title='No matching emails'
        subtitle={`Nothing found for “${query.trim()}”`}
      />
    );
  })();

  return (
    <Animated.View
      pointerEvents={isOpen ? 'auto' : 'none'}
      style={[StyleSheet.absoluteFill, { zIndex: 60 }, rootStyle]}
      className='bg-neutral-100 dark:bg-tabs-screen'
    >
      <View style={{ paddingTop: topSafeHeight }} className='bg-card'>
        <Animated.View
          style={[{ height: headerHeight }, headerBarStyle]}
          className='flex-row items-center bg-card px-2'
        >
          <Animated.View style={backStyle}>
            <HeaderIconButton liquidGlass accessibilityLabel='Close search' onPress={handleClose}>
              <ChevronLeftIcon stroke={foreground} />
            </HeaderIconButton>
          </Animated.View>

          <AnimatedTextInput
            ref={inputRef}
            animatedProps={animatedInputProps}
            value={query}
            onChangeText={setQuery}
            placeholder={placeholder}
            placeholderTextColor={muted}
            className='min-w-0 flex-1 px-2 text-[16px] text-foreground'
            returnKeyType='search'
            autoCorrect={false}
            autoCapitalize='none'
          />

          {showClear ? (
            <Pressable
              accessibilityRole='button'
              accessibilityLabel='Clear search'
              hitSlop={8}
              onPress={handleClear}
              className='mr-1 size-8 items-center justify-center rounded-full bg-foreground/10'
            >
              <X size={16} color={foreground} strokeWidth={2.25} />
            </Pressable>
          ) : null}
        </Animated.View>
      </View>

      <View className='flex-1 bg-neutral-100 dark:bg-tabs-screen'>
        <FlatList
          data={results}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          ListHeaderComponent={listHeader}
          ListEmptyComponent={listEmpty}
          keyboardShouldPersistTaps='handled'
          keyboardDismissMode='on-drag'
          contentContainerStyle={results.length === 0 ? styles.emptyContent : styles.listContent}
        />
      </View>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  listContent: {
    paddingBottom: 32,
  },
  emptyContent: {
    flexGrow: 1,
  },
});
