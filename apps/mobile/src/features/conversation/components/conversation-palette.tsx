import { createContext, useContext, useMemo, type ReactElement, type ReactNode } from 'react';
import { useCSSVariable } from 'uniwind';

import { useChatRenderTokens } from '@/src/features/chat/v2/components/chat/message-row';
import type { ChatRenderTokens } from '@/src/theme/chatRenderTokens';

import { MESSAGE_BODY_HORIZONTAL_CHROME, RENDERER_BUBBLE_PADDING } from '../constants';

type ConversationPalette = {
  foreground: string;
  muted: string;
  surface: string;
  mention: string;
  mentionSurface: string;
  mentionSelf: string;
  mentionSelfSurface: string;
};

const PaletteContext = createContext<ConversationPalette | null>(null);

/**
 * The spaces colours the shared message renderers read, resolved once for the
 * screen so a row pays a context read instead of a CSS-variable subscription.
 */
export function ConversationPaletteProvider({ children }: { children: ReactNode }): ReactElement {
  const foreground = useCSSVariable('--color-spaces-foreground') as string;
  const muted = useCSSVariable('--color-spaces-muted') as string;
  const surface = useCSSVariable('--color-spaces-surface') as string;
  const mention = useCSSVariable('--color-spaces-mention') as string;
  const mentionSurface = useCSSVariable('--color-spaces-mention-surface') as string;
  const mentionSelf = useCSSVariable('--color-spaces-mention-self') as string;
  const mentionSelfSurface = useCSSVariable('--color-spaces-mention-self-surface') as string;

  const palette = useMemo(
    () => ({
      foreground,
      muted,
      surface,
      mention,
      mentionSurface,
      mentionSelf,
      mentionSelfSurface,
    }),
    [foreground, muted, surface, mention, mentionSurface, mentionSelf, mentionSelfSurface],
  );

  return <PaletteContext.Provider value={palette}>{children}</PaletteContext.Provider>;
}

/**
 * The list's render tokens, re-coloured for the flat layout and re-measured for
 * a body that has no bubble. Without a palette (a row rendered outside the
 * conversation screens) the tokens pass through untouched.
 */
export function useConversationRenderTokens(): ChatRenderTokens {
  const base = useChatRenderTokens();
  const palette = useContext(PaletteContext);

  return useMemo(() => {
    if (!palette) return base;
    return {
      ...base,
      foreground: palette.foreground,
      foregroundMuted: palette.muted,
      mutedForeground: palette.muted,
      rootTextUser: palette.foreground,
      rootTextOther: palette.foreground,
      rootMetaUser: palette.muted,
      rootAccentUser: palette.mention,
      linkColor: palette.mention,
      linkColorUser: palette.mention,
      actionPrimaryColor: palette.mention,
      cardBg: palette.surface,
      inlineContentMaxWidth:
        base.windowWidth - MESSAGE_BODY_HORIZONTAL_CHROME + RENDERER_BUBBLE_PADDING,
      mentionPalette: {
        otherBg: palette.mentionSurface,
        otherText: palette.mention,
        currentOtherBg: palette.mentionSurface,
        currentOtherText: palette.mention,
        mentionedYouBg: palette.mentionSelfSurface,
        mentionedYouText: palette.mentionSelf,
        currentSelfBg: palette.mentionSelfSurface,
        currentSelfText: palette.mentionSelf,
      },
    };
  }, [base, palette]);
}
