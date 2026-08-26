import type { FlowDefinition } from '@xyne/shared';

/**
 * Visibility gating for agent-proposed approval cards.
 *
 * Some flow cards are *addressed to exactly one person*: a HITL write approval
 * (KB upload, ticket/memory create, etc.), a skill-update approval, an
 * agent-clone approval, or an MCP-configure request. The server already
 * ENFORCES this — claw-auth's flow-action handler rejects any clicker whose id
 * is not the intended user with a 403 ("Unauthorized"). But the card itself is
 * posted as an ordinary channel message, so every member of the thread *sees*
 * the actionable buttons even though only one of them can use them.
 *
 * This map lets the client hide the actionable card from everyone except the
 * intended approver. It is a UI de-clutter / least-astonishment measure layered
 * on top of the server authorization — it is NOT itself the security boundary
 * (the message still syncs to every client; the real gate is the 403).
 *
 * The field that names the single allowed user DIFFERS per card type, so it is
 * mapped explicitly. Only ACTIONABLE approval cards are listed here — result /
 * status cards (e.g. a successful write result) carry no gated actionType and
 * therefore stay visible to the whole thread.
 */
const RESTRICTED_FLOW_INTENDED_USER_FIELD: Record<string, string> = {
  // HITL write approval — and the failed-write "Retry" card, which reuses
  // actionType 'write' + userId. Both are actionable only by `userId`.
  write: 'userId',
  // update-skill approval (DM'd to the skill owner).
  'skill-update': 'approverUserId',
  // agent clone request (addressed to the source agent's owner).
  'clone-approval': 'ownerUserId',
  // MCP account/config request (addressed to the invoking user).
  'mcp-configure': 'userId',
};

/**
 * If `flow` is an approval card addressed to a single user, return that user's
 * id; otherwise return null (the card is not visibility-restricted).
 */
export function intendedApproverId(flow: FlowDefinition): string | null {
  const data = (flow?.data ?? {}) as Record<string, unknown>;
  const actionType = typeof data.actionType === 'string' ? data.actionType : undefined;
  if (!actionType) return null;
  const field = RESTRICTED_FLOW_INTENDED_USER_FIELD[actionType];
  if (!field) return null;
  const uid = data[field];
  return typeof uid === 'string' && uid.length > 0 ? uid : null;
}

/**
 * True when this flow card is an approval addressed to someone OTHER than the
 * current viewer, so the actionable card should be hidden from them.
 * Fails OPEN: if we cannot determine the intended user, the card renders
 * normally (unchanged behavior).
 */
export function isApprovalHiddenFromViewer(
  flow: FlowDefinition,
  currentUserId: string | null | undefined,
): boolean {
  const intended = intendedApproverId(flow);
  if (!intended) return false;
  if (!currentUserId) return false;
  return intended !== currentUserId;
}
