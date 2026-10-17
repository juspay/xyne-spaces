import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import type { ReactElement } from 'react';

import { BlockMarkdown } from '../BlockMarkdown';
import type { BlockMarkdownVariant } from '../blockMarkdownStyle';
import { useResolvedCustomEmojiMarkdown } from '../useResolvedCustomEmojiMarkdown';

export const FlowMarkdown = ({
  markdown,
  inheritedContainerStyle,
  style,
  mine,
  viewerId,
  onOpenUrl,
  variant,
}: {
  markdown: string;
  inheritedContainerStyle: ViewStyle;
  style?: StyleProp<ViewStyle>;
  mine: boolean;
  viewerId: string;
  onOpenUrl: (url: string) => void;
  variant?: BlockMarkdownVariant;
}): ReactElement | null => {
  const resolvedMarkdown = useResolvedCustomEmojiMarkdown(markdown);

  if (!markdown.trim()) return null;
  return (
    <View
      style={{
        minWidth: 0,
        maxWidth: '100%',
        ...inheritedContainerStyle,
        ...(style ? (StyleSheet.flatten(style) ?? {}) : {}),
      }}
    >
      <BlockMarkdown
        markdown={resolvedMarkdown}
        mine={mine}
        viewerId={viewerId}
        onOpenUrl={onOpenUrl}
        {...(variant ? { variant } : {})}
      />
    </View>
  );
};
