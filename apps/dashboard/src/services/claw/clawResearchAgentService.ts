import { clawRequest } from './clawRequest';
import type { ResearchAgentOption } from './clawToolsTypes';

/** Products the research agent can be pinned to. */
export async function listResearchAgentProducts(): Promise<ResearchAgentOption[]> {
  const data = await clawRequest<{ success: boolean; data: ResearchAgentOption[] }>(
    '/api/v1/research-agent/products',
  );
  return data.data;
}

/** Repositories the research agent can be pinned to. */
export async function listResearchAgentRepositories(): Promise<ResearchAgentOption[]> {
  const data = await clawRequest<{ success: boolean; data: ResearchAgentOption[] }>(
    '/api/v1/research-agent/repositories',
  );
  return data.data;
}
