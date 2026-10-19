import { parseFlowJsonParts } from '@/src/utils/flowJsonMarkdown';
import { useMentionPress } from '@/src/components/conversation-composer/utils/useMentionPress';
import { useMemo, type ReactElement } from 'react';
import { View } from 'react-native';

import type { ForwardedPreview, MessageRowModel } from '../../model/chatRow.types';
import { canRenderInlineRich } from '../../model/text/parseInlineRich';
import {
  groupCustomEmojiMarkdownSegmentsByLine,
  parseCustomEmojiMarkdownSegments,
} from '../../model/text/parseCustomEmojiMarkdownSegments';
import { BlockMarkdown } from '../BlockMarkdown';
import { buildBlockMarkdownStyle, inlineCodeSurfaceFor } from '../blockMarkdownStyle';
import { CustomEmoji } from '../CustomEmoji';
import { InlineRichText } from '../InlineRichText';
import { FlowJsonRenderer } from './FlowJsonRenderer';
import { useChatRenderTokens } from '../../theme/ChatRenderProvider';

const QUOTED_EMOJI_SIZE = 20;

export const ForwardedMessageBody = ({
  forwarded,
  model,
  mine,
}: {
  forwarded: ForwardedPreview;
  model: MessageRowModel;
  mine: boolean;
}): ReactElement | null => {
  const openUrl = useMentionPress();
  const tokens = useChatRenderTokens();
  const foreground = mine ? tokens.rootTextUser : tokens.rootTextOther;
  const inlineCode = inlineCodeSurfaceFor(mine, tokens, foreground);
  const flowParts = useMemo(
    () => parseFlowJsonParts(forwarded.originalHtml),
    [forwarded.originalHtml],
  );
  const hasFlow = flowParts.some(part => part.type === 'flow');
  const emojiLines = useMemo(() => {
    if (hasFlow) return [];
    return groupCustomEmojiMarkdownSegmentsByLine(
      parseCustomEmojiMarkdownSegments(forwarded.originalMarkdown),
    );
  }, [forwarded.originalMarkdown, hasFlow]);
  const markdownStyle = useMemo(
    () =>
      buildBlockMarkdownStyle({
        foreground,
        foregroundMuted: tokens.foregroundMuted,
        cardBg: tokens.cardBg,
        brand: tokens.brand,
        link: mine ? tokens.linkColorUser : tokens.linkColor,
        inlineCodeBackground: inlineCode.backgroundColor,
        inlineCodeForeground: inlineCode.foreground,
        tableHeaderBackground: tokens.tableHeaderBg,
        tableBorderColor: tokens.tableBorderColor,
        variant: 'quoted',
      }),
    [
      foreground,
      inlineCode.backgroundColor,
      inlineCode.foreground,
      mine,
      tokens.brand,
      tokens.cardBg,
      tokens.foregroundMuted,
      tokens.linkColor,
      tokens.linkColorUser,
      tokens.tableHeaderBg,
      tokens.tableBorderColor,
    ],
  );

  if (!forwarded.originalMarkdown.trim()) {
    return null;
  }

  if (hasFlow) {
    return (
      <FlowJsonRenderer
        model={model}
        parts={flowParts}
        markdownStyle={markdownStyle}
        markdownVariant='quoted'
        mine={mine}
        onOpenUrl={url => {
          void openUrl(url);
        }}
      />
    );
  }

  const hasCustomEmoji = emojiLines.some(line =>
    line.some(segment => segment.type === 'customEmoji'),
  );
  if (!hasCustomEmoji) {
    return (
      <BlockMarkdown
        markdown={forwarded.originalMarkdown}
        mine={mine}
        viewerId={model.viewerId}
        variant='quoted'
        onOpenUrl={url => {
          void openUrl(url);
        }}
      />
    );
  }

  return (
    <View style={{ minWidth: 0, maxWidth: '100%' }}>
      {emojiLines.map((line, lineIndex) => (
        <View
          key={`quoted-line-${lineIndex}`}
          className='flex-row flex-wrap items-center'
          style={{ minWidth: 0, maxWidth: '100%' }}
        >
          {line.map((segment, segmentIndex) => {
            const key = `${segment.type}-${lineIndex}-${segmentIndex}`;
            if (segment.type === 'customEmoji') {
              return (
                <CustomEmoji
                  key={key}
                  emojiId={segment.emojiId}
                  name={segment.name}
                  {...(segment.uri ? { uri: segment.uri } : {})}
                  size={QUOTED_EMOJI_SIZE}
                />
              );
            }
            if (!segment.markdown.trim()) {
              return null;
            }
            if (canRenderInlineRich(segment.markdown)) {
              return (
                <View key={key} style={{ minWidth: 0, flexShrink: 1 }}>
                  <InlineRichText
                    markdown={segment.markdown}
                    mine={mine}
                    viewerId={model.viewerId}
                  />
                </View>
              );
            }
            return (
              <View key={key} style={{ minWidth: 0, maxWidth: '100%', flexShrink: 1 }}>
                <BlockMarkdown
                  markdown={segment.markdown}
                  mine={mine}
                  viewerId={model.viewerId}
                  variant='quoted'
                  onOpenUrl={url => {
                    void openUrl(url);
                  }}
                />
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
};
