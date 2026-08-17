import { Prisma, PrismaClient } from '@prisma/client';
import { sanitizeProjectCode, ProjectType, ChannelRole, ChannelScopeType, ChannelVisibility } from '@xyne/shared';
import { repositories } from '@/database/repositories';

type PrismaClientLike = PrismaClient | Prisma.TransactionClient;

interface EnsureGeneralChannelParams {
  db: PrismaClientLike;
  workspaceId: string;
  workspaceName: string;
  createdBy: string;
  userId?: string;
  role?: ChannelRole;
}

interface GeneralChannelResult {
  channel: { id: string };
  project: { id: string };
  created: boolean;
}

/**
 * Ensure a workspace has a "general" channel (created with a DEFAULT project when
 * missing) and that `workspace.landingChannelId` points at it when unset.
 * Optionally joins the given user to it (idempotent).
 *
 * Shared by enterprise and community workspace flows so both create and join the
 * general channel through the same code path.
 */
export async function ensureGeneralChannelForWorkspace(
  params: EnsureGeneralChannelParams,
): Promise<GeneralChannelResult> {
  const { db, workspaceId, workspaceName, createdBy, userId, role = ChannelRole.MEMBER } = params;

  const existing = await db.channel.findFirst({
    where: {
      workspaceId,
      name: { equals: 'general', mode: 'insensitive' },
      isArchived: false,
    },
    select: { id: true, projectId: true },
  });

  let channel = existing;

  if (!channel) {
    let project = await db.project.findFirst({
      where: { workspaceId, type: ProjectType.DEFAULT },
      select: { id: true },
    });

    if (!project) {
      const code = await generateUniqueDefaultProjectCode(db, workspaceName, workspaceId);
      project = await db.project.create({
        data: {
          name: workspaceName,
          code,
          description: `Default project for ${workspaceName}`,
          type: ProjectType.DEFAULT,
          workspaceId,
          createdBy,
        },
        select: { id: true },
      });
    }

    channel = await db.channel.create({
      data: {
        name: 'general',
        scopeType: ChannelScopeType.DEFAULT,
        visibility: ChannelVisibility.PUBLIC,
        createdBy,
        projectId: project.id,
        workspaceId,
      },
      select: { id: true, projectId: true },
    });

    // Dual-write: mirror the channel→project board set into ChannelBoardMapping.
    const boards = await db.board.findMany({
      where: { projectId: project.id },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (boards.length > 0) {
      const now = new Date();
      await db.channelBoardMapping.createMany({
        data: boards.map((board, index) => ({
          channelId: channel!.id,
          boardId: board.id,
          workspaceId,
          isDefault: index === 0,
          createdBy,
          createdAt: now,
          updatedAt: now,
        })),
        skipDuplicates: true,
      });
    }
  }

  await db.workspace.updateMany({
    where: { id: workspaceId, landingChannelId: null },
    data: { landingChannelId: channel.id },
  });

  if (userId) {
    await repositories.channelParticipants.addParticipant(channel.id, userId, role as ChannelRole);
  }

  return {
    channel: { id: channel.id },
    project: { id: channel.projectId },
    created: !existing,
  };
}

/**
 * Join a user to an existing workspace "general" channel (scoped to the workspace,
 * unlike a global name lookup). Returns the channel id, or null when the workspace
 * has no general channel yet.
 */
export async function ensureUserInGeneralChannel(
  db: PrismaClientLike,
  workspaceId: string,
  userId: string,
  role: ChannelRole = ChannelRole.MEMBER,
): Promise<string | null> {
  const generalChannel = await db.channel.findFirst({
    where: {
      workspaceId,
      name: { equals: 'general', mode: 'insensitive' },
      isArchived: false,
    },
    select: { id: true },
  });

  if (!generalChannel) {
    return null;
  }

  await repositories.channelParticipants.addParticipant(generalChannel.id, userId, role);
  return generalChannel.id;
}

async function generateUniqueDefaultProjectCode(
  db: PrismaClientLike,
  workspaceName: string,
  workspaceId: string,
): Promise<string> {
  const sanitized = sanitizeProjectCode(workspaceName);
  const base = sanitized.length >= 2 ? sanitized : 'PRJ';

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

  return sanitizeProjectCode(`PRJ${Date.now().toString(36)}`);
}
