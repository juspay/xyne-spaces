import { DEFAULT_CHAT_BUBBLE_OPTION } from '@/src/theme/chatBubbleTheme';
import { deriveChatBubbleContentTokens } from '@/src/theme/chatBubbleContentTokens';

export type MentionedYouColors = {
  mentionedYouBg: string;
  mentionedYouText: string;
};

/**
 * How an activity body draws a mention of *you*: the colour the default chat
 * bubble theme gives the same case — a soft yellow in light mode, a muted gold
 * in dark.
 *
 * The shared mention token is one saturated gold meant for a chat bubble's own
 * background; on an activity row's plain surface it reads as heavy. Both
 * Activity screens take these, rather than the shared token being changed,
 * which chat reads too.
 */
export function mentionedYouColors(theme: string): MentionedYouColors {
  const mode = theme === 'dark' ? 'dark' : 'light';
  const { mentionSelfBgOther, mentionSelfTextOther } = deriveChatBubbleContentTokens(
    mode === 'dark' ? DEFAULT_CHAT_BUBBLE_OPTION.darkColor : DEFAULT_CHAT_BUBBLE_OPTION.lightColor,
    mode,
  );
  return { mentionedYouBg: mentionSelfBgOther, mentionedYouText: mentionSelfTextOther };
}
