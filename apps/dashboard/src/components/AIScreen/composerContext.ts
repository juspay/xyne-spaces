import type { ResearchContext } from '@xyne/shared';
import {
  toAttachedContext,
  type SelectedChannel,
  type SelectedTicket,
  type SelectedCanvas,
  type SelectedTranscript,
  type SelectedRecording,
  type AttachedContextItem,
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
  /** A specific folder scoped in (not the whole collection, not one file).
   *  Sent to claw-auth as a single 'folder' attached_context pointer — NOT
   *  expanded to a recursive file list here (xyneAIControllerV2.ts doesn't
   *  do that); claw-auth resolves it itself, at Vespa-query time, since
   *  Vespa's collectionId filter only ever matches a doc's ROOT collection
   *  and can't filter on a folder id directly. */
  folderScopes: { id: string; name: string }[];
  research: ResearchContext | null;
  webSearchEnabled: boolean;
  deepResearchEnabled: boolean;
  createCanvasEnabled: boolean;
  /** Single search + single answer pass instead of the full agentic tool
   *  loop — see xyne-claw-auth's run-stream.ts POST / instant branch. */
  instant: boolean;
  /** Per-run model pin from the composer's model dropdown. The list comes from
   *  the account's allowed models (the agent's shared LiteLLM key's /v1/models);
   *  null = "Default" — the model configured in the DB. A pick is the source of
   *  truth for the run: it overrides the agent's configured model. */
  model: string | null;
  /** Which provider the model pin rides — the models endpoint's pinProvider.
   *  null when no model is picked. */
  modelProvider: 'litellm' | 'spaces' | null;
  /** Per-run thinking level from the composer's thinking dropdown.
   *  null = the agent's configured default. */
  thinkingLevel: 'off' | 'minimal' | 'low' | 'medium' | 'high' | null;
}

export const EMPTY_COMPOSER_CONTEXT: ComposerContext = {
  channels: [],
  tickets: [],
  canvases: [],
  transcripts: [],
  recordings: [],
  collections: [],
  fileScopes: [],
  folderScopes: [],
  research: null,
  webSearchEnabled: false,
  deepResearchEnabled: false,
  createCanvasEnabled: false,
  instant: false,
  model: null,
  modelProvider: null,
  thinkingLevel: null,
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
    ctx.folderScopes.length > 0 ||
    ctx.research !== null ||
    ctx.webSearchEnabled ||
    ctx.deepResearchEnabled ||
    ctx.createCanvasEnabled ||
    ctx.instant ||
    ctx.model !== null ||
    ctx.thinkingLevel !== null
  );
}

/**
 * KB scopes (collections, folders) shared by the sent `attachedContext` and
 * the richer display set below. Collections/folders carry their cuid + name
 * already, so they ride as ordinary attachedContext entries — unlike files,
 * which need the backend's fileId(UUID)-or-id(cuid) resolution (see
 * `fileIds` in {@link toStreamOverrides} and xyneAIControllerV2.ts).
 */
function toBaseAttachedContext(ctx: ComposerContext): AttachedContextItem[] {
  return toAttachedContext({
    channels: ctx.channels,
    tickets: ctx.tickets,
    canvases: ctx.canvases,
    transcripts: ctx.transcripts,
    recordings: ctx.recordings,
    folders: ctx.folderScopes,
    collections: ctx.collections,
  });
}

/**
 * The FULL context set for DISPLAY on the sent message's pills — adds file
 * items (with their client-known titles) on top of {@link toBaseAttachedContext}
 * so the just-sent message's pills match what reload shows once the backend
 * resolves and persists the file's attached_context entry.
 */
export function toDisplayAttachedContext(ctx: ComposerContext): AttachedContextItem[] {
  return toAttachedContext({
    channels: ctx.channels,
    tickets: ctx.tickets,
    canvases: ctx.canvases,
    transcripts: ctx.transcripts,
    recordings: ctx.recordings,
    files: ctx.fileScopes,
    folders: ctx.folderScopes,
    collections: ctx.collections,
  });
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
    // Sent as bare ids, not attachedContext — see toBaseAttachedContext's doc.
    fileIds: ctx.fileScopes.map(f => f.id),
    ticketIds: ctx.tickets.map(t => t.id),
    canvasIds: ctx.canvases.map(c => c.id),
    callIds: [...ctx.transcripts.map(t => t.id), ...ctx.recordings.map(r => r.id)],
    attachedContext: toBaseAttachedContext(ctx),
    // Display-only richer set (adds a file pill with its title) so the
    // just-sent message matches the post-reload persisted pills. NOT sent to
    // the backend.
    displayAttachedContext: toDisplayAttachedContext(ctx),
    webSearchEnabled: ctx.webSearchEnabled,
    deepResearchEnabled: ctx.deepResearchEnabled,
    createCanvasEnabled: ctx.createCanvasEnabled,
    instant: ctx.instant,
    ...(ctx.model
      ? { model: ctx.model, ...(ctx.modelProvider ? { modelProvider: ctx.modelProvider } : {}) }
      : {}),
    ...(ctx.thinkingLevel ? { thinkingLevel: ctx.thinkingLevel } : {}),
    researchContext: ctx.research,
  };
}
