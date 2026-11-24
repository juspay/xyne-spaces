import {
  ArrowUpCircle,
  Bell,
  BellOff,
  Bookmark,
  ChevronLeft,
  Clock,
  File,
  Info,
  NotebookText,
  Paperclip,
  Phone,
  Plus,
  Search,
  Settings,
  Star,
  Target,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react-native';
import { useMemo, useState, type ReactElement, type ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCSSVariable } from 'uniwind';

// Deep imports, as the classic info screen does: the profile barrel drags in every sheet.
import { AddPeopleModal } from '@/src/components/profile/add-people-modal';
import { PromoteToChannelSheet } from '@/src/components/profile/promote-to-channel-sheet';
import { LayersIcon } from '@/src/features/bottom-navigation/icons';
import { Switch } from '@/src/ui/switch';
import { AvatarFace } from '@/src/ui/avatar';

import {
  CHANNEL_INFO_ACTION_GAP,
  CHANNEL_INFO_ACTION_ICON_SIZE,
  CHANNEL_INFO_ACTIONS_PADDING_TOP,
  CHANNEL_INFO_BAR_PADDING_X,
  CHANNEL_INFO_BAR_PADDING_Y,
  CHANNEL_INFO_FACE_OVERLAP,
  CHANNEL_INFO_FACE_SIZE,
  CHANNEL_INFO_PADDING_BOTTOM,
  CHANNEL_INFO_PADDING_TOP,
  CHANNEL_INFO_PADDING_X,
  CHANNEL_INFO_ROW_ICON_SIZE,
  ROOM_HEADER_BUTTON_ICON_SIZE,
  ROOM_HEADER_BUTTON_SIZE,
} from '../constants';
import { useChannelInfo } from '../hooks/use-channel-info';
import { useSelfFace } from '../hooks/use-self-face';
import type { ChannelInfoActionId, ChannelInfoContentRowId } from '../model/channel-info';
import { colorOf } from '../model/token-color';
import { ChannelInfoAction } from './channel-info-action';
import { ChannelInfoGroup } from './channel-info-group';
import { ChannelInfoIdentity } from './channel-info-identity';
import { ChannelInfoRow } from './channel-info-row';
import { ChannelSectionTray } from './channel-section-tray';
import { IconButton } from './icon-button';
import { OverlappingAvatars } from './overlapping-avatars';

const CONTENT_ROWS: Readonly<Record<ChannelInfoContentRowId, { label: string; icon: LucideIcon }>> =
  {
    files: { label: 'Files', icon: File },
    tickets: { label: 'Tickets', icon: Target },
    pinned: { label: 'Pinned', icon: Bookmark },
    canvas: { label: 'Canvases', icon: NotebookText },
    links: { label: 'Links', icon: Paperclip },
  };

type OpenSheet = 'add' | 'promote' | 'section' | null;

/**
 * The redesigned conversation info (Figma "9 · Channel info"), opened from the
 * room title. Every destination and action of the classic screen is here:
 * Star and Section under "In your list", the classic About / Settings /
 * Promote rows with Leave in the last card. Figma draws a channel; a group
 * chat and a one-to-one chat use the same layout with what applies to them.
 */
export function ChannelInfoScreen(): ReactElement {
  const { channelId = '' } = useLocalSearchParams<{ channelId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const info = useChannelInfo(channelId);
  const self = useSelfFace();
  const [openSheet, setOpenSheet] = useState<OpenSheet>(null);
  const [foregroundToken, subtleToken, outlineToken, dangerToken] = useCSSVariable([
    '--color-spaces-foreground',
    '--color-spaces-subtle',
    '--color-spaces-outline',
    '--color-status-danger',
  ]);
  const foreground = colorOf(foregroundToken);
  const subtle = colorOf(subtleToken);
  const outline = colorOf(outlineToken);
  const danger = colorOf(dangerToken);
  const isDm = info.kind === 'dm';

  const contentStyle = useMemo(
    () => [styles.content, { paddingBottom: CHANNEL_INFO_PADDING_BOTTOM + insets.bottom }],
    [insets.bottom],
  );

  const icon = (glyph: LucideIcon, color = foreground): ReactNode => {
    const Glyph = glyph;
    return <Glyph size={CHANNEL_INFO_ROW_ICON_SIZE} color={color} />;
  };

  const renderAction = (id: ChannelInfoActionId): ReactElement => {
    const size = CHANNEL_INFO_ACTION_ICON_SIZE;
    switch (id) {
      case 'search':
        return (
          <ChannelInfoAction
            key={id}
            icon={<Search size={size} color={foreground} />}
            label='Search'
            color={foreground}
            onPress={info.onSearch}
          />
        );
      case 'call':
        return (
          <ChannelInfoAction
            key={id}
            icon={<Phone size={size} color={foreground} />}
            label='Call'
            color={foreground}
            chevron
            onPress={info.onCall}
          />
        );
      case 'mute':
        return (
          <ChannelInfoAction
            key={id}
            icon={
              info.isMuted ? (
                <BellOff size={size} color={foreground} />
              ) : (
                <Bell size={size} color={foreground} />
              )
            }
            label={info.isMuted ? 'Unmute' : 'Mute'}
            color={foreground}
            selected={info.isMuted}
            onPress={info.onToggleMute}
          />
        );
      case 'add':
        return (
          <ChannelInfoAction
            key={id}
            icon={<Plus size={size} color={foreground} />}
            label='Add'
            color={foreground}
            onPress={() => setOpenSheet('add')}
          />
        );
    }
  };

  const membersLeading = isDm ? (
    info.dmUserId ? (
      <AvatarFace userId={info.dmUserId} size={CHANNEL_INFO_FACE_SIZE} />
    ) : (
      icon(Users)
    )
  ) : info.memberFaces.length > 0 ? (
    <OverlappingAvatars
      userIds={info.memberFaces}
      size={CHANNEL_INFO_FACE_SIZE}
      overlap={CHANNEL_INFO_FACE_OVERLAP}
      ringClassName='border-spaces-surface'
      self={self}
    />
  ) : (
    icon(Users)
  );

  return (
    <View className='flex-1 bg-spaces-background' style={{ paddingTop: insets.top }}>
      <View className='flex-row items-center' style={styles.bar}>
        <IconButton label='Back' size={ROOM_HEADER_BUTTON_SIZE} onPress={() => router.back()}>
          <ChevronLeft size={ROOM_HEADER_BUTTON_ICON_SIZE} color={foreground} />
        </IconButton>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={contentStyle}>
        <ChannelInfoIdentity
          kind={info.kind}
          name={info.name}
          subtitle={info.subtitle}
          description={info.description}
          isPrivateChannel={info.isPrivateChannel}
          dmUserId={info.dmUserId}
          isOnline={info.isOnline}
          dmStatusEmoji={info.dmStatusEmoji}
          dmStatusContent={info.dmStatusContent}
          color={foreground}
          onOpenAvatar={info.onOpenAvatar}
        />

        <View className='flex-row' style={styles.actions}>
          {info.actions.map(renderAction)}
        </View>

        <ChannelInfoGroup title='In your list'>
          {info.canStar ? (
            <ChannelInfoRow
              key='starred'
              leading={icon(Star)}
              label='Starred'
              chevronColor={subtle}
              trailing={
                <Switch
                  size='compact'
                  offColor={outline}
                  value={info.isStarred}
                  onValueChange={info.onToggleStar}
                  accessibilityLabel='Starred'
                />
              }
            />
          ) : null}
          {info.section === null ? null : (
            <ChannelInfoRow
              key='section'
              leading={
                <LayersIcon
                  width={CHANNEL_INFO_ROW_ICON_SIZE}
                  height={CHANNEL_INFO_ROW_ICON_SIZE}
                  color={foreground}
                />
              }
              label='Section'
              value={info.section}
              chevronColor={subtle}
              onPress={() => setOpenSheet('section')}
            />
          )}
        </ChannelInfoGroup>

        <ChannelInfoGroup title={isDm ? 'Profile' : 'Members'}>
          <ChannelInfoRow
            leading={membersLeading}
            label={isDm ? info.name : info.membersLabel}
            caption={!isDm}
            chevronColor={subtle}
            accessibilityLabel={isDm ? `Profile, ${info.name}` : `Members, ${info.membersLabel}`}
            onPress={info.onOpenMembers}
          />
        </ChannelInfoGroup>

        <ChannelInfoGroup title={info.kind === 'channel' ? 'In this channel' : 'In this chat'}>
          {info.contentRows.map(id => (
            <ChannelInfoRow
              key={id}
              leading={icon(CONTENT_ROWS[id].icon)}
              label={CONTENT_ROWS[id].label}
              chevronColor={subtle}
              onPress={() => info.onOpenContent(id)}
            />
          ))}
        </ChannelInfoGroup>

        <ChannelInfoGroup title='About'>
          <ChannelInfoRow
            key='about'
            leading={icon(info.created === null || isDm ? Info : Clock)}
            label={info.created === null || isDm ? 'About' : info.created}
            accessibilityLabel={info.created === null || isDm ? 'About' : `About, ${info.created}`}
            chevronColor={subtle}
            onPress={info.onOpenAbout}
          />
          <ChannelInfoRow
            key='settings'
            leading={icon(Settings)}
            label='Settings'
            chevronColor={subtle}
            onPress={info.onOpenSettings}
          />
          {info.canPromoteToChannel ? (
            <ChannelInfoRow
              key='promote'
              leading={icon(ArrowUpCircle)}
              label='Promote to channel'
              chevronColor={subtle}
              onPress={() => setOpenSheet('promote')}
            />
          ) : null}
          {info.canLeaveChannel ? (
            <ChannelInfoRow
              key='leave'
              leading={icon(X, danger)}
              label='Leave channel'
              destructive
              chevron={false}
              chevronColor={subtle}
              onPress={info.onLeave}
            />
          ) : null}
        </ChannelInfoGroup>
      </ScrollView>

      <AddPeopleModal
        isOpen={openSheet === 'add'}
        onClose={() => setOpenSheet(null)}
        channelId={channelId}
      />
      <PromoteToChannelSheet
        isOpen={openSheet === 'promote'}
        onClose={() => setOpenSheet(null)}
        channelId={channelId}
      />
      {info.section === null ? null : (
        <ChannelSectionTray
          open={openSheet === 'section'}
          channelName={info.name}
          sections={info.sections}
          currentSectionId={info.currentSectionId}
          onChoose={info.onMoveToSection}
          onClose={() => setOpenSheet(null)}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    paddingHorizontal: CHANNEL_INFO_BAR_PADDING_X,
    paddingVertical: CHANNEL_INFO_BAR_PADDING_Y,
  },
  content: {
    paddingHorizontal: CHANNEL_INFO_PADDING_X,
    paddingTop: CHANNEL_INFO_PADDING_TOP,
  },
  actions: {
    paddingTop: CHANNEL_INFO_ACTIONS_PADDING_TOP,
    columnGap: CHANNEL_INFO_ACTION_GAP,
  },
});
