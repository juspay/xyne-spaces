import { clawApiRequest } from './clawRequest';
import type {
  SlackAgentStatus,
  SlackAppCreated,
  SlackAppSynced,
  SlackCommandRegistered,
} from './clawSlackTypes';

const SLACK_BASE = '/surfaces/slack/agents';

const orgQuery = (orgId?: string | null): string =>
  orgId ? `?orgId=${encodeURIComponent(orgId)}` : '';

const orgBody = (orgId?: string | null): string => JSON.stringify(orgId ? { orgId } : {});

export async function listSlackAgentStatuses(
  userId: string,
  orgId?: string | null,
): Promise<SlackAgentStatus[]> {
  return clawApiRequest<SlackAgentStatus[]>(`${SLACK_BASE}/status${orgQuery(orgId)}`, { userId });
}

export async function createSlackAgentApp(
  userId: string,
  slug: string,
  orgId?: string | null,
): Promise<SlackAppCreated> {
  return clawApiRequest<SlackAppCreated>(`${SLACK_BASE}/${encodeURIComponent(slug)}/create-app`, {
    userId,
    method: 'POST',
    body: orgBody(orgId),
  });
}

export async function syncSlackAgentApp(
  userId: string,
  slug: string,
  orgId?: string | null,
): Promise<SlackAppSynced> {
  return clawApiRequest<SlackAppSynced>(`${SLACK_BASE}/${encodeURIComponent(slug)}/sync-app`, {
    userId,
    method: 'POST',
    body: orgBody(orgId),
  });
}

export async function removeSlackAgentRegistration(
  userId: string,
  slug: string,
  orgId?: string | null,
): Promise<void> {
  await clawApiRequest<unknown>(
    `${SLACK_BASE}/${encodeURIComponent(slug)}/slack-app${orgQuery(orgId)}`,
    { userId, method: 'DELETE' },
  );
}

export async function registerSlackCommand(
  userId: string,
  slug: string,
  options: { orgId?: string; commandName?: string } = {},
): Promise<SlackCommandRegistered> {
  return clawApiRequest<SlackCommandRegistered>(
    `${SLACK_BASE}/${encodeURIComponent(slug)}/register-command`,
    {
      userId,
      method: 'POST',
      body: JSON.stringify({
        ...(options.orgId ? { orgId: options.orgId } : {}),
        ...(options.commandName ? { commandName: options.commandName } : {}),
      }),
    },
  );
}
