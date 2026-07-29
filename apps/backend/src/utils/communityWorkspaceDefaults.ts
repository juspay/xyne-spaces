import { Prisma, PrismaClient, ProjectType, TicketStatusV2 } from '@prisma/client';
import { sanitizeProjectCode } from '@xyne/shared';

type PrismaClientLike = PrismaClient | Prisma.TransactionClient;

interface CreateCommunityWorkspaceDefaultsParams {
  db: PrismaClientLike;
  workspaceId: string;
  workspaceName: string;
  createdBy: string;
}

interface CommunityWorkspaceDefaults {
  project: { id: string };
  channel: { id: string };
  workspace: { id: string; landingChannelId: string | null };
}

export async function createCommunityWorkspaceDefaults(
  params: CreateCommunityWorkspaceDefaultsParams,
): Promise<CommunityWorkspaceDefaults> {
  const projectCode = await generateUniqueCommunityProjectCode(
    params.db,
    params.workspaceName,
    params.workspaceId,
  );

  const project = await params.db.project.create({
    data: {
      name: params.workspaceName,
      code: projectCode,
      description: `Default project for ${params.workspaceName}`,
      type: ProjectType.DEFAULT,
      workspaceId: params.workspaceId,
      createdBy: params.createdBy,
    },
    select: { id: true },
  });

  const board = await params.db.board.create({
    data: {
      name: params.workspaceName,
      projectId: project.id,
      workspaceId: params.workspaceId,
      createdBy: params.createdBy,
    },
    select: { id: true },
  });

  await params.db.stage.createMany({
    data: [
      {
        name: 'To Do',
        sequenceNumber: 1,
        boardId: board.id,
        createdBy: params.createdBy,
        defaultTicketStatusV2: TicketStatusV2.TODO,
      },
      {
        name: 'In Progress',
        sequenceNumber: 2,
        boardId: board.id,
        createdBy: params.createdBy,
        defaultTicketStatusV2: TicketStatusV2.STARTED,
      },
      {
        name: 'Review',
        sequenceNumber: 3,
        boardId: board.id,
        createdBy: params.createdBy,
        defaultTicketStatusV2: TicketStatusV2.STARTED,
      },
      {
        name: 'Completed',
        sequenceNumber: 4,
        boardId: board.id,
        createdBy: params.createdBy,
        defaultTicketStatusV2: TicketStatusV2.COMPLETED,
      },
    ].map(stage => ({ ...stage, workspaceId: params.workspaceId })),
  });

  const channel = await params.db.channel.create({
    data: {
      name: 'general',
      scopeType: 'DEFAULT',
      visibility: 'PUBLIC',
      createdBy: params.createdBy,
      projectId: project.id,
      workspaceId: params.workspaceId,
    },
    select: { id: true },
  });

  const workspace = await params.db.workspace.update({
    where: { id: params.workspaceId },
    data: { landingChannelId: channel.id },
    select: {
      id: true,
      landingChannelId: true,
    },
  });

  return { project, channel, workspace };
}

async function generateUniqueCommunityProjectCode(
  db: PrismaClientLike,
  workspaceName: string,
  workspaceId: string,
): Promise<string> {
  const sanitized = sanitizeProjectCode(workspaceName);
  const base = sanitized.length >= 2 ? sanitized : 'CM';

  for (let index = 0; index < 100; index += 1) {
    const suffix = index === 0 ? '' : String(index + 1);
    const candidate = `${base.slice(0, 10 - suffix.length)}${suffix}`;
    const existing = await db.project.findFirst({
      where: { workspaceId, code: candidate },
      select: { id: true },
    });

    if (!existing) {
      return candidate;
    }
  }

  return sanitizeProjectCode(`CM${Date.now().toString(36)}`);
}
