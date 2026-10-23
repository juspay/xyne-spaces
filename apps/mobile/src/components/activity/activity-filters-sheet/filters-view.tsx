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
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useCSSVariable } from 'uniwind';

import { useUsersById } from '@xyne/shared/hooks';

import Avatar from '@/src/components/ui/avatar';
import type {
  ActivityActorKind,
  ActivityViewMode,
} from '@/src/features/activity/model/preferences';
import {
  activityPreferences$,
  applyActivityPreferences,
  setActionable,
  setActorKind,
  setUnreadOnly,
  setViewMode,
} from '@/src/features/activity/state/preferences-store';
import {
  SegmentedControl,
  type SegmentedControlClassNames,
  type SegmentedControlOption,
} from '@/src/ui/segmented-control';
import { Switch } from '@/src/ui/switch';
import { getUserDisplayName } from '@/src/utils/channel-utils';
import { haptics } from '@/src/utils/haptics';

import {
  CONTENT_BOTTOM_PADDING,
  DIVIDER_MARGIN,
  HEADER_HEIGHT,
  PERSON_BLOCK_HEIGHT,
  RESIZE_MS,
  ROW_HEIGHT,
  SECTION_LABEL_HEIGHT,
} from './constants';

const ICON_SIZE = 20;

const SHEET_SEGMENTS: SegmentedControlClassNames = {
  track: 'bg-bottomsheet-container-bg',
  indicator: 'bg-bottomsheet-bg dark:bg-accent',
  activeLabel: 'text-bottomsheet-container-foreground',
  inactiveLabel: 'text-bottomsheet-text-muted',
};

const styles = StyleSheet.create({
  person: { overflow: 'hidden' },
});

function useSheetColors(): { foreground: string; muted: string } {
  return {
    foreground: useCSSVariable('--color-bottomsheet-container-foreground') as string,
    muted: useCSSVariable('--color-bottomsheet-text-muted') as string,
  };
}

function segmentIcon(glyph: LucideIcon) {
  return function SegmentIcon({ active }: { active: boolean }): ReactElement {
    const { foreground, muted } = useSheetColors();
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
  return (
    <View className='justify-center px-2' style={{ height: SECTION_LABEL_HEIGHT }}>
      <Text className='text-[14px] text-bottomsheet-text-muted'>{children}</Text>
    </View>
  );
}

function Divider(): ReactElement {
  return (
    <View
      className='bg-border'
      style={{ height: StyleSheet.hairlineWidth, marginVertical: DIVIDER_MARGIN }}
    />
  );
}

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
    <View className='flex-row items-center px-2' style={{ height: ROW_HEIGHT }}>
      <Text className='flex-1 text-[16px] text-bottomsheet-container-foreground'>{label}</Text>
      {/*
        Drawn in React Native, as in the Spaces tray: the app's native iOS
        switch does not render inside this sheet.
      */}
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
      className='flex-row items-center rounded-xl px-2 active:bg-bottomsheet-container-bg'
      style={{ height: ROW_HEIGHT }}
    >
      <View className='w-6 items-center justify-center'>{icon}</View>
      <Text
        numberOfLines={1}
        className='ml-3 flex-1 text-[16px] text-bottomsheet-container-foreground'
      >
        {label}
      </Text>
      {trailing}
    </Pressable>
  );
}

/**
 * "Anyone", or the person picked, once a kind is chosen. Opens by animating its
 * height, on the sheet's own timing, so it grows with the sheet rather than
 * pushing the rows below it out of the bottom.
 */
function PersonRow({ onPress }: { onPress: () => void }): ReactElement {
  const kind = useValue(activityPreferences$.actorKind);
  const userId = useValue(activityPreferences$.actorUserId);
  const usersById = useUsersById();
  const { foreground, muted } = useSheetColors();

  const isOpen = kind !== 'all';

  // The last real kind, so the label does not flip while the row closes.
  const [shownKind, setShownKind] = useState<'user' | 'agent'>(kind === 'agent' ? 'agent' : 'user');
  useEffect(() => {
    if (kind !== 'all') setShownKind(kind);
  }, [kind]);

  const progress = useSharedValue(isOpen ? 1 : 0);
  useEffect(() => {
    progress.set(
      withTiming(isOpen ? 1 : 0, { duration: RESIZE_MS, easing: Easing.out(Easing.cubic) }),
    );
  }, [isOpen, progress]);

  const style = useAnimatedStyle(() => ({
    height: progress.get() * PERSON_BLOCK_HEIGHT,
    opacity: progress.get(),
  }));

  const chosen = userId !== null ? usersById.get(userId) : undefined;
  const Icon = shownKind === 'user' ? User : Bot;

  return (
    <Animated.View style={[styles.person, style]} pointerEvents={isOpen ? 'auto' : 'none'}>
      <View className='pt-2'>
        <ActionRow
          label={
            chosen !== undefined
              ? getUserDisplayName(chosen)
              : shownKind === 'user'
                ? 'Anyone'
                : 'Any agent'
          }
          icon={
            chosen !== undefined ? (
              <Avatar userIds={[chosen.id]} size={ICON_SIZE} />
            ) : (
              <Icon size={ICON_SIZE} color={foreground} strokeWidth={2} />
            )
          }
          trailing={<ChevronRight size={18} color={muted} strokeWidth={2} />}
          onPress={onPress}
        />
      </View>
    </Animated.View>
  );
}

type FiltersViewProps = {
  onMarkAsRead: () => void;
  onChoosePerson: () => void;
};

/** The sheet's first view: every control the feed has, top to bottom. */
export function FiltersView({ onMarkAsRead, onChoosePerson }: FiltersViewProps): ReactElement {
  const { foreground } = useSheetColors();
  const unreadOnly = useValue(activityPreferences$.unreadOnly);
  const actorKind = useValue(activityPreferences$.actorKind);
  const actionable = useValue(activityPreferences$.actionable);
  const viewMode = useValue(activityPreferences$.viewMode);

  return (
    <View className='px-3' style={{ paddingBottom: CONTENT_BOTTOM_PADDING }}>
      <View className='justify-center px-2' style={{ height: HEADER_HEIGHT }}>
        <Text className='text-[17px] font-semibold text-bottomsheet-text-header'>Filters</Text>
      </View>

      <ActionRow
        label='Mark as read'
        icon={<CheckCheck size={ICON_SIZE} color={foreground} strokeWidth={2} />}
        onPress={onMarkAsRead}
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
        classNames={SHEET_SEGMENTS}
      />
      <PersonRow onPress={onChoosePerson} />

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
        classNames={SHEET_SEGMENTS}
      />
    </View>
  );
}
