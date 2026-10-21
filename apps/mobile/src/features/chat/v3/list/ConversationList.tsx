import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactElement,
} from 'react';
import { useWindowDimensions, View } from 'react-native';
import type { LegendListRef } from '@legendapp/list/react-native';
import { KeyboardAwareLegendList, useKeyboardScrollToEnd } from '@legendapp/list/keyboard';
import { KeyboardGestureArea } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useChatRenderTokens as useResolvedChatRenderTokens } from '@/src/theme/useChatRenderTokens';
import { ConversationSkeleton } from '@/src/components/conversation-composer';

import {
  CHAT_KEYBOARD_GESTURE_INTERPOLATOR,
  CHAT_KEYBOARD_GESTURE_OFFSET,
  CHAT_KEYBOARD_SHOULD_PERSIST_TAPS,
  getChatKeyboardGeometry,
} from '../composer/chatKeyboardConfig';
import { useComposerReserve } from '../composer/useComposerReserve';
import { useSendAndFollowTail } from '../composer/useSendAndFollowTail';
import { isErrorVisible } from '../machine/selectors';
import type { ListMetrics } from '../machine/openState';
import type { ChatRow } from '../model/chatRow.types';
import { keyExtractor } from '../model/rowType';
import { ChatRenderProvider } from '../theme/ChatRenderProvider';
import { initialScrollMode, reduceScrollMode, shouldRestorePosition } from './anchoring';
import { FloatingDateHeader } from './FloatingDateHeader';
import { listChromeFor } from './listChrome';
import { useViewportTracking } from './useViewportTracking';
import { useFloatingDate } from './useFloatingDate';
import {
  canMountConversationList,
  jumpHighlightConversationId,
  lockedRowIdFor,
  targetFromState,
  visibleRowForReadCursor,
} from './landing';
import { intentKeyFrom, legendListProps } from './legendListProps';
import { useHeightViolation } from './useHeightViolation';
import { useLandingMetrics } from './useLandingMetrics';
import { useListLayoutReadiness } from './useListLayoutReadiness';
import { usePlacement } from './usePlacement';
import { useRowPresentation } from './useRowPresentation';
import { LIST_STYLE, dateFromVisibleRow, listShellClass } from './conversationListHelpers';
import { ConversationListError } from './ConversationListError';
import { ConversationListCover, ConversationListDock } from './ConversationListChrome';
import { useConversationListRenderItem } from './useConversationListRenderItem';
import { useOlderPageShimmer } from './useOlderPageShimmer';
import type { ConversationListProps } from './conversationList.types';

export type {
  ConversationComposer,
  ConversationListProps,
  ListEvent,
  RowEventKind,
} from './conversationList.types';

