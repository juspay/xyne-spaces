import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { clawApiRequest } from '@/services/claw/clawRequest';

export interface AgentMemory {
  readonly id: string;
  readonly hindsightMemoryId: string;
  readonly content: string;
  readonly category: string | null;
  readonly scope: 'user' | 'shared' | null;
  readonly createdAt: string | null;
  readonly recallHits7d: number;
  readonly lastRecalledAt: string | null;
}

export interface AgentMemoryStatus {
  readonly memoryEnabled: boolean;
  readonly memorySharedAllowed: boolean;
  readonly memoryApprovalStrategy: 'HUMAN_ONLY' | 'EVALS_ONLY' | 'EVALS_THEN_HUMAN';
}

const bank = (slug: string): string => `/memory/banks/${encodeURIComponent(slug)}`;

export const agentMemoryKey = (slug: string): readonly unknown[] => ['claw-agent-memories', slug];
export const agentMemoryStatusKey = (slug: string): readonly unknown[] => [
  'claw-agent-memory-status',
  slug,
];

export function listAgentMemories(slug: string, limit = 50): Promise<AgentMemory[]> {
  return clawApiRequest<AgentMemory[]>(`${bank(slug)}/memories?limit=${limit}`);
}

export function getAgentMemoryStatus(slug: string): Promise<AgentMemoryStatus> {
  return clawApiRequest<AgentMemoryStatus>(`${bank(slug)}/status`);
}

export function deleteAgentMemory(slug: string, memoryId: string): Promise<unknown> {
  return clawApiRequest<unknown>(`${bank(slug)}/memories/${encodeURIComponent(memoryId)}`, {
    method: 'DELETE',
  });
}

export function setAgentMemoryEnabled(slug: string, enabled: boolean): Promise<AgentMemoryStatus> {
  return clawApiRequest<AgentMemoryStatus>(`${bank(slug)}/${enabled ? 'enable' : 'disable'}`, {
    method: 'POST',
  });
}

export function clearAgentMemories(slug: string): Promise<unknown> {
  return clawApiRequest<unknown>(`${bank(slug)}/clear-all`, { method: 'POST' });
}

/**
 * The digital-twin bank is per-user and gated behind its own endpoints, so the
 * agent-detail screen never lists it. Everything else is agent-scoped.
 */
export function isDigitalTwin(slug: string): boolean {
  return slug === 'digital-twin';
}

export function useAgentMemories(slug: string): UseQueryResult<AgentMemory[], Error> {
  return useQuery({
    queryKey: agentMemoryKey(slug),
    queryFn: () => listAgentMemories(slug),
    enabled: !isDigitalTwin(slug),
    retry: false,
    staleTime: 60 * 1000,
  });
}

export function useAgentMemoryStatus(slug: string): UseQueryResult<AgentMemoryStatus, Error> {
  return useQuery({
    queryKey: agentMemoryStatusKey(slug),
    queryFn: () => getAgentMemoryStatus(slug),
    enabled: !isDigitalTwin(slug),
    retry: false,
    staleTime: 60 * 1000,
  });
}
