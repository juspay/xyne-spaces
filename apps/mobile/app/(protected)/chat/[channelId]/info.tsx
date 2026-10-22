import { ReactElement, ReactNode, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { SafeAreaView } from '@/src/components/ui/safe-area-view';
import { useCSSVariable } from 'uniwind';
import {
  ArrowUpCircle,
  ChevronRight,
  FolderOpen,
  Hash,
  Info,
  Link as LinkIcon,
  Lock,
  LogOut,
  NotebookText,
  Phone,
  Pin,
  Search,
  Settings as SettingsIcon,
  Star,
  Ticket,
  UserRoundPlus,
  Users,
  type LucideIcon,
} from 'lucide-react-native';

import Avatar from '@/src/components/ui/avatar';
import { haptics, triggerHaptic, type HapticScenario } from '@/src/utils/haptics';
import { HeaderBackButton } from '@/src/components/ui/header-icon-button';
import { ReactionEmojiDisplay } from '@/src/components/chat/message/reactions/reaction-emoji-display';
// Deep imports, not the `@/src/components/profile` barrel: the barrel pulls in
// every sheet in that folder, so importing through it would drag sheets this
// screen never opens onto the startup graph.
import { AddPeopleModal } from '@/src/components/profile/add-people-modal';
import { PromoteToChannelSheet } from '@/src/components/profile/promote-to-channel-sheet';
import { useConversationHeaderData } from '@/src/hooks/useConversationHeaderData';
import {
  initialTabForSurface,
  type SearchSourceSurface,
} from '@/src/features/global-search/utils/search-tabs';
// Only the gate and the deferred loader: the tickets table itself is reached
// through a lazy import in `load.ts`, so it never lands on this screen's graph.
import { canShowChannelTickets } from '@/src/features/channel-tickets/gate';
import { useChannelTicketsWarmup } from '@/src/features/channel-tickets/load';
import { ChannelScopeType } from '@xyne/shared';
import { useCanReadTicket } from '@xyne/shared/hooks';

// The icon box is sized to exactly one line of the title so the #/lock stays
// centred on the first line when a long name wraps. Must track `text-2xl`,
// whose Tailwind default line-height is 32px.
const TITLE_LINE_HEIGHT = 32;

type SquareActionButtonProps = {
  icon: ReactNode;
  label: string;
  onPress: () => void;
  /** Overrides the default tap feel — Star/Unstar reports its direction instead. */
  haptic?: HapticScenario;
};

const SquareActionButton = ({
  icon,
  label,
  onPress,
  haptic = 'buttonTap',
}: SquareActionButtonProps): ReactElement => (
  <Pressable
    onPress={onPress}
    onPressIn={(): void => {
      void triggerHaptic(haptic);
    }}
    className='flex-1 items-center justify-center gap-2 rounded-xl border border-settings-row-divider bg-settings-section-bg py-3 active:bg-secondary'
  >
    {icon}
    <Text numberOfLines={1} className='text-xs font-medium text-settings-label'>
      {label}
    </Text>
  </Pressable>
);

// Mirrors app/(protected)/settings/index.tsx's SettingsRow so this screen's
// list sections read as the same design language as the account settings page.
type InfoRowProps = {
  icon: LucideIcon;
  label: string;
  trailingValue?: string | undefined;
  destructive?: boolean;
  onPress: () => void;
};

const InfoRow = ({
  icon: Icon,
  label,
  trailingValue,
  destructive,
  onPress,
}: InfoRowProps): ReactElement => {
  const labelColor = useCSSVariable('--color-settings-label') as string;
  const descriptionColor = useCSSVariable('--color-settings-description') as string;
  const chevronColor = useCSSVariable('--color-settings-chevron') as string;
  const dividerColor = useCSSVariable('--color-settings-row-divider') as string;
  const dangerColor = useCSSVariable('--color-settings-icon-red') as string;
  const color = destructive ? dangerColor : labelColor;

  return (
    <Pressable
      onPress={onPress}
      onPressIn={(): void => {
        void haptics.buttonTap();
      }}
      accessibilityRole='button'
      accessibilityLabel={label}
      android_ripple={{ color: dividerColor }}
      style={({ pressed }) => ({ opacity: pressed ? 0.58 : 1 })}
    >
      <View className='min-h-[62px] flex-row items-center gap-3 py-2.5 pl-2.5 pr-4'>
        <View className='h-9 w-9 items-center justify-center'>
          <Icon size={22} color={color} strokeWidth={2.1} />
        </View>
        <Text className='flex-1 text-base' style={{ color }} numberOfLines={1}>
          {label}
        </Text>
        {trailingValue ? (
          <Text className='text-sm' style={{ color: descriptionColor }}>
            {trailingValue}
          </Text>
        ) : null}
        {!destructive ? <ChevronRight size={19} color={chevronColor} strokeWidth={2.5} /> : null}
      </View>
    </Pressable>
  );
};

const RowDivider = (): ReactElement => {
  const dividerColor = useCSSVariable('--color-settings-row-divider') as string;
  return <View className='h-px' style={{ marginLeft: 58, backgroundColor: dividerColor }} />;
};

const ConversationInfoScreen = (): ReactElement => {
  const { channelId } = useLocalSearchParams<{ channelId: string }>();
  const router = useRouter();
  const bgColor = useCSSVariable('--color-settings-bg') as string;
  const labelColor = useCSSVariable('--color-settings-label') as string;
  const descriptionColor = useCSSVariable('--color-settings-description') as string;
  const iconRedColor = useCSSVariable('--color-settings-icon-red') as string;
  const [showAddPeopleModal, setShowAddPeopleModal] = useState(false);
  const [showPromoteSheet, setShowPromoteSheet] = useState(false);

  const {
    channel,
    isDM,
    isPrivateChannel,
    dmProfileUserId,
    dmStatusEmoji,
    dmStatusContent,
    isOnline,
    displayName,
    memberCount,
    memberLabel,
    canAddPeople,
    canPromoteToChannel,
    canUseMemberActions,
    canLeaveChannel,
    isStarred,
    handleStarToggle,
    handleCallPress,
    handleLeaveChannel,
  } = useConversationHeaderData(channelId ?? '');

  // Tickets row: TICKETS read access, not a DM / group DM, not a desk channel.
  // When shown, warm the lazy screen module and the first page of tickets now so
  // the row opens instantly; nothing runs for channels that fail the gate.
  const canReadTicket = useCanReadTicket();
  const showTickets = canShowChannelTickets(channel, canReadTicket);
  useChannelTicketsWarmup(channelId ?? '', showTickets);

  // Reuses the same full-screen preview the app-level profile page opens from
  // its avatar, passing the DM partner's id instead of defaulting to self.
  const handleAvatarPress = (): void => {
    if (!dmProfileUserId) return;
    router.push({
      pathname: '/(protected)/settings/profile-photo',
      params: { userId: dmProfileUserId },
    });
  };

  const handleAboutPress = (): void => {
    router.push({ pathname: '/(protected)/chat/[channelId]/about', params: { channelId } });
  };

  const handleMembersPress = (): void => {
    if (isDM) {
      if (dmProfileUserId) router.push(`/profile/${dmProfileUserId}`);
      return;
    }
    router.push({ pathname: '/(protected)/chat/[channelId]/members', params: { channelId } });
  };

  const handleFilesPress = (): void => {
    router.push({ pathname: '/(protected)/chat/[channelId]/files', params: { channelId } });
  };

  const handlePinsPress = (): void => {
    router.push({
      pathname: '/(protected)/chat/[channelId]/pinned-messages',
      params: { channelId },
    });
  };

  const handleCanvasPress = (): void => {
    router.push({ pathname: '/(protected)/chat/[channelId]/canvas', params: { channelId } });
  };

  const handleLinksPress = (): void => {
    router.push({ pathname: '/(protected)/chat/[channelId]/links', params: { channelId } });
  };

  const handleTicketsPress = (): void => {
    router.push({ pathname: '/(protected)/chat/[channelId]/tickets', params: { channelId } });
  };

  /**
   * Opens the shared global-search page locked to this conversation. The scope
   * travels as route params, which the search screen reads before its first
   * render.
   */
  const handleSearchPress = (): void => {
    if (!channelId) return;

    const sourceSurface: SearchSourceSurface =
      isDM || channel?.scopeType === ChannelScopeType.GROUP_DM ? 'dms' : 'channels';

    router.push({
      pathname: '/(protected)/global-search',
      params: {
        sourceSurface,
        initialTab: initialTabForSurface(sourceSurface),
        scopeChannelId: channelId,
        scopeLabel: displayName,
      },
    } as unknown as Href);
  };

  const handleChannelSettingsPress = (): void => {
    router.push({ pathname: '/(protected)/chat/[channelId]/settings', params: { channelId } });
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: bgColor }} edges={['top', 'bottom']}>
      <View className='min-h-14 flex-row items-center px-2'>
        <HeaderBackButton liquidGlass onPress={() => router.back()} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 28 }}
      >
        <View className='items-center px-5 pb-8 pt-2'>
          {isDM && dmProfileUserId ? (
            <Pressable
              onPress={handleAvatarPress}
              onPressIn={(): void => {
                void haptics.buttonTap();
              }}
              accessibilityRole='button'
              accessibilityLabel='Preview profile photo'
              className='relative mb-4 rounded-full active:opacity-80'
            >
              <Avatar userIds={[dmProfileUserId]} size={124} rounded={false} />
              <View
                className={`absolute bottom-1 right-1 h-5 w-5 rounded-full border-2 ${
                  isOnline ? 'bg-green-500' : 'bg-[#9CA3AF]'
                }`}
                style={{ borderColor: bgColor }}
              />
            </Pressable>
          ) : null}

          {/* Keep the #/lock aligned with the first title line while centring
              each wrapped line independently. */}
          <View className='flex-row items-start justify-center gap-1.5'>
            {!isDM ? (
              <View
                className='shrink-0 items-center justify-center'
                style={{ height: TITLE_LINE_HEIGHT }}
              >
                {isPrivateChannel ? (
                  <Lock size={18} color={descriptionColor} />
                ) : (
                  <Hash size={18} color={descriptionColor} />
                )}
              </View>
            ) : null}
            <Text
              className='max-w-[85%] shrink text-center text-2xl font-bold'
              style={{ color: labelColor, lineHeight: TITLE_LINE_HEIGHT }}
              numberOfLines={2}
            >
              {displayName}
            </Text>
          </View>

          {isDM && dmStatusEmoji ? (
            <View className='mt-1.5 flex-row items-center gap-2'>
              <ReactionEmojiDisplay emojiName={dmStatusEmoji} size={16} />
              {dmStatusContent ? (
                <Text className='text-sm' style={{ color: descriptionColor }}>
                  {dmStatusContent}
                </Text>
              ) : null}
            </View>
          ) : null}

          {!isDM ? (
            <Text className='mt-1.5 text-sm' style={{ color: descriptionColor }}>
              {memberCount} {memberLabel}
            </Text>
          ) : null}
        </View>

        <View className='flex-row gap-3 pb-6'>
          {canAddPeople ? (
            <SquareActionButton
              icon={<UserRoundPlus size={22} color={labelColor} />}
              label='Add'
              onPress={() => setShowAddPeopleModal(true)}
            />
          ) : null}
          {canUseMemberActions ? (
            <SquareActionButton
              icon={
                <Star
                  size={22}
                  color={isStarred ? '#EAB308' : labelColor}
                  fill={isStarred ? '#EAB308' : 'transparent'}
                />
              }
              label={isStarred ? 'Unstar' : 'Star'}
              haptic={isStarred ? 'toggleOff' : 'toggleOn'}
              onPress={handleStarToggle}
            />
          ) : null}
          <SquareActionButton
            icon={<Phone size={22} color={labelColor} />}
            label='Call'
            onPress={() => void handleCallPress()}
          />
          <SquareActionButton
            icon={<Search size={22} color={labelColor} />}
            label='Search'
            onPress={handleSearchPress}
          />
        </View>

        <View className='overflow-hidden rounded-2xl bg-settings-section-bg'>
          <InfoRow icon={Info} label='About' onPress={handleAboutPress} />
          <RowDivider />
          <InfoRow
            icon={Users}
            label={isDM ? 'Profile' : 'Members'}
            trailingValue={!isDM ? String(memberCount) : undefined}
            onPress={handleMembersPress}
          />
          <RowDivider />
          <InfoRow icon={FolderOpen} label='Files' onPress={handleFilesPress} />
          <RowDivider />
          <InfoRow icon={Pin} label='Pins' onPress={handlePinsPress} />
          <RowDivider />
          <InfoRow icon={NotebookText} label='Canvas' onPress={handleCanvasPress} />
          <RowDivider />
          <InfoRow icon={LinkIcon} label='Links' onPress={handleLinksPress} />
          {showTickets ? (
            <>
              <RowDivider />
              <InfoRow icon={Ticket} label='Tickets' onPress={handleTicketsPress} />
            </>
          ) : null}
        </View>

        {/* Single Settings destination: it hosts notification settings for every
            conversation type, plus channel admin controls for real channels.

            Promotion sits here rather than in the quick-action row above: it is a
            rare, one-way structural change, not a frequent reversible tap like
            Call or Star. A full-width row also fits the whole label, and keeps
            that row at four buttons so it cannot crowd on narrow screens. */}
        <View className='mt-6 overflow-hidden rounded-2xl bg-settings-section-bg'>
          <InfoRow icon={SettingsIcon} label='Settings' onPress={handleChannelSettingsPress} />
          {canPromoteToChannel ? (
            <>
              <RowDivider />
              <InfoRow
                icon={ArrowUpCircle}
                label='Promote to channel'
                onPress={() => setShowPromoteSheet(true)}
              />
            </>
          ) : null}
        </View>

        {canLeaveChannel ? (
          <Pressable
            onPress={handleLeaveChannel}
            onPressIn={(): void => {
              // Destructive: leaving is the heaviest action on this screen.
              void haptics.warning();
            }}
            accessibilityRole='button'
            accessibilityLabel='Leave channel'
            className='mt-7 min-h-12 flex-row items-center justify-center gap-2 rounded-full active:opacity-80'
            style={{ backgroundColor: iconRedColor }}
          >
            <LogOut size={18} color='#FFFFFF' strokeWidth={2.4} />
            <Text className='text-base font-semibold text-white'>Leave channel</Text>
          </Pressable>
        ) : null}
      </ScrollView>

      <AddPeopleModal
        isOpen={showAddPeopleModal}
        onClose={() => setShowAddPeopleModal(false)}
        channelId={channelId ?? ''}
      />

      <PromoteToChannelSheet
        isOpen={showPromoteSheet}
        onClose={() => setShowPromoteSheet(false)}
        channelId={channelId ?? ''}
      />
    </SafeAreaView>
  );
};

export default ConversationInfoScreen;
