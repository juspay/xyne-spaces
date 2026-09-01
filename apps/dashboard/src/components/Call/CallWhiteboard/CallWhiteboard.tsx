import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { Room } from 'livekit-client';
import { Brush, Eraser, Plus, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../../../utils/classNames';
import { Button } from '../../ui/Button/Button';
import { callService } from '../../../services/Call/callService';
import { logger, Logger } from '../../../utils/logger';
import {
  addCallWhiteboardStroke,
  appendCallWhiteboardPoint,
  CALL_WHITEBOARD_COLORS,
  CALL_WHITEBOARD_MAX_PAGES,
  CALL_WHITEBOARD_TOPIC,
  completeCallWhiteboardStroke,
  createCallWhiteboardPage,
  createCallWhiteboardPagePngBlob,
  deleteCallWhiteboardStroke,
  getCallWhiteboardStroke,
  getCallWhiteboardStrokes,
  renderCallWhiteboardStroke,
  sendCallWhiteboardEvent,
  subscribeCallWhiteboard,
  useCallWhiteboardStore,
  type CallWhiteboardStroke,
  type CallWhiteboardWireMessage,
  type CallWhiteboardDeletedPageNotice,
} from '../../../stores/callWhiteboardStore';

interface CallWhiteboardProps {
  room: Room | null;
  className?: string | undefined;
  displayOnly?: boolean | undefined;
}

interface CallWhiteboardRenderCache {
  pageId: string;
  width: number;
  height: number;
  strokeIds: string[];
  strokePointCounts: Map<string, number>;
}

function generateStrokeId(identity: string): string {
  return `${identity}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizePoint(
  event: React.PointerEvent<HTMLDivElement>,
  element: HTMLDivElement,
): { x: number; y: number } {
  const rect = element.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
    y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
  };
}

function distanceToSegment(
  point: { x: number; y: number },
  start: { x: number; y: number },
  end: { x: number; y: number },
): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }

  const t = Math.max(
    0,
    Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy)),
  );
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}

function findStrokeAtPoint(
  point: { x: number; y: number },
  strokes: CallWhiteboardStroke[],
  canvasWidth: number,
  canvasHeight: number,
): CallWhiteboardStroke | null {
  const pointer = {
    x: point.x * canvasWidth,
    y: point.y * canvasHeight,
  };

  for (let i = strokes.length - 1; i >= 0; i -= 1) {
    const stroke = strokes[i]!;
    if (stroke.tool !== 'pen' || stroke.points.length === 0) continue;

    const hitRadius = Math.max(10, stroke.width + 6);
    if (stroke.points.length === 1) {
      const onlyPoint = stroke.points[0]!;
      const distance = Math.hypot(
        pointer.x - onlyPoint.x * canvasWidth,
        pointer.y - onlyPoint.y * canvasHeight,
      );
      if (distance <= hitRadius) return stroke;
      continue;
    }

    for (let pointIndex = 1; pointIndex < stroke.points.length; pointIndex += 1) {
      const start = stroke.points[pointIndex - 1]!;
      const end = stroke.points[pointIndex]!;
      const distance = distanceToSegment(
        pointer,
        { x: start.x * canvasWidth, y: start.y * canvasHeight },
        { x: end.x * canvasWidth, y: end.y * canvasHeight },
      );
      if (distance <= hitRadius) return stroke;
    }
  }

  return null;
}

function createRenderCache(
  pageId: string,
  width: number,
  height: number,
  strokes: CallWhiteboardStroke[],
): CallWhiteboardRenderCache {
  return {
    pageId,
    width,
    height,
    strokeIds: strokes.map(stroke => stroke.id),
    strokePointCounts: new Map(strokes.map(stroke => [stroke.id, stroke.points.length])),
  };
}

function canDrawIncrementally(
  cache: CallWhiteboardRenderCache | null,
  pageId: string,
  width: number,
  height: number,
  strokes: CallWhiteboardStroke[],
): cache is CallWhiteboardRenderCache {
  if (!cache || cache.pageId !== pageId || cache.width !== width || cache.height !== height) {
    return false;
  }

  const currentStrokeIds = strokes.map(stroke => stroke.id);
  const isPreviousOrderPreserved = cache.strokeIds.every(
    (strokeId, index) => currentStrokeIds[index] === strokeId,
  );
  if (!isPreviousOrderPreserved) return false;

  return strokes.every(stroke => {
    const previousPointCount = cache.strokePointCounts.get(stroke.id) ?? 0;
    return previousPointCount <= stroke.points.length;
  });
}

function renderStrokeDelta(
  ctx: CanvasRenderingContext2D,
  stroke: CallWhiteboardStroke,
  previousPointCount: number,
  canvasWidth: number,
  canvasHeight: number,
): void {
  const points =
    previousPointCount > 0
      ? stroke.points.slice(Math.max(0, previousPointCount - 1))
      : stroke.points;
  if (points.length === 0) return;

  renderCallWhiteboardStroke(ctx, { ...stroke, points }, canvasWidth, canvasHeight);
}

export function CallWhiteboard({
  room,
  className,
  displayOnly = false,
}: CallWhiteboardProps): React.ReactElement {
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [isSavingBeforeDelete, setIsSavingBeforeDelete] = useState(false);
  const [visibleDeleteNotice, setVisibleDeleteNotice] =
    useState<CallWhiteboardDeletedPageNotice | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const currentStrokeIdRef = useRef<string | null>(null);
  const currentStrokePageIdRef = useRef<string | null>(null);
  const deletedStrokeIdsInGestureRef = useRef<Set<string>>(new Set());
  const isPointerDownRef = useRef(false);
  const frameRef = useRef<number | null>(null);
  const renderCacheRef = useRef<CallWhiteboardRenderCache | null>(null);
  const participantIdentity = room?.localParticipant.identity ?? 'unknown';
  const participantName = room?.localParticipant.name || participantIdentity;

  const color = useCallWhiteboardStore(s => s.color);
  const callId = useCallWhiteboardStore(s => s.callId);
  const strokeWidth = useCallWhiteboardStore(s => s.strokeWidth);
  const tool = useCallWhiteboardStore(s => s.tool);
  const activePageId = useCallWhiteboardStore(s => s.activePageId);
  const pages = useCallWhiteboardStore(s => s.pages);
  const deletedPageNotice = useCallWhiteboardStore(s => s.deletedPageNotice);
  const canAddPage = pages.length < CALL_WHITEBOARD_MAX_PAGES;
  const activePageHasContent = getCallWhiteboardStrokes(activePageId).length > 0;

  const redrawCanvas = useCallback((): void => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const strokes = getCallWhiteboardStrokes(activePageId);
    const cache = renderCacheRef.current;

    if (canDrawIncrementally(cache, activePageId, canvas.width, canvas.height, strokes)) {
      for (const stroke of strokes) {
        const previousPointCount = cache.strokePointCounts.get(stroke.id) ?? 0;
        if (stroke.points.length <= previousPointCount) continue;
        renderStrokeDelta(ctx, stroke, previousPointCount, canvas.width, canvas.height);
      }
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const stroke of strokes) {
        renderCallWhiteboardStroke(ctx, stroke, canvas.width, canvas.height);
      }
    }

    renderCacheRef.current = createRenderCache(activePageId, canvas.width, canvas.height, strokes);
  }, [activePageId]);

  const scheduleRedraw = useCallback((): void => {
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      redrawCanvas();
    });
  }, [redrawCanvas]);

  const publishWhiteboardEvent = useCallback(
    (message: CallWhiteboardWireMessage): void => {
      if (!room) return;
      const reliable = message.type !== 'WHITEBOARD_STROKE_POINT';
      void room.localParticipant.publishData(new TextEncoder().encode(JSON.stringify(message)), {
        reliable,
        topic: CALL_WHITEBOARD_TOPIC,
      });
    },
    [room],
  );

  const deleteStrokeAtPoint = useCallback(
    (point: { x: number; y: number }): boolean => {
      const canvas = canvasRef.current;
      if (!canvas) return false;

      const stroke = findStrokeAtPoint(
        point,
        getCallWhiteboardStrokes(activePageId),
        canvas.width,
        canvas.height,
      );
      if (!stroke || deletedStrokeIdsInGestureRef.current.has(stroke.id)) return false;

      const timestamp = Date.now();
      const deleted = deleteCallWhiteboardStroke(stroke.id, activePageId, timestamp);
      if (!deleted) return false;

      deletedStrokeIdsInGestureRef.current.add(stroke.id);
      publishWhiteboardEvent({
        type: 'WHITEBOARD_STROKE_DELETE',
        participantIdentity,
        pageId: activePageId,
        strokeId: stroke.id,
        timestamp,
      });
      return true;
    },
    [activePageId, participantIdentity, publishWhiteboardEvent],
  );

  useEffect(() => {
    return subscribeCallWhiteboard(scheduleRedraw);
  }, [scheduleRedraw]);

  useEffect(() => {
    renderCacheRef.current = null;
    scheduleRedraw();
  }, [activePageId, scheduleRedraw]);

  useEffect(() => {
    const surface = surfaceRef.current;
    const canvas = canvasRef.current;
    if (!surface || !canvas) return;

    const syncSize = (): void => {
      const rect = surface.getBoundingClientRect();
      const nextWidth = Math.round(rect.width || surface.offsetWidth);
      const nextHeight = Math.round(rect.height || surface.offsetHeight);
      if (nextWidth <= 0 || nextHeight <= 0) return;

      const sizeChanged = canvas.width !== nextWidth || canvas.height !== nextHeight;
      if (sizeChanged) {
        renderCacheRef.current = null;
        canvas.width = nextWidth;
        canvas.height = nextHeight;
      }

      sendCallWhiteboardEvent({
        type: 'setViewportSize',
        width: nextWidth,
        height: nextHeight,
      });
      scheduleRedraw();
    };

    syncSize();
    const observer = new ResizeObserver(syncSize);
    observer.observe(surface);
    return (): void => observer.disconnect();
  }, [scheduleRedraw]);

  useEffect(() => {
    return (): void => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!deletedPageNotice) return undefined;

    setVisibleDeleteNotice(deletedPageNotice);
    const timer = window.setTimeout(() => setVisibleDeleteNotice(null), 5000);
    return (): void => window.clearTimeout(timer);
  }, [deletedPageNotice]);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>): void => {
      const surface = surfaceRef.current;
      if (!surface) return;

      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      isPointerDownRef.current = true;

      const point = normalizePoint(event, surface);
      if (tool === 'delete') {
        deletedStrokeIdsInGestureRef.current.clear();
        deleteStrokeAtPoint(point);
        return;
      }

      const strokeId = generateStrokeId(participantIdentity);
      currentStrokeIdRef.current = strokeId;
      currentStrokePageIdRef.current = activePageId;

      const stroke: CallWhiteboardStroke = {
        id: strokeId,
        pageId: activePageId,
        participantIdentity,
        points: [point],
        color: tool === 'eraser' ? '#000000' : color,
        width: strokeWidth,
        tool,
        isComplete: false,
      };

      addCallWhiteboardStroke(stroke);
      publishWhiteboardEvent({
        type: 'WHITEBOARD_STROKE_BEGIN',
        participantIdentity,
        stroke,
        timestamp: Date.now(),
      });
    },
    [
      activePageId,
      color,
      deleteStrokeAtPoint,
      participantIdentity,
      publishWhiteboardEvent,
      strokeWidth,
      tool,
    ],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>): void => {
      const surface = surfaceRef.current;
      const strokeId = currentStrokeIdRef.current;
      const pageId = currentStrokePageIdRef.current;
      if (!surface || !isPointerDownRef.current) return;

      event.preventDefault();
      const point = normalizePoint(event, surface);
      if (tool === 'delete') {
        deleteStrokeAtPoint(point);
        return;
      }

      if (!strokeId || !pageId) return;
      appendCallWhiteboardPoint(strokeId, point, pageId);
      publishWhiteboardEvent({
        type: 'WHITEBOARD_STROKE_POINT',
        participantIdentity,
        pageId,
        strokeId,
        point,
        timestamp: Date.now(),
      });
    },
    [deleteStrokeAtPoint, participantIdentity, publishWhiteboardEvent, tool],
  );

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>): void => {
      event.preventDefault();
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }

      const strokeId = currentStrokeIdRef.current;
      const pageId = currentStrokePageIdRef.current;

      isPointerDownRef.current = false;
      currentStrokeIdRef.current = null;
      currentStrokePageIdRef.current = null;
      deletedStrokeIdsInGestureRef.current.clear();
      if (!strokeId || !pageId) return;

      completeCallWhiteboardStroke(strokeId, pageId);
      const finalStroke = getCallWhiteboardStroke(strokeId, pageId);
      publishWhiteboardEvent({
        type: 'WHITEBOARD_STROKE_END',
        participantIdentity,
        pageId,
        strokeId,
        ...(finalStroke && { stroke: finalStroke }),
        timestamp: Date.now(),
      });
    },
    [participantIdentity, publishWhiteboardEvent],
  );

  const handleClose = useCallback((): void => {
    const timestamp = Date.now();
    sendCallWhiteboardEvent({ type: 'setOpen', isOpen: false, timestamp });
    publishWhiteboardEvent({
      type: 'WHITEBOARD_VISIBILITY',
      participantIdentity,
      isOpen: false,
      timestamp,
    });
  }, [participantIdentity, publishWhiteboardEvent]);

  const handleAddPage = useCallback((): void => {
    if (!canAddPage) return;

    const page = createCallWhiteboardPage(participantIdentity);
    const timestamp = Date.now();
    sendCallWhiteboardEvent({ type: 'addPage', page, activate: true, timestamp });
    publishWhiteboardEvent({
      type: 'WHITEBOARD_PAGE_CREATE',
      participantIdentity,
      page,
      activePageId: page.id,
      timestamp,
    });
  }, [canAddPage, participantIdentity, publishWhiteboardEvent]);

  const handleSelectPage = useCallback(
    (pageId: string): void => {
      if (pageId === activePageId) return;

      const timestamp = Date.now();
      sendCallWhiteboardEvent({ type: 'selectPage', pageId, timestamp });
      publishWhiteboardEvent({
        type: 'WHITEBOARD_PAGE_SELECT',
        participantIdentity,
        pageId,
        timestamp,
      });
    },
    [activePageId, participantIdentity, publishWhiteboardEvent],
  );

  const deletePageById = useCallback(
    (pageId: string, savedBeforeDelete = false): void => {
      const activePageIndex = pages.findIndex(page => page.id === pageId);
      const nextActivePageId =
        pages.length <= 1
          ? pageId
          : (pages[activePageIndex - 1]?.id ??
            pages[activePageIndex + 1]?.id ??
            pages[0]?.id ??
            pageId);
      const timestamp = Date.now();

      setIsDeleteConfirmOpen(false);
      sendCallWhiteboardEvent({
        type: 'deletePage',
        pageId,
        nextActivePageId,
        timestamp,
        deletedBy: participantName,
        savedBeforeDelete,
      });
      publishWhiteboardEvent({
        type: 'WHITEBOARD_PAGE_DELETE',
        participantIdentity,
        participantName,
        savedBeforeDelete,
        pageId,
        nextActivePageId,
        timestamp,
      });
    },
    [pages, participantIdentity, participantName, publishWhiteboardEvent],
  );

  const handleDeletePage = useCallback((): void => {
    deletePageById(activePageId);
  }, [activePageId, deletePageById]);

  const handleDeleteAndSavePage = useCallback((): void => {
    if (!callId || !activePageHasContent || isSavingBeforeDelete) return;

    const pageIdToDelete = activePageId;
    setIsSavingBeforeDelete(true);
    void (async (): Promise<void> => {
      try {
        const png = await createCallWhiteboardPagePngBlob(pageIdToDelete);
        if (!png) {
          toast.error('Whiteboard page has no content to save');
          return;
        }

        await callService.saveWhiteboard(callId, png);
        toast.success('Whiteboard page saved');
        deletePageById(pageIdToDelete, true);
      } catch (error) {
        toast.error('Whiteboard page could not be saved');
        logger.error(Logger.Event.FRONTEND_ERROR, {
          feature: 'call-whiteboard',
          reason: 'save-before-delete-failed',
          callId,
          pageId: pageIdToDelete,
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        setIsSavingBeforeDelete(false);
      }
    })();
  }, [activePageHasContent, activePageId, callId, deletePageById, isSavingBeforeDelete]);

  return (
    <div className={cn('h-full w-full p-2 sm:p-4', className)}>
      <div className='flex h-full min-h-0 w-full flex-col gap-2'>
        <div className='relative min-h-0 flex-1 w-full overflow-hidden rounded-xl border border-gray-700/60 bg-white shadow-2xl'>
          {!displayOnly && (
            <div className='absolute left-3 top-3 z-20 flex max-w-[calc(100%-4.75rem)] items-center gap-2 overflow-x-auto rounded-full border border-gray-200 bg-white/95 px-2 py-1.5 shadow-lg backdrop-blur'>
              <button
                type='button'
                onClick={() => sendCallWhiteboardEvent({ type: 'setTool', tool: 'pen' })}
                className={cn(
                  'flex h-8 w-8 items-center justify-center rounded-full transition-colors',
                  tool === 'pen' ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-100',
                )}
                title='Pen'
                aria-pressed={tool === 'pen'}
                data-track-category='CALLS'
                data-track-name='Whiteboard_Set_Tool_Pen'
              >
                <Brush className='h-4 w-4' aria-hidden />
              </button>

              <button
                type='button'
                onClick={() => sendCallWhiteboardEvent({ type: 'setTool', tool: 'eraser' })}
                className={cn(
                  'flex h-8 w-8 items-center justify-center rounded-full transition-colors',
                  tool === 'eraser' ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-100',
                )}
                title='Eraser'
                aria-pressed={tool === 'eraser'}
                data-track-category='CALLS'
                data-track-name='Whiteboard_Set_Tool_Eraser'
              >
                <Eraser className='h-4 w-4' aria-hidden />
              </button>

              <button
                type='button'
                onClick={() => sendCallWhiteboardEvent({ type: 'setTool', tool: 'delete' })}
                className={cn(
                  'flex h-8 w-8 items-center justify-center rounded-full transition-colors',
                  tool === 'delete' ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-100',
                )}
                title='Delete stroke'
                aria-pressed={tool === 'delete'}
                data-track-category='CALLS'
                data-track-name='Whiteboard_Set_Tool_Delete'
              >
                <Trash2 className='h-4 w-4' aria-hidden />
              </button>

              <div className='h-6 w-px bg-gray-200' aria-hidden />

              {CALL_WHITEBOARD_COLORS.map(item => (
                <button
                  key={item}
                  type='button'
                  onClick={() => sendCallWhiteboardEvent({ type: 'setColor', color: item })}
                  className={cn(
                    'h-6 w-6 rounded-full border transition-transform hover:scale-110',
                    color === item && tool === 'pen'
                      ? 'ring-2 ring-gray-900 ring-offset-2'
                      : 'border-gray-200',
                  )}
                  style={{ backgroundColor: item }}
                  title={item}
                  aria-label={`Color ${item}`}
                  aria-pressed={color === item && tool === 'pen'}
                  data-track-category='CALLS'
                  data-track-name='Whiteboard_Set_Color'
                  data-track-metadata={JSON.stringify({ color: item })}
                />
              ))}

              <div className='h-6 w-px bg-gray-200' aria-hidden />

              <input
                type='range'
                min={1}
                max={28}
                step={1}
                value={strokeWidth}
                onChange={event =>
                  sendCallWhiteboardEvent({
                    type: 'setStrokeWidth',
                    width: Number(event.target.value),
                  })
                }
                className='w-24 accent-gray-900'
                aria-label='Stroke width'
                data-track-category='CALLS'
                data-track-name='Whiteboard_Set_Stroke_Width'
              />

              <button
                type='button'
                onClick={handleClose}
                className='flex h-8 w-8 items-center justify-center rounded-full text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900'
                title='Close whiteboard'
                data-track-category='CALLS'
                data-track-name='Whiteboard_Close'
              >
                <X className='h-4 w-4' aria-hidden />
              </button>
            </div>
          )}

          {!displayOnly && (
            <button
              type='button'
              onClick={() => setIsDeleteConfirmOpen(true)}
              className='absolute right-3 top-3 z-20 flex h-9 w-9 items-center justify-center rounded-full border border-red-200 bg-white/95 text-red-600 shadow-lg backdrop-blur transition-colors hover:bg-red-50 hover:text-red-700'
              title='Delete whiteboard page'
              data-track-category='CALLS'
              data-track-name='Whiteboard_Delete_Page_Open'
              data-track-metadata={JSON.stringify({ pageId: activePageId })}
            >
              <Trash2 className='h-4 w-4' aria-hidden />
            </button>
          )}

          {!displayOnly && visibleDeleteNotice && (
            <div
              className={cn(
                'absolute left-1/2 top-16 z-20 flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium shadow-lg backdrop-blur',
                visibleDeleteNotice.savedBeforeDelete
                  ? 'border-green-200 bg-green-50/95 text-green-800'
                  : 'border-red-200 bg-red-50/95 text-red-800',
              )}
            >
              <span className='truncate'>
                {visibleDeleteNotice.deletedBy}{' '}
                {visibleDeleteNotice.savedBeforeDelete ? 'saved and deleted' : 'deleted'} whiteboard
              </span>
              <button
                type='button'
                onClick={() => setVisibleDeleteNotice(null)}
                className={cn(
                  'flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition-colors',
                  visibleDeleteNotice.savedBeforeDelete
                    ? 'text-green-700 hover:bg-green-100 hover:text-green-900'
                    : 'text-red-700 hover:bg-red-100 hover:text-red-900',
                )}
                aria-label='Dismiss whiteboard delete notice'
                data-track-category='CALLS'
                data-track-name='Whiteboard_Delete_Notice_Dismiss'
              >
                <X className='h-3.5 w-3.5' aria-hidden />
              </button>
            </div>
          )}

          {!displayOnly && isDeleteConfirmOpen && (
            <div className='absolute inset-0 z-30 flex items-center justify-center bg-gray-950/45 px-4 backdrop-blur-sm'>
              <div
                className='w-full max-w-sm rounded-xl border border-gray-200 bg-white p-4 text-gray-950 shadow-2xl'
                role='dialog'
                aria-modal='true'
                aria-labelledby='call-whiteboard-delete-title'
              >
                <h2 id='call-whiteboard-delete-title' className='text-sm font-semibold'>
                  Delete this whiteboard?
                </h2>
                <p className='mt-2 text-sm leading-5 text-gray-600'>
                  This page and its drawings will be removed for everyone in the call. Save it now
                  if you want it attached to the call thread before deleting.
                </p>
                <div className='mt-4 flex flex-wrap justify-end gap-2'>
                  <button
                    type='button'
                    onClick={() => setIsDeleteConfirmOpen(false)}
                    disabled={isSavingBeforeDelete}
                    className='rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50'
                    data-track-category='CALLS'
                    data-track-name='Whiteboard_Delete_Page_Cancel'
                  >
                    Cancel
                  </button>
                  <Button
                    type='button'
                    variant='ghost'
                    onClick={handleDeleteAndSavePage}
                    disabled={!callId || !activePageHasContent || isSavingBeforeDelete}
                    className='rounded-lg border border-gray-900 px-3 py-2 text-sm font-medium text-gray-900 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50'
                    trackId='whiteboard_delete_page_save_confirm'
                    data-track-category='CALLS'
                    data-track-name='Whiteboard_Delete_Page_Save_Confirm'
                    data-track-metadata={JSON.stringify({ pageId: activePageId })}
                  >
                    {isSavingBeforeDelete ? 'Saving...' : 'Save & delete'}
                  </Button>
                  <Button
                    type='button'
                    variant='ghost'
                    onClick={handleDeletePage}
                    disabled={isSavingBeforeDelete}
                    className='rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50'
                    trackId='whiteboard_delete_page_confirm'
                    data-track-category='CALLS'
                    data-track-name='Whiteboard_Delete_Page_Confirm'
                    data-track-metadata={JSON.stringify({ pageId: activePageId })}
                  >
                    Delete
                  </Button>
                </div>
              </div>
            </div>
          )}

          <div
            ref={surfaceRef}
            className={cn(
              'absolute inset-0 touch-none',
              displayOnly
                ? 'cursor-default'
                : tool === 'delete'
                  ? 'cursor-pointer'
                  : 'cursor-crosshair',
            )}
            onPointerDown={displayOnly ? undefined : handlePointerDown}
            onPointerMove={displayOnly ? undefined : handlePointerMove}
            onPointerUp={displayOnly ? undefined : handlePointerUp}
            onPointerCancel={displayOnly ? undefined : handlePointerUp}
          >
            <canvas ref={canvasRef} className='absolute inset-0 h-full w-full' />
          </div>
        </div>

        {!displayOnly && (
          <div className='flex shrink-0 justify-center'>
            <div
              className='flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-gray-700/70 bg-gray-900/95 p-1 shadow-xl'
              aria-label='Whiteboard pages'
            >
              {pages.map((page, index) => {
                const isActive = page.id === activePageId;
                return (
                  <button
                    key={page.id}
                    type='button'
                    onClick={() => handleSelectPage(page.id)}
                    className={cn(
                      'flex h-8 min-w-8 items-center justify-center rounded-full px-3 text-xs font-semibold transition-colors',
                      isActive
                        ? 'bg-white text-gray-950'
                        : 'text-gray-300 hover:bg-gray-700 hover:text-white',
                    )}
                    title={`Whiteboard ${index + 1}`}
                    aria-pressed={isActive}
                    data-track-category='CALLS'
                    data-track-name='Whiteboard_Select_Page'
                    data-track-metadata={JSON.stringify({ pageId: page.id, index })}
                  >
                    {index + 1}
                  </button>
                );
              })}

              <button
                type='button'
                onClick={handleAddPage}
                disabled={!canAddPage}
                className='flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-gray-300 transition-colors hover:bg-gray-700 hover:text-white disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-gray-300'
                title={canAddPage ? 'Add whiteboard' : 'Maximum 5 whiteboards'}
                data-track-category='CALLS'
                data-track-name='Whiteboard_Add_Page'
              >
                <Plus className='h-4 w-4' aria-hidden />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
