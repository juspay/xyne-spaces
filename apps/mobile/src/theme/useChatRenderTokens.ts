import { useMemo } from 'react';
import { useCSSVariable } from 'uniwind';

import {
  DEFAULT_CHAT_RENDER_TOKENS,
  DEFAULT_FLOW_CARD_QUESTION_COLORS,
  DEFAULT_FLOW_CARD_STEP_COLORS,
  DEFAULT_PR_BADGE_PALETTE,
  DEFAULT_USERNAME_PALETTE,
  CALL_MESSAGE_COLOR_VAR_NAMES,
  CHAT_SURFACE_COLOR_VAR_NAMES,
  FLOW_CARD_COLOR_VAR_NAMES,
  PR_BADGE_COLOR_VAR_NAMES,
  SYSTEM_MESSAGE_COLOR_VAR_NAMES,
  USERNAME_COLOR_VAR_NAMES,
  type ChatRenderTokens,
} from '@/src/theme/chatRenderTokens';
import { useSelectedChatBubbleContentTokens } from '@/src/theme/useSelectedChatBubbleContentTokens';

const FALLBACK_CHAT_RENDER_TOKENS: ChatRenderTokens = {
  ...DEFAULT_CHAT_RENDER_TOKENS,
  windowWidth: 360,
};

const isResolvedColor = (value: string | undefined): value is string =>
  typeof value === 'string' && value.trim().length > 0 && !value.startsWith('var(');

const resolveTokenColor = (value: string | undefined, fallback: string): string =>
  isResolvedColor(value) ? value : fallback;

/**
 * Resolve the chat paint token set once per list (not per row).
 * Adopted verbatim from v2 `chat-render-tokens.ts`.
 */
