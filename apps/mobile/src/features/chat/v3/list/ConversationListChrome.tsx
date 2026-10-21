import { type ReactElement, type RefObject } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';

import { ChatComposerDock } from '../composer/ChatComposerDock';
import { ScrollToBottomButton } from '../composer/ScrollToBottomButton';
import type { ConversationComposer } from './conversationList.types';
import { ListEmpty } from './ListEmpty';
import { ListSkeleton } from './ListSkeleton';

const composerInsetPx = (reserve: number | { value: number }): number =>
  typeof reserve === 'number' ? reserve : reserve.value;

export function ConversationListCover({
  showSkeleton,
  showEmpty,
  skeletonCount,
  composerReserve,
}: {
  showSkeleton: boolean;
  showEmpty: boolean;
  skeletonCount: number;
  composerReserve: number | { value: number };
}): ReactElement | null {
  if (!showSkeleton && !showEmpty) {
    return null;
  }
  const bottom = composerInsetPx(composerReserve);
  return (
    <>
      {showSkeleton ? (
        <View
          pointerEvents='none'
          className='absolute left-0 right-0 top-0 bg-chat-screen'
          style={{ bottom }}
        >
          <ListSkeleton count={skeletonCount} />
        </View>
      ) : null}
      {showEmpty ? (
        <View
          pointerEvents='none'
          className='absolute left-0 right-0 top-0 bg-chat-screen'
          style={{ bottom }}
        >
          <ListEmpty />
        </View>
      ) : null}
    </>
  );
}

export function ConversationListDock({
  showJumpToLatest,
  composerReserve,
  onJumpToLatest,
  composer,
  composerRef,
  onComposerLayout,
  onMeasuredSend,
}: {
  showJumpToLatest: boolean;
  composerReserve: number | { value: number };
  onJumpToLatest: () => void;
  composer: ConversationComposer;
  composerRef: RefObject<View | null>;
  onComposerLayout: (event: LayoutChangeEvent) => void;
  onMeasuredSend: ConversationComposer['onSend'];
}): ReactElement {
  return (
    <>
      <ScrollToBottomButton
        visible={showJumpToLatest}
        bottomOffset={composerInsetPx(composerReserve) + 12}
        onPress={onJumpToLatest}
      />
      <ChatComposerDock
        {...composer}
        composerRef={composerRef}
        onComposerLayout={onComposerLayout}
        onSend={onMeasuredSend}
      />
    </>
  );
}
