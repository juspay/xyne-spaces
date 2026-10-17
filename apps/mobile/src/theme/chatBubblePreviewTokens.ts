import type { ChatRenderTokens } from '@/src/theme/chatRenderTokens';
import { deriveChatBubbleContentTokens } from '@/src/theme/chatBubbleContentTokens';

/**
 * Overlays a candidate bubble color onto a resolved {@link ChatRenderTokens} set.
 *
 * Pure so the chat bubble preview screen can build every page's tokens up front instead of
 * subscribing to CSS variables once per rendered page.
 */
export const buildChatBubblePreviewTokens = (
  baseTokens: ChatRenderTokens,
  color: string,
  theme: string,
): ChatRenderTokens => {
  const bubbleContentTokens = deriveChatBubbleContentTokens(color, theme);

  return {
    ...baseTokens,
    ambientAccentColor: bubbleContentTokens.ambientAccentColor,
    linkColor: bubbleContentTokens.ambientAccentColor,
    linkColorUser: bubbleContentTokens.linkColorUser,
    actionPrimaryColor: bubbleContentTokens.ambientActionBg,
    currentUserBubbleBg: color,
    rootTextUser: bubbleContentTokens.rootTextUser,
    rootMetaUser: bubbleContentTokens.rootMetaUser,
    rootAccentUser: bubbleContentTokens.rootAccentUser,
    embeddedBgUser: bubbleContentTokens.embeddedBgUser,
    embeddedTitleUser: bubbleContentTokens.embeddedTitleUser,
    embeddedMutedUser: bubbleContentTokens.embeddedMutedUser,
    mentionPalette: {
      ...baseTokens.mentionPalette,
      otherBg: bubbleContentTokens.ambientMentionBg,
      otherText: bubbleContentTokens.ambientMentionText,
      currentOtherBg: bubbleContentTokens.mentionOtherBgUser,
      currentOtherText: bubbleContentTokens.mentionOtherTextUser,
      mentionedYouBg: bubbleContentTokens.mentionSelfBgOther,
      mentionedYouText: bubbleContentTokens.mentionSelfTextOther,
      currentSelfBg: bubbleContentTokens.mentionSelfBgUser,
      currentSelfText: bubbleContentTokens.mentionSelfTextUser,
    },
  };
};
