import { useSyncExternalStore } from 'react';
import { logger, Logger } from '../utils/logger';

export type CallWhiteboardTool = 'pen' | 'eraser' | 'delete';

export const CALL_WHITEBOARD_TOPIC = 'call-whiteboard';

export const CALL_WHITEBOARD_COLORS = [
  '#111827',
  '#EF4444',
  '#F59E0B',
  '#22C55E',
  '#3B82F6',
  '#8B5CF6',
] as const;

export const CALL_WHITEBOARD_MAX_PAGES = 5;

const DEFAULT_PAGE_ID = 'whiteboard-page-1';

export interface CallWhiteboardPoint {
  x: number;
  y: number;
}

export interface CallWhiteboardPage {
  id: string;
  label: string;
  order: number;
  createdAt: number;
  createdBy: string;
}

export interface CallWhiteboardStroke {
  id: string;
  pageId: string;
  participantIdentity: string;
  points: CallWhiteboardPoint[];
  color: string;
  width: number;
  tool: CallWhiteboardTool;
  isComplete: boolean;
}

export type CallWhiteboardWireMessage =
  | {
      type: 'WHITEBOARD_STROKE_BEGIN';
      participantIdentity: string;
      stroke: CallWhiteboardStroke;
      timestamp: number;
    }
  | {
      type: 'WHITEBOARD_STROKE_POINT';
      participantIdentity: string;
      pageId: string;
      strokeId: string;
      point: CallWhiteboardPoint;
      timestamp: number;
    }
  | {
      type: 'WHITEBOARD_STROKE_END';
      participantIdentity: string;
      pageId: string;
      strokeId: string;
      stroke?: CallWhiteboardStroke;
      timestamp: number;
    }
  | {
      type: 'WHITEBOARD_CLEAR';
      participantIdentity: string;
      pageId: string;
      timestamp: number;
    }
  | {
      type: 'WHITEBOARD_STROKE_DELETE';
      participantIdentity: string;
      pageId: string;
      strokeId: string;
      timestamp: number;
    }
  | {
      type: 'WHITEBOARD_PAGE_CREATE';
      participantIdentity: string;
      page: CallWhiteboardPage;
      activePageId: string;
      timestamp: number;
    }
  | {
      type: 'WHITEBOARD_PAGE_SELECT';
      participantIdentity: string;
      pageId: string;
      timestamp: number;
    }
  | {
      type: 'WHITEBOARD_PAGE_DELETE';
      participantIdentity: string;
      participantName?: string;
      savedBeforeDelete?: boolean;
      pageId: string;
      nextActivePageId: string;
      timestamp: number;
    }
  | {
      type: 'WHITEBOARD_VISIBILITY';
      participantIdentity: string;
      isOpen: boolean;
      timestamp: number;
    }
  | {
      type: 'WHITEBOARD_SYNC_REQUEST';
      participantIdentity: string;
      timestamp: number;
    }
  | {
      type: 'WHITEBOARD_SYNC_STATE';
      participantIdentity: string;
      pages: CallWhiteboardPage[];
      activePageId: string;
      isOpen: boolean;
      strokes: CallWhiteboardStroke[];
      deletedPageIds?: Record<string, number>;
      deletedStrokeIds?: Record<string, number>;
      timestamp: number;
    };

export interface CallWhiteboardState {
  callId: string | null;
  isOpen: boolean;
  color: string;
  strokeWidth: number;
  tool: CallWhiteboardTool;
  hasContent: boolean;
  version: number;
  viewportWidth: number;
  viewportHeight: number;
  pages: CallWhiteboardPage[];
  activePageId: string;
  deletedPageNotice: CallWhiteboardDeletedPageNotice | null;
}

export interface CallWhiteboardDeletedPageNotice {
  pageId: string;
  pageLabel: string;
  deletedBy: string;
  savedBeforeDelete: boolean;
  timestamp: number;
}

export interface CallWhiteboardPngBlob {
  blob: Blob;
  width: number;
  height: number;
  pageId: string;
  pageLabel: string;
  pageOrder: number;
}

