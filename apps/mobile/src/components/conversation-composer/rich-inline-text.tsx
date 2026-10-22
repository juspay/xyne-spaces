import { Fragment, memo, useMemo, type ReactElement, type ReactNode } from 'react';
import { Text, type TextStyle, type ViewStyle } from 'react-native';
import { useCSSVariable } from 'uniwind';
import type { LinkPressEvent, MarkdownStyle } from 'react-native-enriched-markdown';

import {
  MENTION_BROADCAST_SCHEME,
  MENTION_CHANNEL_SCHEME,
  MENTION_GROUP_SCHEME,
  MENTION_USER_SCHEME,
} from './utils/mentionSchemes';
import { parseInlineRich, type InlineNode, type MentionKind } from './utils/parseInlineRich';

type RichInlineTextProps = {
  markdown: string;
  markdownStyle: MarkdownStyle;
  /** Current user id - used with `isOwnMessage` to pick the mention treatment. */
  currentUserId?: string;
  /** Whether the message was authored by the current user (own bubble). */
  isOwnMessage?: boolean;
  onLinkPress?: (event: LinkPressEvent) => void;
  selectable?: boolean;
  containerStyle?: ViewStyle;
  numberOfLines?: number;
};

/**
 * Mention chip colors, one pair per state of the 2x2 (message author x mention
 * target). A mention of *you* in someone else's message
 * is the loudest; your own mentions in your own message are the quietest.
 */
type MentionPalette = {
  otherBg: string;
  otherText: string;
  currentOtherBg: string;
  currentOtherText: string;
  mentionedYouBg: string;
  mentionedYouText: string;
  currentSelfBg: string;
  currentSelfText: string;
};

const FALLBACK_MENTION_PALETTE: MentionPalette = {
  otherBg: '#eef2ff',
  otherText: '#4453a6',
  currentOtherBg: '#d7f3ea',
  currentOtherText: '#2b6b59',
  mentionedYouBg: '#d6a21f',
  mentionedYouText: '#251700',
  currentSelfBg: '#d6a21f',
  currentSelfText: '#251700',
};

const isResolvedColor = (value: string | undefined): value is string =>
  typeof value === 'string' && value.trim().length > 0 && !value.startsWith('var(');

const resolveTokenColor = (value: string | undefined, fallback: string): string =>
  isResolvedColor(value) ? value : fallback;

const MENTION_SCHEME_BY_KIND: Record<MentionKind, string> = {
  user: MENTION_USER_SCHEME,
  channel: MENTION_CHANNEL_SCHEME,
  group: MENTION_GROUP_SCHEME,
  broadcast: MENTION_BROADCAST_SCHEME,
};

/** Rebuild the `xyne://...` url so taps dispatch through the same handler as md4c. */
const mentionUrl = (kind: MentionKind, id: string): string =>
  kind === 'broadcast'
    ? `${MENTION_SCHEME_BY_KIND[kind]}${id}`
    : `${MENTION_SCHEME_BY_KIND[kind]}${encodeURIComponent(id)}`;

/**
 * Resolve a mention's chip colors from the 2x2 of (message author x target):
 * a `@you` user mention, or a broadcast (`@channel`/`@here`) in someone else's
 * message, "targets me". Channel/group mentions are navigational, never "me".
 */
const resolveMentionColors = (
  node: Extract<InlineNode, { type: 'mention' }>,
  palette: MentionPalette,
  currentUserId: string | undefined,
  isOwnMessage: boolean,
): { bg: string; text: string } => {
  const isBroadcastMention = node.mentionKind === 'broadcast';
  const isSelfMention = node.mentionKind === 'user' && !!currentUserId && node.id === currentUserId;
  const targetsMe = isSelfMention || (isBroadcastMention && !isOwnMessage);

  if (isOwnMessage) {
    return isSelfMention || isBroadcastMention
      ? { bg: palette.currentSelfBg, text: palette.currentSelfText }
      : { bg: palette.currentOtherBg, text: palette.currentOtherText };
  }
  return targetsMe
    ? { bg: palette.mentionedYouBg, text: palette.mentionedYouText }
    : { bg: palette.otherBg, text: palette.otherText };
};

