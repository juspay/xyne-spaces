import { useMemo, type ReactElement } from 'react';
import { useMentionPress } from '@/src/components/conversation-composer/utils/useMentionPress';
import { Pressable, Text, View } from 'react-native';
import type { MarkdownStyle } from 'react-native-enriched-markdown';
import { useChatRenderTokens } from '../theme/ChatRenderProvider';

import { bodyPaintFor } from '../model/bodyPaint';
import { INLINE_EMOJI_RESERVED_WIDTH_PX } from '../model/buildBody';
import type { MessageRowModel, PreviewSegment } from '../model/chatRow.types';
import { JUMBO_EMOJI_SIZE_PX } from '../model/jumboEmoji';
import { mentionFromUrl, resolveMentionColors } from '../model/mentionPresentation';
import { PRIMARY_FONT_SIZE, TEXT_LINE_HEIGHT } from '../model/text/markdownStyle';
import { CustomEmoji } from './CustomEmoji';
import { InlineRichText } from './InlineRichText';
import { BlockMarkdown } from './BlockMarkdown';
import { buildBlockMarkdownStyle, inlineCodeSurfaceFor } from './blockMarkdownStyle';
import { FlowJsonRenderer } from './parts/FlowJsonRenderer';

const Segment = ({
  segment,
  size,
  onOpenUrl,
  mine,
  viewerId,
}: {
  segment: PreviewSegment;
  size: number;
  onOpenUrl: (url: string) => void;
  mine: boolean;
  viewerId: string;
}): ReactElement => {
  const tokens = useChatRenderTokens();
  if (segment.kind === 'mention') {
    const mention = mentionFromUrl(segment.url);
    if (!mention) {
      return <Text>{segment.text}</Text>;
    }
    const colors = resolveMentionColors({
      mentionKind: mention.mentionKind,
      mentionId: mention.mentionId,
      palette: tokens.mentionPalette,
      viewerId,
      isOwnMessage: mine,
    });
    return (
      <Text
        style={{ backgroundColor: colors.backgroundColor, textDecorationLine: 'none' }}
        onPress={(): void => onOpenUrl(segment.url)}
      >
        <Text style={{ color: colors.color, textDecorationLine: 'none' }}>{segment.text}</Text>
      </Text>
    );
  }
  if (segment.kind === 'link') {
    return (
      <Text
        className='text-brand underline'
        style={{ color: mine ? tokens.linkColorUser : tokens.linkColor }}
        onPress={segment.url ? (): void => onOpenUrl(segment.url ?? '') : undefined}
      >
        {segment.text}
      </Text>
    );
  }
  if (segment.kind === 'emoji') {
    return (
      <CustomEmoji
        emojiId={segment.emojiId}
        name={segment.name}
        {...(segment.uri ? { uri: segment.uri } : {})}
        size={size}
      />
    );
  }
  return <Text>{segment.text}</Text>;
};

const READ_MORE_VERTICAL_GAP = 4;

const CollapseControl = ({
  conversationId,
  mine,
  onToggleExpand,
}: {
  conversationId: string;
  mine: boolean;
  onToggleExpand: (conversationId: string) => void;
}): ReactElement => {
  const tokens = useChatRenderTokens();
  const readMoreColor = mine ? tokens.actionPrimaryColor : tokens.linkColor;
  return (
    <Pressable
      accessibilityRole='button'
      accessibilityLabel='Read more'
      hitSlop={8}
      onPress={event => {
        event.stopPropagation();
        onToggleExpand(conversationId);
      }}
      className='self-start'
      style={{ paddingTop: READ_MORE_VERTICAL_GAP, paddingBottom: READ_MORE_VERTICAL_GAP }}
    >
      <Text style={{ color: readMoreColor, fontSize: 15, lineHeight: 20, fontWeight: '600' }}>
        Read more
      </Text>
    </Pressable>
  );
};

