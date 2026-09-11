// Maps each trigger event type to the payload key holding its entity id, for stamping
// WorkflowExecution.entityType/.entityId. Only the types the debug panel can query are
// listed; WEBHOOK has no entity id at all. Add a type here when the panel learns to ask
// for it — runs stamped before that point simply won't be correlated.
const TRIGGER_ENTITY_ID_KEY: Readonly<Record<string, string>> = {
  TICKET_CREATED: 'ticketId',
  TICKET_UPDATED: 'ticketId',
  TICKET_COMMENTED: 'ticketId',
  EMAIL_RECEIVED: 'emailId',
  EMAIL_SENT: 'emailId',
  MESSAGE_RECEIVED: 'messageId',
};

interface DebugEntity {
  entityType: string;
  entityId: string;
}

// Returns `{}` rather than null so callers can spread it straight into Prisma `data`.
export function resolveDebugEntity(
  eventType: string,
  payload: unknown,
): DebugEntity | Record<string, never> {
  const key = TRIGGER_ENTITY_ID_KEY[eventType];
  if (!key || !payload || typeof payload !== 'object') return {};
  const id = (payload as Record<string, unknown>)[key];
  return typeof id === 'string' && id.length > 0
    ? { entityType: eventType, entityId: id }
    : {};
}
