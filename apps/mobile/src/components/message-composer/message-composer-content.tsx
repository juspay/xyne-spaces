import { memo, useMemo, type ReactElement } from 'react';
import { useCSSVariable, useUniwind } from 'uniwind';

import { useMessageComposer } from './message-composer-context';
import { MessageType, isForwardedMessageXml, parseForwardedMessageXml } from '@xyne/shared';
import { ConversationComposerMarkdownBody } from '@/src/components/conversation-composer/conversation-composer-markdown-body';
import { htmlToMD } from './utils/htmlToMD';
import { buildComposerMarkdownStyle } from './utils/markdownStyle';
import { useMentionPress } from '@/src/components/conversation-composer/utils/useMentionPress';
import { normalizeActivityPreviewMarkdown } from '@/src/components/conversation-composer/utils/htmlToMD';
import {
  formatCallSuggestedTicketsMarkdown,
  isCallSuggestedTicketsMessage,
} from '@/src/utils/callSuggestedTicketsMarkdown';
import { DebugBoundary } from './utils/debug-boundary';

const Content = memo((): ReactElement | null => {
  const { item, kind, currentUser, contentVariant } = useMessageComposer();

  const foreground = useCSSVariable(
    contentVariant === 'activity' ? '--color-activity-description' : '--color-foreground',
  ) as string;
  const foregroundMuted = useCSSVariable(
    contentVariant === 'activity' ? '--color-activity-description' : '--color-muted',
  ) as string;
  const cardBg = useCSSVariable('--color-card') as string;
  const brand = useCSSVariable('--color-brand') as string;
  const { theme } = useUniwind();
  const linkColor = theme === 'dark' ? '#3CB16F' : '#288451';
  const handleMentionPress = useMentionPress();

  const markdownStyle = useMemo(
    () =>
      buildComposerMarkdownStyle({
        foreground,
        foregroundMuted,
        cardBg,
        brand,
        linkColor,
        variant: contentVariant,
      }),
    [foreground, foregroundMuted, cardBg, brand, linkColor, contentVariant],
  );

  // Compute the markdown body unconditionally so the emoji-resolution hook below
  // is also called unconditionally (rules of hooks). FORWARDED messages render only
  // the optional text the forwarder added; the original body is the <Forwarded /> sibling.
  const markdown = useMemo(() => {
    if (kind === 'DELETED' || kind === 'SYSTEM') return '';
    const rawContent = item.content ?? '';
    if (!rawContent) return '';
    if (item.msgType === MessageType.FORWARDED) {
      if (!isForwardedMessageXml(rawContent)) return '';
      const optionalText = parseForwardedMessageXml(rawContent)?.optionalText ?? '';
      return htmlToMD(optionalText);
    }
    const metadata = item.metadata as { contentFormat?: string } | null;
    const shouldParse =
      metadata?.contentFormat !== 'markdown' || /<\/?[a-z][^>]*>/i.test(rawContent);

    let body = shouldParse ? htmlToMD(rawContent) : rawContent;
    if (isCallSuggestedTicketsMessage(item.metadata)) {
      const formatted = formatCallSuggestedTicketsMarkdown(body);
      if (formatted) body = formatted;
    }
    return body;
  }, [kind, item.content, item.msgType, item.metadata]);

  const previewMarkdown = useMemo(
    () => (contentVariant === 'activity' ? normalizeActivityPreviewMarkdown(markdown) : markdown),
    [contentVariant, markdown],
  );

  if (!previewMarkdown.trim()) return null;

  return (
    <DebugBoundary>
      <ConversationComposerMarkdownBody
        markdown={previewMarkdown}
        markdownStyle={markdownStyle}
        containerStyle={{ maxWidth: '100%' }}
        onLinkPress={({ url }) => {
          void handleMentionPress(url);
        }}
        selectable={false}
        {...(currentUser?.id ? { currentUserId: currentUser.id } : {})}
        isOwnMessage={kind === 'CURRENT_USER'}
      />
    </DebugBoundary>
  );
});
Content.displayName = 'MessageComposer.Content';

export { Content };
