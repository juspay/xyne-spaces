import { globalClickTracker } from './globalClickTracker';

/**
 * The subset of a ticket row that tracking reads. Every field but `id` is
 * optional so Zero `Ticket` rows and the partial shapes a create response or a
 * list card hold can all be passed in.
 */
export interface TrackableTicket {
  id: string;
  xyneId?: string | null | undefined;
  ticketType?: string | null | undefined;
  priority?: string | null | undefined;
  statusV2?: string | null | undefined;
  stageName?: string | null | undefined;
  boardId?: string | null | undefined;
  projectId?: string | null | undefined;
  channelId?: string | null | undefined;
  assignedTo?: string | null | undefined;
  userGroupId?: string | null | undefined;
  rootId?: string | null | undefined;
  parentId?: string | null | undefined;
  isArchived?: boolean | null | undefined;
  eta?: number | string | Date | null | undefined;
  isStageOverdue?: boolean | null | undefined;
  aiCategory?: string | null | undefined;
  createdAt?: number | string | Date | null | undefined;
}

const DAY_MS = 86_400_000;

function toMs(value: number | string | Date | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/** Whole days since `createdAt`, or null when unknown. */
export function daysSinceCreated(createdAt: TrackableTicket['createdAt']): number | null {
  const ms = toMs(createdAt);
  return ms === null ? null : Math.max(0, Math.round((Date.now() - ms) / DAY_MS));
}

/**
 * Ticket dimensions for `data-track-metadata` / `trackManualEvent`.
 *
 * Ids, enums, booleans and counts only. The title and description are user
 * content and never leave the client through tracking; assignee ids are a
 * social-graph edge and are reduced to `hasAssignee`.
 */
export function ticketTrackingMetadata(
  ticket: TrackableTicket | null | undefined,
): Record<string, unknown> {
  if (!ticket) return {};
  const days = daysSinceCreated(ticket.createdAt);
  return {
    ticketId: ticket.id,
    ...(ticket.xyneId && { xyneId: ticket.xyneId }),
    ...(ticket.ticketType && { ticketType: ticket.ticketType }),
    ...(ticket.priority && { priority: ticket.priority }),
    ...(ticket.statusV2 && { statusV2: ticket.statusV2 }),
    ...(ticket.stageName && { stageName: ticket.stageName }),
    ...(ticket.boardId && { boardId: ticket.boardId }),
    ...(ticket.projectId && { projectId: ticket.projectId }),
    ...(ticket.channelId && { channelId: ticket.channelId }),
    ...(ticket.assignedTo !== undefined && { hasAssignee: !!ticket.assignedTo }),
    ...(ticket.userGroupId !== undefined && { hasUserGroup: !!ticket.userGroupId }),
    ...((ticket.rootId !== undefined || ticket.parentId !== undefined) && {
      isSubTicket: !!(ticket.rootId || ticket.parentId),
    }),
    ...(typeof ticket.isArchived === 'boolean' && { isArchived: ticket.isArchived }),
    ...(ticket.eta !== undefined && { hasEta: !!ticket.eta }),
    ...(typeof ticket.isStageOverdue === 'boolean' && { isStageOverdue: ticket.isStageOverdue }),
    ...(ticket.aiCategory && { aiCategory: ticket.aiCategory }),
    ...(days !== null && { daysSinceCreated: days }),
  };
}

/** Which UI the change was made from. */
export type TicketChangeSurface =
  | 'details'
  | 'kanban_drag'
  | 'kanban_card'
  | 'list_inline'
  | 'table_inline'
  | 'bulk'
  /** SupportTicketDetail — the desk archive path bypasses TicketDetails. */
  | 'desk_detail';

/**
 * Outcome event after a ticket mutation resolved. Fire on success only — the
 * click that asked for the change is already captured by the element's own
 * `data-track-*` attributes, so this is the "it actually happened" row.
 */
export function trackTicketOutcome(
  eventName:
    | 'TICKET_STATUS_CHANGED'
    | 'TICKET_STAGE_CHANGED'
    | 'TICKET_ASSIGNED'
    | 'TICKET_PRIORITY_CHANGED'
    | 'TICKET_BOARD_CHANGED'
    | 'TICKET_FIELD_UPDATED'
    | 'TICKET_LINKED'
    | 'TICKET_UNLINKED'
    | 'TICKET_ARCHIVED',
  ticket: TrackableTicket | null | undefined,
  extra: Record<string, unknown> & { surface: TicketChangeSurface },
): void {
  globalClickTracker.trackManualEvent('Tickets', eventName, undefined, {
    ...ticketTrackingMetadata(ticket),
    ...extra,
  });
}

/**
 * CREATE_TICKET_SUCCEEDED: the "it exists now" row, fired only after
 * POST /tickets returned an id. Every create path (the modal, its popout, the
 * composer's direct Support create) reports through here so the key set is
 * one set. Counts and booleans only — never the title or description.
 */
export function trackTicketCreateSucceeded(
  ticket: TrackableTicket,
  extra: Record<string, unknown> & { source: string },
): void {
  globalClickTracker.trackManualEvent('Tickets', 'CREATE_TICKET_SUCCEEDED', undefined, {
    ...ticketTrackingMetadata(ticket),
    aiOriginated: isAiOriginatedSource(extra.source),
    ...extra,
  });
}

export type TicketCreateErrorKind = 'network' | 'validation' | 'server';

/**
 * Classify a failed create from the thrown error: no HTTP response means the
 * request never landed, a 4xx is the form's fault, anything else is the
 * server's. Axios and fetch-style errors both carry `response.status`.
 */
export function ticketCreateFailureMetadata(error: unknown): {
  errorKind: TicketCreateErrorKind;
  httpStatus?: number;
} {
  const httpStatus =
    typeof error === 'object' && error !== null && 'response' in error
      ? (error as { response?: { status?: number } }).response?.status
      : undefined;
  if (httpStatus === undefined) return { errorKind: 'network' };
  return { errorKind: httpStatus >= 500 ? 'server' : 'validation', httpStatus };
}

/** CREATE_TICKET_FAILED, the failure sibling of `trackTicketCreateSucceeded`. */
export function trackTicketCreateFailed(
  error: unknown,
  extra: Record<string, unknown> & { source: string },
): void {
  globalClickTracker.trackManualEvent('Tickets', 'CREATE_TICKET_FAILED', undefined, {
    ...ticketCreateFailureMetadata(error),
    ...extra,
  });
}

/** Coarse list-size dimension for `TICKET_LIST_VIEWED`. */
export function ticketCountBucket(count: number): '0' | '1-10' | '11-50' | '51-200' | '200+' {
  if (count <= 0) return '0';
  if (count <= 10) return '1-10';
  if (count <= 50) return '11-50';
  if (count <= 200) return '51-200';
  return '200+';
}

/** Creation entry points that originate from an AI suggestion of some kind. */
const AI_ORIGINATED_SOURCES = new Set([
  'sdlc_artifact',
  'ai_suggestion',
  'pulse',
  'nudge',
  'ai_artifact',
]);

export function isAiOriginatedSource(source: string | undefined): boolean {
  return !!source && AI_ORIGINATED_SOURCES.has(source);
}