export type CallWhiteboardEvent =
  | { type: 'setCallId'; callId: string | null }
  | { type: 'toggleOpen' }
  | { type: 'setOpen'; isOpen: boolean; timestamp?: number }
  | { type: 'setColor'; color: string }
  | { type: 'setStrokeWidth'; width: number }
  | { type: 'setTool'; tool: CallWhiteboardTool }
  | { type: 'clear'; pageId?: string }
  | { type: 'deleteStroke'; pageId: string; strokeId: string; timestamp?: number }
  | { type: 'addPage'; page: CallWhiteboardPage; activate?: boolean; timestamp?: number }
  | { type: 'selectPage'; pageId: string; timestamp?: number }
  | {
      type: 'deletePage';
      pageId: string;
      nextActivePageId: string;
      timestamp?: number;
      deletedBy?: string;
      savedBeforeDelete?: boolean;
    }
  | { type: 'setViewportSize'; width: number; height: number };

const pages = new Map<string, CallWhiteboardPage>();
const strokesByPage = new Map<string, Map<string, CallWhiteboardStroke>>();
const deletedPageTimestamps = new Map<string, number>();
const deletedStrokeTimestamps = new Map<string, number>();
const savedCallTimestamps = new Map<string, number>();
const listeners = new Set<() => void>();

const SAVED_CALL_CACHE_MAX_ENTRIES = 50;
const SAVED_CALL_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

let activePageChangedAt = 0;
let visibilityChangedAt = 0;

function createInitialPage(): CallWhiteboardPage {
  return {
    id: DEFAULT_PAGE_ID,
    label: '1',
    order: 0,
    createdAt: 0,
    createdBy: 'system',
  };
}

pages.set(DEFAULT_PAGE_ID, createInitialPage());
strokesByPage.set(DEFAULT_PAGE_ID, new Map());

let state: CallWhiteboardState = {
  callId: null,
  isOpen: false,
  color: '#111827',
  strokeWidth: 4,
  tool: 'pen',
  hasContent: false,
  version: 0,
  viewportWidth: 1600,
  viewportHeight: 900,
  pages: [createInitialPage()],
  activePageId: DEFAULT_PAGE_ID,
  deletedPageNotice: null,
};

function clonePage(page: CallWhiteboardPage): CallWhiteboardPage {
  return { ...page };
}

function cloneStroke(stroke: CallWhiteboardStroke): CallWhiteboardStroke {
  return {
    ...stroke,
    points: stroke.points.map(point => ({ ...point })),
  };
}

function getSortedPages(): CallWhiteboardPage[] {
  return Array.from(pages.values())
    .sort((a, b) => a.order - b.order || a.createdAt - b.createdAt || a.id.localeCompare(b.id))
    .map(clonePage);
}

function ensureDefaultPage(): CallWhiteboardPage {
  const existing = pages.get(DEFAULT_PAGE_ID);
  if (existing) {
    if (!strokesByPage.has(DEFAULT_PAGE_ID)) {
      strokesByPage.set(DEFAULT_PAGE_ID, new Map());
    }
    return existing;
  }

  if (pages.size > 0) {
    return Array.from(pages.values()).sort(
      (a, b) => a.order - b.order || a.createdAt - b.createdAt || a.id.localeCompare(b.id),
    )[0]!;
  }

  const page = createInitialPage();
  pages.set(page.id, page);
  strokesByPage.set(page.id, new Map());
  return page;
}

function getPageStrokes(pageId: string, create = false): Map<string, CallWhiteboardStroke> | null {
  const existing = strokesByPage.get(pageId);
  if (existing || !create) return existing ?? null;

  const next = new Map<string, CallWhiteboardStroke>();
  strokesByPage.set(pageId, next);
  return next;
}

function hasAnyContent(): boolean {
  for (const pageStrokes of strokesByPage.values()) {
    if (pageStrokes.size > 0) return true;
  }
  return false;
}

function markUnsaved(): void {
  if (state.callId) {
    savedCallTimestamps.delete(state.callId);
  }
}

function pruneSavedCallTimestamps(now = Date.now()): void {
  for (const [callId, savedAt] of savedCallTimestamps) {
    if (now - savedAt > SAVED_CALL_CACHE_TTL_MS) {
      savedCallTimestamps.delete(callId);
    }
  }

  while (savedCallTimestamps.size > SAVED_CALL_CACHE_MAX_ENTRIES) {
    const oldestCallId = savedCallTimestamps.keys().next().value;
    if (!oldestCallId) return;
    savedCallTimestamps.delete(oldestCallId);
  }
}

