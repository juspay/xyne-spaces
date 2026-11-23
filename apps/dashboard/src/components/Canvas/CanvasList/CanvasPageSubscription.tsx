import React, { useEffect, useMemo, useRef } from 'react';
import type { Canvas } from '../Canvas.types';
import { queries } from '../../../zero/queries';
import { useQuery } from '../../../hooks/useQuery';
import { useCachedQuery } from '@xyne/shared/hooks';

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
  onCachedPage?: ((page: Canvas[], previousPageIds: Set<string>) => void) | undefined;
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
  onCachedPage,
}) => {
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

  const props = { query, pageSize, onPageComplete, onLoadingChange, onCachedPage };
  // Separate components keep hook order stable when the cursor changes.
  return cursor === null ? <CachedFirstPage {...props} /> : <LivePage {...props} />;
};

type PageProps = {
  query:
    | ReturnType<typeof queries.userCanvasesPaginated>
    | ReturnType<typeof queries.channelCanvasesPaginated>;
  pageSize: number;
  onPageComplete: (page: Canvas[], previousPageIds: Set<string>, pageSize: number) => void;
  onLoadingChange: (isLoading: boolean) => void;
  onCachedPage?: ((page: Canvas[], previousPageIds: Set<string>) => void) | undefined;
};

function CachedFirstPage({ query, ...props }: PageProps): React.ReactElement {
  const [page, details, meta] = useCachedQuery(query as never, {
    cursorEnabled: true,
    includeMeta: true,
  });
  return (
    <PageResult
      {...props}
      page={page}
      isLive={details.type === 'complete' && meta?.source === 'fresh' && meta.live}
      isCached={meta?.source === 'cache'}
    />
  );
}

function LivePage({ query, ...props }: PageProps): React.ReactElement {
  const [page, details] = useQuery(query as never);
  return (
    <PageResult {...props} page={page} isLive={details.type === 'complete'} isCached={false} />
  );
}

function PageResult({
  page,
  isLive,
  isCached,
  pageSize,
  onPageComplete,
  onLoadingChange,
  onCachedPage,
}: Omit<PageProps, 'query'> & { page: unknown; isLive: boolean; isCached: boolean }): null {
  const previousLiveIds = useRef<Set<string>>(new Set());
  const cachedIds = useRef<Set<string>>(new Set());
  const receivedLivePage = useRef(false);

  useEffect(() => {
    onLoadingChange(!isLive);
  }, [isLive, onLoadingChange]);

  useEffect(() => {
    const rows = ((page as Canvas[] | undefined) || []).slice();
    if (isLive) {
      receivedLivePage.current = true;
      // Remove display-only placeholders before reconciling the authoritative page.
      if (cachedIds.current.size) onCachedPage?.([], cachedIds.current);
      cachedIds.current = new Set();
      onPageComplete(rows, previousLiveIds.current, pageSize);
      previousLiveIds.current = new Set(rows.map(canvas => canvas.id));
    } else if (isCached && !receivedLivePage.current && onCachedPage) {
      onCachedPage(rows, cachedIds.current);
      cachedIds.current = new Set(rows.map(canvas => canvas.id));
    }
  }, [page, isLive, isCached, pageSize, onPageComplete, onCachedPage]);

  return null;
}
