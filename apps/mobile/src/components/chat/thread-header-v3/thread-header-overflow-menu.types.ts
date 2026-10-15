import type { ReactElement } from 'react';

export type {
  ThreadHeaderOverflowAction,
  ThreadHeaderOverflowActionId,
} from '@/src/features/chat/thread-header/thread-header-overflow';

export type ThreadHeaderOverflowMenuProps = {
  channelId: string;
  threadId: string;
  canUseMemberActions: boolean;
};

export type ThreadHeaderOverflowMenuComponent = (
  props: ThreadHeaderOverflowMenuProps,
) => ReactElement;