type RenderContext = {
  palette: MentionPalette;
  linkColor: string;
  linkUnderline: boolean;
  codeStyle: TextStyle;
  strongColor: string | undefined;
  emColor: string | undefined;
  underlineColor: string | undefined;
  currentUserId: string | undefined;
  isOwnMessage: boolean;
  onLinkPress: ((event: LinkPressEvent) => void) | undefined;
  activeUnderline: boolean;
  activeStrike: boolean;
};

const getTextDecorationLine = ({
  activeUnderline,
  activeStrike,
}: {
  activeUnderline: boolean;
  activeStrike: boolean;
}): TextStyle['textDecorationLine'] => {
  if (activeUnderline && activeStrike) return 'underline line-through';
  if (activeUnderline) return 'underline';
  if (activeStrike) return 'line-through';
  return 'none';
};

const renderNodes = (nodes: InlineNode[], keyPrefix: string, ctx: RenderContext): ReactNode[] =>
  nodes.map((node, index) => {
    const key = `${keyPrefix}.${index}`;
    switch (node.type) {
      case 'text':
        return <Fragment key={key}>{node.text}</Fragment>;

      case 'strong':
        return (
          <Text key={key} style={{ fontWeight: 'bold', color: ctx.strongColor }}>
            {renderNodes(node.children, key, ctx)}
          </Text>
        );

      case 'em':
        return (
          <Text key={key} style={{ fontStyle: 'italic', color: ctx.emColor }}>
            {renderNodes(node.children, key, ctx)}
          </Text>
        );

      case 'underline': {
        const childCtx = { ...ctx, activeUnderline: true };
        return (
          <Text
            key={key}
            style={{
              textDecorationLine: getTextDecorationLine(childCtx),
              color: ctx.underlineColor,
            }}
          >
            {renderNodes(node.children, key, childCtx)}
          </Text>
        );
      }

      case 'strike': {
        const childCtx = { ...ctx, activeStrike: true };
        return (
          <Text key={key} style={{ textDecorationLine: getTextDecorationLine(childCtx) }}>
            {renderNodes(node.children, key, childCtx)}
          </Text>
        );
      }

      case 'code':
        return (
          <Text key={key} style={ctx.codeStyle}>
            {node.text}
          </Text>
        );

      case 'link': {
        const childCtx = {
          ...ctx,
          activeUnderline: ctx.activeUnderline || ctx.linkUnderline,
        };
        return (
          <Text
            key={key}
            style={{
              color: ctx.linkColor,
              textDecorationLine: getTextDecorationLine(childCtx),
            }}
            onPress={
              ctx.onLinkPress ? (): void => ctx.onLinkPress?.({ url: node.href }) : undefined
            }
          >
            {renderNodes(node.children, key, childCtx)}
          </Text>
        );
      }

      case 'mention': {
        const { bg, text } = resolveMentionColors(
          node,
          ctx.palette,
          ctx.currentUserId,
          ctx.isOwnMessage,
        );
        // No explicit fontWeight: the chip inherits the body weight so a mention
        // reads as colored text, not bolder text.
        return (
          <Text
            key={key}
            style={{ backgroundColor: bg, textDecorationLine: 'none' }}
            onPress={
              ctx.onLinkPress
                ? (): void => ctx.onLinkPress?.({ url: mentionUrl(node.mentionKind, node.id) })
                : undefined
            }
          >
            <Text style={{ color: text, textDecorationLine: 'none' }}>{node.label}</Text>
          </Text>
        );
      }

      default:
        return null;
    }
  });

/**
 * Renders the controlled markdown subset emitted by `htmlToMD` into a single
 * native `<Text>` tree.
 *
 * Why this exists: md4c (`EnrichedMarkdownText`) exposes one shared `link`
 * style, so mentions and real hyperlinks are visually identical. Rendering the
 * inline AST ourselves lets mentions carry their own color + highlight while
 * keeping correct text wrapping and a synchronous first
 * paint (no md4c async settle / blink). Block constructs, custom emoji and
 * LaTeX fall back to md4c via `canRenderInlineRich`.
 */
