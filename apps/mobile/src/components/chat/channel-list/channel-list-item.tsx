import type { ChannelListItemData } from '@/src/types/channel-list';
import { buildSearchHighlightSegments } from '@/src/utils/searchHighlight';
import { cn } from '@/src/utils/cn';
import { ChannelVisibility } from '@xyne/shared';
import { Hash, Lock } from 'lucide-react-native';
import type { ReactElement, ReactNode } from 'react';
import { memo, useMemo } from 'react';
import { ChannelListUnreadBadge } from './channel-list-unread-badge';
import { hasNewActivity, SEARCH_HIGHLIGHT_CLASS } from './channel-list.utils';
import { Text, View } from 'react-native';
import { useCSSVariable } from 'uniwind';
import { ChannelListItemProvider, useChannelListItemContext } from './channel-list-item-context';
import { ListRowPressable } from '@/src/components/ui/list-row-pressable';
import { CHANNEL_ICON_GLYPH_SIZE, CHANNEL_ICON_SIZE } from './channel-list-layout';

export type ChannelListItemRootProps = {
  data: ChannelListItemData;
  children: ReactNode;
  onPress?: () => void;
};

function ChannelListItemRoot({ data, children, onPress }: ChannelListItemRootProps): ReactElement {
  return (
    <ListRowPressable className='w-full bg-tabs-screen' onPress={onPress}>
      <ChannelListItemProvider value={data}>{children}</ChannelListItemProvider>
    </ListRowPressable>
  );
}

const Icon = memo(function ChannelListItemIcon() {
  const { visibility, unreadCount, lastViewedAt, lastActivityAt } = useChannelListItemContext();
  const foreground = useCSSVariable('--color-foreground') as string;
  const muted = useCSSVariable('--color-secondary-foreground') as string;
  const isPrivate = visibility === ChannelVisibility.PRIVATE;
  const shouldShowBold = hasNewActivity(unreadCount, lastViewedAt, lastActivityAt);
  const iconColor = shouldShowBold ? foreground : muted;

  return (
    <View
      className='items-center justify-center'
      style={{ width: CHANNEL_ICON_SIZE, height: CHANNEL_ICON_SIZE, borderRadius: 999 }}
    >
      {isPrivate ? (
        <Lock color={iconColor} size={CHANNEL_ICON_GLYPH_SIZE} strokeWidth={2} />
      ) : (
        <Hash color={iconColor} size={CHANNEL_ICON_GLYPH_SIZE} strokeWidth={2} />
      )}
    </View>
  );
});

const Name = memo(function ChannelListItemName() {
  const {
    name,
    unreadCount,
    lastViewedAt,
    lastActivityAt,
    highlightQuery = '',
  } = useChannelListItemContext();
  const shouldShowBold = hasNewActivity(unreadCount, lastViewedAt, lastActivityAt);
  const className = cn(
    'shrink text-[16px]',
    shouldShowBold ? 'font-bold text-foreground' : 'font-medium text-secondary-foreground',
  );

  const segments = useMemo(
    () => buildSearchHighlightSegments(name, highlightQuery),
    [highlightQuery, name],
  );

  if (!highlightQuery) {
    return (
      <Text className={className} numberOfLines={1}>
        {name}
      </Text>
    );
  }

  return (
    <Text className={className} numberOfLines={1}>
      {segments.map((segment, index) => (
        <Text
          key={`${segment.text}-${index}`}
          {...(segment.highlighted ? { className: SEARCH_HIGHLIGHT_CLASS } : {})}
        >
          {segment.text}
        </Text>
      ))}
    </Text>
  );
});

const UnreadBadge = memo(function ChannelListItemUnreadBadge() {
  const { unreadCount } = useChannelListItemContext();

  if (unreadCount <= 0) {
    return null;
  }

  return <ChannelListUnreadBadge count={unreadCount} />;
});

export const ChannelListItem = Object.assign(ChannelListItemRoot, {
  Icon,
  Name,
  UnreadBadge,
});
