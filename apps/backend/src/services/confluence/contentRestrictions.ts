import { CanvasVisibility } from '@prisma/client';
import type { ConfluenceContentRestrictions, ConfluencePage } from './confluenceClient';

export interface ConfluenceRestrictionDecision {
  visibility: CanvasVisibility;
  hasReadRestriction: boolean | null;
  status: 'checked' | 'unknown';
  restrictedContentIds: string[];
  checkedContentIds: string[];
  error?: string;
}

export const resolveConfluenceCanvasVisibility = async (
  page: ConfluencePage,
  fetchContentRestrictions: (contentId: string) => Promise<ConfluenceContentRestrictions>,
): Promise<ConfluenceRestrictionDecision> => {
  const contentIds = uniqueIds([
    ...(page.ancestors || []).map(ancestor => ancestor.id),
    page.id,
  ]);

  const checkedContentIds: string[] = [];
  const restrictedContentIds: string[] = [];

  try {
    for (const contentId of contentIds) {
      const restrictions = await fetchContentRestrictions(contentId);
      checkedContentIds.push(contentId);
      const readUsers = restrictions.read?.restrictions?.user?.results?.length || 0;
      const readGroups = restrictions.read?.restrictions?.group?.results?.length || 0;
      if (readUsers + readGroups > 0) {
        restrictedContentIds.push(contentId);
      }
    }

    return {
      visibility: restrictedContentIds.length > 0 ? CanvasVisibility.PRIVATE : CanvasVisibility.PUBLIC,
      hasReadRestriction: restrictedContentIds.length > 0,
      status: 'checked',
      restrictedContentIds,
      checkedContentIds,
    };
  } catch (error) {
    return {
      visibility: CanvasVisibility.PRIVATE,
      hasReadRestriction: null,
      status: 'unknown',
      restrictedContentIds,
      checkedContentIds,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
};

const uniqueIds = (values: Array<string | undefined | null>): string[] =>
  [...new Set(values.filter((value): value is string => Boolean(value)))];
