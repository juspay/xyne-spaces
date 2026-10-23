import { useMemo } from 'react';

import { useMtlsEmojiUris } from '@/src/hooks/useMtlsEmoji';

import { replaceEmojiPlaceholders } from '../model/text/htmlToMD';
import { parseCustomEmojiMarkdownSegments } from '../model/text/parseCustomEmojiMarkdownSegments';

/**
 * Resolve opaque custom-emoji markers before markdown reaches the native
 * renderer. Keeping this at the markdown boundary preserves the surrounding
 * markdown structure and gives every V3 special card the same readable
 * fallback while an authenticated URI is unavailable.
 */
export const useResolvedCustomEmojiMarkdown = (markdown: string): string => {
  const segments = useMemo(() => parseCustomEmojiMarkdownSegments(markdown), [markdown]);
  const emojiIds = useMemo(
    () =>
      segments
        .filter(
          (segment): segment is Extract<typeof segment, { type: 'customEmoji' }> =>
            segment.type === 'customEmoji' && !segment.uri,
        )
        .map(segment => segment.emojiId),
    [segments],
  );
  const emojiUris = useMtlsEmojiUris(emojiIds);

  return useMemo(() => replaceEmojiPlaceholders(markdown, emojiUris), [emojiUris, markdown]);
};
