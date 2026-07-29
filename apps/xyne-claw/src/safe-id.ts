// sessionId / conversationId / agentSlug all end up in filesystem paths
// (workspace dir, session dir, debug dumps) and in the claw-auth callback URL
// path. Restrict them to the same conservative charset claw-auth's
// isSafeConversationId uses — no separators, no dots, so no traversal.
const SAFE_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

export function isSafeId(id: string): boolean {
  return SAFE_ID_RE.test(id);
}
