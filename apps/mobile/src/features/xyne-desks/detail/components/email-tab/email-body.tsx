import { memo, useCallback, useMemo } from 'react';
import { Text, View } from 'react-native';
import { type LinkPressEvent, type MarkdownStyle } from 'react-native-enriched-markdown';
import { useCSSVariable } from 'uniwind';

import { useAuth } from '@/src/contexts/AuthContext';
import { ConversationComposerMarkdownBody } from '@/src/features/chat/v2/components/conversation-composer/conversation-composer-markdown-body';
import { buildComposerMarkdownStyle } from '@/src/features/chat/v2/components/conversation-composer/utils/markdownStyle';
import { hasMarkdownTable } from '@/src/utils/markdownTable';
import { useMentionPress } from '@/src/features/chat/v2/components/conversation-composer/utils/useMentionPress';
import { useCustomEmojis } from '@/src/hooks/useCustomEmojis';
import { replaceEmojiShortcodesWithMarkdown } from '@/src/utils/flowJsonMarkdown';

import { emailHtmlToMarkdown } from '../../utils/email-html-to-markdown';

type EmailBodyProps = {
  body: string | null;
};

const customEmojiMapCache = new WeakMap<object, Map<string, { id: string; name: string }>>();

function catalogToCustomEmojiMap(
  emojis: readonly { id: string; name: string }[],
): Map<string, { id: string; name: string }> {
  const cached = customEmojiMapCache.get(emojis);
  if (cached) return cached;
  const map = new Map(emojis.map(emoji => [emoji.name, { id: emoji.id, name: emoji.name }]));
  customEmojiMapCache.set(emojis, map);
  return map;
}

/**
 * Same pipeline as chat messages: email HTML → markdown → composer body
 * (hydrates custom emoji placeholders the inline/md4c paths would print as `:name:`).
 */
export const EmailBody = memo(function EmailBody({ body }: EmailBodyProps) {
  const { user } = useAuth();
  const currentUserId = user?.user_id ?? undefined;
  const handleMentionPress = useMentionPress();
  const customEmojis = useCustomEmojis();

  const foreground = useCSSVariable('--color-foreground') as string;
  const foregroundMuted = useCSSVariable('--color-secondary-foreground') as string;
  const cardBg = useCSSVariable('--color-card') as string;
  const brand = useCSSVariable('--color-brand') as string;
  const linkColor = useCSSVariable('--color-primary') as string;
  const tableHeaderBg = useCSSVariable('--color-tertiary-bg') as string;
  const tableBorder = useCSSVariable('--color-border') as string;

  const markdown = useMemo(() => {
    const converted = emailHtmlToMarkdown(body ?? '');
    if (!converted || customEmojis.data.length === 0) return converted;
    return replaceEmojiShortcodesWithMarkdown(converted, {
      customEmojis: catalogToCustomEmojiMap(customEmojis.data),
    });
  }, [body, customEmojis.data]);

  const markdownStyle = useMemo<MarkdownStyle>(() => {
    const base = buildComposerMarkdownStyle({
      foreground: resolveColor(foreground, '#202124'),
      foregroundMuted: resolveColor(foregroundMuted, '#5f6368'),
      cardBg: resolveColor(cardBg, '#ffffff'),
      brand: resolveColor(brand, '#1B8755'),
      linkColor: resolveColor(linkColor, '#1a73e8'),
      tableHeaderBackground: resolveColor(tableHeaderBg, '#f4f4f4'),
      tableBorderColor: resolveColor(tableBorder, '#d6dce6'),
      variant: 'quoted',
    });
    return {
      ...base,
      paragraph: {
        ...base.paragraph,
        marginBottom: 6,
      },
    };
  }, [foreground, foregroundMuted, cardBg, brand, linkColor, tableHeaderBg, tableBorder]);

  const onLinkPress = useCallback(
    (event: LinkPressEvent) => {
      void handleMentionPress(event.url);
    },
    [handleMentionPress],
  );

  if (!markdown.trim()) {
    return <Text className='mt-3 text-[14px] italic text-secondary-foreground'>No content</Text>;
  }

  return (
    <View className='mt-3'>
      <ConversationComposerMarkdownBody
        markdown={markdown}
        markdownStyle={markdownStyle}
        onLinkPress={onLinkPress}
        selectable
        {...(currentUserId ? { currentUserId } : {})}
        isOwnMessage={false}
        {...(hasMarkdownTable(markdown) ? { flavor: 'github' as const } : {})}
      />
    </View>
  );
});

function resolveColor(value: string | undefined, fallback: string): string {
  if (typeof value === 'string' && value.trim().length > 0 && !value.startsWith('var(')) {
    return value;
  }
  return fallback;
}
