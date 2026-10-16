type ActivityThreadRouteInput = {
  actorAction?: string | null;
  conversationId?: string;
  initialMessageId?: string;
  isThreadActivity?: boolean | null;
  messageId?: string;
};

/**
 * Prefer explicit and structural thread relationships. Reply actions are the
 * fallback for cached Activity rows whose related conversation is incomplete.
 */
export function shouldOpenActivityThread({
  actorAction,
  conversationId,
  initialMessageId,
  isThreadActivity,
  messageId,
}: ActivityThreadRouteInput): boolean {
  if (!conversationId) return false;
  if (isThreadActivity === true) return true;
  if (initialMessageId && messageId) return initialMessageId !== messageId;
  return actorAction === 'replied' || actorAction === 'replied_v2';
}
