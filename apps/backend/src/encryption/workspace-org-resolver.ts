import { DatabaseClient } from '@/database/client';

export async function resolveOrgIdForWorkspace(workspaceId: string): Promise<string> {
  const workspace = await DatabaseClient.getInstance().workspace.findUnique({
    where: { id: workspaceId },
    select: { orgId: true },
  });

  if (!workspace?.orgId) {
    throw new Error(`Workspace ${workspaceId} is missing orgId`);
  }

  return workspace.orgId;
}