/** One list engine (design §6.1); channel and thread differ through data, not components. */
export function ConversationList({
  surface,
  state,
  rows,
  composer,
  hasReachedStart,
  onPaginate,
  onRowEvent,
  onListEvent,
}: ConversationListProps): ReactElement {
  const { width: windowWidth } = useWindowDimensions();
  const renderTokens = useResolvedChatRenderTokens(windowWidth);
  const target = targetFromState(state);
  const listRef = useRef<LegendListRef>(null);
  const composerRef = useRef<View>(null);
  const insets = useSafeAreaInsets();
  const keyboardGeometry = useMemo(() => getChatKeyboardGeometry(insets.bottom), [insets.bottom]);
  const { contentInsetEndAdjustment: composerReserve, onComposerLayout } = useComposerReserve(
    listRef,
    composerRef,
  );
  const { freeze, scrollMessageToEnd } = useKeyboardScrollToEnd({ listRef });
  const [mode, dispatchMode] = useReducer(
    reduceScrollMode,
    target ?? { kind: 'tail' as const },
    initialScrollMode,
  );
  const targetKind = target?.kind ?? 'tail';
  const lastKindRef = useRef(targetKind);
  useLayoutEffect(() => {
    if (lastKindRef.current === targetKind) {
      return;
    }
    lastKindRef.current = targetKind;
    dispatchMode({ type: 'retarget', targetKind });
  }, [targetKind]);

  const modeRef = useRef(mode);
  modeRef.current = mode;
  const statusRef = useRef(state.status);
  statusRef.current = state.status;
  const { floatingDate, rememberDate, onUserScroll, onViewportScroll } = useFloatingDate(
    surface,
    intentKeyFrom(state, surface),
  );
  const dataKey = intentKeyFrom(state, surface);
  const highlightedConversationId = jumpHighlightConversationId(rows, target);
  const { presentedRows, onToggleExpand } = useRowPresentation(
    rows,
    dataKey,
    highlightedConversationId,
  );
  const lockedRowId = target ? lockedRowIdFor(presentedRows, target) : null;
  const lockedRef = useRef(lockedRowId);
  lockedRef.current = lockedRowId;
  usePlacement({
    listRef,
    rows: presentedRows,
    target,
    dataKey,
    status: state.status,
    packAtEnd: target?.kind === 'tail' && surface.kind === 'channel',
  });

  const recordItemSizeChanged = useHeightViolation(listRef, dataKey);
  const isEditing = composer.editingMessage !== null && composer.editingMessage !== undefined;

  const onLandingMetrics = useCallback(
    (metrics: ListMetrics): void => {
      onListEvent({ type: 'landingConfirmed', metrics });
    },
    [onListEvent],
  );

  const reportLandingMetrics = useLandingMetrics({
    listRef,
    rows: presentedRows,
    target,
    status: state.status,
    dataKey,
    onMetrics: onLandingMetrics,
  });

  const { distanceRef, showJumpToLatest, syncViewport, onJumpToLatest } = useViewportTracking({
    listRef,
    modeRef,
    dispatchMode,
    onViewportScroll,
    reportLandingMetrics,
  });

  const onMeasuredSend = useSendAndFollowTail({
    onSend: composer.onSend,
    isEditing,
    isAtTail: !showJumpToLatest,
    scrollToEnd: scrollMessageToEnd,
  });

  const restore = useCallback(
    (item: ChatRow): boolean =>
      shouldRestorePosition({
        mode: modeRef.current,
        status: statusRef.current,
        rowId: keyExtractor(item),
        lockedRowId: lockedRef.current,
        distanceFromBottomPx: distanceRef.current,
      }),
    [distanceRef],
  );

  const presentedRowsRef = useRef(presentedRows);
  presentedRowsRef.current = presentedRows;
  const reportVisible = useCallback(
    (item: ChatRow | null = null): void => {
      const atEnd = listRef.current?.getState()?.isAtEnd === true;
      onListEvent({
        type: 'visible',
        row: visibleRowForReadCursor(item, presentedRowsRef.current, atEnd),
        atEnd,
      });
    },
    [onListEvent],
  );
  const syncViewportAndRead = useCallback((): boolean => {
    const ok = syncViewport();
    if (ok) {
      reportVisible();
    }
    return ok;
  }, [reportVisible, syncViewport]);

  const oldestRowId = presentedRows[0] ? keyExtractor(presentedRows[0]) : null;
  const { showShimmer: showOlderShimmer, noteOlderRequested } = useOlderPageShimmer(
    hasReachedStart,
    oldestRowId,
  );
  const onStartReached = useCallback((): void => {
    noteOlderRequested();
    onPaginate('older');
  }, [noteOlderRequested, onPaginate]);

  const { listLayoutReady, markListLayoutReady, onListLoad } = useListLayoutReadiness({
    listRef,
    dataKey,
    rowCount: presentedRows.length,
    syncViewport: syncViewportAndRead,
  });

  const onScrollBeginDrag = useCallback((): void => {
    dispatchMode({ type: 'userDrag' });
    onUserScroll();
    onListEvent({ type: 'userTookOwnership' });
  }, [onListEvent, onUserScroll]);

  const onFirstVisibleItemChanged = useCallback(
    ({ item }: { item: ChatRow }): void => {
      markListLayoutReady();
      rememberDate(dateFromVisibleRow(item));
      reportLandingMetrics();
      reportVisible(item);
    },
    [markListLayoutReady, rememberDate, reportLandingMetrics, reportVisible],
  );

  const onItemSizeChanged = useCallback(
    (info: { size: number; itemKey: string }): void => {
      recordItemSizeChanged(info);
      reportLandingMetrics();
    },
    [recordItemSizeChanged, reportLandingMetrics],
  );

  const renderItem = useConversationListRenderItem({
    surface,
    rows: presentedRows,
    onRowEvent,
    onToggleExpand,
  });

  const listProps = useMemo(
    () =>
      legendListProps({
        state,
        surface,
        target,
        rows: presentedRows,
        shouldRestorePosition: restore,
      }),
    [state, surface, target, presentedRows, restore],
  );
  const listReadyToMount = canMountConversationList(target, state.status, presentedRows);

  const { showSkeleton, showEmpty } = listChromeFor(
    state.status,
    presentedRows.length,
    listLayoutReady,
  );
  if (isErrorVisible(state)) {
    return (
      <ConversationListError
        failure={state.failure}
        onRetry={(): void => onListEvent({ type: 'retry' })}
        onOpenLatest={(): void => onListEvent({ type: 'openLatest' })}
      />
    );
  }

  return (
    <ChatRenderProvider value={renderTokens}>
      <View className='flex-1 bg-chat-screen'>
        <FloatingDateHeader date={floatingDate} />
        <View className={listShellClass(surface.kind)}>
          <KeyboardGestureArea
            interpolator={CHAT_KEYBOARD_GESTURE_INTERPOLATOR}
            offset={CHAT_KEYBOARD_GESTURE_OFFSET}
            style={LIST_STYLE}
          >
            {listReadyToMount ? (
              <KeyboardAwareLegendList
                ref={listRef}
                {...listProps}
                renderItem={renderItem}
                keyboardShouldPersistTaps={CHAT_KEYBOARD_SHOULD_PERSIST_TAPS}
                keyboardOffset={keyboardGeometry.listOffset}
                freeze={freeze}
                onStartReached={onStartReached}
                onEndReached={(): void => onPaginate('newer')}
                onScroll={syncViewportAndRead}
                onScrollBeginDrag={onScrollBeginDrag}
                onLoad={onListLoad}
                onFirstVisibleItemChanged={onFirstVisibleItemChanged}
                contentInsetEndAdjustment={composerReserve}
                onItemSizeChanged={onItemSizeChanged}
                {...(showOlderShimmer ? { ListHeaderComponent: ConversationSkeleton } : {})}
                style={LIST_STYLE}
              />
            ) : null}
          </KeyboardGestureArea>
          <ConversationListCover
            showSkeleton={showSkeleton}
            showEmpty={showEmpty}
            skeletonCount={surface.kind === 'channel' ? 4 : 5}
            composerReserve={composerReserve}
          />
        </View>
        <ConversationListDock
          showJumpToLatest={showJumpToLatest}
          composerReserve={composerReserve}
          onJumpToLatest={onJumpToLatest}
          composer={composer}
          composerRef={composerRef}
          onComposerLayout={onComposerLayout}
          onMeasuredSend={onMeasuredSend}
        />
      </View>
    </ChatRenderProvider>
  );
}
