import { ChevronDown, Ellipsis } from 'lucide-react-native';
import { memo, useEffect, useState, type ReactElement } from 'react';
import { InteractionManager, Pressable, Text, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { useCSSVariable } from 'uniwind';

import { haptics } from '@/src/utils/haptics';

import {
  CHANNEL_ROW_HEIGHT,
  CHANNEL_ROW_PADDING_X,
  SECTION_CHEVRON_SIZE,
  SECTION_MORE_ICON_SIZE,
  SECTION_HEADER_HEIGHT,
  SECTION_TITLE_SIZE,
  SECTION_TOGGLE_MS,
} from '../constants';
import { useChannelActions } from '../hooks/use-channel-actions';
import type { ChannelGroup } from '../model/layout';
import { openSectionOptions } from '../state/section-picker-store';
import { ChannelRow } from './channel-row';

const TOGGLE = { duration: SECTION_TOGGLE_MS, easing: Easing.out(Easing.cubic) } as const;

/**
 * Whether the group's rows are in the tree.
 *
 * Expanding has to be nothing but an animation. If the rows were mounted at
 * the moment the group opened, the JS thread would be busy building them for
 * exactly the frames the height is meant to be easing open — a sudden jump, and
 * worse the more channels the group holds. So a group that starts collapsed
 * mounts its rows once the app is idle, and from then on they stay mounted:
 * folding and unfolding only move height and opacity.
 */
function useRowsMounted(isCollapsed: boolean): boolean {
  const [isWarm, setIsWarm] = useState(!isCollapsed);

  useEffect(() => {
    if (isWarm) return undefined;
    if (!isCollapsed) {
      setIsWarm(true);
      return undefined;
    }
    const handle = InteractionManager.runAfterInteractions(() => setIsWarm(true));
    return (): void => handle.cancel();
  }, [isCollapsed, isWarm]);

  return isWarm || !isCollapsed;
}

function Header({ group }: { group: ChannelGroup }): ReactElement {
  const { toggleGroup } = useChannelActions();
  const muted = useCSSVariable('--color-spaces-muted') as string;

  const isCollapsed = group.isCollapsed;
  const chevronStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: withTiming(isCollapsed ? '-90deg' : '0deg', TOGGLE) }],
  }));

  return (
    <View
      className='flex-row items-center'
      style={{ height: SECTION_HEADER_HEIGHT, paddingHorizontal: CHANNEL_ROW_PADDING_X }}
    >
      <Pressable
        accessibilityRole='button'
        accessibilityState={{ expanded: !group.isCollapsed }}
        accessibilityLabel={group.title}
        onPress={() => toggleGroup(group)}
        className='h-full flex-1 flex-row items-center gap-1.5'
      >
        <Text
          numberOfLines={1}
          style={{ fontSize: SECTION_TITLE_SIZE, fontWeight: '500' }}
          className='shrink text-spaces-muted'
        >
          {group.title}
        </Text>
        <Animated.View style={chevronStyle}>
          <ChevronDown size={SECTION_CHEVRON_SIZE} color={muted} strokeWidth={2.2} />
        </Animated.View>
      </Pressable>
      {/* Only a section has settings; Channels is the catch-all and has none. */}
      {group.kind === 'section' ? (
        <Pressable
          accessibilityRole='button'
          accessibilityLabel={`${group.title} options`}
          hitSlop={8}
          onPress={() => {
            void haptics.selection();
            openSectionOptions(group.id);
          }}
          className='h-full items-center justify-center pl-3'
        >
          <Ellipsis size={SECTION_MORE_ICON_SIZE} color={muted} strokeWidth={2.2} />
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * Height and opacity follow the group's collapsed flag through one timing, so
 * the rows and the chevron move together and the groups below ride up with
 * them. Height comes from the row count because a row is a fixed size.
 */
function Body({ group }: { group: ChannelGroup }): ReactElement {
  const isCollapsed = group.isCollapsed;
  const rowsMounted = useRowsMounted(isCollapsed);
  const expandedHeight = group.channelIds.length * CHANNEL_ROW_HEIGHT;

  const style = useAnimatedStyle(() => ({
    height: withTiming(isCollapsed ? 0 : expandedHeight, TOGGLE),
    opacity: withTiming(isCollapsed ? 0 : 1, TOGGLE),
  }));

  return (
    <Animated.View
      style={[{ overflow: 'hidden' }, style]}
      pointerEvents={isCollapsed ? 'none' : 'auto'}
      importantForAccessibility={isCollapsed ? 'no-hide-descendants' : 'auto'}
    >
      {rowsMounted ? group.channelIds.map(id => <ChannelRow key={id} id={id} />) : null}
    </Animated.View>
  );
}

/**
 * One group: a header and the rows beneath it. `flat` is the headerless list
 * shown when there are no sections, so it is plain rows with nothing to fold.
 */
export const ChannelGroupView = memo(function ChannelGroupView({
  group,
}: {
  group: ChannelGroup;
}): ReactElement {
  if (group.kind === 'flat') {
    return (
      <View>
        {group.channelIds.map(id => (
          <ChannelRow key={id} id={id} />
        ))}
      </View>
    );
  }

  return (
    <View>
      <Header group={group} />
      <Body group={group} />
    </View>
  );
});
