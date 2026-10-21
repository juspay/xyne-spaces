import { memo, useCallback, useEffect, type ReactElement } from 'react';
import { Pressable, View, Text } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { ChevronDown, Folder, Hash, MoreVertical, Star } from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';
import { ChannelListUnreadBadge } from './channel-list-unread-badge';
import { ListRowPressable } from '@/src/components/ui/list-row-pressable';
import { haptics } from '@/src/utils/haptics';
import {
  CHANNEL_ICON_GLYPH_SIZE,
  CHANNEL_ICON_SIZE,
  CHANNEL_ROW_GUTTER,
  SECTION_DIVIDER_WIDTH,
  SECTION_HEADER_HEIGHT,
} from './channel-list-layout';

export type ChannelGroupGlyph = 'folder' | 'star' | 'hash';

type ChannelGroupHeaderProps = {
  title: string;
  glyph: ChannelGroupGlyph;
  unreadCount: number;
  channelCount: number;
  isCollapsed: boolean;
  /** The first header has nothing above it to divide it from, so it draws no rule. */
  isFirstGroup: boolean;
  onToggle: () => void;
  /** Omitted for the built-in groups, which have nothing to rename or delete. */
  onMorePress?: (() => void) | undefined;
};

const GLYPH_COMPONENTS = {
  folder: Folder,
  star: Star,
  hash: Hash,
} as const;

/**
 * An expanded group's glyph is filled in, so the icon column alone says which
 * groups are open. Hash is four bare lines with no interior to fill, so it
 * carries the same weight shift as a heavier stroke instead.
 */
const GLYPH_STROKE_WIDTH = 2;
const HASH_EXPANDED_STROKE_WIDTH = 2.75;

const getGlyphFillProps = (
  glyph: ChannelGroupGlyph,
  color: string,
  isExpanded: boolean,
): { fill: string; strokeWidth: number } => {
  if (!isExpanded) {
    return { fill: 'none', strokeWidth: GLYPH_STROKE_WIDTH };
  }

  return glyph === 'hash'
    ? { fill: 'none', strokeWidth: HASH_EXPANDED_STROKE_WIDTH }
    : { fill: color, strokeWidth: GLYPH_STROKE_WIDTH };
};

/**
 * Accordion header opening a group of channels, mirroring Slack's sidebar. It
 * borrows the channel row's gutter and icon box, so its glyph shares a column
 * with the rows' Hash / Lock glyphs and its title shares one with their names —
 * the rows below need no indent to read as belonging to it. Rules above and
 * below bound the group instead; the chevron and the overflow menu sit on the
 * trailing edge.
 */
function ChannelGroupHeaderComponent({
  title,
  glyph,
  unreadCount,
  channelCount,
  isCollapsed,
  isFirstGroup,
  onToggle,
  onMorePress,
}: ChannelGroupHeaderProps): ReactElement {
  const mutedColor = useCSSVariable('--color-secondary-foreground') as string;
  const borderColor = useCSSVariable('--color-border') as string;
  const chevronRotation = useSharedValue(isCollapsed ? 0 : 180);

  useEffect(() => {
    chevronRotation.value = withTiming(isCollapsed ? 0 : 180, {
      duration: 180,
      easing: Easing.out(Easing.cubic),
    });
  }, [isCollapsed, chevronRotation]);

  const chevronStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${chevronRotation.value}deg` }],
  }));

  const handleMorePress = useCallback((): void => {
    void haptics.buttonTap();
    onMorePress?.();
  }, [onMorePress]);

  const GlyphIcon = GLYPH_COMPONENTS[glyph];
  const glyphFillProps = getGlyphFillProps(glyph, mutedColor, !isCollapsed);

  return (
    /* The whole row is the toggle, so the press feedback spans it edge to edge.
       The chevron and the overflow button are nested Pressables — they capture
       their own touches, so the row never double-fires underneath them. */
    <ListRowPressable
      onPress={onToggle}
      className='flex-row items-center bg-tabs-screen'
      accessibilityLabel={`${title} group, ${isCollapsed ? 'collapsed' : 'expanded'}`}
      style={{
        height: SECTION_HEADER_HEIGHT,
        paddingLeft: CHANNEL_ROW_GUTTER,
        // The chevron's 32px box already carries 8px around its glyph, so 4px
        // here lands the glyph on the channel rows' `pr-3` edge.
        paddingRight: 4,
        // One rule per boundary, drawn by the header below it — never a rule
        // under a header, so the list's bottom stays open and two rules can
        // never stack. The rule sits flush on the row's top edge, as Slack's do.
        borderTopWidth: isFirstGroup ? 0 : SECTION_DIVIDER_WIDTH,
        borderColor,
      }}
    >
      <View
        className='items-center justify-center'
        style={{ width: CHANNEL_ICON_SIZE, height: CHANNEL_ICON_SIZE }}
      >
        {/* Always the glyph, never the section's emoji. A custom emoji is an
            API-hosted image here, so its stored value would render as a literal
            `:shortcode:`; a folder is also what keeps the icon column uniform
            and lets every header show its expanded state by filling in. */}
        <GlyphIcon color={mutedColor} size={CHANNEL_ICON_GLYPH_SIZE} {...glyphFillProps} />
      </View>

      <View className='flex-1 flex-row items-center h-full min-w-0 ml-3'>
        <Text
          className='text-[13px] font-semibold uppercase tracking-[0.8px] text-foreground shrink'
          numberOfLines={1}
        >
          {title}
        </Text>
        {isCollapsed && channelCount > 0 && (
          <Text className='ml-2 text-[12px] font-medium text-muted'>{channelCount}</Text>
        )}
      </View>

      {isCollapsed && unreadCount > 0 && (
        <View className='mr-1'>
          <ChannelListUnreadBadge count={unreadCount} />
        </View>
      )}

      {onMorePress ? (
        <Pressable
          accessibilityRole='button'
          accessibilityLabel={`${title} section options`}
          onPress={handleMorePress}
          className='items-center justify-center w-9 active:opacity-60'
          style={{ height: SECTION_HEADER_HEIGHT }}
          hitSlop={6}
        >
          <MoreVertical size={16} color={mutedColor} />
        </Pressable>
      ) : null}

      {/* Purely an affordance — the row itself is the toggle, so making this a
          Pressable would only punch a dead spot in the row's press feedback. */}
      <Animated.View
        className='items-center justify-center w-8'
        style={[chevronStyle, { height: SECTION_HEADER_HEIGHT }]}
      >
        <ChevronDown size={16} color={mutedColor} strokeWidth={2.5} />
      </Animated.View>
    </ListRowPressable>
  );
}

export const ChannelGroupHeader = memo(ChannelGroupHeaderComponent);
