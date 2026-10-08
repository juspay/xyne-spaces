import type { ResearchContext } from '@xyne/shared';
import {
  toAttachedContext,
  type SelectedChannel,
  type SelectedTicket,
  type SelectedCanvas,
  type SelectedTranscript,
  type SelectedRecording,
  type SelectedLocalFolder,
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
  localFolders: SelectedLocalFolder[];
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
  voiceMode: boolean;
  voiceStudioMode: string | null;
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
  modelProvider: 'litellm' | 'spaces' | 'local-harness' | null;
  /** Per-run thinking level from the composer's thinking dropdown.
   *  null = the agent's configured default. */
  thinkingLevel: 'off' | 'minimal' | 'low' | 'medium' | 'high' | null;
  sandboxMode: 'remote' | 'local' | 'container';
}

export const EMPTY_COMPOSER_CONTEXT: ComposerContext = {
  channels: [],
  tickets: [],
  canvases: [],
  transcripts: [],
  recordings: [],
  localFolders: [],
  collections: [],
  fileScopes: [],
  folderScopes: [],
  research: null,
  webSearchEnabled: false,
  deepResearchEnabled: false,
  createCanvasEnabled: false,
  voiceMode: false,
  voiceStudioMode: null,
  instant: false,
  model: null,
  modelProvider: null,
  thinkingLevel: null,
  sandboxMode: 'remote',
};

/** True when the snapshot carries any context/toggle worth sending as overrides. */
export function hasComposerContext(ctx: ComposerContext): boolean {
  return (
    ctx.channels.length > 0 ||
    ctx.tickets.length > 0 ||
    ctx.canvases.length > 0 ||
    ctx.transcripts.length > 0 ||
    ctx.recordings.length > 0 ||
    ctx.localFolders.length > 0 ||
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
 * KB scopes (collections, folders, files) shared by the sent `attachedContext`
 * and the richer display set below. Every KB picker stores CollectionItem.id
 * (cuid) as fileScopes[].id — the id attached_context 'file' items carry, same
 * as collections/folders — so files ride as ordinary attachedContext entries
 * here too.
 */
function toBaseAttachedContext(ctx: ComposerContext): AttachedContextItem[] {
  return toAttachedContext({
    channels: ctx.channels,
    tickets: ctx.tickets,
    canvases: ctx.canvases,
    transcripts: ctx.transcripts,
    recordings: ctx.recordings,
    localFolders: ctx.localFolders,
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
    ticketIds: ctx.tickets.map(t => t.id),
    canvasIds: ctx.canvases.map(c => c.id),
    callIds: [...ctx.transcripts.map(t => t.id), ...ctx.recordings.map(r => r.id)],
    attachedContext: toBaseAttachedContext(ctx),
    // Same content as attachedContext — kept as a separate field so the
    // just-sent message's pills have an explicit source independent of
    // whatever attachedContext ends up being sent.
    displayAttachedContext: toBaseAttachedContext(ctx),
    webSearchEnabled: ctx.webSearchEnabled,
    deepResearchEnabled: ctx.deepResearchEnabled,
    createCanvasEnabled: ctx.createCanvasEnabled,
    voiceMode: ctx.voiceMode,
    instant: ctx.instant,
    ...(ctx.model
      ? { model: ctx.model, ...(ctx.modelProvider ? { modelProvider: ctx.modelProvider } : {}) }
      : {}),
    ...(ctx.thinkingLevel ? { thinkingLevel: ctx.thinkingLevel } : {}),
    ...(ctx.sandboxMode !== 'remote' ? { sandboxMode: ctx.sandboxMode } : {}),
    researchContext: ctx.research,
  };
}
