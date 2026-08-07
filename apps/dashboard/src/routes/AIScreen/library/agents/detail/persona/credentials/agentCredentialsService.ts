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
