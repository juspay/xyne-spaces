/**
 * Workspace shared mailbox (DL flow) — read APIs.
 *
 * Connect/disconnect of the shared mailbox itself happens via OAuth redirect
 * to `/api/integrations/google/connect/workspace` (or microsoft), the same
 * pattern as per-desk integration. DL desks are created through the regular
 * channel-create flow (channelService.createChannel) with deskType='DL'.
 */

import { apiInstance } from './apiClient';

export interface WorkspaceSharedMailboxStatus {
  configured: boolean;
  displayName: string | null;
  sourceType: string | null;
  isActive: boolean;
}

export async function getWorkspaceSharedMailboxStatus(): Promise<WorkspaceSharedMailboxStatus> {
  const res = await apiInstance.get<WorkspaceSharedMailboxStatus>(
    '/integrations/workspace-desk/status',
  );
  return res.data;
}

export async function disconnectWorkspaceDeskIntegration(): Promise<void> {
  await apiInstance.post<{ success: true }>('/integrations/workspace-desk/disconnect');
}