export function MessageRowBody({
  model,
  onToggleExpand,
}: {
  model: MessageRowModel;
  onToggleExpand: (conversationId: string) => void;
}): ReactElement {
  const onOpenUrl = useMentionPress();
  const tokens = useChatRenderTokens();
  const mine = model.rowKind === 'CURRENT_USER';
  const paint = bodyPaintFor(model);
  const body = model.body;
  const clampLines =
    body.collapse.isCollapsible && !model.isExpanded ? body.collapse.collapsedLines : undefined;
  const hidden = body.isVisibleToCurrentUser ? null : (
    <Text style={{ color: tokens.mutedForeground }}>Only visible to you. </Text>
  );
  const collapseControl =
    body.collapse.isCollapsible && !model.isExpanded ? (
      <CollapseControl
        conversationId={model.conversationId}
        mine={mine}
        onToggleExpand={onToggleExpand}
      />
    ) : null;
  const bodyForeground = mine ? tokens.rootTextUser : tokens.rootTextOther;
  const inlineCode = inlineCodeSurfaceFor(mine, tokens, bodyForeground);
  const flowMarkdownStyle = useMemo(
    (): MarkdownStyle =>
      buildBlockMarkdownStyle({
        foreground: bodyForeground,
        foregroundMuted: tokens.foregroundMuted,
        cardBg: tokens.cardBg,
        brand: tokens.brand,
        link: mine ? tokens.linkColorUser : tokens.linkColor,
        inlineCodeBackground: inlineCode.backgroundColor,
        inlineCodeForeground: inlineCode.foreground,
        tableHeaderBackground: tokens.tableHeaderBg,
        tableBorderColor: tokens.tableBorderColor,
      }),
    [
      bodyForeground,
      inlineCode.backgroundColor,
      inlineCode.foreground,
      mine,
      tokens.foregroundMuted,
      tokens.cardBg,
      tokens.brand,
      tokens.linkColorUser,
      tokens.linkColor,
      tokens.tableHeaderBg,
      tokens.tableBorderColor,
    ],
  );

  if (model.isFlowJson && body.flowParts.length > 0) {
    return (
      <>
        {hidden}
        <FlowJsonRenderer
          model={model}
          parts={body.flowParts}
          markdownStyle={flowMarkdownStyle}
          mine={mine}
          onOpenUrl={url => {
            void onOpenUrl(url);
          }}
        />
        {collapseControl}
      </>
    );
  }
  if (paint === 'jumbo') {
    const emojis = body.segments.filter(segment => segment.kind === 'emoji');
    if (emojis.length > 0) {
      return (
        <View className='flex-row items-center gap-1'>
          {emojis.map((segment, index) => (
            <CustomEmoji
              key={`${index}:${segment.emojiId}`}
              emojiId={segment.emojiId}
              name={segment.name}
              {...(segment.uri ? { uri: segment.uri } : {})}
              size={JUMBO_EMOJI_SIZE_PX}
            />
          ))}
        </View>
      );
    }
    return (
      <Text
        className='text-foreground'
        style={{
          fontSize: JUMBO_EMOJI_SIZE_PX,
          lineHeight: JUMBO_EMOJI_SIZE_PX + 8,
          color: mine ? tokens.rootTextUser : tokens.rootTextOther,
        }}
      >
        {body.plainText.trim()}
      </Text>
    );
  }
  if (paint === 'inline-rich' && body.inlineMarkdown) {
    return (
      <>
        {hidden}
        <InlineRichText
          markdown={body.inlineMarkdown}
          mine={mine}
          viewerId={model.viewerId}
          {...(clampLines !== undefined ? { numberOfLines: clampLines } : {})}
        />
        {collapseControl}
      </>
    );
  }
  if (paint === 'segments') {
    return (
      <>
        <Text
          className='text-foreground'
          numberOfLines={clampLines}
          style={{
            fontSize: PRIMARY_FONT_SIZE,
            lineHeight: TEXT_LINE_HEIGHT,
            color: mine ? tokens.rootTextUser : tokens.rootTextOther,
          }}
        >
          {hidden}
          {body.segments.map((segment, index) => (
            <Segment
              key={
                segment.kind === 'emoji'
                  ? `${index}:${segment.emojiId}`
                  : `${index}:${segment.kind}`
              }
              segment={segment}
              size={INLINE_EMOJI_RESERVED_WIDTH_PX}
              mine={mine}
              viewerId={model.viewerId}
              onOpenUrl={url => {
                void onOpenUrl(url);
              }}
            />
          ))}
        </Text>
        {collapseControl}
      </>
    );
  }
  return (
    <>
      {hidden}
      <BlockMarkdown
        markdown={body.markdown || body.plainText}
        mine={mine}
        viewerId={model.viewerId}
        {...(clampLines !== undefined ? { collapsedLines: clampLines } : {})}
        onOpenUrl={url => {
          void onOpenUrl(url);
        }}
      />
      {collapseControl}
    </>
  );
}
