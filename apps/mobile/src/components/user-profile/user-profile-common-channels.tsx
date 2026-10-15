import { memo, useMemo, type ReactElement } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { type Channel, ChannelScopeType } from '@xyne/shared';

import Avatar from '@/src/components/ui/avatar';
import { useAuth } from '@/src/contexts/AuthContext';
import { useAllChannels, useChannelDisplayName } from '@/src/hooks/useChannels';
import { cn } from '@/src/utils/cn';
import {
  ListRow,
  ListRowDivider,
  SectionCard,
  SectionLabel,
} from '@/src/components/ui/settings-list';

import { useUserProfile } from './user-profile-context';

const MAX_COMMON_CHANNELS = 3;

type CommonChannelsProps = {
  className?: string;
};

const parseParticipantIds = (channel: { name: string; scopeType: string }): string[] => {
  if (
    channel.scopeType !== ChannelScopeType.DM &&
    channel.scopeType !== ChannelScopeType.GROUP_DM
  ) {
    return [];
  }
  return channel.name
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
};

type CommonChannelItemProps = {
  channel: Channel;
  currentUserId: string;
};

const CommonChannelItem = memo(
  ({ channel, currentUserId }: CommonChannelItemProps): ReactElement => {
    const router = useRouter();
    const displayName = useChannelDisplayName(channel, currentUserId);

    const participantIds = useMemo(() => parseParticipantIds(channel), [channel]);
    const firstOtherId = useMemo(
      () => participantIds.find(id => id !== currentUserId),
      [participantIds, currentUserId],
    );
    const memberCount = participantIds.length;

    const handlePress = (): void => {
      router.push(`/(protected)/chat/${channel.id}`);
    };

    return (
      <ListRow
        leading={<Avatar userIds={firstOtherId ? [firstOtherId] : []} size={30} rounded={false} />}
        label={displayName}
        {...(memberCount > 0
          ? { description: `${memberCount} ${memberCount === 1 ? 'member' : 'members'}` }
          : {})}
        showChevron
        onPress={handlePress}
      />
    );
  },
);
CommonChannelItem.displayName = 'UserProfile.CommonChannelItem';

const CommonChannels = memo(({ className }: CommonChannelsProps): ReactElement | null => {
  const { user, isOwnProfile } = useUserProfile();
  const { user: authUser } = useAuth();
  const allChannels = useAllChannels();

  const currentUserId = authUser?.user_id ?? '';
  const profileUserId = user?.id ?? '';

  const commonChannels = useMemo<Channel[]>(() => {
    if (!profileUserId || !currentUserId || profileUserId === currentUserId) {
      return [];
    }
    const matching = allChannels.filter(channel => {
      if (channel.scopeType !== ChannelScopeType.GROUP_DM) return false;
      const ids = parseParticipantIds(channel);
      return ids.includes(currentUserId) && ids.includes(profileUserId);
    });
    matching.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
    return matching.slice(0, MAX_COMMON_CHANNELS);
  }, [allChannels, currentUserId, profileUserId]);

  if (isOwnProfile || commonChannels.length === 0) return null;

  return (
    <View className={cn(className)}>
      <SectionLabel>Common Groups</SectionLabel>
      <SectionCard>
        {commonChannels.map((channel, index) => (
          <View key={channel.id}>
            {index > 0 ? <ListRowDivider /> : null}
            <CommonChannelItem channel={channel} currentUserId={currentUserId} />
          </View>
        ))}
      </SectionCard>
    </View>
  );
});
CommonChannels.displayName = 'UserProfile.CommonChannels';

export { CommonChannels };
