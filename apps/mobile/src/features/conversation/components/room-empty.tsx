import { memo, type ReactElement } from 'react';

import type { ChatListEmptyProps } from '@/src/features/chat/v2/components/chat/chat-renderers';

import { RoomNotice } from './room-notice';

/**
 * A room or thread with no messages yet, as a room notice. The channel adds
 * the nudge the newer chat list uses; a thread's typing bar already says "Reply".
 */
export const RoomEmpty = memo(function RoomEmpty({ surface }: ChatListEmptyProps): ReactElement {
  return (
    <RoomNotice
      title='No messages yet'
      detail={surface === 'channel' ? 'Send the first one to start the conversation.' : undefined}
    />
  );
});
