/**
 * Digital Twin in-thread reply draft — PURE types + validation/projection.
 *
 * Deliberately dependency-free (no DB, no logger, no config) so it can be
 * unit-tested in isolation without pulling the whole service graph. The DB IO
 * (create/read/delete against the draft_messages table) lives in
 * `twinReplyDraftService.ts`, which re-exports everything here.
 *
 * See twinReplyDraftService.ts for the storage/owner-only model.
 */

export type TwinDraftAction = 'react' | 'reply' | 'react_and_reply';

/** A slimmed tool-invocation carrying only what the frontend citation chip
 *  needs (`toolCallId` + `citations`) — baked by claw-auth's buildThreadCitationMeta. */
export interface TwinDraftCitation {
  toolCallId: string;
  citations: unknown[];
}

export interface TwinReplyDraft {
  // ── identity / surface (the first two are also the Redis key) ──
  /** Origin conversation the user was mentioned in — where the draft SURFACES. */
  conversationId: string;
  /** The owner (= mentionedUserId). The ONLY user who may read/act on this draft. */
  ownerUserId: string;
  /** Origin channel of the mention. */
  channelId: string;

  // ── what to deliver ──
  action: TwinDraftAction;
  /** Reply body in the user's own voice (reply / react_and_reply). */
  message?: string;
  /** Emoji for react / react_and_reply. */
  emoji?: string;

  // ── why (private "Why?" panel; never posted) ──
  /** Rationale markdown; factual claims carry `[clf-…#n]` tokens. */
  reasoning?: string;
  /** Baked citation lookup (buildThreadCitationMeta.clawCitations) for the chips. */
  clawCitations?: TwinDraftCitation[];
  /** iconKey → data:URI map (buildThreadCitationMeta.clawCitationIcons). */
  clawCitationIcons?: Record<string, string>;

  // ── where it posts (resolved by claw-auth at approve time from these) ──
  destinationKind: string; // origin_thread | origin_channel | dm_sender | dm | channel | thread
  destinationChannelId?: string;
  destinationConversationId?: string;
  destinationUserId?: string;
  destinationChannelName?: string;
  /** Human name of the DM recipient (dm / dm_sender), resolved for display. */
  destinationUserName?: string;
  destinationReason?: string;

  // ── execution context forwarded to claw-auth on approve/decline ──
  sourceMessageId?: string;
  mentionedUserId: string;
  workspaceId: string;
  senderId?: string;
  senderName?: string;
  channelName?: string;
  incomingTask?: string;
  agentSlug?: string;
  spacesAppId?: string;
  /** claw run/session that produced this draft — keys the feedback row. */
  sessionId: string;

  createdAt: number;
}

/** Validate an unknown value from the S2S create body into a TwinReplyDraft.
 *  Rejects anything missing the required identity/routing fields. Returns the
 *  normalized draft (with createdAt stamped) or an error string. */
