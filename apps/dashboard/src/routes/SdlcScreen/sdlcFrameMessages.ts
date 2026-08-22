// postMessage contract between the main bundle and the SDLC lane's iframe. The
// frame is kept alive across route changes, so it cannot be navigated by swapping
// `src` — that would reload it. Paths on the wire are basename-free: both bundles
// share one route table and react-router strips the basename, so a path means the
// same thing on both sides.

import type { AskAIInitialContextSelections, ThreadInfo } from '../../machines/xyneAIMachine';

export const SDLC_FRAME_MESSAGE = {
  navigate: 'xyne:sdlc-frame:navigate',
  route: 'xyne:sdlc-frame:route',
  ready: 'xyne:sdlc-frame:ready',
  reset: 'xyne:sdlc-frame:reset',
  askAi: 'xyne:sdlc-frame:ask-ai',
} as const;

export interface SdlcFrameNavigateMessage {
  type: typeof SDLC_FRAME_MESSAGE.navigate;
  path: string;
}

export interface SdlcFrameRouteMessage {
  type: typeof SDLC_FRAME_MESSAGE.route;
  path: string;
}

export interface SdlcFrameReadyMessage {
  type: typeof SDLC_FRAME_MESSAGE.ready;
}

/** Frame → parent: destroy this frame and mount a fresh one at the SDLC root. */
export interface SdlcFrameResetMessage {
  type: typeof SDLC_FRAME_MESSAGE.reset;
}

/**
 * Frame → parent: open the Ask AI panel for this repository.
 *
 * The panel is owned by the parent — the lane bundle runs with the app chrome
 * stripped (isSdlcSurface feeds isInPanelWebview in AppRoot), so it has no panel
 * of its own, and xyneAIActor is a module singleton that the two documents do not
 * share. Freshness is deliberately NOT decided here: only the parent can compare
 * against the actor that actually owns the conversation.
 */
export interface SdlcFrameAskAiPayload {
  /** Repository channel — the assistant's chat context. */
  channelId: string;
  repoId: string;
  repoName: string;
  /** Forces a new thread even when the actor already holds this repository. */
  forceFreshChat: boolean;
  canvasInfo?: { canvasId: string; title: string };
  initialQuery?: string;
  /** Pre-seeded Ask AI context chips, e.g. the artifact + ticket for Start work. */
  initialContextSelections?: AskAIInitialContextSelections;
  /** Set when the request came from a thread, so the panel opens on that conversation. */
  threadInfo?: ThreadInfo;
}

export interface SdlcFrameAskAiMessage {
  type: typeof SDLC_FRAME_MESSAGE.askAi;
  payload: SdlcFrameAskAiPayload;
}

export type SdlcFrameMessage =
  | SdlcFrameNavigateMessage
  | SdlcFrameRouteMessage
  | SdlcFrameReadyMessage
  | SdlcFrameResetMessage
  | SdlcFrameAskAiMessage;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Both sync directions check this rather than the viewport alone: leaving /sdlc
 * updates the location and clears the viewport in separate effects, so there is a
 * render where the new non-SDLC path is visible while the viewport still looks
 * active — enough to push the frame onto /chat and lose its state.
 */
export function isSdlcPath(pathname: string): boolean {
  return /^\/[^/]+\/sdlc(\/|$)/.test(pathname);
}

/** Shared head of every context-selection entry. Returns null on any mismatch. */
function parseSelectionHead(value: unknown): { id: string; title: string } | null {
  if (!isRecord(value)) return null;
  const { id, title } = value;
  if (typeof id !== 'string' || !id) return null;
  if (typeof title !== 'string') return null;
  return { id, title };
}

function optionalString(value: unknown): { ok: true; value?: string } | { ok: false } {
  if (value === undefined) return { ok: true };
  if (typeof value !== 'string') return { ok: false };
  return { ok: true, value };
}

