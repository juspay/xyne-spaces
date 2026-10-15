import { clawApiRequest } from './clawRequest';
import type { SubagentDef } from './clawSubagentsTypes';

export const listClawSubagents = (userId?: string): Promise<SubagentDef[]> =>
  clawApiRequest<SubagentDef[]>('/subagents', userId ? { userId } : {});

export const getClawSubagent = (name: string, userId?: string): Promise<SubagentDef> =>
  clawApiRequest<SubagentDef>(`/subagents/${encodeURIComponent(name)}`, userId ? { userId } : {});
