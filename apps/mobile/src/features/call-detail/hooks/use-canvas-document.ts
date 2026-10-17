import { useEffect, useMemo, useState } from 'react';
import * as Y from 'yjs';

import { useQuery } from '@/src/hooks/useQuery';
import { queries } from '@/src/zero/queries';

import { callDetailService } from '../services/call-detail-service';
import {
  blocksFromBlockNoteJson,
  blocksFromYFragment,
  CANVAS_XML_FRAGMENT,
  isCanvasDocumentEmpty,
  type CanvasBlock,
} from '../utils/canvas-document';

export type CanvasDocumentStatus = 'loading' | 'ready' | 'empty' | 'error';

export interface CanvasDocumentState {
  status: CanvasDocumentStatus;
  blocks: CanvasBlock[];
  title: string | null;
  /** Zero resolved and the viewer cannot see this canvas. */
  isDenied: boolean;
  reload: () => void;
}

/** Keyed `${canvasId}:${nonce}` — a regenerated summary reuses its canvas id. */
const yDocCache = new Map<string, CanvasBlock[]>();

async function loadCollaborativeBlocks(canvasId: string): Promise<CanvasBlock[] | null> {
  const update = await callDetailService.fetchCanvasYjsUpdate(canvasId);
  if (!update || update.length === 0) return null;
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, update);
    return blocksFromYFragment(doc.getXmlFragment(CANVAS_XML_FRAGMENT));
  } finally {
    doc.destroy();
  }
}

/**
 * The blocks of a (read-only) canvas. Stored JSON content is used when the row
 * carries it; collaborative canvases — every call summary and PRD — keep their
 * content in Y-Sweet, so that snapshot is fetched and decoded instead.
 */
export function useCanvasDocument(canvasId: string, nonce = 0): CanvasDocumentState {
  const [canvasRow, canvasDetails] = useQuery(queries.getCanvas({ canvasId }), {
    enabled: canvasId.length > 0,
  });
  const [reloadTick, setReloadTick] = useState(0);
  const cacheKey = `${canvasId}:${nonce}`;
  const [remote, setRemote] = useState<{
    key: string;
    status: CanvasDocumentStatus;
    blocks: CanvasBlock[];
  } | null>(() => {
    const cached = yDocCache.get(cacheKey);
    return cached ? { key: cacheKey, status: 'ready', blocks: cached } : null;
  });

  const storedBlocks = useMemo(
    () => blocksFromBlockNoteJson((canvasRow as { content?: unknown } | undefined)?.content),
    [canvasRow],
  );
  const hasStoredContent = storedBlocks.length > 0 && !isCanvasDocumentEmpty(storedBlocks);
  const isCollaborative = Boolean(
    (canvasRow as { isCollaborative?: boolean } | undefined)?.isCollaborative,
  );
  const needsRemote = !hasStoredContent && (isCollaborative || canvasDetails.type === 'complete');

  useEffect(() => {
    if (!canvasId || !needsRemote) return;
    const cached = reloadTick === 0 ? yDocCache.get(cacheKey) : undefined;
    if (cached) {
      setRemote({ key: cacheKey, status: 'ready', blocks: cached });
      return;
    }
    let cancelled = false;
    setRemote(current =>
      current?.key === cacheKey && current.status === 'ready'
        ? current
        : { key: cacheKey, status: 'loading', blocks: [] },
    );
    loadCollaborativeBlocks(canvasId)
      .then(blocks => {
        if (cancelled) return;
        if (!blocks || isCanvasDocumentEmpty(blocks)) {
          setRemote({ key: cacheKey, status: blocks ? 'empty' : 'error', blocks: [] });
          return;
        }
        yDocCache.set(cacheKey, blocks);
        setRemote({ key: cacheKey, status: 'ready', blocks });
      })
      .catch(() => {
        if (!cancelled) setRemote({ key: cacheKey, status: 'error', blocks: [] });
      });
    return (): void => {
      cancelled = true;
    };
  }, [canvasId, cacheKey, needsRemote, reloadTick]);

  const reload = (): void => setReloadTick(tick => tick + 1);
  const title = (canvasRow as { title?: string } | undefined)?.title ?? null;
  const isDenied = canvasDetails.type === 'complete' && !canvasRow;

  if (hasStoredContent) {
    return { status: 'ready', blocks: storedBlocks, title, isDenied: false, reload };
  }
  if (remote?.key === cacheKey) {
    return { status: remote.status, blocks: remote.blocks, title, isDenied, reload };
  }
  return { status: 'loading', blocks: [], title, isDenied, reload };
}
