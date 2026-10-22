import type { ComposerContext } from '../components/AIScreen/composerContext';

/**
 * Xyne AI composer drafts (XYNE-67287).
 *
 * What the user has typed (and picked) in a Xyne AI composer, kept in
 * localStorage so it survives navigating away, closing the sidebar or a reload.
 *
 * Deliberately separate from the channel draft system (`useDraft` /
 * `draft_messages`): Xyne AI chats are not Spaces channels, a new chat has no
 * id until its first send, and that path deletes drafts on empty content
 * (XYNE-17500).
 *
 * Key: `xyne-ai-draft:<workspaceId>:<userId>:<scope>`, where scope is the
 * conversation id or `new`. The /ai screen and the sidebar share keys, so a
 * draft started in one shows in the other.
 */

export const AI_DRAFT_PREFIX = 'xyne-ai-draft:';
export const AI_DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Generous for a prompt; stops one runaway paste from eating the origin's quota. */
export const AI_DRAFT_MAX_TEXT = 100_000;
/** Scope used before a chat has a conversation id. */
export const NEW_CHAT_DRAFT_SCOPE = 'new';

/**
 * The part of the composer context a draft keeps: the picked context and the
 * per-message toggles. Agent, Auto, fast and sandbox mode are global
 * preferences already; voice/studio mode belongs to the moment. Attachments are
 * in-memory `File`s and are never stored — only their count, for a notice.
 */
export type AIComposerDraftContext = Pick<
  ComposerContext,
  | 'channels'
  | 'tickets'
  | 'canvases'
  | 'transcripts'
  | 'recordings'
  | 'messages'
  | 'people'
  | 'sharedFiles'
  | 'apps'
  | 'userTags'
  | 'localFolders'
  | 'collections'
  | 'fileScopes'
  | 'folderScopes'
  | 'webSearchEnabled'
  | 'deepResearchEnabled'
  | 'createCanvasEnabled'
  | 'model'
  | 'modelProvider'
  | 'thinkingLevel'
>;

export interface AIComposerDraft {
  v: 1;
  text: string;
  /** Absent for a text-only draft (the sidebar). */
  context?: AIComposerDraftContext;
  /** Agent the model pin belongs to; the pin is only restored for this agent. */
  agentSlug?: string | null;
  /** Attachments that were in the composer and are not kept. */
  attachmentCount?: number;
  savedAt: number;
}

export type AIComposerDraftInput = Omit<AIComposerDraft, 'v' | 'savedAt'>;

/** Minimal Storage surface, so tests can pass an in-memory one. */
export type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;

export function buildAIDraftKey(
  workspaceId: string | null | undefined,
  userId: string | null | undefined,
  scope: string | null | undefined,
): string | null {
  if (!workspaceId || !userId || !scope) return null;
  return `${AI_DRAFT_PREFIX}${workspaceId}:${userId}:${scope}`;
}

export function toDraftContext(ctx: ComposerContext): AIComposerDraftContext {
  return {
    channels: ctx.channels,
    tickets: ctx.tickets,
    canvases: ctx.canvases,
    transcripts: ctx.transcripts,
    recordings: ctx.recordings,
    messages: ctx.messages,
    people: ctx.people,
    sharedFiles: ctx.sharedFiles,
    apps: ctx.apps,
    userTags: ctx.userTags,
    localFolders: ctx.localFolders,
    collections: ctx.collections,
    fileScopes: ctx.fileScopes,
    folderScopes: ctx.folderScopes,
    webSearchEnabled: ctx.webSearchEnabled,
    deepResearchEnabled: ctx.deepResearchEnabled,
    createCanvasEnabled: ctx.createCanvasEnabled,
    model: ctx.model,
    modelProvider: ctx.modelProvider,
    thinkingLevel: ctx.thinkingLevel,
  };
}

/** True when the context carries anything the user picked for this message. */
export function hasPickedDraftContext(ctx: AIComposerDraftContext | undefined): boolean {
  if (!ctx) return false;
  return (
    (ctx.channels?.length ?? 0) > 0 ||
    (ctx.tickets?.length ?? 0) > 0 ||
    (ctx.canvases?.length ?? 0) > 0 ||
    (ctx.transcripts?.length ?? 0) > 0 ||
    (ctx.recordings?.length ?? 0) > 0 ||
    (ctx.messages?.length ?? 0) > 0 ||
    (ctx.people?.length ?? 0) > 0 ||
    (ctx.sharedFiles?.length ?? 0) > 0 ||
    (ctx.apps?.length ?? 0) > 0 ||
    (ctx.collections?.length ?? 0) > 0 ||
    (ctx.fileScopes?.length ?? 0) > 0 ||
    (ctx.folderScopes?.length ?? 0) > 0
  );
}

/**
 * A draft worth keeping has text or picked context. Toggles, a model pin or a
 * local folder on their own are not a draft — they persist for the chat anyway.
 */
