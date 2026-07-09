import { useCallback, useEffect, useState } from 'react';
import { tagsConfigApi, type TagCategories, type TagCategoryConfig } from '../api/tagsConfigApi';

interface ZodIssueLike {
  path: (string | number)[];
  message: string;
}

interface ApiErrorLike extends Error {
  responseData?: { error?: string; issues?: ZodIssueLike[] };
}

/**
 * Describes a single Zod issue using the actual submitted value where
 * possible, e.g. `sentiment > tags "High Priority": must be lowercase, ...`
 * instead of the raw path `categories.sentiment.tags.0`.
 */
function describeIssue(issue: ZodIssueLike, categories: TagCategories): string {
  const [, categoryName, field, index] = issue.path;

  if (categoryName === undefined) {
    return issue.message;
  }
  if (field === undefined) {
    return `category "${categoryName}": ${issue.message}`;
  }

  const categoryConfig = categories[String(categoryName)];
  let value: string | number | boolean | undefined;
  if (index !== undefined) {
    const list = categoryConfig?.[field as 'tags' | 'blacklist'];
    value = Array.isArray(list) ? list[Number(index)] : undefined;
  } else {
    const fieldValue = categoryConfig?.[field as keyof TagCategoryConfig];
    if (
      typeof fieldValue === 'string' ||
      typeof fieldValue === 'number' ||
      typeof fieldValue === 'boolean'
    ) {
      value = fieldValue;
    }
  }

  const label = value !== undefined ? `${field} "${value}"` : String(field);
  return `${categoryName} > ${label}: ${issue.message}`;
}

function extractErrorMessage(err: unknown, categories: TagCategories, fallback: string): string {
  if (err instanceof Error) {
    const issues = (err as ApiErrorLike).responseData?.issues;
    if (issues && issues.length > 0) {
      return issues.map(issue => describeIssue(issue, categories)).join('; ');
    }
    if (err.message) {
      return err.message;
    }
  }
  return fallback;
}

export function useDeskTagsConfig(channelId: string | null, enabled: boolean) {
  const [categories, setCategories] = useState<TagCategories>({});
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!channelId || !enabled) return;
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    tagsConfigApi
      .getConfig(channelId)
      .then(result => {
        if (!cancelled) setCategories(result);
      })
      .catch(() => {
        if (!cancelled) setError('Failed to load tag generation config');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [channelId, enabled]);

  const saveCategories = useCallback(
    async (next: TagCategories): Promise<void> => {
      if (!channelId) return;
      setIsSaving(true);
      setError(null);
      try {
        const result = await tagsConfigApi.updateConfig(channelId, next);
        setCategories(result);
      } catch (err) {
        const message = extractErrorMessage(err, next, 'Failed to save tag generation config');
        setError(message);
        throw new Error(message);
      } finally {
        setIsSaving(false);
      }
    },
    [channelId],
  );

  return { categories, isLoading, isSaving, error, saveCategories };
}
