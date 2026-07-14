import { clawApiRequest } from './clawRequest';
import type { SubagentDef, SubagentInputBody, SubagentShareEntry } from './clawSubagentsTypes';

export const listClawSubagents = (userId: string): Promise<SubagentDef[]> =>
  clawApiRequest<SubagentDef[]>('/subagents', { userId });

export const getClawSubagent = (name: string, userId: string): Promise<SubagentDef> =>
  clawApiRequest<SubagentDef>(`/subagents/${encodeURIComponent(name)}`, { userId });

export const createClawSubagent = (
  payload: SubagentInputBody,
  userId: string,
): Promise<SubagentDef> =>
  clawApiRequest<SubagentDef>('/subagents', {
    method: 'POST',
    userId,
    body: JSON.stringify(payload),
  });

export const updateClawSubagent = (
  name: string,
  payload: SubagentInputBody,
  userId: string,
): Promise<SubagentDef> =>
  clawApiRequest<SubagentDef>(`/subagents/${encodeURIComponent(name)}`, {
    method: 'PUT',
    userId,
    body: JSON.stringify(payload),
  });

export const enableClawSubagent = (name: string, userId: string): Promise<SubagentDef> =>
  clawApiRequest<SubagentDef>(`/subagents/${encodeURIComponent(name)}/enable`, {
    method: 'POST',
    userId,
  });

export const disableClawSubagent = async (name: string, userId: string): Promise<void> => {
  await clawApiRequest<unknown>(`/subagents/${encodeURIComponent(name)}`, {
    method: 'DELETE',
    userId,
  });
};

export const deleteClawSubagent = disableClawSubagent;

export const listClawSubagentShares = (
  name: string,
  userId: string,
): Promise<SubagentShareEntry[]> =>
  clawApiRequest<SubagentShareEntry[]>(`/subagents/${encodeURIComponent(name)}/shares`, {
    userId,
  });

export const addClawSubagentShare = (
  name: string,
  userIdOrEmail: string,
  userId: string,
): Promise<SubagentShareEntry> =>
  clawApiRequest<SubagentShareEntry>(`/subagents/${encodeURIComponent(name)}/shares`, {
    method: 'POST',
    userId,
    body: JSON.stringify({ userIdOrEmail, role: 'EDITOR' }),
  });

export const removeClawSubagentShare = async (
  name: string,
  targetUserId: string,
  userId: string,
): Promise<void> => {
  await clawApiRequest<unknown>(
    `/subagents/${encodeURIComponent(name)}/shares/${encodeURIComponent(targetUserId)}`,
    { method: 'DELETE', userId },
  );
};
