export function buildCallbackBodyFromDone(
  done: Record<string, unknown>,
  ids: { sessionId: string; userId: string; conversationId: string; agentSlug: string },
): Record<string, unknown> {
  const { meta, ...rest } = done;
  return {
    ...rest,
    sessionId: ids.sessionId,
    userId: ids.userId,
    conversationId: ids.conversationId,
    agentSlug: ids.agentSlug,
    result:
      (done["result"] as string | undefined)
      ?? (done["content"] as string | undefined)
      ?? "",
    ...((meta as Record<string, unknown> | undefined) ?? {}),
  };
}