export function coerceTwinReplyDraft(
  body: unknown,
): { draft: TwinReplyDraft } | { error: string } {
  if (!body || typeof body !== 'object') return { error: 'body must be an object' };
  const b = body as Record<string, unknown>;
  const str = (k: string): string | undefined => (typeof b[k] === 'string' && (b[k] as string).length > 0 ? (b[k] as string) : undefined);

  const conversationId = str('conversationId');
  const ownerUserId = str('ownerUserId') ?? str('mentionedUserId');
  const channelId = str('channelId');
  const mentionedUserId = str('mentionedUserId') ?? ownerUserId;
  const workspaceId = str('workspaceId');
  const sessionId = str('sessionId');
  const action = b['action'];
  if (!conversationId) return { error: 'conversationId is required' };
  if (!ownerUserId) return { error: 'ownerUserId (or mentionedUserId) is required' };
  if (!channelId) return { error: 'channelId is required' };
  if (!workspaceId) return { error: 'workspaceId is required' };
  if (!sessionId) return { error: 'sessionId is required' };
  if (action !== 'react' && action !== 'reply' && action !== 'react_and_reply') {
    return { error: 'action must be react | reply | react_and_reply' };
  }

  const citations = Array.isArray(b['clawCitations']) ? (b['clawCitations'] as TwinDraftCitation[]) : undefined;
  const icons = b['clawCitationIcons'] && typeof b['clawCitationIcons'] === 'object'
    ? (b['clawCitationIcons'] as Record<string, string>)
    : undefined;

  const draft: TwinReplyDraft = {
    conversationId,
    ownerUserId,
    channelId,
    action,
    mentionedUserId: mentionedUserId!,
    workspaceId,
    sessionId,
    destinationKind: str('destinationKind') ?? 'origin_thread',
    createdAt: Date.now(),
    ...(str('message') !== undefined ? { message: str('message') } : {}),
    ...(str('emoji') !== undefined ? { emoji: str('emoji') } : {}),
    ...(str('reasoning') !== undefined ? { reasoning: str('reasoning') } : {}),
    ...(citations ? { clawCitations: citations } : {}),
    ...(icons ? { clawCitationIcons: icons } : {}),
    ...(str('destinationChannelId') !== undefined ? { destinationChannelId: str('destinationChannelId') } : {}),
    ...(str('destinationConversationId') !== undefined ? { destinationConversationId: str('destinationConversationId') } : {}),
    ...(str('destinationUserId') !== undefined ? { destinationUserId: str('destinationUserId') } : {}),
    ...(str('destinationChannelName') !== undefined ? { destinationChannelName: str('destinationChannelName') } : {}),
    ...(str('destinationUserName') !== undefined ? { destinationUserName: str('destinationUserName') } : {}),
    ...(str('destinationReason') !== undefined ? { destinationReason: str('destinationReason') } : {}),
    ...(str('sourceMessageId') !== undefined ? { sourceMessageId: str('sourceMessageId') } : {}),
    ...(str('senderId') !== undefined ? { senderId: str('senderId') } : {}),
    ...(str('senderName') !== undefined ? { senderName: str('senderName') } : {}),
    ...(str('channelName') !== undefined ? { channelName: str('channelName') } : {}),
    ...(str('incomingTask') !== undefined ? { incomingTask: str('incomingTask') } : {}),
    ...(str('agentSlug') !== undefined ? { agentSlug: str('agentSlug') } : {}),
    ...(str('spacesAppId') !== undefined ? { spacesAppId: str('spacesAppId') } : {}),
  };
  return { draft };
}

/**
 * Decide which destination id (if any) still needs a human NAME resolved for the
 * owner-facing "posts to …" label, and which field to write it to. Pure: the
 * caller performs the actual DB lookup (channels/users live in Spaces).
 *
 * The Twin agent forwards only ids for `channel`/`thread`/`dm` (it looks the id
 * up via its Spaces tools but never carries the name), so those need resolving.
 * `origin_thread` needs nothing ("this thread"); `origin_channel` reuses the
 * origin `channelName`; `dm_sender` reuses `senderName` — all already carried.
 * Returns null when no lookup is needed (name already present or not applicable).
 */
export function destinationNameLookup(
  d: Pick<TwinReplyDraft, 'destinationKind' | 'destinationChannelId' | 'destinationChannelName' | 'destinationUserId' | 'destinationUserName'>,
):
  | { field: 'destinationChannelName'; id: string }
  | { field: 'destinationUserName'; id: string }
  | null {
  if ((d.destinationKind === 'channel' || d.destinationKind === 'thread') && !d.destinationChannelName && d.destinationChannelId) {
    return { field: 'destinationChannelName', id: d.destinationChannelId };
  }
  if (d.destinationKind === 'dm' && !d.destinationUserName && d.destinationUserId) {
    return { field: 'destinationUserName', id: d.destinationUserId };
  }
  return null;
}
