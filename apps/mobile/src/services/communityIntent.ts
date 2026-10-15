/**
 * Community sign-in intent, persisted across the OAuth round trip.
 *
 * Mirrors the dashboard's three `localStorage` keys (see `PENDING_COMMUNITY_WORKSPACE_ID_KEY` and
 * friends in `apps/dashboard/src/machines/authMachine.ts`) so the mobile flow behaves identically:
 * the user picks a community *before* authenticating, and the join is completed once an identity
 * cookie exists.
 */

import { deleteKeys, getString, setString } from './localStorage';

const PENDING_COMMUNITY_WORKSPACE_ID_KEY = 'pending_community_workspace_id';
const PENDING_COMMUNITY_WORKSPACE_NAME_KEY = 'pending_community_workspace_name';
const ENTERPRISE_WORKSPACE_LOGIN_INTENT_KEY = 'enterprise_workspace_login_intent';

/** One-shot handoff of the joined workspace's landing channel to `(protected)/index.tsx`. */
const COMMUNITY_LANDING_CHANNEL_ID_KEY = 'community_landing_channel_id';

export interface PendingCommunityWorkspace {
  id: string;
  name: string | null;
}

export function hasEnterpriseLoginIntent(): boolean {
  return getString(ENTERPRISE_WORKSPACE_LOGIN_INTENT_KEY) === 'true';
}

export function clearPendingCommunityWorkspace(): void {
  deleteKeys([PENDING_COMMUNITY_WORKSPACE_ID_KEY, PENDING_COMMUNITY_WORKSPACE_NAME_KEY]);
}

/**
 * The pending community selection, or `null` when there is none.
 *
 * An explicit enterprise ("continue with work email") intent always wins and purges the pending
 * community selection, matching the `hasPendingCommunityWorkspace` guard in the dashboard's auth
 * machine.
 */
export function getPendingCommunityWorkspace(): PendingCommunityWorkspace | null {
  if (hasEnterpriseLoginIntent()) {
    clearPendingCommunityWorkspace();
    return null;
  }

  const id = getString(PENDING_COMMUNITY_WORKSPACE_ID_KEY);
  if (!id) {
    return null;
  }

  return { id, name: getString(PENDING_COMMUNITY_WORKSPACE_NAME_KEY) };
}

export function setPendingCommunityWorkspace(workspaceId: string, workspaceName?: string): void {
  setString(PENDING_COMMUNITY_WORKSPACE_ID_KEY, workspaceId);
  if (workspaceName) {
    setString(PENDING_COMMUNITY_WORKSPACE_NAME_KEY, workspaceName);
    return;
  }
  deleteKeys([PENDING_COMMUNITY_WORKSPACE_NAME_KEY]);
}

export function setEnterpriseLoginIntent(): void {
  setString(ENTERPRISE_WORKSPACE_LOGIN_INTENT_KEY, 'true');
  clearPendingCommunityWorkspace();
}

export function clearEnterpriseLoginIntent(): void {
  deleteKeys([ENTERPRISE_WORKSPACE_LOGIN_INTENT_KEY]);
}

export function setCommunityLandingChannelId(channelId: string): void {
  setString(COMMUNITY_LANDING_CHANNEL_ID_KEY, channelId);
}

/** Reads and clears the landing channel so the redirect only happens once after a join. */
export function consumeCommunityLandingChannelId(): string | null {
  const channelId = getString(COMMUNITY_LANDING_CHANNEL_ID_KEY);
  if (channelId) {
    deleteKeys([COMMUNITY_LANDING_CHANNEL_ID_KEY]);
  }
  return channelId;
}
