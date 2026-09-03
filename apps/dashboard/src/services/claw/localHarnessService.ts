import { clawRequest } from './clawRequest';

const USER_ID_HEADER = 'x-user-id';

export async function setUserAgentProvider(
  slug: string,
  userId: string,
  provider: string,
): Promise<{ provider: string }> {
  const body = await clawRequest<{ success: boolean; data: { provider: string } }>(
    `/api/v1/agents/${encodeURIComponent(slug)}/user-config/${encodeURIComponent(userId)}`,
    {
      method: 'PUT',
      headers: { [USER_ID_HEADER]: userId },
      body: JSON.stringify({ provider }),
    },
  );
  return body.data;
}

export interface UserAgentProvider {
  provider: string;
  /** True when the user never picked a provider for this agent. */
  inherited: boolean;
}

export async function getUserAgentProvider(
  slug: string,
  userId: string,
): Promise<UserAgentProvider> {
  const body = await clawRequest<{
    success: boolean;
    data: { provider: string; inherited?: boolean };
  }>(`/api/v1/agents/${encodeURIComponent(slug)}/user-config/${encodeURIComponent(userId)}`, {
    headers: { [USER_ID_HEADER]: userId },
  });
  return { provider: body.data.provider, inherited: body.data.inherited === true };
}

export async function clearUserAgentProvider(slug: string, userId: string): Promise<void> {
  await clawRequest<{ success: boolean }>(
    `/api/v1/agents/${encodeURIComponent(slug)}/user-config/${encodeURIComponent(userId)}`,
    { method: 'DELETE', headers: { [USER_ID_HEADER]: userId } },
  );
}

/**
 * The user's account-wide default harness. When set, every agent this user runs
 * goes to that harness unless the agent carries a per-agent override — so it is
 * what "use this harness for all my agents" writes, and what a newly created
 * agent inherits without any extra wiring.
 */
export async function getLocalHarnessDefaultProvider(): Promise<string | null> {
  const body = await clawRequest<{ success: boolean; data: { defaultProvider: string | null } }>(
    '/api/v1/local-harness/preferences',
  );
  return body.data.defaultProvider;
}

export async function setLocalHarnessDefaultProvider(
  defaultProvider: string | null,
): Promise<string | null> {
  const body = await clawRequest<{ success: boolean; data: { defaultProvider: string | null } }>(
    '/api/v1/local-harness/preferences',
    { method: 'PUT', body: JSON.stringify({ defaultProvider }) },
  );
  return body.data.defaultProvider;
}
