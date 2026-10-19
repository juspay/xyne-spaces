import { useEffect, useState } from 'react';

import { tagsConfigApi } from '../api/tags-config-api';

/**
 * Resolve AI-tag selections (`category:tag`) → conversationIds for V4.
 * While loading, returns [] so the list shows empty (not unfiltered) — matches dashboard.
 */
export function useGeneratedTagsConversationIds(
  channelId: string,
  generatedTags: readonly string[],
): { conversationIds: string[] | undefined; isLoading: boolean } {
  const [conversationIds, setConversationIds] = useState<string[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const tagsKey = generatedTags.length > 0 ? [...generatedTags].sort().join('\0') : '';

  useEffect(() => {
    if (!channelId || !tagsKey) {
      setConversationIds(null);
      setIsLoading(false);
      return;
    }

    const tags = tagsKey.split('\0');
    setConversationIds([]);
    setIsLoading(true);
    let cancelled = false;

    tagsConfigApi
      .filterConversationsByTags(channelId, tags)
      .then(ids => {
        if (!cancelled) setConversationIds(ids);
      })
      .catch(() => {
        if (!cancelled) setConversationIds([]);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [channelId, tagsKey]);

  return {
    conversationIds: tagsKey ? (conversationIds ?? []) : undefined,
    isLoading,
  };
}
