import { clawRequest } from './clawRequest';
import type {
  ClaudeModelInfo,
  GitHubDeviceCode,
  ProviderCredential,
  ProviderCredentialPayload,
  ProviderModelOption,
  SubagentRouting,
} from './clawSettingsTypes';

const USER_ID_HEADER = 'x-user-id';

const withUser = (userId: string): RequestInit => ({
  headers: { [USER_ID_HEADER]: userId },
});

export async function listProviderCredentials(userId: string): Promise<ProviderCredential[]> {
  const data = await clawRequest<{ success: boolean; data: ProviderCredential[] }>(
    '/api/v1/settings/provider-credentials',
    withUser(userId),
  );
  return data.data;
}

export async function upsertProviderCredential(
  userId: string,
  provider: string,
  payload: ProviderCredentialPayload,
): Promise<ProviderCredential> {
  const data = await clawRequest<{ success: boolean; data: ProviderCredential }>(
    `/api/v1/settings/provider-credentials/${encodeURIComponent(provider)}`,
    {
      method: 'PUT',
      headers: { [USER_ID_HEADER]: userId },
      body: JSON.stringify(payload),
    },
  );
  return data.data;
}

export async function deleteProviderCredential(userId: string, provider: string): Promise<void> {
  await clawRequest<{ success: boolean }>(
    `/api/v1/settings/provider-credentials/${encodeURIComponent(provider)}`,
    {
      method: 'DELETE',
      headers: { [USER_ID_HEADER]: userId },
    },
  );
}

export async function listSubagentRouting(userId: string): Promise<SubagentRouting[]> {
  const data = await clawRequest<{ success: boolean; data: SubagentRouting[] }>(
    '/api/v1/settings/subagent-routing',
    withUser(userId),
  );
  return data.data;
}

export async function upsertSubagentRouting(
  userId: string,
  subagentName: string,
  provider: string,
): Promise<SubagentRouting> {
  const data = await clawRequest<{ success: boolean; data: SubagentRouting }>(
    `/api/v1/settings/subagent-routing/${encodeURIComponent(subagentName)}`,
    {
      method: 'PUT',
      headers: { [USER_ID_HEADER]: userId },
      body: JSON.stringify({ provider }),
    },
  );
  return data.data;
}

export async function deleteSubagentRouting(userId: string, subagentName: string): Promise<void> {
  await clawRequest<{ success: boolean }>(
    `/api/v1/settings/subagent-routing/${encodeURIComponent(subagentName)}`,
    {
      method: 'DELETE',
      headers: { [USER_ID_HEADER]: userId },
    },
  );
}

export async function initiateCopilotGitHubLogin(userId: string): Promise<GitHubDeviceCode> {
  const data = await clawRequest<{ success: boolean; data: GitHubDeviceCode }>(
    '/api/v1/settings/copilot/github-login',
    {
      method: 'POST',
      headers: { [USER_ID_HEADER]: userId },
    },
  );
  return data.data;
}

export async function pollCopilotGitHubLogin(userId: string): Promise<{ status: string }> {
  const data = await clawRequest<{ success: boolean; data?: { status: string }; error?: string }>(
    '/api/v1/settings/copilot/github-poll',
    {
      method: 'POST',
      headers: { [USER_ID_HEADER]: userId },
    },
  );
  if (!data.success || !data.data) throw new Error(data.error ?? 'Authorization failed');
  return data.data;
}

export async function listCopilotModelsForUser(userId: string): Promise<ProviderModelOption[]> {
  const data = await clawRequest<{ success: boolean; data: ProviderModelOption[] }>(
    '/api/v1/settings/copilot/models',
    withUser(userId),
  );
  return data.data;
}

export async function listClaudeModelsForUser(userId: string): Promise<ClaudeModelInfo[]> {
  const data = await clawRequest<{ success: boolean; data: ClaudeModelInfo[] }>(
    '/api/v1/settings/claude/models',
    withUser(userId),
  );
  return data.data;
}

export async function listCodexModelsForUser(userId: string): Promise<ProviderModelOption[]> {
  const data = await clawRequest<{ success: boolean; data: ProviderModelOption[] }>(
    '/api/v1/settings/codex/models',
    withUser(userId),
  );
  return data.data;
}