function parseContextSelections(value: unknown): AskAIInitialContextSelections | null {
  if (!isRecord(value)) return null;
  const { canvases, tickets, recordings } = value;
  if (!Array.isArray(canvases) || !Array.isArray(recordings)) return null;
  if (tickets !== undefined && !Array.isArray(tickets)) return null;

  const parsedCanvases: AskAIInitialContextSelections['canvases'] = [];
  for (const entry of canvases) {
    const head = parseSelectionHead(entry);
    if (!head || !isRecord(entry)) return null;
    const canvasId = optionalString(entry['canvasId']);
    if (!canvasId.ok) return null;
    parsedCanvases.push({
      ...head,
      ...(canvasId.value !== undefined && { canvasId: canvasId.value }),
    });
  }

  const parsedRecordings: AskAIInitialContextSelections['recordings'] = [];
  for (const entry of recordings) {
    const head = parseSelectionHead(entry);
    if (!head || !isRecord(entry)) return null;
    const channelId = optionalString(entry['channelId']);
    const conversationId = optionalString(entry['conversationId']);
    const externalId = optionalString(entry['externalId']);
    if (!channelId.ok || !conversationId.ok || !externalId.ok) return null;
    parsedRecordings.push({
      ...head,
      ...(channelId.value !== undefined && { channelId: channelId.value }),
      ...(conversationId.value !== undefined && { conversationId: conversationId.value }),
      ...(externalId.value !== undefined && { externalId: externalId.value }),
    });
  }

  let parsedTickets: NonNullable<AskAIInitialContextSelections['tickets']> | undefined;
  if (tickets !== undefined) {
    parsedTickets = [];
    for (const entry of tickets) {
      const head = parseSelectionHead(entry);
      if (!head || !isRecord(entry)) return null;
      const xyneId = optionalString(entry['xyneId']);
      const status = optionalString(entry['status']);
      if (!xyneId.ok || !status.ok) return null;
      parsedTickets.push({
        ...head,
        ...(xyneId.value !== undefined && { xyneId: xyneId.value }),
        ...(status.value !== undefined && { status: status.value }),
      });
    }
  }

  return {
    canvases: parsedCanvases,
    recordings: parsedRecordings,
    ...(parsedTickets && { tickets: parsedTickets }),
  };
}

function parseThreadInfo(value: unknown): ThreadInfo | null {
  if (!isRecord(value)) return null;
  const { conversationId, previewText, isThreadMessage, attachmentIds } = value;
  if (typeof conversationId !== 'string' || !conversationId) return null;
  if (typeof previewText !== 'string') return null;
  if (isThreadMessage !== undefined && typeof isThreadMessage !== 'boolean') return null;

  let ids: string[] | undefined;
  if (attachmentIds !== undefined) {
    if (!Array.isArray(attachmentIds)) return null;
    if (attachmentIds.some(id => typeof id !== 'string')) return null;
    ids = attachmentIds as string[];
  }

  const optional: Record<string, string> = {};
  for (const key of ['channelId', 'senderName', 'senderId', 'messageId'] as const) {
    const raw = value[key];
    if (raw === undefined) continue;
    if (typeof raw !== 'string') return null;
    optional[key] = raw;
  }

  return {
    conversationId,
    previewText,
    ...optional,
    ...(isThreadMessage !== undefined && { isThreadMessage }),
    ...(ids && { attachmentIds: ids }),
  };
}

function parseAskAiPayload(value: unknown): SdlcFrameAskAiPayload | null {
  if (!isRecord(value)) return null;
  const { channelId, repoId, repoName, forceFreshChat, canvasInfo, initialQuery } = value;
  if (typeof channelId !== 'string' || !channelId) return null;
  if (typeof repoId !== 'string' || !repoId) return null;
  if (typeof repoName !== 'string') return null;
  if (typeof forceFreshChat !== 'boolean') return null;
  if (initialQuery !== undefined && typeof initialQuery !== 'string') return null;

  let canvas: SdlcFrameAskAiPayload['canvasInfo'];
  if (canvasInfo !== undefined) {
    if (!isRecord(canvasInfo)) return null;
    const { canvasId, title } = canvasInfo;
    if (typeof canvasId !== 'string' || !canvasId) return null;
    if (typeof title !== 'string') return null;
    canvas = { canvasId, title };
  }

  const rawSelections = value['initialContextSelections'];
  let selections: AskAIInitialContextSelections | undefined;
  if (rawSelections !== undefined) {
    const parsed = parseContextSelections(rawSelections);
    if (!parsed) return null;
    selections = parsed;
  }

  const rawThread = value['threadInfo'];
  let thread: ThreadInfo | undefined;
  if (rawThread !== undefined) {
    const parsed = parseThreadInfo(rawThread);
    if (!parsed) return null;
    thread = parsed;
  }

  return {
    channelId,
    repoId,
    repoName,
    forceFreshChat,
    ...(canvas && { canvasInfo: canvas }),
    ...(initialQuery !== undefined && { initialQuery }),
    ...(selections && { initialContextSelections: selections }),
    ...(thread && { threadInfo: thread }),
  };
}

/** Narrows the shape only — callers must also check `event.origin`. */
export function parseSdlcFrameMessage(data: unknown): SdlcFrameMessage | null {
  if (!isRecord(data)) return null;
  const { type } = data;

  if (type === SDLC_FRAME_MESSAGE.ready || type === SDLC_FRAME_MESSAGE.reset) {
    return { type };
  }

  if (type === SDLC_FRAME_MESSAGE.askAi) {
    const payload = parseAskAiPayload(data['payload']);
    return payload ? { type, payload } : null;
  }

  if (type === SDLC_FRAME_MESSAGE.navigate || type === SDLC_FRAME_MESSAGE.route) {
    // Rooted same-origin paths only; '//' would be another host.
    const { path } = data;
    if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//')) {
      return null;
    }
    return { type, path };
  }

  return null;
}
