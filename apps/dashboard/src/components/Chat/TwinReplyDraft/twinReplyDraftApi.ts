import { apiInstance } from '../../../services/clients/apiClient';
import type { ToolInvocation } from '../XyneAISidebar/utils/XyneAITypes';

export type TwinDraftAction = 'react' | 'reply' | 'react_and_reply';

/** A baked citation lookup entry (buildThreadCitationMeta.clawCitations) — the
 *  toolCallId + its citations, exactly what ThreadCitationChip's resolvers need. */
export interface TwinDraftClawCitation {
  toolCallId: string;
  citations: ToolInvocation['citations'];
}

/**
 * Owner-facing view of a single Twin reply proposal, built from a `draft_messages`
 * row (origin='twin') synced via Zero. `id` is the draft row id — the handle used
 * to approve/decline this specific proposal (a thread may hold several).
 */
export interface TwinReplyDraftView {
  /** draft_messages row id — the approve/decline handle. */
  id: string;
  conversationId: string;
  action: TwinDraftAction;
  message?: string;
  emoji?: string;
  /** Private rationale markdown; factual claims carry `[clf-…#n]` tokens. */
  reasoning?: string;
  clawCitations?: TwinDraftClawCitation[];
  clawCitationIcons?: Record<string, string>;
  destinationKind: string;
  destinationChannelName?: string;
  /** Human name of the DM recipient (dm / dm_sender), for the "sends a DM to …" label. */
  destinationUserName?: string;
  destinationReason?: string;
  sourceMessageId?: string;
  senderName?: string;
  channelName?: string;
  /** The claw agent + run behind this draft — used to point the run debugger at it. */
  agentSlug?: string;
  sessionId?: string;
  createdAt: number;
}

/** The twin payload stored in the row's `metadata` JSON (the backend TwinReplyDraft). */
type StoredTwinDraft = Omit<TwinReplyDraftView, 'id'> & Record<string, unknown>;

/** The subset of a `draft_messages` (origin='twin') Zero row this mapper needs.
 *  A structural type so callers pass `TwinDraftDB` without this module importing
 *  the opaque Zero-derived alias. */
export interface TwinDraftRow {
  id: string;
  conversationId?: string | null;
  createdAt: number;
  metadata?: unknown;
}

/** Parse the stringified-JSON twin payload from a row's `metadata` (TEXT column).
 *  Tolerates an already-parsed object defensively. Returns null if absent/malformed. */
function parseStoredTwinDraft(metadata: unknown): StoredTwinDraft | null {
  if (!metadata) return null;
  if (typeof metadata === 'string') {
    try {
      return JSON.parse(metadata) as StoredTwinDraft;
    } catch {
      return null;
    }
  }
  return metadata as StoredTwinDraft;
}

/**
 * Map a Zero-synced twin draft row to the owner-facing view. The rich payload
 * lives in `metadata` (written by the S2S create route as stringified JSON);
 * `id`/`createdAt` come from the row. Returns null if the row has no metadata.
 */
export function rowToTwinReplyDraftView(row: TwinDraftRow): TwinReplyDraftView | null {
  const meta = parseStoredTwinDraft(row.metadata);
  if (!meta) return null;
  return {
    ...meta,
    id: row.id,
    conversationId: row.conversationId ?? meta.conversationId,
    createdAt: typeof meta.createdAt === 'number' ? meta.createdAt : row.createdAt,
  };
}

/** Where an approved reply landed — used to redirect the user there. */
export interface PostedTarget {
  channelId: string;
  conversationId?: string;
}

/**
 * An in-progress "edit this Twin draft in the composer" session. The dock hands
 * this to the ChatInput so the real message composer takes over editing: it loads
 * the draft text, highlights the composer, and — crucially — routes Send through
 * `onApprove` (the twin approve endpoint) rather than a plain thread post, since
 * the draft's true destination lives server-side and approving is what records
 * the twin's learning feedback. Leaving edit mode (the edit bar's Back button)
 * restores the composer to the user's own draft without sending.
 */
export interface TwinEditSession {
  /** The draft row id being edited — binds the session to one specific proposal. */
  draftId: string;
  /** The draft's current text, loaded into the composer when the session opens. */
  message: string;
  /** Sender of the message being replied to — shown in the edit bar for context. */
  senderName?: string;
  /** Approve with the user's edited text (empty ⇒ send the twin's original).
   *  Owns the outcome: ends the session on success, keeps it (with a toast) on
   *  failure so the user's edit survives for a retry. */
  onApprove: (editedText: string) => void;
}

/** Approve a specific draft (by row id) — posts/reacts AS the user (optionally
 *  with edited text). Returns where the reply posted (for redirect), or null for
 *  a react-only delivery. Throws on failure so the caller can keep the draft. */
export async function approveTwinReplyDraft(
  draftId: string,
  editedMessage?: string,
): Promise<PostedTarget | null> {
  const res = await apiInstance.post<{ success: boolean; posted?: PostedTarget }>(
    `/conversations/reply-drafts/${draftId}/approve`,
    { ...(editedMessage !== undefined ? { editedMessage } : {}) },
  );
  return res.data?.posted ?? null;
}

/** Decline a specific draft (by row id) — records the feedback and clears it. */
export async function declineTwinReplyDraft(draftId: string): Promise<void> {
  await apiInstance.post(`/conversations/reply-drafts/${draftId}/decline`, {});
}
