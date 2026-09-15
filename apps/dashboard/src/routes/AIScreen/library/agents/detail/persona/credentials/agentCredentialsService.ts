import { clawApiRequest } from '@/services/claw/clawRequest';

export interface AgentProviderCredentialStatus {
  readonly provider: string;
  readonly model: string | null;
  readonly baseUrl: string | null;
  readonly authType: string | null;
  readonly reasoningEffort: 'low' | 'medium' | 'high' | null;
  readonly configured: boolean;
  readonly createdByUserId: string | null;
  readonly sharedCredentialId: string | null;
  readonly sharedCredentialName: string | null;
  readonly createdAt: string;
}

export interface SetAgentCredentialPayload {
  provider: string;
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  authType?: 'api_key' | 'oauth_token';
  reasoningEffort?: 'low' | 'medium' | 'high' | null;
}

const base = (slug: string): string => `/agents/${encodeURIComponent(slug)}/provider-credentials`;

export async function listAgentProviderCredentials(
  slug: string,
): Promise<AgentProviderCredentialStatus[]> {
  const data = await clawApiRequest<{ providers: AgentProviderCredentialStatus[] }>(base(slug));
  return data.providers;
}

export function setAgentProviderCredential(
  slug: string,
  payload: SetAgentCredentialPayload,
): Promise<unknown> {
  return clawApiRequest<unknown>(base(slug), {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function deleteAgentProviderCredential(slug: string, provider: string): Promise<unknown> {
  return clawApiRequest<unknown>(`${base(slug)}/${encodeURIComponent(provider)}`, {
    method: 'DELETE',
  });
}

export interface ShareCredentialResult {
  sharedCredentialId: string;
  results: Array<{ agentId: string; slug?: string; ok: boolean; error?: string }>;
}

export function shareAgentProviderCredential(
  slug: string,
  provider: string,
  payload: { name?: string; agentIds: string[] },
): Promise<ShareCredentialResult> {
  return clawApiRequest<ShareCredentialResult>(
    `${base(slug)}/${encodeURIComponent(provider)}/share`,
    { method: 'POST', body: JSON.stringify(payload) },
  );
}

export interface AgentOauthFlow {
  url: string;
  state: string;
  expiresIn: number;
}

/**
 * Agent-scoped browser OAuth. Only codex and claude expose these routes — both
 * capture a refreshable token bundle, unlike a pasted key. Anthropic and OpenAI
 * both redirect to a loopback port we don't own, hence the paste-back step.
 */
export interface AgentCopilotDeviceCode {
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

export type AgentCopilotPollStatus = 'approved' | 'pending' | 'slow_down';

/** Copilot uses GitHub's device flow — a code the user types on github.com,
 *  then we poll. No redirect, so nothing to paste back. */
export function startAgentCopilotLogin(slug: string): Promise<AgentCopilotDeviceCode> {
  return clawApiRequest<AgentCopilotDeviceCode>(`${base(slug)}/copilot/github-login`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export function pollAgentCopilotLogin(slug: string): Promise<{ status: AgentCopilotPollStatus }> {
  return clawApiRequest<{ status: AgentCopilotPollStatus }>(`${base(slug)}/copilot/github-poll`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export function startAgentOauth(
  slug: string,
  provider: 'codex' | 'claude',
): Promise<AgentOauthFlow> {
  return clawApiRequest<AgentOauthFlow>(`${base(slug)}/${provider}/oauth/start`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export function exchangeAgentOauth(
  slug: string,
  provider: 'codex' | 'claude',
  payload: { code: string; state: string },
): Promise<unknown> {
  return clawApiRequest<unknown>(`${base(slug)}/${provider}/oauth/exchange`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
