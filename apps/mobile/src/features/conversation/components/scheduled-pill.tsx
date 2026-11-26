import { ChevronRight, Clock } from 'lucide-react-native';
import { memo, type ReactElement } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { useCSSVariable } from 'uniwind';

import type { ScheduledBannerViewProps } from '@/src/components/input-composer/upcoming-scheduled-banner';

import {
  SCHEDULED_PILL_GAP,
  SCHEDULED_PILL_HEIGHT,
  SCHEDULED_PILL_ICON_SIZE,
  SCHEDULED_PILL_MARGIN_BOTTOM,
  SCHEDULED_PILL_PADDING_X,
} from '../constants';
import { scheduledPillAccessibilityLabel, scheduledPillLabel } from '../model/schedule-time';
import { colorOf } from '../model/token-color';

/**
 * The room's scheduled-message notice: a quiet pill 8 above
 * the field, in line with it, saying when the next one sends. A tap opens the
 * scheduled list, as the classic strip does.
 */
export const ScheduledPill = memo(function ScheduledPill({
  upcomingCount,
  earliestScheduledFor,
  onPress,
}: ScheduledBannerViewProps): ReactElement {
  const [mutedToken, subtleToken] = useCSSVariable([
    '--color-spaces-muted',
    '--color-spaces-subtle',
  ]);
  const next = new Date(earliestScheduledFor);
  const now = new Date();

  return (
    <Pressable
      accessibilityRole='button'
      accessibilityLabel={scheduledPillAccessibilityLabel(upcomingCount, next, now)}
      onPress={onPress}
      className='max-w-full flex-row items-center self-start rounded-full bg-spaces-surface active:opacity-70'
      style={styles.pill}
    >
      <Clock size={SCHEDULED_PILL_ICON_SIZE} color={colorOf(mutedToken)} />
      <Text numberOfLines={1} className='shrink text-[13px] leading-[18px] text-spaces-muted'>
        {scheduledPillLabel(upcomingCount, next, now)}
      </Text>
      <ChevronRight size={SCHEDULED_PILL_ICON_SIZE} color={colorOf(subtleToken)} />
    </Pressable>
  );
});

const styles = StyleSheet.create({
  pill: {
    height: SCHEDULED_PILL_HEIGHT,
    paddingHorizontal: SCHEDULED_PILL_PADDING_X,
    columnGap: SCHEDULED_PILL_GAP,
    marginBottom: SCHEDULED_PILL_MARGIN_BOTTOM,
  },
});
