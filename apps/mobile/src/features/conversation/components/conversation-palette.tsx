import { createContext, useContext, useMemo, type ReactElement, type ReactNode } from 'react';
import type { MarkdownStyle } from 'react-native-enriched-markdown';
import { useCSSVariable } from 'uniwind';

import { useChatRenderTokens } from '@/src/features/chat/v2/components/chat/message-row';
import { MONO_FONT } from '@/src/features/chat/v2/components/conversation-composer/utils/markdownStyle';
import type { ChatRenderTokens } from '@/src/theme/chatRenderTokens';

import {
  CODE_BLOCK_FONT_SIZE,
  CODE_BLOCK_LINE_HEIGHT,
  CODE_BLOCK_PADDING,
  CODE_BLOCK_RADIUS,
  RENDERER_BUBBLE_PADDING,
} from '../constants';
import { flatBodyWidth } from '../model/row-estimate';

type ConversationPalette = {
  foreground: string;
  muted: string;
  surface: string;
  mention: string;
  mentionSurface: string;
  mentionSelf: string;
  mentionSelfSurface: string;
  /** The "Read more" link under a folded message. */
  readMore: string;
  /** What the rows sit on, for anything that fades into it. */
  rowBackground: string;
  /** A code block in the words: the row's own surface inside a hairline (Figma "Code / Block"). */
  codeBlock: MarkdownStyle['codeBlock'];
  widthInset: number;
  canReact: boolean;
};

const PaletteContext = createContext<ConversationPalette | null>(null);

/**
 * The spaces colours the shared message renderers read, resolved once for the
 * screen so a row pays a context read instead of a CSS-variable subscription.
 */
export function ConversationPaletteProvider({
  children,
  widthInset: ownWidthInset,
  canReact: ownCanReact,
  raised = false,
}: {
  children: ReactNode;
  /**
   * How much narrower than the window the screen's rows are (the thread card's
   * side insets). Omitted, a nested provider keeps its parent's, else 0.
   */
  widthInset?: number;
  /**
   * Whether the user may react here (a joined room); false hides the rows'
   * add-reaction pill. Omitted, a nested provider keeps its parent's, else true.
   */
  canReact?: boolean;
  /** The rows sit on the raised surface (the hold menu's lifted copy) rather than the screen. */
  raised?: boolean;
}): ReactElement {
  const parent = useContext(PaletteContext);
  const widthInset = ownWidthInset ?? parent?.widthInset ?? 0;
  const canReact = ownCanReact ?? parent?.canReact ?? true;
  const foreground = useCSSVariable('--color-spaces-foreground') as string;
  const muted = useCSSVariable('--color-spaces-muted') as string;
  const surface = useCSSVariable('--color-spaces-surface') as string;
  const mention = useCSSVariable('--color-spaces-mention') as string;
  const mentionSurface = useCSSVariable('--color-spaces-mention-surface') as string;
  const mentionSelf = useCSSVariable('--color-spaces-mention-self') as string;
  const mentionSelfSurface = useCSSVariable('--color-spaces-mention-self-surface') as string;
  const readMore = useCSSVariable('--color-spaces-read-more') as string;
  const background = useCSSVariable('--color-spaces-background') as string;
  const surfaceRaised = useCSSVariable('--color-spaces-surface-raised') as string;
  const outline = useCSSVariable('--color-spaces-outline') as string;
  const rowBackground = raised ? surfaceRaised : background;

  const palette = useMemo(
    () => ({
      foreground,
      muted,
      surface,
      mention,
      mentionSurface,
      mentionSelf,
      mentionSelfSurface,
      readMore,
      rowBackground,
      codeBlock: {
        fontFamily: MONO_FONT,
        fontSize: CODE_BLOCK_FONT_SIZE,
        lineHeight: CODE_BLOCK_LINE_HEIGHT,
        color: foreground,
        backgroundColor: rowBackground,
        borderColor: outline,
        borderWidth: 1,
        borderRadius: CODE_BLOCK_RADIUS,
        padding: CODE_BLOCK_PADDING,
      },
      widthInset,
      canReact,
    }),
    [
      foreground,
      muted,
      surface,
      mention,
      mentionSurface,
      mentionSelf,
      mentionSelfSurface,
      readMore,
      rowBackground,
      outline,
      widthInset,
      canReact,
    ],
  );

  return <PaletteContext.Provider value={palette}>{children}</PaletteContext.Provider>;
}

/** The screen's resolved colours; only for parts that render inside a conversation screen. */
export function useConversationPalette(): ConversationPalette {
  const palette = useContext(PaletteContext);
  if (!palette) throw new Error('useConversationPalette needs a ConversationPaletteProvider');
  return palette;
}

/** What the rows sit on; undefined outside the conversation screens. */
export function useConversationRowBackground(): string | undefined {
  return useContext(PaletteContext)?.rowBackground;
}

/** Whether the rows may offer reacting; true outside the conversation screens. */
export function useConversationCanReact(): boolean {
  return useContext(PaletteContext)?.canReact ?? true;
}

/** The flat body's width: the window, less the screen's inset and the row's own chrome. */
export function useConversationBodyWidth(): number {
  const { windowWidth } = useChatRenderTokens();
  const widthInset = useContext(PaletteContext)?.widthInset ?? 0;
  return flatBodyWidth(windowWidth - widthInset);
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
      // Own forwarded / replied-to-thread blocks; the classic ones derive from the bubble colour.
      embeddedBgUser: palette.surface,
      embeddedTitleUser: palette.foreground,
      embeddedMutedUser: palette.muted,
      inlineContentMaxWidth:
        flatBodyWidth(base.windowWidth - palette.widthInset) + RENDERER_BUBBLE_PADDING,
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