export function isDraftEmpty(draft: Pick<AIComposerDraft, 'text' | 'context'>): boolean {
  return draft.text.trim() === '' && !hasPickedDraftContext(draft.context);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseDraft(raw: string | null): AIComposerDraft | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || parsed['v'] !== 1) return null;
    const text = parsed['text'];
    const savedAt = parsed['savedAt'];
    if (typeof text !== 'string' || typeof savedAt !== 'number') return null;
    const rawContext = parsed['context'];
    const context = isRecord(rawContext)
      ? (rawContext as unknown as AIComposerDraftContext)
      : undefined;
    const rawAgent = parsed['agentSlug'];
    const rawCount = parsed['attachmentCount'];
    return {
      v: 1,
      text,
      savedAt,
      ...(context ? { context } : {}),
      ...(typeof rawAgent === 'string' || rawAgent === null ? { agentSlug: rawAgent } : {}),
      ...(typeof rawCount === 'number' ? { attachmentCount: rawCount } : {}),
    };
  } catch {
    return null;
  }
}

export function readAIDraft(
  storage: DraftStorage | null,
  key: string | null,
  now: number = Date.now(),
): AIComposerDraft | null {
  if (!storage || !key) return null;
  try {
    const draft = parseDraft(storage.getItem(key));
    if (!draft) return null;
    if (now - draft.savedAt > AI_DRAFT_TTL_MS || isDraftEmpty(draft)) {
      storage.removeItem(key);
      return null;
    }
    return draft;
  } catch {
    return null;
  }
}

export function removeAIDraft(storage: DraftStorage | null, key: string | null): void {
  if (!storage || !key) return;
  try {
    storage.removeItem(key);
  } catch {
    // Storage unavailable (private mode, disabled) — nothing to remove.
  }
}

export interface WriteAIDraftOptions {
  /** Keep the stored draft's context when this write has none (a text-only
   *  composer must not wipe chips picked on the full-screen composer). */
  keepExistingContext?: boolean;
  now?: number;
}

/**
 * Store a draft, or remove the key when the draft is empty. Returns false when
 * storage refused the write (quota, disabled) — drafts are best-effort and
 * callers never surface this.
 */
export function writeAIDraft(
  storage: DraftStorage | null,
  key: string | null,
  input: AIComposerDraftInput,
  options: WriteAIDraftOptions = {},
): boolean {
  if (!storage || !key) return false;
  const now = options.now ?? Date.now();
  let draft: AIComposerDraft = {
    ...input,
    v: 1,
    text:
      input.text.length > AI_DRAFT_MAX_TEXT ? input.text.slice(0, AI_DRAFT_MAX_TEXT) : input.text,
    savedAt: now,
  };
  if (options.keepExistingContext && !draft.context) {
    const existing = readAIDraft(storage, key, now);
    if (existing?.context) {
      draft = { ...draft, context: existing.context };
      if (existing.agentSlug !== undefined && draft.agentSlug === undefined) {
        draft = { ...draft, agentSlug: existing.agentSlug };
      }
    }
  }
  if (isDraftEmpty(draft)) {
    removeAIDraft(storage, key);
    return true;
  }
  try {
    storage.setItem(key, JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

/** Drop expired or unreadable drafts. Cheap: only touches keys with our prefix. */
export function pruneAIDrafts(storage: DraftStorage | null, now: number = Date.now()): void {
  if (!storage) return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (key?.startsWith(AI_DRAFT_PREFIX)) keys.push(key);
    }
    for (const key of keys) {
      const draft = parseDraft(storage.getItem(key));
      if (!draft || now - draft.savedAt > AI_DRAFT_TTL_MS) storage.removeItem(key);
    }
  } catch {
    // Best-effort housekeeping.
  }
}

/**
 * The composer context to start from when a draft is restored. The model pin
 * and thinking level come back only for the agent they were picked on — one
 * agent's model may not exist on another's list.
 */
export function applyDraftContext(
  base: ComposerContext,
  draft: AIComposerDraft,
  currentAgentSlug: string | null,
): ComposerContext {
  const ctx = draft.context;
  if (!ctx) return base;
  const sameAgent = (draft.agentSlug ?? null) === currentAgentSlug;
  return {
    ...base,
    channels: ctx.channels ?? [],
    tickets: ctx.tickets ?? [],
    canvases: ctx.canvases ?? [],
    transcripts: ctx.transcripts ?? [],
    recordings: ctx.recordings ?? [],
    messages: ctx.messages ?? [],
    people: ctx.people ?? [],
    sharedFiles: ctx.sharedFiles ?? [],
    apps: ctx.apps ?? [],
    userTags: ctx.userTags ?? {},
    localFolders: ctx.localFolders ?? base.localFolders,
    collections: ctx.collections ?? [],
    fileScopes: ctx.fileScopes ?? [],
    folderScopes: ctx.folderScopes ?? [],
    webSearchEnabled: ctx.webSearchEnabled ?? base.webSearchEnabled,
    deepResearchEnabled: ctx.deepResearchEnabled ?? base.deepResearchEnabled,
    createCanvasEnabled: ctx.createCanvasEnabled ?? base.createCanvasEnabled,
    model: sameAgent ? (ctx.model ?? null) : base.model,
    modelProvider: sameAgent ? (ctx.modelProvider ?? null) : base.modelProvider,
    thinkingLevel: sameAgent ? (ctx.thinkingLevel ?? null) : base.thinkingLevel,
  };
}

/** localStorage when available, else null (disabled storage, non-browser). */
export function getDraftStorage(): DraftStorage | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}
