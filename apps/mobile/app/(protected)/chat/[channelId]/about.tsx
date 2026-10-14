import { type ReactElement, type ReactNode } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCSSVariable } from 'uniwind';
import { CalendarDays, Hash, Lock, Users, type LucideIcon } from 'lucide-react-native';
import { ChannelScopeType, ChannelVisibility } from '@xyne/shared';

import { HeaderBackButton } from '@/src/components/ui/header-icon-button';
import { CopyableValue } from '@/src/components/ui/copyable-value';
import Avatar from '@/src/components/ui/avatar';
import { resolveChannelMemberCount } from '@/src/features/chat/channel-members/channel-member-actions';
import { useCachedQuery } from '@/src/hooks/useCachedQuery';
import { useVisibleChannelById } from '@/src/hooks/useChannels';
import { useUser } from '@/src/hooks/useUsers';
import { queries } from '@/src/zero/queries';

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'long',
  day: 'numeric',
  year: 'numeric',
});

const SectionLabel = ({ children }: { children: string }): ReactElement => {
  const descriptionColor = useCSSVariable('--color-settings-description') as string;
  return (
    <Text
      className='mb-2 ml-4 text-xs font-semibold uppercase tracking-wide'
      style={{ color: descriptionColor }}
    >
      {children}
    </Text>
  );
};

const Card = ({ children }: { children: ReactNode }): ReactElement => (
  <View className='overflow-hidden rounded-2xl bg-settings-section-bg'>{children}</View>
);

const RowDivider = (): ReactElement => {
  const dividerColor = useCSSVariable('--color-settings-row-divider') as string;
  return <View className='h-px' style={{ marginLeft: 58, backgroundColor: dividerColor }} />;
};

type DetailRowProps = {
  icon?: LucideIcon;
  leading?: ReactElement;
  label: string;
  value: string;
};

const DetailRow = ({ icon: Icon, leading, label, value }: DetailRowProps): ReactElement => {
  const labelColor = useCSSVariable('--color-settings-label') as string;
  const descriptionColor = useCSSVariable('--color-settings-description') as string;

  return (
    <View className='min-h-[56px] flex-row items-center gap-3 py-2.5 pl-2.5 pr-4'>
      <View className='h-9 w-9 items-center justify-center'>
        {leading ?? (Icon ? <Icon size={21} color={descriptionColor} strokeWidth={2.1} /> : null)}
      </View>
      <Text className='flex-1 text-base' style={{ color: labelColor }} numberOfLines={1}>
        {label}
      </Text>
      <Text
        className='max-w-[55%] text-right text-sm'
        style={{ color: descriptionColor }}
        numberOfLines={1}
      >
        {value}
      </Text>
    </View>
  );
};

const AboutScreen = (): ReactElement => {
  const { channelId } = useLocalSearchParams<{ channelId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const labelColor = useCSSVariable('--color-settings-label') as string;
  const descriptionColor = useCSSVariable('--color-settings-description') as string;

  const channel = useVisibleChannelById(channelId ?? '');
  const createdByUser = useUser(channel?.createdBy ?? '');
  const [participants] = useCachedQuery(
    queries.channelParticipants({ channelId: channelId ?? '' }),
    { enabled: !!channelId },
  );

  const isDM = channel?.scopeType === ChannelScopeType.DM;
  const isPrivate = channel?.visibility === ChannelVisibility.PRIVATE;
  const memberCount = resolveChannelMemberCount({
    liveParticipantCount: participants.length,
    statsParticipantCount: channel?.channelStats?.participantCount,
  });
  const description = channel?.description?.trim();
  const formattedDate = channel?.createdAt
    ? dateFormatter.format(new Date(channel.createdAt))
    : null;

  return (
    <View className='flex-1 bg-settings-bg' style={{ paddingTop: insets.top }}>
      <View className='flex-row items-center gap-2 px-2 py-3'>
        <HeaderBackButton liquidGlass onPress={() => router.back()} />
        <Text className='text-lg font-semibold' style={{ color: labelColor }}>
          About
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 28 }}
        showsVerticalScrollIndicator={false}
      >
        <SectionLabel>Description</SectionLabel>
        <Card>
          <View className='px-4 py-3.5'>
            {description ? (
              <Text className='text-base' style={{ color: labelColor }}>
                {description}
              </Text>
            ) : (
              <Text className='text-base italic' style={{ color: descriptionColor }}>
                No description set
              </Text>
            )}
          </View>
        </Card>

        <View className='mt-7'>
          <SectionLabel>Details</SectionLabel>
          <Card>
            {!isDM ? (
              <>
                <DetailRow
                  icon={isPrivate ? Lock : Hash}
                  label='Visibility'
                  value={isPrivate ? 'Private' : 'Public'}
                />
                <RowDivider />
                <DetailRow
                  icon={Users}
                  label='Members'
                  value={`${memberCount} ${memberCount === 1 ? 'member' : 'members'}`}
                />
                <RowDivider />
              </>
            ) : null}
            {channel?.createdBy ? (
              <>
                <DetailRow
                  leading={<Avatar userIds={[channel.createdBy]} size={28} />}
                  label='Created by'
                  value={createdByUser?.name ?? 'Unknown'}
                />
                {formattedDate ? <RowDivider /> : null}
              </>
            ) : null}
            {formattedDate ? (
              <DetailRow icon={CalendarDays} label='Created on' value={formattedDate} />
            ) : null}
          </Card>
        </View>

        <View className='mt-7'>
          <SectionLabel>Channel ID</SectionLabel>
          <Card>
            <View className='px-4 py-3.5'>
              <CopyableValue
                value={channel?.id ?? channelId ?? ''}
                monospace
                textClassName='text-sm'
                copyAccessibilityLabel='Copy channel ID'
              />
            </View>
          </Card>
        </View>
      </ScrollView>
    </View>
  );
};

export default AboutScreen;
