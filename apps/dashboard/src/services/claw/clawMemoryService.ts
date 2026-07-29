import { clawRequest } from './clawRequest';

export interface ClawAgentMemory {
  readonly id: string;
  readonly hindsightMemoryId: string;
  readonly category: string | null;
  readonly content: string;
  readonly curatorReasoning: string | null;
  readonly curatorConfidence: number | null;
  readonly createdAt: string;
  readonly recallHits7d: number;
  readonly lastRecalledAt: string | null;
}

export async function listClawAgentMemories(
  agentSlug: string,
  search: string,
): Promise<{ memories: ClawAgentMemory[]; total: number }> {
  const params = new URLSearchParams({ limit: '50', status: 'approved' });
  if (search.trim()) params.set('search', search.trim());
  const body = await clawRequest<{
    success: boolean;
    data: ClawAgentMemory[];
    total: number;
  }>(`/api/v1/memory/banks/${encodeURIComponent(agentSlug)}/memories?${params.toString()}`);
  return { memories: body.data, total: body.total };
}

export async function deleteClawAgentMemory(
  agentSlug: string,
  hindsightMemoryId: string,
): Promise<void> {
  await clawRequest<unknown>(
    `/api/v1/memory/banks/${encodeURIComponent(agentSlug)}/memories/${encodeURIComponent(hindsightMemoryId)}`,
    { method: 'DELETE' },
  );
}
