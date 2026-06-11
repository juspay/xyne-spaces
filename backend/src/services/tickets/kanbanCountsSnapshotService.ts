import { UserResponsibility } from '@prisma/client';
import { db } from '@/database/client';

export type KanbanCountsSnapshot = {
  id: string;
  workspaceId: string;
  boardId: string | null;
  projectId: string | null;
  stageName: string | null;
  statusV2: string | null;
  priority: string | null;
  assignedTo: string | null;
  createdBy: string | null;
  userGroupId: string | null;
  ticketType: string | null;
  eta: number | null;
  createdAt: number;
  tags: string[];
  prReviewers: string[];
  qaAssigned: string[];
  formFieldValues: Record<string, unknown>;
};

const toMillis = (value: Date | null | undefined): number | null => value?.getTime() ?? null;

export const buildKanbanCountsSnapshot = async (
  ticketId: string,
): Promise<KanbanCountsSnapshot | null> => {
  const ticket = await db.ticket.findUnique({
    where: { id: ticketId },
    select: {
      id: true,
      workspaceId: true,
      boardId: true,
      projectId: true,
      stageName: true,
      statusV2: true,
      priority: true,
      assignedTo: true,
      createdBy: true,
      userGroupId: true,
      ticketType: true,
      eta: true,
      createdAt: true,
    },
  });

  if (!ticket) return null;

  const [tags, assignments, formValues] = await Promise.all([
    db.ticketTag.findMany({
      where: { ticketId },
      select: { name: true },
    }),
    db.ticketAssignment.findMany({
      where: {
        ticketId,
        userResponsibility: { in: [UserResponsibility.PR_REVIEWER, UserResponsibility.QA] },
      },
      select: {
        userId: true,
        userResponsibility: true,
      },
    }),
    db.formEntityValues.findMany({
      where: {
        entityId: ticketId,
        entityType: 'TICKET',
      },
      select: {
        fieldId: true,
        actualFieldValue: true,
      },
    }),
  ]);

  const prReviewers = assignments
    .filter(item => item.userResponsibility === UserResponsibility.PR_REVIEWER)
    .map(item => item.userId);
  const qaAssigned = assignments
    .filter(item => item.userResponsibility === UserResponsibility.QA)
    .map(item => item.userId);

  const formFieldValues: Record<string, unknown> = {};
  for (const value of formValues) {
    formFieldValues[value.fieldId] = value.actualFieldValue;
  }

  return {
    id: ticket.id,
    workspaceId: ticket.workspaceId,
    boardId: ticket.boardId,
    projectId: ticket.projectId,
    stageName: ticket.stageName,
    statusV2: ticket.statusV2,
    priority: ticket.priority,
    assignedTo: ticket.assignedTo,
    createdBy: ticket.createdBy,
    userGroupId: ticket.userGroupId,
    ticketType: ticket.ticketType,
    eta: toMillis(ticket.eta),
    createdAt: ticket.createdAt.getTime(),
    tags: tags.map(tag => tag.name),
    prReviewers,
    qaAssigned,
    formFieldValues,
  };
};

