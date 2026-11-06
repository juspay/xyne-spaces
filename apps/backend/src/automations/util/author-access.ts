import { db } from '@/database/client';
import { repositories } from '@/database/repositories';

const RESTRICTED_SCOPE_TYPES = new Set(['DM', 'GROUP_DM']);

/** The automation author is an active, human member of the automation's workspace. */
export async function isActiveWorkspaceAuthor(authorId: string, workspaceId: string): Promise<boolean> {
  if (!authorId) return false;
  const user = await db.user.findFirst({
    where: { id: authorId, workspaceId },
    select: { status: true, userType: true },
  });
  return !!user && user.status !== 'INACTIVE' && user.userType !== 'BOT';
}

/**
 * Private channels and DMs are visible to an automation only when its author is a
 * participant. Public channels are visible to every member of the workspace.
 */
export async function authorCanSeeChannel(
  channelId: string,
  authorId: string,
  workspaceId: string,
): Promise<boolean> {
  const channel = await db.channel.findFirst({
    where: { id: channelId, workspaceId },
    select: { visibility: true, scopeType: true },
  });
  if (!channel) return false;
  if (channel.visibility !== 'PRIVATE' && !RESTRICTED_SCOPE_TYPES.has(channel.scopeType)) return true;
  return repositories.channelParticipants.isParticipant(channelId, authorId);
}

/** The request user an automation acts as: always its author, with the author's real role. */
export async function automationRequestUser(
  authorId: string,
  workspaceId: string,
): Promise<{ id: string; workspaceId: string; role: string }> {
  const user = await db.user.findFirst({ where: { id: authorId, workspaceId }, select: { role: true } });
  if (!user) throw new Error(`Automation author ${authorId} is not in workspace ${workspaceId}`);
  return { id: authorId, workspaceId, role: user.role };
}

export async function assertAssignableUser(userId: string, workspaceId: string, label: string): Promise<void> {
  const user = await db.user.findFirst({
    where: { id: userId, workspaceId },
    select: { status: true, userType: true },
  });
  if (!user || user.status === 'INACTIVE' || user.userType === 'BOT') {
    throw new Error(`[${label}] assignee ${userId} is not an active member of this workspace`);
  }
}

export async function assertGroupInWorkspace(groupId: string, workspaceId: string, label: string): Promise<void> {
  const group = await db.userGroup.findFirst({ where: { id: groupId, workspaceId }, select: { id: true } });
  if (!group) throw new Error(`[${label}] group ${groupId} is not in this workspace`);
}
