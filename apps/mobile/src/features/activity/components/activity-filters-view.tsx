import { useValue } from '@legendapp/state/react';
import {
  Bot,
  CheckCheck,
  ChevronRight,
  Layers,
  Rows3,
  User,
  Users,
  type LucideIcon,
} from 'lucide-react-native';
import { useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useCSSVariable } from 'uniwind';

import { useUsersById } from '@xyne/shared/hooks';

import { useZero } from '@/src/hooks/useZero';
import { Avatar } from '@/src/ui';
import { SegmentedControl, type SegmentedControlOption } from '@/src/ui/segmented-control';
import { Switch } from '@/src/ui/switch';
import { TRAY_ROW_HEIGHT } from '@/src/ui/tray/parts';
import { getUserDisplayName } from '@/src/utils/channel-utils';
import { haptics } from '@/src/utils/haptics';

import { markTabAsRead } from '../actions/markTabAsRead';
import type { ActivityActorKind, ActivityViewMode } from '../model/preferences';
import { closeActivityTray, setActivityTrayView } from '../state/filter-tray-store';
import { activityFilter$ } from '../state/filter-store';
import {
  activityPreferences$,
  applyActivityPreferences,
  setActionable,
  setActorKind,
  setUnreadOnly,
  setViewMode,
} from '../state/preferences-store';

const ICON_SIZE = 20;
const PERSON_ROW_MS = 180;

const styles = StyleSheet.create({
  person: { overflow: 'hidden' },
});

function useIconColor(): string {
  return useCSSVariable('--color-spaces-foreground') as string;
}

function segmentIcon(glyph: LucideIcon) {
  return function SegmentIcon({ active }: { active: boolean }): ReactElement {
    const foreground = useCSSVariable('--color-spaces-foreground') as string;
    const muted = useCSSVariable('--color-spaces-muted') as string;
    const Glyph = glyph;
    return <Glyph size={16} color={active ? foreground : muted} strokeWidth={2} />;
  };
}

const ACTOR_OPTIONS: readonly SegmentedControlOption<ActivityActorKind>[] = [
  { id: 'all', label: 'All', icon: segmentIcon(Users) },
  { id: 'user', label: 'User', icon: segmentIcon(User) },
  { id: 'agent', label: 'Agent', icon: segmentIcon(Bot) },
];

const VIEW_OPTIONS: readonly SegmentedControlOption<ActivityViewMode>[] = [
  { id: 'condensed', label: 'Condensed', icon: segmentIcon(Rows3) },
  { id: 'detailed', label: 'Detailed', icon: segmentIcon(Layers) },
];

function SectionLabel({ children }: { children: string }): ReactElement {
  return <Text className='px-3 pb-2 pt-1 text-[14px] text-spaces-muted'>{children}</Text>;
}

/**
 * A short, thin rule between filters — a third of the card, centred, so it
 * separates without framing.
 */
function Divider(): ReactElement {
  return (
    <View
      className='self-center bg-spaces-muted/30'
      style={{ height: 0.5, width: '96%', marginVertical: 8 }}
    />
  );
}

/** A label with a switch at its far end. */
function SwitchRow({
  label,
  value,
  onValueChange,
}: {
  label: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
}): ReactElement {
  return (
    <View className='flex-row items-center px-3' style={{ height: TRAY_ROW_HEIGHT }}>
      <Text className='flex-1 text-[16px] font-medium text-spaces-foreground'>{label}</Text>
      <Switch
        value={value}
        onValueChange={onValueChange}
        onSettled={applyActivityPreferences}
        accessibilityLabel={label}
      />
    </View>
  );
}

function ActionRow({
  label,
  icon,
  trailing,
  onPress,
}: {
  label: string;
  icon: ReactNode;
  trailing?: ReactNode;
  onPress: () => void;
}): ReactElement {
  return (
    <Pressable
      accessibilityRole='button'
      onPress={() => {
        void haptics.buttonTap();
        onPress();
      }}
      className='flex-row items-center rounded-2xl px-3 active:bg-spaces-surface'
      style={{ height: TRAY_ROW_HEIGHT }}
    >
      <View className='w-6 items-center justify-center'>{icon}</View>
      <Text
        numberOfLines={1}
        className='ml-3 flex-1 text-[16px] font-medium text-spaces-foreground'
      >
        {label}
      </Text>
      {trailing}
    </Pressable>
  );
}

