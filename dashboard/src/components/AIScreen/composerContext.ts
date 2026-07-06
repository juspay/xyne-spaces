import type { ResearchContext } from '@xyne/shared';
import {
  toAttachedContext,
  type SelectedChannel,
  type SelectedTicket,
  type SelectedCanvas,
  type SelectedTranscript,
  type SelectedRecording,
} from '../Chat/XyneAISidebar/components/ContextPickerPanel';
import type { StreamOverrides } from '../../hooks/useXyneAIStream';

/**
 * Full snapshot of the extra composer state on the /ai page — everything the
 * screenshot toolbar controls: the `/` context picker selections, collections
 * (book), a scoped file, the research (search) selection, and the web-search /
 * deep-research / create-canvas toggles.
 *
 * Owned by AIComposer, passed up on submit and threaded into
 * useXyneAIStream.submitQuery via {@link toStreamOverrides}. It's also passed
 * back down as `initialExtras` so the landing → chat handoff seeds the chat
 * composer with the same selections the user made on the landing page.
 */
export interface ComposerContext {
  channels: SelectedChannel[];
  tickets: SelectedTicket[];
  canvases: SelectedCanvas[];
  transcripts: SelectedTranscript[];
  recordings: SelectedRecording[];
  collections: { id: string; name: string }[];
  fileScopes: { id: string; name: string }[];
  research: ResearchContext | null;
  webSearchEnabled: boolean;
  deepResearchEnabled: boolean;
  createCanvasEnabled: boolean;
}

export const EMPTY_COMPOSER_CONTEXT: ComposerContext = {
  channels: [],
  tickets: [],
  canvases: [],
  transcripts: [],
  recordings: [],
  collections: [],
  fileScopes: [],
  research: null,
  webSearchEnabled: false,
  deepResearchEnabled: false,
  createCanvasEnabled: false,
};

/** True when the snapshot carries any context/toggle worth sending as overrides. */
export function hasComposerContext(ctx: ComposerContext): boolean {
  return (
    ctx.channels.length > 0 ||
    ctx.tickets.length > 0 ||
    ctx.canvases.length > 0 ||
    ctx.transcripts.length > 0 ||
    ctx.recordings.length > 0 ||
    ctx.collections.length > 0 ||
    ctx.fileScopes.length > 0 ||
    ctx.research !== null ||
    ctx.webSearchEnabled ||
    ctx.deepResearchEnabled ||
    ctx.createCanvasEnabled
  );
}

/**
 * Convert a composer snapshot into the per-submit override object consumed by
 * useXyneAIStream.submitQuery. Mirrors how XyneAISidebar feeds the same fields
 * into the hook config (channelIds sent both as `channelIds` and inside
 * `attachedContext`; transcripts + recordings both map to call ids).
 */
export function toStreamOverrides(ctx: ComposerContext): StreamOverrides {
  return {
    channelIds: ctx.channels.map(c => c.id),
    collectionIds: ctx.collections.map(c => c.id),
    fileIds: ctx.fileScopes.map(f => f.id),
    ticketIds: ctx.tickets.map(t => t.id),
    canvasIds: ctx.canvases.map(c => c.id),
    callIds: [...ctx.transcripts.map(t => t.id), ...ctx.recordings.map(r => r.id)],
    attachedContext: toAttachedContext({
      channels: ctx.channels,
      tickets: ctx.tickets,
      canvases: ctx.canvases,
      transcripts: ctx.transcripts,
      recordings: ctx.recordings,
    }),
    webSearchEnabled: ctx.webSearchEnabled,
    deepResearchEnabled: ctx.deepResearchEnabled,
    createCanvasEnabled: ctx.createCanvasEnabled,
    researchContext: ctx.research,
  };
}
