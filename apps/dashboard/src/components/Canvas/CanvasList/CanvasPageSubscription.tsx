import React, { useEffect, useMemo, useRef } from 'react';
import type { Canvas } from '../Canvas.types';
import { queries } from '../../../zero/queries';
import { useQuery } from '../../../hooks/useQuery';

type CanvasCursor = { id: string; updatedAt: number };
type CanvasCreatorFilter = 'me' | 'others';

export const CanvasPageSubscription: React.FC<{
  cursor: CanvasCursor | null;
  pageSize: number;
  channelId?: string | undefined;
  searchQuery?: string | undefined;
  includeArchived: boolean;
  onlyArchived: boolean;
  includePublicChannelCanvases?: boolean | undefined;
  creatorFilter?: CanvasCreatorFilter | undefined;
  createdByUserId?: string | undefined;
  onPageComplete: (page: Canvas[], previousPageIds: Set<string>, pageSize: number) => void;
  onLoadingChange: (isLoading: boolean) => void;
}> = ({
  cursor,
  pageSize,
  channelId,
  searchQuery,
  includeArchived,
  onlyArchived,
  includePublicChannelCanvases,
  creatorFilter,
  createdByUserId,
  onPageComplete,
  onLoadingChange,
}) => {
  const previousPageIdsRef = useRef<Set<string>>(new Set());

  const query = useMemo(() => {
    const trimmedSearchQuery = searchQuery?.trim();
    if (channelId) {
      return queries.channelCanvasesPaginated({
        channelId,
        limit: pageSize,
        start: cursor,
        includeArchived,
        onlyArchived,
        ...(trimmedSearchQuery ? { searchQuery: trimmedSearchQuery } : {}),
      });
    }

    return queries.userCanvasesPaginated({
      limit: pageSize,
      start: cursor,
      includeArchived,
      onlyArchived,
      ...(includePublicChannelCanvases ? { includePublicChannelCanvases: true } : {}),
      ...(creatorFilter ? { creatorFilter } : {}),
      ...(creatorFilter === 'others' && createdByUserId ? { createdByUserId } : {}),
      ...(trimmedSearchQuery ? { searchQuery: trimmedSearchQuery } : {}),
    });
  }, [
    channelId,
    createdByUserId,
    creatorFilter,
    cursor,
    includeArchived,
    includePublicChannelCanvases,
    onlyArchived,
    pageSize,
    searchQuery,
  ]);

  // Pagination boundaries must use the live page, not an accumulated cached window.
  const [page, pageDetails] = useQuery(query as never);
  const isLoading = pageDetails.type !== 'complete';

  useEffect(() => {
    onLoadingChange(isLoading);
  }, [isLoading, onLoadingChange]);

  useEffect(() => {
    if (pageDetails.type !== 'complete') return;

    const completedPage = ((page as unknown as Canvas[]) || []).slice();
    onPageComplete(completedPage, previousPageIdsRef.current, pageSize);
    previousPageIdsRef.current = new Set(completedPage.map(canvas => canvas.id));
  }, [cursor, onPageComplete, page, pageDetails.type, pageSize]);

  return null;
};
