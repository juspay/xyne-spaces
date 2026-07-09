import { useCallback, useEffect, useRef, useState } from 'react';
import { tagsApi, type TagGroup } from '../api/tagsApi';

function useGroupedTags(
  id: string,
  fetchFn: (id: string) => Promise<TagGroup[]>,
  enabled: boolean,
) {
  const [groups, setGroups] = useState<TagGroup[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setIsLoading(true);
    fetchFn(id)
      .then(result => {
        if (!cancelled) setGroups(result);
      })
      .catch(() => {
        if (!cancelled) setGroups([]);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id, fetchFn, enabled]);

  return { groups, isLoading };
}

export function useTicketLatestEmailTags(ticketId: string, enabled: boolean) {
  return useGroupedTags(ticketId, tagsApi.getTicketLatestEmailTags, enabled);
}

export type MutatingKey = string; // `${category}:${tag}`

// ─── Generic entity tag hooks ─────────────────────────────────────────────────

export function useEntityTags(sourceType: string, sourceId: string, enabled: boolean) {
  const fetchFn = useCallback((id: string) => tagsApi.getEntityTags(sourceType, id), [sourceType]);
  return useGroupedTags(sourceId, fetchFn, enabled);
}

export function useTagEditor(params: { sourceType: string; sourceId: string; enabled: boolean }) {
  const { sourceType, sourceId, enabled } = params;
  const [groups, setGroups] = useState<TagGroup[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [mutating, setMutating] = useState<Set<MutatingKey>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setIsLoading(true);
    tagsApi
      .getEntityTags(sourceType, sourceId)
      .then(result => {
        if (!cancelled) setGroups(result);
      })
      .catch(() => {
        if (!cancelled) setGroups([]);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sourceType, sourceId, enabled]);

  const mutKey = (category: string, tag: string): MutatingKey => `${category}:${tag}`;

  const addTag = useCallback(
    async (category: string, tag: string) => {
      const group = groups.find(g => g.category === category);
      if (group?.tags.some(t => t.tag === tag)) {
        setError(`"${tag}" is already added to ${category}`);
        return;
      }
      const opts = group?.configOptions;
      if (
        opts?.maxCount !== null &&
        opts?.maxCount !== undefined &&
        (group?.tags.length ?? 0) >= opts.maxCount
      ) {
        setError(`Maximum ${opts.maxCount} tag(s) allowed for ${category}`);
        return;
      }
      if (
        opts &&
        !opts.isNewTagAllowed &&
        opts.allowedTags.length > 0 &&
        !opts.allowedTags.includes(tag)
      ) {
        setError(`"${tag}" is not in the allowed list for ${category}`);
        return;
      }

      const key = mutKey(category, tag);
      setMutating(prev => new Set(prev).add(key));
      setError(null);

      setGroups(prev =>
        prev.map(g =>
          g.category !== category ? g : { ...g, tags: [...g.tags, { tag, reason: null }] },
        ),
      );

      try {
        await tagsApi.addEntityTag(sourceType, sourceId, category, tag);
      } catch (err: unknown) {
        if (isMounted.current) {
          setGroups(prev =>
            prev.map(g =>
              g.category !== category ? g : { ...g, tags: g.tags.filter(t => t.tag !== tag) },
            ),
          );
          setError((err as Error)?.message ?? 'Failed to add tag');
        }
      } finally {
        if (isMounted.current) {
          setMutating(prev => {
            const s = new Set(prev);
            s.delete(key);
            return s;
          });
        }
      }
    },
    [sourceType, sourceId, groups],
  );

  const removeTag = useCallback(
    async (category: string, tag: string) => {
      const key = mutKey(category, tag);
      setMutating(prev => new Set(prev).add(key));
      setError(null);

      // Capture the original tag object before optimistic removal
      const originalTag = groups.find(g => g.category === category)?.tags.find(t => t.tag === tag);

      setGroups(prev =>
        prev.map(g =>
          g.category !== category ? g : { ...g, tags: g.tags.filter(t => t.tag !== tag) },
        ),
      );

      try {
        await tagsApi.removeEntityTag(sourceType, sourceId, category, tag);
      } catch (err: unknown) {
        if (isMounted.current) {
          // Restore the original tag object on rollback (preserves reason field)
          setGroups(prev =>
            prev.map(g =>
              g.category !== category
                ? g
                : { ...g, tags: [...g.tags, originalTag ?? { tag, reason: null }] },
            ),
          );
          setError((err as Error)?.message ?? 'Failed to remove tag');
        }
      } finally {
        if (isMounted.current) {
          setMutating(prev => {
            const s = new Set(prev);
            s.delete(key);
            return s;
          });
        }
      }
    },
    [sourceType, sourceId, groups],
  );

  return { groups, isLoading, mutating, error, addTag, removeTag };
}

// ─── Unique tag values (for Allowed Tags auto-fill in config) ─────────────────

export function useUniqueTagValues(categoryName: string, sourceType: string, enabled: boolean) {
  const [values, setValues] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!enabled || !categoryName.trim()) return;
    let cancelled = false;
    setIsLoading(true);
    tagsApi
      .getUniqueTagValues(categoryName, sourceType)
      .then(vals => {
        if (!cancelled) setValues(vals);
      })
      .catch(() => {
        if (!cancelled) setValues([]);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [categoryName, sourceType, enabled]);

  return { values, isLoading };
}
