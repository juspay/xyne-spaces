import { ReactElement, useState, useMemo } from 'react';
import { useAuthContextValues } from '../../hooks/useAuth';
import { useAllChannels, useUserChannelStatuses } from '../../hooks/useChannels';
import { groupChannelsByScope } from '../Chat/ChatDirectory/ChatDirectory.utils';
import { useAllUnreadCount } from '../../hooks/useUnreadCount';
import ChannelCommandMenu from '../Chat/ChatDirectory/ChannelCommandMenu';
import type { ContextItem } from '../Chat/ThreadContextPanel/ThreadContextPanel.types';

interface GlobalCommandMenuProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  contextSelectionMode?: boolean;
  contextItems?: ContextItem[];
  onContextItemToggle?: (item: ContextItem) => void;
  onContextSelectionConfirm?: () => void;
}

const GlobalCommandMenu = ({
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  contextSelectionMode,
  contextItems,
  onContextItemToggle,
  onContextSelectionConfirm,
}: GlobalCommandMenuProps = {}): ReactElement | null => {
  const context = useAuthContextValues();
  const channelData = useAllChannels();
  const allChannelsUserStatus = useUserChannelStatuses();
  const [internalOpen, setInternalOpen] = useState(false);

  // Get unread counts for all channels
  const unreadCounts = useAllUnreadCount();

  const open = controlledOpen ?? internalOpen;
  const onOpenChange = controlledOnOpenChange ?? setInternalOpen;

  // Group channels by scope type
  const { starred, channels, directMessages } = useMemo(() => {
    if (!channelData.length) return { starred: [], channels: [], directMessages: [] };

    const grouped = groupChannelsByScope(channelData, allChannelsUserStatus);

    const sortByActivity = (list: typeof channelData) =>
      [...list].sort(
        (a, b) =>
          new Date(b.lastActivityAt ?? 0).getTime() - new Date(a.lastActivityAt ?? 0).getTime(),
      );

    return {
      starred: sortByActivity(grouped.starred),
      channels: sortByActivity(grouped.channels),
      directMessages: sortByActivity(grouped.directMessages),
    };
  }, [channelData, allChannelsUserStatus]);

  if (!context.userID) return null;

  return (
    <ChannelCommandMenu
      channels={channels}
      starred={starred}
      directMessages={directMessages}
      currentUserID={context.userID}
      unreadCounts={unreadCounts}
      open={open}
      onOpenChange={onOpenChange}
      {...(contextSelectionMode !== undefined ? { contextSelectionMode } : {})}
      {...(contextItems !== undefined ? { contextItems } : {})}
      {...(onContextItemToggle !== undefined ? { onContextItemToggle } : {})}
      {...(onContextSelectionConfirm !== undefined ? { onContextSelectionConfirm } : {})}
    />
  );
};

export default GlobalCommandMenu;