/** The row and the gap above it. */
const PERSON_BLOCK_HEIGHT = TRAY_ROW_HEIGHT + 8;

/**
 * Who the feed is narrowed to, once a kind is chosen: "Anyone", or the person
 * picked. Tapping it steps into the searchable list.
 *
 * Always mounted, and opened by animating its height on the UI thread, rather
 * than mounted when a kind is picked. Mounting it grew the tray in one step
 * while the rows below were still laid out for the old height, so for a frame
 * the two overlapped; an animated height moves them together, and keeps the
 * card's growth continuous.
 */
function PersonRow(): ReactElement {
  const kind = useValue(activityPreferences$.actorKind);
  const userId = useValue(activityPreferences$.actorUserId);
  const usersById = useUsersById();
  const muted = useCSSVariable('--color-spaces-muted') as string;
  const foreground = useIconColor();

  const isOpen = kind !== 'all';

  // The last real kind, so the label does not flip to the wrong one while the
  // row is closing.
  const [shownKind, setShownKind] = useState<'user' | 'agent'>(kind === 'agent' ? 'agent' : 'user');
  useEffect(() => {
    if (kind !== 'all') setShownKind(kind);
  }, [kind]);

  const progress = useSharedValue(isOpen ? 1 : 0);
  useEffect(() => {
    progress.set(withTiming(isOpen ? 1 : 0, { duration: PERSON_ROW_MS }));
  }, [isOpen, progress]);

  const style = useAnimatedStyle(() => ({
    height: progress.get() * PERSON_BLOCK_HEIGHT,
    opacity: progress.get(),
  }));

  const anyLabel = shownKind === 'user' ? 'Anyone' : 'Any agent';
  const chosen = userId !== null ? usersById.get(userId) : undefined;
  const Icon = shownKind === 'user' ? User : Bot;

  return (
    <Animated.View style={[styles.person, style]} pointerEvents={isOpen ? 'auto' : 'none'}>
      <View className='pt-2'>
        <ActionRow
          label={chosen !== undefined ? getUserDisplayName(chosen) : anyLabel}
          icon={
            chosen !== undefined ? (
              <Avatar userIds={[chosen.id]} size={ICON_SIZE} />
            ) : (
              <Icon size={ICON_SIZE} color={foreground} strokeWidth={2} />
            )
          }
          trailing={<ChevronRight size={18} color={muted} strokeWidth={2} />}
          onPress={() => setActivityTrayView('people')}
        />
      </View>
    </Animated.View>
  );
}

/** The tray's first view: every control the feed has, top to bottom. */
export function ActivityFiltersView(): ReactElement {
  const zero = useZero();
  const foreground = useIconColor();
  const unreadOnly = useValue(activityPreferences$.unreadOnly);
  const actorKind = useValue(activityPreferences$.actorKind);
  const actionable = useValue(activityPreferences$.actionable);
  const viewMode = useValue(activityPreferences$.viewMode);

  return (
    <View className='px-3 pb-4 pt-3'>
      <ActionRow
        label='Mark as read'
        icon={<CheckCheck size={ICON_SIZE} color={foreground} strokeWidth={2} />}
        onPress={() => {
          markTabAsRead(zero, activityFilter$.peek());
          void haptics.success();
          closeActivityTray();
        }}
      />

      <Divider />

      <SwitchRow label='Unread' value={unreadOnly} onValueChange={setUnreadOnly} />

      <Divider />

      <SectionLabel>From</SectionLabel>
      <SegmentedControl
        options={ACTOR_OPTIONS}
        value={actorKind}
        onValueChange={setActorKind}
        onSettled={applyActivityPreferences}
        accessibilityLabel='Show activity from'
      />
      <PersonRow />

      <Divider />

      <SwitchRow label='Actionable' value={actionable} onValueChange={setActionable} />

      <Divider />

      <SectionLabel>View</SectionLabel>
      <SegmentedControl
        options={VIEW_OPTIONS}
        value={viewMode}
        onValueChange={setViewMode}
        onSettled={applyActivityPreferences}
        accessibilityLabel='Activity view'
      />
    </View>
  );
}
