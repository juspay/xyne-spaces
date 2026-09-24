import { logger, Event as LogEvent } from '../../utils/logger';
import { createContext } from 'react';

export const ConversationTabContext = createContext<{
  setActiveTab: (tab: string, e?: React.MouseEvent) => void;
  setSkipMarkAsRead: (skip: boolean) => void;
  skipMarkAsReadRef: React.MutableRefObject<boolean> | null;
  /**
   * Whether the channel has boards linked via channel_board_mappings — i.e. whether
   * a ticket created here has anywhere to land. Constant per channel, so it is
   * resolved once by the panel rather than subscribed to per message bubble.
   */
  channelHasBoards: boolean;
}>({
  setActiveTab: () => undefined,
  channelHasBoards: false,
  setSkipMarkAsRead: () => {
    logger.warn(LogEvent.FRONTEND_ERROR, {
      type: 'migrated_console_warn',
      message: String('setSkipMarkAsRead called outside ConversationTabContext provider'),
    });
  },
  skipMarkAsReadRef: null,
});
