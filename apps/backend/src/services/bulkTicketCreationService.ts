import { TicketPriority, TicketStatusV2, SurfaceAreaType } from '@xyne/shared';
import { BulkTicketMode } from '@xyne/shared';
import { bulkTicketCreationQueue } from '@/queues/BulkTicketCreationQueue';

interface BulkCreationSubTicket {
  title: string;
  description?: string;
  priority?: TicketPriority;
  statusV2?: TicketStatusV2;
  eta?: Date;
  channelId: string;
  boardId: string;
  assignedTo?: string;
  userGroupId?: string;
  tags?: string[];
  ticketType?: string;
  stageName?: string;
  dynamicFields?: Record<string, string>;
  merchantId?: string;
  workflowType?: string;
  clientRowId?: string;
}

interface EnqueueBulkCreationInput {
  mode: BulkTicketMode;
  parentTicketId: string | null;
  sourceMessageId?: string;
  channelId: string;
  projectId: string;
  workspaceId: string;
  userId: string;
  subTickets: BulkCreationSubTicket[];
}

export async function enqueueBulkCreationJob({
  mode,
  parentTicketId,
  sourceMessageId,
  channelId,
  projectId,
  workspaceId,
  userId,
  subTickets,
}: EnqueueBulkCreationInput): Promise<void> {
  if (subTickets.length === 0) return;

  const jobName = mode === BulkTicketMode.ALL_PARENTS ? 'bulk-ticket' : 'sub-ticket';
  await bulkTicketCreationQueue.getQueue().add(jobName, {
    parentTicketId,
    parentWorkspaceId: workspaceId,
    userId,
    subTickets: subTickets.map(s => ({
      ...s,
      projectId,
      description: s.description ?? '',
      createdBy: userId,
      updatedBy: userId,
    })),
    sourceMessageId,
    sourceType: SurfaceAreaType.MESSAGE,
    channelId,
    projectId,
  });
}
