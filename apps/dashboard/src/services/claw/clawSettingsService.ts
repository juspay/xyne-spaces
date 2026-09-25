import { clawRequest } from './clawRequest';
import type {
  ClaudeModelInfo,
  CodexOauthStart,
  GitHubDeviceCode,
  OrcaRouterCatalog,
  OrcaRouterOauthStart,
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

export type CredentialHealthStatus = 'ok' | 'invalid' | 'model-unavailable' | 'unknown' | 'missing';

export interface CredentialHealth {
  provider: string;
  status: CredentialHealthStatus;
  message?: string;
  models?: number;
}

export async function verifyProviderCredentialForUser(
  userId: string,
  provider: string,
): Promise<CredentialHealth> {
  const data = await clawRequest<{ success: boolean; data: CredentialHealth }>(
    `/api/v1/settings/provider-credentials/${encodeURIComponent(provider)}/verify`,
    { ...withUser(userId), method: 'POST' },
  );
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

export async function startCodexOauth(userId: string): Promise<CodexOauthStart> {
  const data = await clawRequest<{ success: boolean; data: CodexOauthStart }>(
    '/api/v1/settings/codex/oauth/start',
    {
      method: 'POST',
      headers: { [USER_ID_HEADER]: userId },
    },
  );
  return data.data;
}

export async function exchangeCodexOauth(
  userId: string,
  payload: { code: string; state: string },
): Promise<void> {
  await clawRequest<{ success: boolean }>('/api/v1/settings/codex/oauth/exchange', {
    method: 'POST',
    headers: { [USER_ID_HEADER]: userId },
    body: JSON.stringify(payload),
  });
}

export async function listCodexModelsForUser(userId: string): Promise<ProviderModelOption[]> {
  const data = await clawRequest<{ success: boolean; data: ProviderModelOption[] }>(
    '/api/v1/settings/codex/models',
    withUser(userId),
  );
  return data.data;
}

/* ── OrcaRouter ────────────────────────────────────────────────────────
 * One provider, two explicit authentication choices (API key, or the
 * out-of-band PKCE sign-in). The backend holds the issued key — the browser
 * never receives it, and the catalog is proxied so no key rides a browser
 * request.
 * ───────────────────────────────────────────────────────────────────── */

export async function startOrcaRouterOauth(userId: string): Promise<OrcaRouterOauthStart> {
  const data = await clawRequest<{ success: boolean; data: OrcaRouterOauthStart }>(
    '/api/v1/settings/provider-credentials/orcarouter/oauth/start',
    {
      method: 'POST',
      headers: { [USER_ID_HEADER]: userId },
    },
  );
  return data.data;
}

export async function exchangeOrcaRouterOauth(
  userId: string,
  payload: { code: string; state: string },
): Promise<{ provider: string; hasApiKey: boolean; source: string }> {
  const data = await clawRequest<{
    success: boolean;
    data: { provider: string; hasApiKey: boolean; source: string };
  }>('/api/v1/settings/provider-credentials/orcarouter/oauth/exchange', {
    method: 'POST',
    headers: { [USER_ID_HEADER]: userId },
    body: JSON.stringify(payload),
  });
  return data.data;
}

/**
 * Cancel an in-flight OrcaRouter sign-in server-side. Uses `keepalive` so the
 * request still leaves the browser during `pagehide` / tab teardown. Failures
 * are swallowed: cancellation is best-effort and must never surface as a
 * settings error.
 */
export async function cancelOrcaRouterOauth(
  userId: string,
  payload: { state?: string },
  opts?: { keepalive?: boolean },
): Promise<void> {
  try {
    await clawRequest<{ success: boolean }>(
      '/api/v1/settings/provider-credentials/orcarouter/oauth/cancel',
      {
        method: 'POST',
        headers: { [USER_ID_HEADER]: userId },
        body: JSON.stringify(payload),
        ...(opts?.keepalive ? { keepalive: true } : {}),
      },
    );
  } catch {
    /* best-effort */
  }
}

export async function listOrcaRouterModelsForUser(
  userId: string,
  params: { capability: string; modalities?: readonly string[] },
): Promise<OrcaRouterCatalog> {
  const query = new URLSearchParams({ capability: params.capability });
  if (params.modalities && params.modalities.length > 0) {
    query.set('modalities', params.modalities.join(','));
  }
  const data = await clawRequest<{ success: boolean; data: OrcaRouterCatalog }>(
    `/api/v1/settings/provider-credentials/orcarouter/models?${query.toString()}`,
    withUser(userId),
  );
  return data.data;
}

export interface ClaudeOauthFlow {
  url: string;
  state: string;
  expiresIn: number;
}

/** Begin the Claude browser sign-in; returns the consent URL to open. */
export async function startClaudeOauth(userId: string): Promise<ClaudeOauthFlow> {
  const data = await clawRequest<{ success: boolean; data: ClaudeOauthFlow }>(
    '/api/v1/settings/provider-credentials/claude/oauth/start',
    {
      method: 'POST',
      headers: { [USER_ID_HEADER]: userId },
      body: JSON.stringify({}),
    },
  );
  return data.data;
}

/**
 * Finish sign-in with what Anthropic showed the user. Accepts a bare code, a
 * "code#state" pair, or the whole redirect URL — the server normalises it.
 */
export async function exchangeClaudeOauth(
  userId: string,
  payload: { code: string; state: string },
): Promise<void> {
  await clawRequest<{ success: boolean }>(
    '/api/v1/settings/provider-credentials/claude/oauth/exchange',
    {
      method: 'POST',
      headers: { [USER_ID_HEADER]: userId },
      body: JSON.stringify(payload),
    },
  );
}
