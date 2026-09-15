interface TicketFormActivityContext {
  boardId: string;
  metadata: unknown;
}

export interface FormActivityContext {
  allowed: boolean;
  name?: string;
}

const objectValue = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/**
 * Form values may belong to board custom fields or to a FLOW pseudo-stage.
 * FLOW pseudo-stages use planNodeId as contextId because no persisted stage exists.
 */
export function resolveFormActivityContext(
  ticket: TicketFormActivityContext,
  contextId: string | null
): FormActivityContext {
  if (contextId === ticket.boardId) return { allowed: true };

  const flow = objectValue(objectValue(ticket.metadata).flow);
  const planNodeId = typeof flow.planNodeId === 'string' ? flow.planNodeId : null;
  if (!planNodeId || contextId !== planNodeId) return { allowed: false };

  const nodeSnapshot = objectValue(flow.nodeSnapshot);
  const title =
    typeof nodeSnapshot.title === 'string' && nodeSnapshot.title.trim()
      ? nodeSnapshot.title.trim()
      : undefined;
  return { allowed: true, ...(title && { name: title }) };
}