const RichInlineTextComponent = ({
  markdown,
  markdownStyle,
  currentUserId,
  isOwnMessage = false,
  onLinkPress,
  selectable = false,
  containerStyle,
  numberOfLines,
}: RichInlineTextProps): ReactElement => {
  const otherBg = useCSSVariable('--color-chat-mention-inline-other-bg') as string;
  const otherText = useCSSVariable('--color-chat-mention-inline-other-text') as string;
  const currentOtherBg = useCSSVariable('--color-chat-mention-inline-current-other-bg') as string;
  const currentOtherText = useCSSVariable(
    '--color-chat-mention-inline-current-other-text',
  ) as string;
  const mentionedYouBg = useCSSVariable('--color-chat-mention-inline-mentioned-you-bg') as string;
  const mentionedYouText = useCSSVariable(
    '--color-chat-mention-inline-mentioned-you-text',
  ) as string;
  const currentSelfBg = useCSSVariable('--color-chat-mention-inline-current-self-bg') as string;
  const currentSelfText = useCSSVariable('--color-chat-mention-inline-current-self-text') as string;
  const palette = useMemo<MentionPalette>(
    () => ({
      otherBg: resolveTokenColor(otherBg, FALLBACK_MENTION_PALETTE.otherBg),
      otherText: resolveTokenColor(otherText, FALLBACK_MENTION_PALETTE.otherText),
      currentOtherBg: resolveTokenColor(currentOtherBg, FALLBACK_MENTION_PALETTE.currentOtherBg),
      currentOtherText: resolveTokenColor(
        currentOtherText,
        FALLBACK_MENTION_PALETTE.currentOtherText,
      ),
      mentionedYouBg: resolveTokenColor(mentionedYouBg, FALLBACK_MENTION_PALETTE.mentionedYouBg),
      mentionedYouText: resolveTokenColor(
        mentionedYouText,
        FALLBACK_MENTION_PALETTE.mentionedYouText,
      ),
      currentSelfBg: resolveTokenColor(currentSelfBg, FALLBACK_MENTION_PALETTE.currentSelfBg),
      currentSelfText: resolveTokenColor(currentSelfText, FALLBACK_MENTION_PALETTE.currentSelfText),
    }),
    [
      otherBg,
      otherText,
      currentOtherBg,
      currentOtherText,
      mentionedYouBg,
      mentionedYouText,
      currentSelfBg,
      currentSelfText,
    ],
  );

  const nodes = useMemo(() => parseInlineRich(markdown), [markdown]);

  const paragraph = markdownStyle.paragraph;
  const rootStyle = useMemo<TextStyle>(
    () => ({
      ...(paragraph?.fontSize !== undefined ? { fontSize: paragraph.fontSize } : {}),
      ...(paragraph?.color !== undefined ? { color: paragraph.color } : {}),
      ...(paragraph?.lineHeight !== undefined ? { lineHeight: paragraph.lineHeight } : {}),
      ...(paragraph?.fontWeight !== undefined
        ? { fontWeight: paragraph.fontWeight as TextStyle['fontWeight'] }
        : {}),
    }),
    [paragraph?.fontSize, paragraph?.color, paragraph?.lineHeight, paragraph?.fontWeight],
  );

  const children = useMemo(
    () =>
      renderNodes(nodes, 'r', {
        palette,
        linkColor: (markdownStyle.link?.color as string) ?? (paragraph?.color as string),
        linkUnderline: markdownStyle.link?.underline ?? false,
        codeStyle: {
          ...(markdownStyle.code?.fontFamily ? { fontFamily: markdownStyle.code.fontFamily } : {}),
          ...(markdownStyle.code?.fontSize !== undefined
            ? { fontSize: markdownStyle.code.fontSize }
            : {}),
          ...(markdownStyle.code?.color ? { color: markdownStyle.code.color } : {}),
          ...(markdownStyle.code?.backgroundColor
            ? { backgroundColor: markdownStyle.code.backgroundColor }
            : {}),
        },
        strongColor: markdownStyle.strong?.color,
        emColor: markdownStyle.em?.color,
        underlineColor: markdownStyle.underline?.color,
        currentUserId,
        isOwnMessage,
        onLinkPress,
        activeUnderline: false,
        activeStrike: false,
      }),
    [nodes, palette, markdownStyle, paragraph?.color, currentUserId, isOwnMessage, onLinkPress],
  );

  // `containerStyle` is a ViewStyle (callers pass layout props like maxWidth);
  // every prop it carries is also valid on Text, so it composes safely here.
  return (
    <Text
      style={[rootStyle, containerStyle as TextStyle]}
      selectable={selectable}
      {...(numberOfLines ? { numberOfLines } : {})}
    >
      {children}
    </Text>
  );
};

const RichInlineText = memo(RichInlineTextComponent);
RichInlineText.displayName = 'RichInlineText';

export { RichInlineText };
