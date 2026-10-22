import { getJson } from '../services/localStorage';

let activeWorkspaceId: string | null = null;

const cachedUser = getJson<{ workspaceId?: string }>('@lotus_user_cache');
if (cachedUser?.workspaceId) {
  activeWorkspaceId = cachedUser.workspaceId;
}

export function setActiveWorkspaceId(workspaceId: string | null): void {
  activeWorkspaceId = workspaceId;
}

export function getActiveWorkspaceId(): string | null {
  return activeWorkspaceId;
}