export function useChatRenderTokens(windowWidth: number): ChatRenderTokens {
  const { selectedBubbleBg, tokens: bubbleContentTokens } = useSelectedChatBubbleContentTokens();
  const foreground = useCSSVariable('--color-foreground') as string;
  const foregroundMuted = useCSSVariable('--color-muted') as string;
  const rootTextOther = useCSSVariable('--color-conversation-composer-root-text-other') as string;
  const cardBg = useCSSVariable('--color-card') as string;
  const brand = useCSSVariable('--color-brand') as string;
  const mutedForeground = useCSSVariable('--color-muted-foreground') as string;
  const forwardedBgUser = useCSSVariable(
    '--color-conversation-composer-forwarded-bg-user',
  ) as string;
  const forwardedBgOther = useCSSVariable(
    '--color-conversation-composer-forwarded-bg-other',
  ) as string;
  const ticketPriorityLowColor = useCSSVariable('--color-ticket-priority-low') as string;
  const ticketPriorityMediumColor = useCSSVariable('--color-ticket-priority-medium') as string;
  const ticketPriorityHighColor = useCSSVariable('--color-ticket-priority-high') as string;
  const ticketPriorityCriticalColor = useCSSVariable('--color-ticket-priority-critical') as string;
  const tableHeaderBg = useCSSVariable('--color-tertiary-bg') as string;
  const tableBorderColor = useCSSVariable('--color-border') as string;
  // Whole username palette in a single array hook instead of per-row color subscriptions.
  const usernamePaletteRaw = useCSSVariable(
    USERNAME_COLOR_VAR_NAMES as unknown as string[],
  ) as string[];
  const prBadgeColorsRaw = useCSSVariable(
    PR_BADGE_COLOR_VAR_NAMES as unknown as string[],
  ) as string[];
  const flowCardColorsRaw = useCSSVariable(
    FLOW_CARD_COLOR_VAR_NAMES as unknown as string[],
  ) as string[];
  const chatSurfaceColorsRaw = useCSSVariable(
    CHAT_SURFACE_COLOR_VAR_NAMES as unknown as string[],
  ) as string[];
  const systemMessageColorsRaw = useCSSVariable(
    SYSTEM_MESSAGE_COLOR_VAR_NAMES as unknown as string[],
  ) as string[];
  const callMessageColorsRaw = useCSSVariable(
    CALL_MESSAGE_COLOR_VAR_NAMES as unknown as string[],
  ) as string[];

  return useMemo<ChatRenderTokens>(() => {
    return {
      foreground: resolveTokenColor(foreground, FALLBACK_CHAT_RENDER_TOKENS.foreground),
      foregroundMuted: resolveTokenColor(
        foregroundMuted,
        FALLBACK_CHAT_RENDER_TOKENS.foregroundMuted,
      ),
      rootTextUser: bubbleContentTokens.rootTextUser,
      rootTextOther: resolveTokenColor(rootTextOther, FALLBACK_CHAT_RENDER_TOKENS.rootTextOther),
      rootMetaUser: bubbleContentTokens.rootMetaUser,
      rootAccentUser: bubbleContentTokens.rootAccentUser,
      cardBg: resolveTokenColor(cardBg, FALLBACK_CHAT_RENDER_TOKENS.cardBg),
      systemText: resolveTokenColor(
        systemMessageColorsRaw?.[0],
        FALLBACK_CHAT_RENDER_TOKENS.systemText,
      ),
      callIconColor: resolveTokenColor(
        callMessageColorsRaw?.[0],
        FALLBACK_CHAT_RENDER_TOKENS.callIconColor,
      ),
      borderColor: resolveTokenColor(
        chatSurfaceColorsRaw?.[0],
        FALLBACK_CHAT_RENDER_TOKENS.borderColor,
      ),
      chatCardColor: resolveTokenColor(
        chatSurfaceColorsRaw?.[1],
        FALLBACK_CHAT_RENDER_TOKENS.chatCardColor,
      ),
      popoverColor: resolveTokenColor(
        chatSurfaceColorsRaw?.[2],
        FALLBACK_CHAT_RENDER_TOKENS.popoverColor,
      ),
      brand: resolveTokenColor(brand, FALLBACK_CHAT_RENDER_TOKENS.brand),
      ambientAccentColor: bubbleContentTokens.ambientAccentColor,
      linkColor: bubbleContentTokens.ambientAccentColor,
      linkColorUser: bubbleContentTokens.linkColorUser,
      inlineContentMaxWidth: Math.max(120, windowWidth * 0.78 - 12),
      windowWidth,
      actionPrimaryColor: bubbleContentTokens.ambientActionBg,
      mutedForeground: resolveTokenColor(
        mutedForeground,
        FALLBACK_CHAT_RENDER_TOKENS.mutedForeground,
      ),
      forwardedBgUser: resolveTokenColor(
        forwardedBgUser,
        FALLBACK_CHAT_RENDER_TOKENS.forwardedBgUser,
      ),
      forwardedBgOther: resolveTokenColor(
        forwardedBgOther,
        FALLBACK_CHAT_RENDER_TOKENS.forwardedBgOther,
      ),
      embeddedBgUser: bubbleContentTokens.embeddedBgUser,
      embeddedTitleUser: bubbleContentTokens.embeddedTitleUser,
      embeddedMutedUser: bubbleContentTokens.embeddedMutedUser,
      ticketPriorityLowColor: resolveTokenColor(
        ticketPriorityLowColor,
        FALLBACK_CHAT_RENDER_TOKENS.ticketPriorityLowColor,
      ),
      ticketPriorityMediumColor: resolveTokenColor(
        ticketPriorityMediumColor,
        FALLBACK_CHAT_RENDER_TOKENS.ticketPriorityMediumColor,
      ),
      ticketPriorityHighColor: resolveTokenColor(
        ticketPriorityHighColor,
        FALLBACK_CHAT_RENDER_TOKENS.ticketPriorityHighColor,
      ),
      ticketPriorityCriticalColor: resolveTokenColor(
        ticketPriorityCriticalColor,
        FALLBACK_CHAT_RENDER_TOKENS.ticketPriorityCriticalColor,
      ),
      currentUserBubbleBg: resolveTokenColor(
        selectedBubbleBg,
        FALLBACK_CHAT_RENDER_TOKENS.currentUserBubbleBg,
      ),
      tableHeaderBg: resolveTokenColor(tableHeaderBg, FALLBACK_CHAT_RENDER_TOKENS.tableHeaderBg),
      tableBorderColor: resolveTokenColor(
        tableBorderColor,
        FALLBACK_CHAT_RENDER_TOKENS.tableBorderColor,
      ),
      usernamePalette: USERNAME_COLOR_VAR_NAMES.map((_, index) =>
        resolveTokenColor(
          usernamePaletteRaw?.[index],
          DEFAULT_USERNAME_PALETTE[index] ?? DEFAULT_USERNAME_PALETTE[0] ?? '#1B8755',
        ),
      ),
      prBadgePalette: {
        created: {
          background: resolveTokenColor(
            prBadgeColorsRaw?.[0],
            DEFAULT_PR_BADGE_PALETTE.created.background,
          ),
          foreground: resolveTokenColor(
            prBadgeColorsRaw?.[1],
            DEFAULT_PR_BADGE_PALETTE.created.foreground,
          ),
        },
        merged: {
          background: resolveTokenColor(
            prBadgeColorsRaw?.[2],
            DEFAULT_PR_BADGE_PALETTE.merged.background,
          ),
          foreground: resolveTokenColor(
            prBadgeColorsRaw?.[3],
            DEFAULT_PR_BADGE_PALETTE.merged.foreground,
          ),
        },
        danger: {
          background: resolveTokenColor(
            prBadgeColorsRaw?.[4],
            DEFAULT_PR_BADGE_PALETTE.danger.background,
          ),
          foreground: resolveTokenColor(
            prBadgeColorsRaw?.[5],
            DEFAULT_PR_BADGE_PALETTE.danger.foreground,
          ),
        },
      },
      flowCardStepColors: {
        checkedFill: resolveTokenColor(
          flowCardColorsRaw?.[0],
          DEFAULT_FLOW_CARD_STEP_COLORS.checkedFill,
        ),
        checkIcon: resolveTokenColor(
          flowCardColorsRaw?.[1],
          DEFAULT_FLOW_CARD_STEP_COLORS.checkIcon,
        ),
        emptyBorder: resolveTokenColor(
          flowCardColorsRaw?.[2],
          DEFAULT_FLOW_CARD_STEP_COLORS.emptyBorder,
        ),
        spinner: resolveTokenColor(flowCardColorsRaw?.[3], DEFAULT_FLOW_CARD_STEP_COLORS.spinner),
        failedFill: resolveTokenColor(
          flowCardColorsRaw?.[4],
          DEFAULT_FLOW_CARD_STEP_COLORS.failedFill,
        ),
        failedIcon: resolveTokenColor(
          flowCardColorsRaw?.[5],
          DEFAULT_FLOW_CARD_STEP_COLORS.failedIcon,
        ),
      },
      flowCardQuestionColors: {
        borderDefault: resolveTokenColor(
          flowCardColorsRaw?.[6],
          DEFAULT_FLOW_CARD_QUESTION_COLORS.borderDefault,
        ),
        borderSelected: foreground,
        rowBackground: resolveTokenColor(
          flowCardColorsRaw?.[7],
          DEFAULT_FLOW_CARD_QUESTION_COLORS.rowBackground,
        ),
        indicatorFill: resolveTokenColor(
          flowCardColorsRaw?.[0],
          DEFAULT_FLOW_CARD_QUESTION_COLORS.indicatorFill,
        ),
        indicatorCheck: resolveTokenColor(
          flowCardColorsRaw?.[1],
          DEFAULT_FLOW_CARD_QUESTION_COLORS.indicatorCheck,
        ),
        indicatorEmpty: resolveTokenColor(
          flowCardColorsRaw?.[2],
          DEFAULT_FLOW_CARD_QUESTION_COLORS.indicatorEmpty,
        ),
        plusIcon: mutedForeground,
        inputBorder: resolveTokenColor(
          flowCardColorsRaw?.[6],
          DEFAULT_FLOW_CARD_QUESTION_COLORS.inputBorder,
        ),
        inputText: foreground,
        inputBackground: resolveTokenColor(
          flowCardColorsRaw?.[8],
          DEFAULT_FLOW_CARD_QUESTION_COLORS.inputBackground,
        ),
        inputPlaceholder: mutedForeground,
      },
      mentionPalette: {
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
  }, [
    brand,
    bubbleContentTokens,
    cardBg,
    callMessageColorsRaw,
    chatSurfaceColorsRaw,
    forwardedBgOther,
    forwardedBgUser,
    foreground,
    foregroundMuted,
    flowCardColorsRaw,
    mutedForeground,
    prBadgeColorsRaw,
    rootTextOther,
    selectedBubbleBg,
    systemMessageColorsRaw,
    ticketPriorityLowColor,
    ticketPriorityMediumColor,
    ticketPriorityHighColor,
    ticketPriorityCriticalColor,
    tableBorderColor,
    tableHeaderBg,
    usernamePaletteRaw,
    windowWidth,
  ]);
}
