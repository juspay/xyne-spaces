// Maps each trigger event type to the payload key holding its entity id, for stamping
// WorkflowExecution.entityType/.entityId. WEBHOOK is absent: it has no entity id.
const TRIGGER_ENTITY_ID_KEY: Readonly<Record<string, string>> = {
  TICKET_CREATED: 'ticketId',
  TICKET_UPDATED: 'ticketId',
  TICKET_COMMENTED: 'ticketId',
  EMAIL_RECEIVED: 'emailId',
  EMAIL_SENT: 'emailId',
  MESSAGE_RECEIVED: 'messageId',
  CALL_EVENT: 'callId',
  TAG_GENERATED: 'sourceId',
};

export interface DebugEntity {
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
