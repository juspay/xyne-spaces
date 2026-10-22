import {
  AtSign,
  Bell,
  CalendarDays,
  Clock,
  CircleHelp,
  MessageCircle,
  Reply,
  Sparkles,
  Target,
  UserPlus,
  type LucideIcon,
} from 'lucide-react-native';
import { memo, type ReactElement } from 'react';
import { View } from 'react-native';
import { useCSSVariable } from 'uniwind';

import { ReactionEmojiDisplay } from '@/src/components/chat/message/reactions/reaction-emoji-display';

import { ACTIVITY_BADGE_ICON_SIZE, ACTIVITY_BADGE_SIZE } from '../constants';
import type { ActivityBadgeKind } from '../model/row';

type Tone = { readonly Icon: LucideIcon; readonly bg: string; readonly fg: string };

/**
 * One tone per kind, from the activity tokens the classic cards already use, so
 * both themes are covered without a color decided here.
 */
const MENTION: Tone = {
  Icon: AtSign,
  bg: '--color-activity-v2-channel-mention-badge-bg',
  fg: '--color-activity-v2-channel-mention-badge-text',
};
const THREAD: Tone = {
  Icon: Reply,
  bg: '--color-activity-thread-bg',
  fg: '--color-activity-thread-icon',
};
const NEUTRAL: Tone = {
  Icon: Bell,
  bg: '--color-activity-v2-reaction-badge-bg',
  fg: '--color-activity-description',
};
const DEADLINE: Tone = {
  Icon: Clock,
  bg: '--color-activity-call-update-bg',
  fg: '--color-activity-call-update-icon',
};

const TONES: Readonly<Record<ActivityBadgeKind, Tone>> = {
  mention: MENTION,
  canvas: {
    ...MENTION,
    bg: '--color-activity-v2-user-mention-badge-bg',
    fg: '--color-activity-v2-user-mention-badge-text',
  },
  reply: THREAD,
  message: { ...THREAD, Icon: MessageCircle },
  reaction: { ...NEUTRAL, fg: '--color-activity-heading' },
  ticket: { ...NEUTRAL, Icon: Target },
  assignment: { ...NEUTRAL, Icon: UserPlus },
  eta: DEADLINE,
  workflow: { ...DEADLINE, Icon: CircleHelp },
  call: {
    Icon: CalendarDays,
    bg: '--color-activity-call-bg',
    fg: '--color-activity-call-icon',
  },
  default: NEUTRAL,
  summary: { ...NEUTRAL, Icon: Sparkles },
};

type ActivityBadgeProps = {
  kind: ActivityBadgeKind;
  reactionEmoji: string | null;
};

/**
 * The round marker on an avatar that says what happened.
 *
 * Memoised on its two primitives, so a row whose badge did not change never
 * re-renders it when the rest of the row does.
 */
export const ActivityBadge = memo(function ActivityBadge({
  kind,
  reactionEmoji,
}: ActivityBadgeProps): ReactElement {
  const tone = TONES[kind];
  const background = useCSSVariable(tone.bg) as string;
  const foreground = useCSSVariable(tone.fg) as string;

  return (
    <View
      className='items-center justify-center rounded-full'
      style={{
        width: ACTIVITY_BADGE_SIZE,
        height: ACTIVITY_BADGE_SIZE,
        backgroundColor: background,
      }}
    >
      {kind === 'reaction' && reactionEmoji ? (
        <ReactionEmojiDisplay emojiName={reactionEmoji} size={ACTIVITY_BADGE_ICON_SIZE} />
      ) : (
        <tone.Icon size={ACTIVITY_BADGE_ICON_SIZE} color={foreground} strokeWidth={2.4} />
      )}
    </View>
  );
});
