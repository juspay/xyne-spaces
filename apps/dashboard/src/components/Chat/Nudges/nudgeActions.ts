import { BulkTicketMode, NudgeKind, type SurfaceNudge } from '@xyne/shared';

export interface BulkTicketFailureRetryInput {
  title: string;
  description: string;
  clientRowId?: string;
}

export interface BulkTicketFailureRetryData {
  mode: BulkTicketMode;
  parentTitle: string;
  failedInputs: BulkTicketFailureRetryInput[];
  existingParentTicket?: { id: string; xyneId?: string; conversationId: string };
  channelId?: string;
  projectId?: string;
}

export function parseBulkTicketFailureNudge(
  nudge: SurfaceNudge,
  fallbackChannelId?: string,
  fallbackProjectId?: string,
): BulkTicketFailureRetryData | null {
  if (nudge.nudgeKind !== NudgeKind.BULK_TICKET_CREATION_FAILED) return null;

  const actions = nudge.actions as Record<string, unknown> | undefined;
  if (!actions) return null;

  const mode =
    actions['mode'] === 'all-parents' ? BulkTicketMode.ALL_PARENTS : BulkTicketMode.PARENT_SUB;
  const parentTitle = typeof actions['parentTitle'] === 'string' ? actions['parentTitle'] : '';
  const channelId =
    typeof actions['channelId'] === 'string' ? actions['channelId'] : fallbackChannelId;
  const projectId =
    typeof actions['projectId'] === 'string' ? actions['projectId'] : fallbackProjectId;

  const rawFailedInputs = actions['failedInputs'];
  const failedInputs = Array.isArray(rawFailedInputs)
    ? rawFailedInputs
        .map((item: unknown) => {
          if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
          const record = item as Record<string, unknown>;
          const title = typeof record['title'] === 'string' ? record['title'].trim() : '';
          if (!title) return null;
          const description =
            typeof record['description'] === 'string' ? record['description'] : '';
          const clientRowId =
            typeof record['clientRowId'] === 'string' ? record['clientRowId'] : undefined;
          const result: BulkTicketFailureRetryInput = { title, description };
          if (clientRowId) result.clientRowId = clientRowId;
          return result;
        })
        .filter((item): item is BulkTicketFailureRetryInput => item !== null)
    : [];

  let existingParentTicket: BulkTicketFailureRetryData['existingParentTicket'];
  const rawParent = actions['existingParentTicket'];
  if (rawParent && typeof rawParent === 'object' && !Array.isArray(rawParent)) {
    const record = rawParent as Record<string, unknown>;
    const id = typeof record['id'] === 'string' ? record['id'] : '';
    const conversationId =
      typeof record['conversationId'] === 'string' ? record['conversationId'] : '';
    const xyneId = typeof record['xyneId'] === 'string' ? record['xyneId'] : undefined;
    if (id && conversationId) {
      existingParentTicket = xyneId ? { id, xyneId, conversationId } : { id, conversationId };
    }
  }

  return {
    mode,
    parentTitle,
    failedInputs,
    ...(existingParentTicket ? { existingParentTicket } : {}),
    ...(channelId ? { channelId } : {}),
    ...(projectId ? { projectId } : {}),
  };
}