function debugWhiteboardBlobSkipped(reason: string, detail?: string): void {
  if (!import.meta.env.DEV) return;
  logger.debug(Logger.Event.FRONTEND_ERROR, {
    feature: 'call-whiteboard',
    callId: state.callId,
    reason,
    ...(detail && { detail }),
  });
}

function emit(partial: Partial<CallWhiteboardState> = {}): void {
  const fallbackPage = ensureDefaultPage();
  const requestedActivePageId = partial.activePageId ?? state.activePageId;
  const activePageId = pages.has(requestedActivePageId) ? requestedActivePageId : fallbackPage.id;

  state = {
    ...state,
    ...partial,
    activePageId,
    pages: getSortedPages(),
    hasContent: hasAnyContent(),
    version: state.version + 1,
  };
  listeners.forEach(listener => listener());
}

function resetWhiteboardForCall(callId: string | null): void {
  pages.clear();
  strokesByPage.clear();
  deletedPageTimestamps.clear();
  deletedStrokeTimestamps.clear();
  const page = createInitialPage();
  pages.set(page.id, page);
  strokesByPage.set(page.id, new Map());
  activePageChangedAt = 0;
  visibilityChangedAt = 0;

  emit({
    callId,
    isOpen: false,
    color: '#111827',
    strokeWidth: 4,
    tool: 'pen',
    activePageId: page.id,
    deletedPageNotice: null,
  });
}

function setWhiteboardOpen(isOpen: boolean, timestamp = Date.now()): void {
  if (timestamp < visibilityChangedAt) return;
  visibilityChangedAt = timestamp;
  emit({ isOpen });
}

function setActivePage(pageId: string, timestamp = Date.now()): boolean {
  if (!pages.has(pageId) || timestamp < activePageChangedAt) return false;
  activePageChangedAt = timestamp;
  emit({ activePageId: pageId });
  return true;
}

function createDeletedPageNotice(
  pageId: string,
  deletedBy: string | undefined,
  timestamp: number,
  savedBeforeDelete = false,
): CallWhiteboardDeletedPageNotice {
  const page = pages.get(pageId);
  return {
    pageId,
    pageLabel: page?.label ?? 'this page',
    deletedBy: deletedBy?.trim() || 'Someone',
    savedBeforeDelete,
    timestamp,
  };
}

function deletePage(
  pageId: string,
  nextActivePageId: string,
  timestamp = Date.now(),
  deletedBy?: string,
  savedBeforeDelete = false,
): void {
  if (!pages.has(pageId)) return;

  const sortedPages = getSortedPages();
  const deletedPageNotice = createDeletedPageNotice(
    pageId,
    deletedBy,
    timestamp,
    savedBeforeDelete,
  );
  if (sortedPages.length <= 1) {
    getPageStrokes(pageId)?.clear();
    markUnsaved();
    emit({ activePageId: pageId, deletedPageNotice });
    return;
  }

  deletedPageTimestamps.set(pageId, Math.max(timestamp, deletedPageTimestamps.get(pageId) ?? 0));
  pages.delete(pageId);
  strokesByPage.delete(pageId);
  markUnsaved();

  const fallbackPageId = getSortedPages()[0]?.id ?? DEFAULT_PAGE_ID;
  const activePageId =
    pages.has(nextActivePageId) && state.activePageId === pageId
      ? nextActivePageId
      : pages.has(state.activePageId)
        ? state.activePageId
        : fallbackPageId;

  activePageChangedAt = Math.max(activePageChangedAt, timestamp);
  emit({ activePageId, deletedPageNotice });
}

