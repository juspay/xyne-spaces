import { db } from '@/database/client';
import { UserResponsibility } from '@xyne/shared';

export type KanbanCountsSnapshot = {
  id: string;
  workspaceId: string;
  boardId: string | null;
  channelId: string | null;
  projectId: string | null;
  stageName: string | null;
  statusV2: string | null;
  priority: string | null;
  assignedTo: string | null;
  createdBy: string | null;
  userGroupId: string | null;
  ticketType: string | null;
  isStageOverdue: boolean;
  eta: number | null;
  createdAt: number;
  tags: string[];
  prReviewers: string[];
  qaAssigned: string[];
  roleAssignments: Array<{ roleId: string; userIds: string[] }>;
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
      channelId: true,
      projectId: true,
      stageName: true,
      statusV2: true,
      priority: true,
      assignedTo: true,
      createdBy: true,
      userGroupId: true,
      ticketType: true,
      isStageOverdue: true,
      eta: true,
      createdAt: true,
    },
  }) as (KanbanCountsSnapshot & {
    assignedTo: string | null;
    createdBy: string | null;
    userGroupId: string | null;
    ticketType: string | null;
    eta: Date | null;
    createdAt: Date;
    isStageOverdue?: boolean | null;
  }) | null;

  if (!ticket) return null;

  const [tags, assignments, formValues] = await Promise.all([
    db.ticketTag.findMany({
      where: { ticketId },
      select: { name: true },
    }),
    db.ticketAssignment.findMany({
      where: { ticketId },
      select: { userId: true, roleId: true, userResponsibility: true },
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
    .map(item => item.userId)
    .filter((id): id is string => Boolean(id));
  const qaAssigned = assignments
    .filter(item => item.userResponsibility === UserResponsibility.QA)
    .map(item => item.userId)
    .filter((id): id is string => Boolean(id));

  const roleAssignmentsMap = new Map<string, string[]>();
  for (const assignment of assignments) {
    if (!assignment.roleId || !assignment.userId) continue;
    const existing = roleAssignmentsMap.get(assignment.roleId);
    if (existing) {
      existing.push(assignment.userId);
    } else {
      roleAssignmentsMap.set(assignment.roleId, [assignment.userId]);
    }
  }
  const roleAssignments = Array.from(roleAssignmentsMap.entries()).map(([roleId, userIds]) => ({
    roleId,
    userIds,
  }));

  const formFieldValues: Record<string, unknown> = {};
  for (const value of formValues) {
    formFieldValues[value.fieldId] = value.actualFieldValue;
  }

  return {
    id: ticket.id,
    workspaceId: ticket.workspaceId,
    boardId: ticket.boardId,
    channelId: ticket.channelId,
    projectId: ticket.projectId,
    stageName: ticket.stageName,
    statusV2: ticket.statusV2,
    priority: ticket.priority,
    assignedTo: ticket.assignedTo,
    createdBy: ticket.createdBy,
    userGroupId: ticket.userGroupId,
    ticketType: ticket.ticketType,
    isStageOverdue: Boolean(ticket.isStageOverdue),
    eta: toMillis(ticket.eta),
    createdAt: ticket.createdAt.getTime(),
    tags: tags.map(tag => tag.name),
    prReviewers,
    qaAssigned,
    roleAssignments,
    formFieldValues,
  };
};

