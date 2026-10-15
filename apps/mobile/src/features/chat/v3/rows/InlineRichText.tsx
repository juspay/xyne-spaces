import { useMemo, type ReactElement } from 'react';
import { Platform, Text, type TextStyle } from 'react-native';

import { useMentionPress } from '@/src/components/conversation-composer/utils/useMentionPress';

import { resolveMentionColors } from '../model/mentionPresentation';
import { parseInlineRich, type InlineNode } from '../model/text/parseInlineRich';
import { mentionUrlFor } from '../model/text/mentionSchemes';
import { PRIMARY_FONT_SIZE, TEXT_LINE_HEIGHT } from '../model/text/markdownStyle';
import { assertNever } from '../machine/assertNever';
import { buildInlineCodeStyle, inlineCodeSurfaceFor } from '../model/text/inlineCodeChrome';
import { useChatRenderTokens } from '../theme/ChatRenderProvider';

const MONO_FONT = Platform.select({
  ios: 'Menlo',
  android: 'monospace',
  default: 'monospace',
}) as string;

const Node = ({
  node,
  onOpenUrl,
  mine,
  viewerId,
  codeStyle,
}: {
  node: InlineNode;
  onOpenUrl: (url: string) => void;
  mine: boolean;
  viewerId: string;
  codeStyle: TextStyle;
}): ReactElement => {
  const tokens = useChatRenderTokens();
  switch (node.type) {
    case 'text':
      return <Text>{node.text}</Text>;
    case 'code':
      return <Text style={codeStyle}>{node.text}</Text>;
    case 'strong':
      return (
        <Text className='font-semibold'>
          {node.children.map((child, index) => (
            <Node
              key={index}
              node={child}
              onOpenUrl={onOpenUrl}
              mine={mine}
              viewerId={viewerId}
              codeStyle={codeStyle}
            />
          ))}
        </Text>
      );
    case 'em':
      return (
        <Text className='italic'>
          {node.children.map((child, index) => (
            <Node
              key={index}
              node={child}
              onOpenUrl={onOpenUrl}
              mine={mine}
              viewerId={viewerId}
              codeStyle={codeStyle}
            />
          ))}
        </Text>
      );
    case 'underline':
      return (
        <Text className='underline'>
          {node.children.map((child, index) => (
            <Node
              key={index}
              node={child}
              onOpenUrl={onOpenUrl}
              mine={mine}
              viewerId={viewerId}
              codeStyle={codeStyle}
            />
          ))}
        </Text>
      );
    case 'strike':
      return (
        <Text className='line-through'>
          {node.children.map((child, index) => (
            <Node
              key={index}
              node={child}
              onOpenUrl={onOpenUrl}
              mine={mine}
              viewerId={viewerId}
              codeStyle={codeStyle}
            />
          ))}
        </Text>
      );
    case 'link':
      return (
        <Text
          className='text-brand underline'
          style={{ color: mine ? tokens.linkColorUser : tokens.linkColor }}
          onPress={(): void => onOpenUrl(node.href)}
        >
          {node.children.map((child, index) => (
            <Node
              key={index}
              node={child}
              onOpenUrl={onOpenUrl}
              mine={mine}
              viewerId={viewerId}
              codeStyle={codeStyle}
            />
          ))}
        </Text>
      );
    case 'mention': {
      const mentionColors = resolveMentionColors({
        mentionKind: node.mentionKind,
        mentionId: node.id,
        palette: tokens.mentionPalette,
        viewerId,
        isOwnMessage: mine,
      });
      return (
        <Text
          style={{ backgroundColor: mentionColors.backgroundColor, textDecorationLine: 'none' }}
          onPress={(): void => onOpenUrl(mentionUrlFor(node.mentionKind, node.id))}
        >
          <Text style={{ color: mentionColors.color, textDecorationLine: 'none' }}>
            {node.label}
          </Text>
        </Text>
      );
    }
    default:
      return assertNever(node);
  }
};

export function InlineRichText({
  markdown,
  mine = false,
  viewerId,
  numberOfLines,
}: {
  markdown: string;
  mine?: boolean;
  viewerId: string;
  numberOfLines?: number;
}): ReactElement {
  const onOpenUrl = useMentionPress();
  const tokens = useChatRenderTokens();
  const nodes = useMemo(() => parseInlineRich(markdown), [markdown]);
  const foreground = mine ? tokens.rootTextUser : tokens.rootTextOther;
  const codeStyle = useMemo(
    (): TextStyle =>
      buildInlineCodeStyle(inlineCodeSurfaceFor(mine, tokens, foreground), MONO_FONT),
    [foreground, mine, tokens],
  );
  return (
    <Text
      className='text-foreground'
      numberOfLines={numberOfLines}
      style={{
        fontSize: PRIMARY_FONT_SIZE,
        lineHeight: TEXT_LINE_HEIGHT,
        color: foreground,
      }}
    >
      {nodes.map((node, index) => (
        <Node
          key={index}
          node={node}
          mine={mine}
          viewerId={viewerId}
          codeStyle={codeStyle}
          onOpenUrl={url => {
            void onOpenUrl(url);
          }}
        />
      ))}
    </Text>
  );
}