export function subscribeCallWhiteboard(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getCallWhiteboardState(): CallWhiteboardState {
  return state;
}

export function getCallWhiteboardPages(): CallWhiteboardPage[] {
  return getSortedPages();
}

export function getCallWhiteboardStrokes(pageId = state.activePageId): CallWhiteboardStroke[] {
  return Array.from(getPageStrokes(pageId)?.values() ?? []).map(cloneStroke);
}

export function getAllCallWhiteboardStrokes(): CallWhiteboardStroke[] {
  return Array.from(strokesByPage.values()).flatMap(pageStrokes =>
    Array.from(pageStrokes.values()).map(cloneStroke),
  );
}

export function getCallWhiteboardDeletedPages(): Record<string, number> {
  return Object.fromEntries(deletedPageTimestamps);
}

export function getCallWhiteboardDeletedStrokes(): Record<string, number> {
  return Object.fromEntries(deletedStrokeTimestamps);
}

export function getCallWhiteboardStroke(
  strokeId: string,
  pageId = state.activePageId,
): CallWhiteboardStroke | null {
  return getPageStrokes(pageId)?.get(strokeId) ?? null;
}

export function useCallWhiteboardStore<T>(selector: (snapshot: CallWhiteboardState) => T): T {
  return useSyncExternalStore(subscribeCallWhiteboard, (): T => selector(state));
}

export function createCallWhiteboardPage(participantIdentity: string): CallWhiteboardPage {
  const sortedPages = getSortedPages();
  const nextIndex = sortedPages.length;
  const nextOrder = sortedPages.reduce((max, page) => Math.max(max, page.order), -1) + 1;
  const createdAt = Date.now();
  return {
    id: `${participantIdentity}-${createdAt}-${Math.random().toString(36).slice(2, 8)}`,
    label: String(nextIndex + 1),
    order: nextOrder,
    createdAt,
    createdBy: participantIdentity,
  };
}

export function sendCallWhiteboardEvent(event: CallWhiteboardEvent): void {
  switch (event.type) {
    case 'setCallId': {
      if (state.callId === event.callId) return;
      resetWhiteboardForCall(event.callId);
      return;
    }
    case 'toggleOpen':
      setWhiteboardOpen(!state.isOpen);
      return;
    case 'setOpen':
      setWhiteboardOpen(event.isOpen, event.timestamp);
      return;
    case 'setColor':
      emit({ color: event.color, tool: 'pen' });
      return;
    case 'setStrokeWidth':
      emit({ strokeWidth: Math.max(1, Math.min(28, event.width)) });
      return;
    case 'setTool':
      emit({ tool: event.tool });
      return;
    case 'clear': {
      const pageId = event.pageId ?? state.activePageId;
      getPageStrokes(pageId)?.clear();
      markUnsaved();
      emit();
      return;
    }
    case 'deleteStroke': {
      deleteCallWhiteboardStroke(event.strokeId, event.pageId, event.timestamp);
      return;
    }
    case 'addPage': {
      const existing = pages.get(event.page.id);
      let changed = false;
      const deletedAt = deletedPageTimestamps.get(event.page.id);
      if (!existing && !deletedAt && pages.size < CALL_WHITEBOARD_MAX_PAGES) {
        pages.set(event.page.id, clonePage(event.page));
        strokesByPage.set(event.page.id, new Map());
        changed = true;
      }
      if (event.activate) {
        const activated = setActivePage(event.page.id, event.timestamp);
        if (!activated && changed) emit();
      } else if (changed) {
        emit();
      }
      return;
    }
    case 'selectPage':
      setActivePage(event.pageId, event.timestamp);
      return;
    case 'deletePage':
      deletePage(
        event.pageId,
        event.nextActivePageId,
        event.timestamp,
        event.deletedBy,
        event.savedBeforeDelete,
      );
      return;
    case 'setViewportSize':
      emit({
        viewportWidth: Math.max(1, Math.round(event.width)),
        viewportHeight: Math.max(1, Math.round(event.height)),
      });
      return;
  }
}

export function addCallWhiteboardStroke(stroke: CallWhiteboardStroke): void {
  if (deletedPageTimestamps.has(stroke.pageId)) return;
  if (deletedStrokeTimestamps.has(stroke.id)) return;

  if (!pages.has(stroke.pageId)) {
    if (pages.size >= CALL_WHITEBOARD_MAX_PAGES) return;

    pages.set(stroke.pageId, {
      id: stroke.pageId,
      label: String(pages.size + 1),
      order: pages.size,
      createdAt: Date.now(),
      createdBy: stroke.participantIdentity,
    });
  }

  getPageStrokes(stroke.pageId, true)?.set(stroke.id, cloneStroke(stroke));
  markUnsaved();
  emit();
}

export function appendCallWhiteboardPoint(
  strokeId: string,
  point: CallWhiteboardPoint,
  pageId = state.activePageId,
): void {
  if (deletedStrokeTimestamps.has(strokeId)) return;
  const stroke = getPageStrokes(pageId)?.get(strokeId);
  if (!stroke) return;
  stroke.points.push({ ...point });
  markUnsaved();
  emit();
}

export function completeCallWhiteboardStroke(
  strokeId: string,
  pageId = state.activePageId,
  finalStroke?: CallWhiteboardStroke,
): void {
  if (deletedStrokeTimestamps.has(strokeId)) return;

  if (finalStroke) {
    addCallWhiteboardStroke({ ...finalStroke, isComplete: true });
    return;
  }

  const stroke = getPageStrokes(pageId)?.get(strokeId);
  if (!stroke) return;
  stroke.isComplete = true;
  markUnsaved();
  emit();
}

export function deleteCallWhiteboardStroke(
  strokeId: string,
  pageId = state.activePageId,
  timestamp = Date.now(),
): boolean {
  const pageStrokes = getPageStrokes(pageId);
  const existing = pageStrokes?.get(strokeId);
  if (!pageStrokes || !existing) {
    deletedStrokeTimestamps.set(
      strokeId,
      Math.max(timestamp, deletedStrokeTimestamps.get(strokeId) ?? 0),
    );
    return false;
  }

  pageStrokes.delete(strokeId);
  deletedStrokeTimestamps.set(
    strokeId,
    Math.max(timestamp, deletedStrokeTimestamps.get(strokeId) ?? 0),
  );
  markUnsaved();
  emit();
  return true;
}

export function mergeCallWhiteboardState({
  incomingPages,
  incomingStrokes,
  activePageId,
  deletedPageIds,
  deletedStrokeIds,
  timestamp,
}: {
  incomingPages: CallWhiteboardPage[];
  incomingStrokes: CallWhiteboardStroke[];
  activePageId: string;
  deletedPageIds?: Record<string, number>;
  deletedStrokeIds?: Record<string, number>;
  timestamp: number;
}): void {
  let changed = false;

  for (const [pageId, deletedAt] of Object.entries(deletedPageIds ?? {})) {
    if (deletedAt > (deletedPageTimestamps.get(pageId) ?? 0)) {
      deletedPageTimestamps.set(pageId, deletedAt);
      pages.delete(pageId);
      strokesByPage.delete(pageId);
      changed = true;
    }
  }

  for (const [strokeId, deletedAt] of Object.entries(deletedStrokeIds ?? {})) {
    if (deletedAt > (deletedStrokeTimestamps.get(strokeId) ?? 0)) {
      deletedStrokeTimestamps.set(strokeId, deletedAt);
      for (const pageStrokes of strokesByPage.values()) {
        if (pageStrokes.delete(strokeId)) changed = true;
      }
    }
  }

  for (const page of incomingPages) {
    const deletedAt = deletedPageTimestamps.get(page.id);
    if (deletedAt !== undefined && deletedAt >= page.createdAt) continue;

    if (!pages.has(page.id) && pages.size < CALL_WHITEBOARD_MAX_PAGES) {
      pages.set(page.id, clonePage(page));
      strokesByPage.set(page.id, new Map());
      changed = true;
    }
  }

  for (const stroke of incomingStrokes) {
    if (!pages.has(stroke.pageId) || deletedPageTimestamps.has(stroke.pageId)) continue;
    if (deletedStrokeTimestamps.has(stroke.id)) continue;

    const pageStrokes = getPageStrokes(stroke.pageId, true);
    const existing = pageStrokes?.get(stroke.id);
    if (!pageStrokes) continue;

    if (!existing || existing.points.length < stroke.points.length || !existing.isComplete) {
      pageStrokes.set(stroke.id, cloneStroke(stroke));
      changed = true;
    }
  }

  if (pages.has(activePageId) && timestamp >= activePageChangedAt) {
    if (changed) markUnsaved();
    activePageChangedAt = timestamp;
    emit({ activePageId });
    return;
  }

  if (changed) {
    markUnsaved();
    emit();
  }
}

export function markCallWhiteboardSaved(callId: string): void {
  const now = Date.now();
  savedCallTimestamps.set(callId, now);
  pruneSavedCallTimestamps(now);
}

export function isCallWhiteboardSaved(callId: string): boolean {
  const savedAt = savedCallTimestamps.get(callId);
  if (!savedAt) return false;

  const now = Date.now();
  if (now - savedAt > SAVED_CALL_CACHE_TTL_MS) {
    savedCallTimestamps.delete(callId);
    return false;
  }

  return true;
}

export function renderCallWhiteboardStroke(
  ctx: CanvasRenderingContext2D,
  stroke: CallWhiteboardStroke,
  canvasWidth: number,
  canvasHeight: number,
): void {
  const first = stroke.points[0];
  if (!first) return;

  ctx.save();
  ctx.globalCompositeOperation = stroke.tool === 'eraser' ? 'destination-out' : 'source-over';
  ctx.strokeStyle = stroke.tool === 'eraser' ? '#000000' : stroke.color;
  ctx.fillStyle = ctx.strokeStyle;
  ctx.lineWidth = Math.max(1, stroke.width);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(first.x * canvasWidth, first.y * canvasHeight);

  if (stroke.points.length === 1) {
    ctx.arc(first.x * canvasWidth, first.y * canvasHeight, ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }

  for (let i = 1; i < stroke.points.length - 1; i += 1) {
    const current = stroke.points[i]!;
    const next = stroke.points[i + 1]!;
    const midX = ((current.x + next.x) / 2) * canvasWidth;
    const midY = ((current.y + next.y) / 2) * canvasHeight;
    ctx.quadraticCurveTo(current.x * canvasWidth, current.y * canvasHeight, midX, midY);
  }

  const last = stroke.points[stroke.points.length - 1]!;
  ctx.lineTo(last.x * canvasWidth, last.y * canvasHeight);
  ctx.stroke();
  ctx.restore();
}

export async function createCallWhiteboardPagePngBlob(
  pageId: string,
): Promise<CallWhiteboardPngBlob | null> {
  if (typeof document === 'undefined') {
    debugWhiteboardBlobSkipped('document-unavailable');
    return null;
  }

  const page = pages.get(pageId);
  if (!page) {
    debugWhiteboardBlobSkipped('page-unavailable');
    return null;
  }

  const pageStrokes = getCallWhiteboardStrokes(page.id);
  if (pageStrokes.length === 0) {
    debugWhiteboardBlobSkipped('page-no-content');
    return null;
  }

  const sourceWidth = Math.max(1, state.viewportWidth);
  const sourceHeight = Math.max(1, state.viewportHeight);
  const maxWidth = 1600;
  const scale = Math.min(1, maxWidth / sourceWidth);
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    debugWhiteboardBlobSkipped('canvas-context-unavailable');
    return null;
  }

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  for (const stroke of pageStrokes) {
    renderCallWhiteboardStroke(ctx, stroke, width, height);
  }

  let blob: Blob | null = null;
  try {
    blob = await new Promise<Blob | null>(resolve => {
      canvas.toBlob(resolve, 'image/png');
    });
  } catch (error) {
    debugWhiteboardBlobSkipped(
      'blob-creation-failed',
      error instanceof Error ? error.message : String(error),
    );
    return null;
  }

  if (!blob) {
    debugWhiteboardBlobSkipped('blob-unavailable');
    return null;
  }

  return {
    blob,
    width,
    height,
    pageId: page.id,
    pageLabel: page.label,
    pageOrder: page.order,
  };
}

export async function createCallWhiteboardPngBlobs(): Promise<CallWhiteboardPngBlob[]> {
  if (!hasAnyContent()) {
    debugWhiteboardBlobSkipped('no-content');
    return [];
  }

  const contentPages = getSortedPages().filter(page => (getPageStrokes(page.id)?.size ?? 0) > 0);
  if (contentPages.length === 0) {
    debugWhiteboardBlobSkipped('no-content-pages');
    return [];
  }

  const blobs: CallWhiteboardPngBlob[] = [];
  for (const page of contentPages) {
    const pageBlob = await createCallWhiteboardPagePngBlob(page.id);
    if (pageBlob) {
      blobs.push(pageBlob);
    }
  }

  return blobs;
}
