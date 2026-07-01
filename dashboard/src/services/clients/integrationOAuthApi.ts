import { apiInstance } from './apiClient';

type OAuthProvider = 'google' | 'microsoft';
type OAuthPlatform = 'electron' | 'web';

type DeskChannelOAuthInitInput = {
  name: string;
  projectId: string;
  visibility: string;
  description?: string;
  assigneeUserGroupId?: string;
  boardId?: string;
  platform?: OAuthPlatform;
};

type WorkspaceChannelEmailOAuthInitInput = {
  returnPath?: string;
  platform?: OAuthPlatform;
};

async function postOAuthInit(
  provider: OAuthProvider,
  path: string,
  payload: Record<string, unknown>,
): Promise<string> {
  const res = await apiInstance.post<{ authUrl: string }>(
    `/integrations/${provider}${path}`,
    payload,
  );
  return res.data.authUrl;
}

export async function initDeskChannelOAuth(
  provider: OAuthProvider,
  payload: DeskChannelOAuthInitInput,
): Promise<string> {
  return postOAuthInit(provider, '/connect/init', payload);
}

export async function initWorkspaceDeskOAuth(
  provider: OAuthProvider,
  platform: OAuthPlatform = 'web',
): Promise<string> {
  return postOAuthInit(provider, '/connect/workspace/init', { platform });
}

export async function initWorkspaceChannelEmailOAuth(
  provider: OAuthProvider,
  payload: WorkspaceChannelEmailOAuthInitInput,
): Promise<string> {
  return postOAuthInit(provider, '/connect/channel-email-workspace/init', payload);
}
