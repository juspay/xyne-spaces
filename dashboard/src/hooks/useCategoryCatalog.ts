import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { tagsConfigApi, type CategoryCatalogEntry } from '../api/tagsConfigApi';

const CACHE_TTL_MS = 30_000;
const catalogCache = new Map<string, { data: CategoryCatalogEntry[]; fetchedAt: number }>();

/**
 * Fetches the cross-channel category catalog (for autocomplete + auto-fill in
 * the tag-category form), cached per workspace+sourceType for CACHE_TTL_MS so
 * repeatedly opening the "Add category" form in one session doesn't refire.
 */
export function useCategoryCatalog(enabled: boolean, sourceType: string = 'desk-email') {
  const { workspaceId } = useParams<{ workspaceId?: string }>();
  const [catalog, setCatalog] = useState<CategoryCatalogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!enabled || !workspaceId) return;

    const cacheKey = `${workspaceId}:${sourceType}`;
    const cached = catalogCache.get(cacheKey);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      setCatalog(cached.data);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    tagsConfigApi
      .getCategoriesCatalog(sourceType)
      .then(result => {
        catalogCache.set(cacheKey, { data: result, fetchedAt: Date.now() });
        if (!cancelled) setCatalog(result);
      })
      .catch(() => {
        if (!cancelled) setCatalog([]);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, workspaceId, sourceType]);

  return { catalog, isLoading };
}
