import { useMemo } from 'react';

import { useMtlsEmojiUris } from '@/src/hooks/useMtlsEmoji';
import { extractEmojiIds, replaceEmojiPlaceholders } from './htmlToMD';

/**
 * Prefetches custom emoji images for placeholders in `markdown`.
 * Prefer passing markdown with `xemoji:…` placeholders directly to
 * `ConversationComposerMarkdownBody`, which resolves and renders them
 * without flashing `:name:` shortcode text while loading.
 */
export function useResolvedEmojiMarkdown(markdown: string): string {
  const ids = useMemo(() => extractEmojiIds(markdown), [markdown]);
  const uriMap = useMtlsEmojiUris(ids);
  return useMemo(() => replaceEmojiPlaceholders(markdown, uriMap), [markdown, uriMap]);
}
