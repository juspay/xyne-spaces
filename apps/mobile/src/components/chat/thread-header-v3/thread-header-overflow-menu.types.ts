import type { ThreadHeaderOverflow } from '@/src/features/chat/thread-header/thread-header-overflow';
import type { ReactElement } from 'react';

export type {
  ThreadHeaderOverflowAction,
  ThreadHeaderOverflowActionId,
} from '@/src/features/chat/thread-header/thread-header-overflow';

export type ThreadHeaderOverflowMenuProps = {
  overflow: ThreadHeaderOverflow;
};

export type ThreadHeaderOverflowMenuComponent = (
  props: ThreadHeaderOverflowMenuProps,
) => ReactElement;
