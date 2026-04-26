import { ReactElement, useState, useMemo, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuthContextValues } from '../../hooks/useAuth';
import {
  useAllChannels,
  useAllVisibleChannels,
  useUserChannelStatuses,
} from '../../hooks/useChannels';
import {
  groupChannelsByScope,
  isDMChannel,
  getDMParticipantIdsToFetch,
} from '../Chat/ChatDirectory/ChatDirectory.utils';
import { useAllUnreadCount } from '../../hooks/useUnreadCount';
import ChannelCommandMenu from '../Chat/ChatDirectory/ChannelCommandMenu';
import type { ContextItem } from '../Chat/ThreadContextPanel/ThreadContextPanel.types';
import type { TabType } from '../Chat/ChatDirectory/ChannelCommandMenu.types';
import { VisibleChannel } from '../../machines/stateMachine';
import { useShortcutById } from '../../shortcuts';
import type { MentionData } from '../Chat/ChatDirectory/MentionNode';
import { useUsers } from '../../hooks/useUsers';

interface GlobalCommandMenuProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  contextSelectionMode?: boolean;
  contextItems?: ContextItem[];
  onContextItemToggle?: (item: ContextItem) => void;
  onContextSelectionConfirm?: () => void;
  enabledTabs?: TabType[];
  inline?: boolean;
  onTabChange?: (tab: TabType) => void;
  disableAutoFocus?: boolean;
}

const GlobalCommandMenu = ({
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  contextSelectionMode,
  contextItems,
  onContextItemToggle,
  onContextSelectionConfirm,
  enabledTabs,
  inline,
  onTabChange,
  disableAutoFocus,
}: GlobalCommandMenuProps = {}): ReactElement | null => {
  const context = useAuthContextValues();
  const channelData = useAllChannels();
  const visibleAllChannels = useAllVisibleChannels();
  const allChannelsUserStatus = useUserChannelStatuses();
  const [internalOpen, setInternalOpen] = useState(false);
  const [initialMention, setInitialMention] = useState<MentionData | null>(null);
  const location = useLocation();
  const allUsers = useUsers();

  // Get unread counts for all channels
  const unreadCounts = useAllUnreadCount();

  const open = controlledOpen ?? internalOpen;
  const onOpenChange = controlledOnOpenChange ?? setInternalOpen;

  const handleOpenChange = useCallback(
    (newOpen: boolean) => {
      onOpenChange(newOpen);
      if (!newOpen) {
        setInitialMention(null);
      }
    },
    [onOpenChange],
  );

  const handleFindInChannel = useCallback(() => {
    // Extract channelId from URL
    const pathParts = location.pathname.split('/').filter(Boolean);
    const chatIndex = pathParts.indexOf('chat');
    let channelId: string | null = null;

    if (chatIndex !== -1) {
      const nextSegment = pathParts[chatIndex + 1];
      if (
        nextSegment === 'dir' ||
        nextSegment === 'dm' ||
        nextSegment === 'bookmarks' ||
        nextSegment === 'activity'
      ) {
        channelId = pathParts[chatIndex + 2] || null;
      }
    }

    if (!channelId) {
      // No channel context — just open regular Cmd+K
      onOpenChange(true);
      return;
    }

    // Find the channel
    const channel = channelData.find(c => c.id === channelId);
    if (!channel) {
      onOpenChange(true);
      return;
    }

    // Build channel display name
    let channelName = channel.name;
    if (isDMChannel(channel.scopeType)) {
      const participantIds = getDMParticipantIdsToFetch(channel, context.userID ?? '');
      const participantNames = participantIds
        .map(id => allUsers.find(u => u.id === id)?.name)
        .filter((name): name is string => !!name);
      if (participantNames.length > 0) {
        channelName = participantNames.join(', ');
      }
    }

    setInitialMention({
      id: channel.id,
      name: channelName,
      type: 'channel',
      prefix: 'in:',
    });
    onOpenChange(true);
  }, [location.pathname, channelData, allUsers, onOpenChange, context.userID]);

  useShortcutById('global.findInChannel', handleFindInChannel);

  // Group channels by scope type
  const { starred, channels, directMessages } = useMemo(() => {
    if (!channelData.length) return { starred: [], channels: [], directMessages: [] };

    const visibleChannels = channelData.map(channel => {
      const vc = visibleAllChannels.find(vc => vc.id === channel.id);
      if (vc) {
        return vc;
      }
      return {
        ...channel,
      };
    }) as VisibleChannel[];
    const grouped = groupChannelsByScope(visibleChannels, allChannelsUserStatus);

    const sortByActivity = (list: typeof visibleChannels) =>
      [...list].sort(
        (a, b) =>
          new Date(b.channelStats?.lastActivityAt ?? 0).getTime() -
          new Date(a.channelStats?.lastActivityAt ?? 0).getTime(),
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
      onOpenChange={handleOpenChange}
      initialMention={initialMention}
      {...(contextSelectionMode !== undefined ? { contextSelectionMode } : {})}
      {...(contextItems !== undefined ? { contextItems } : {})}
      {...(onContextItemToggle !== undefined ? { onContextItemToggle } : {})}
      {...(onContextSelectionConfirm !== undefined ? { onContextSelectionConfirm } : {})}
      {...(enabledTabs !== undefined ? { enabledTabs } : {})}
      {...(inline !== undefined ? { inline } : {})}
      {...(onTabChange !== undefined ? { onTabChange } : {})}
      {...(disableAutoFocus !== undefined ? { disableAutoFocus } : {})}
    />
  );
};

export default GlobalCommandMenu;
