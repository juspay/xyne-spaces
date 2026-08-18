import { logger, Event as LogEvent } from '../../utils/logger';
import { createContext } from 'react';

export const ConversationTabContext = createContext<{
  setActiveTab: (tab: string, e?: React.MouseEvent) => void;
  setSkipMarkAsRead: (skip: boolean) => void;
  skipMarkAsReadRef: React.MutableRefObject<boolean> | null;
}>({
  setActiveTab: () => undefined,
  setSkipMarkAsRead: () => {
    logger.warn(LogEvent.FRONTEND_ERROR, {
      type: 'migrated_console_warn',
      message: String('setSkipMarkAsRead called outside ConversationTabContext provider'),
    });
  },
  skipMarkAsReadRef: null,
});
