import { useMemo, type ReactElement } from 'react';
import { Text, View } from 'react-native';
import { EnrichedMarkdownText, type MarkdownStyle } from 'react-native-enriched-markdown';
import { StreamdownText } from 'react-native-streamdown';

import {
  extractFlowPlanMarkdownHeader,
  type FlowPlanStatusTone,
} from '@/src/utils/flowJsonMarkdown';

import { buildMentionLinkVariants } from '../model/mentionPresentation';
import { hasMarkdownTable } from '@/src/utils/markdownTable';
import { useChatRenderTokens } from '../theme/ChatRenderProvider';
import {
  buildBlockMarkdownStyle,
  inlineCodeSurfaceFor,
  type BlockMarkdownVariant,
} from './blockMarkdownStyle';

const LIST_MARKDOWN = /(?:^|\n)[ \t]{0,3}(?:\d+[.)]|[-+*])[ \t]+/;
const NATIVE_LIST_END_GUARD = '\n\u200B';
const MD4C_FLAGS = {
  underline: true as const,
  latexMath: false as const,
  hardSoftBreaks: true as const,
};

const markdownForNative = (markdown: string): string =>
  LIST_MARKDOWN.test(markdown) ? `${markdown}${NATIVE_LIST_END_GUARD}` : markdown;

const getPlanStatusPillPalette = (
  tone: FlowPlanStatusTone,
): { backgroundColor: string; color: string } => {
  switch (tone) {
    case 'completed':
      return { backgroundColor: '#00A63E', color: '#ffffff' };
    case 'pending':
      return { backgroundColor: '#FF6900', color: '#ffffff' };
    case 'in_progress':
      return { backgroundColor: '#0561E2', color: '#ffffff' };
    case 'failed':
      return { backgroundColor: '#E7000B', color: '#ffffff' };
  }
};

/** Text arriving as a stream: still coming in ('live') or finished ('done'). It keeps
 * rendering through StreamdownText once finished, so the view is not remounted. */
export type MarkdownStream = 'live' | 'done';

const MarkdownBody = ({
  markdown,
  style,
  onOpenUrl,
  stream,
}: {
  markdown: string;
  style: MarkdownStyle;
  onOpenUrl: (url: string) => void;
  stream?: MarkdownStream | undefined;
}): ReactElement => {
  const hasTable = hasMarkdownTable(markdown);
  const nativeProps = {
    markdownStyle: style,
    md4cFlags: MD4C_FLAGS,
    ...(hasTable ? { flavor: 'github' as const } : {}),
    enableBlockContextMenu: false,
    onLinkPress: ({ url }: { url: string }): void => {
      onOpenUrl(url);
    },
  };
  if (!stream) {
    return <EnrichedMarkdownText markdown={markdownForNative(markdown)} {...nativeProps} />;
  }
  // Mid-stream the list guard waits: remend would close an open `**` after it, not before.
  // A table switches the native view mid-stream, which would replay the fade from the start.
  return (
    <StreamdownText
      markdown={stream === 'live' ? markdown : markdownForNative(markdown)}
      streamingAnimation={stream === 'live' && !hasTable}
      {...nativeProps}
    />
  );
};

export const BlockMarkdown = ({
  markdown,
  onOpenUrl,
  mine,
  viewerId,
  collapsedLines,
  variant = 'primary',
  stream,
}: {
  markdown: string;
  onOpenUrl: (url: string) => void;
  mine: boolean;
  viewerId: string;
  collapsedLines?: number;
  variant?: BlockMarkdownVariant;
  stream?: MarkdownStream | undefined;
}): ReactElement => {
  const tokens = useChatRenderTokens();
  const foreground =
    variant === 'system' ? tokens.systemText : mine ? tokens.rootTextUser : tokens.rootTextOther;
  const link = variant === 'system' ? foreground : mine ? tokens.linkColorUser : tokens.linkColor;
  const inlineCode = inlineCodeSurfaceFor(mine, tokens, foreground);
  const style = useMemo((): MarkdownStyle => {
    const base = buildBlockMarkdownStyle({
      foreground,
      foregroundMuted: tokens.foregroundMuted,
      cardBg: tokens.cardBg,
      brand: tokens.brand,
      link,
      inlineCodeBackground: inlineCode.backgroundColor,
      inlineCodeForeground: inlineCode.foreground,
      tableHeaderBackground: tokens.tableHeaderBg,
      tableBorderColor: tokens.tableBorderColor,
      variant,
    });
    return {
      ...base,
      linkVariants: buildMentionLinkVariants({
        palette: tokens.mentionPalette,
        viewerId,
        isOwnMessage: mine,
      }),
    };
  }, [
    foreground,
    inlineCode.backgroundColor,
    inlineCode.foreground,
    link,
    mine,
    variant,
    tokens.foregroundMuted,
    tokens.cardBg,
    tokens.brand,
    tokens.tableHeaderBg,
    tokens.tableBorderColor,
    tokens.mentionPalette,
    viewerId,
  ]);
  const planHeader = useMemo(() => extractFlowPlanMarkdownHeader(markdown), [markdown]);
  const planHeaderPalette = planHeader
    ? getPlanStatusPillPalette(planHeader.statusTone)
    : undefined;
  const clampStyle =
    collapsedLines !== undefined
      ? {
          maxHeight: (style.paragraph?.lineHeight ?? 20) * collapsedLines,
          overflow: 'hidden' as const,
        }
      : undefined;
  const body = planHeader ? (
    <View>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          flexWrap: 'wrap',
          marginBottom: planHeader.restMarkdown.trim() ? 6 : 0,
        }}
      >
        <Text
          style={{
            color: foreground,
            fontSize: style.paragraph?.fontSize ?? 16,
            lineHeight: style.paragraph?.lineHeight ?? 20,
            fontWeight: '700',
          }}
        >
          {planHeader.title}
        </Text>
        <View
          style={{
            marginLeft: 8,
            borderRadius: 6,
            backgroundColor: planHeaderPalette?.backgroundColor,
            paddingHorizontal: 8,
            paddingVertical: 2,
          }}
        >
          <Text
            style={{
              color: planHeaderPalette?.color,
              fontSize: 13,
              lineHeight: 17,
              fontWeight: '700',
            }}
          >
            {planHeader.statusLabel}
          </Text>
        </View>
      </View>
      {planHeader.restMarkdown.trim() ? (
        <MarkdownBody
          markdown={planHeader.restMarkdown}
          style={style}
          onOpenUrl={onOpenUrl}
          stream={stream}
        />
      ) : null}
    </View>
  ) : (
    <MarkdownBody markdown={markdown} style={style} onOpenUrl={onOpenUrl} stream={stream} />
  );
  return clampStyle ? <View style={clampStyle}>{body}</View> : body;
};
