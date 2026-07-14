import { useQuery } from '@tanstack/react-query';
import {
  listResearchAgentProducts,
  listResearchAgentRepositories,
} from '../services/claw/clawResearchAgentService';
import type { ResearchAgentOption } from '../services/claw/clawToolsTypes';

export interface ClawResearchAgentOptions {
  products: ResearchAgentOption[];
  repositories: ResearchAgentOption[];
  isLoading: boolean;
}

/**
 * Research-agent product/repository options for the Toolbox step's pin
 * selectors. Errors degrade to empty lists (parity with the reference's
 * `.catch(() => [])`), so a missing research-agent backend never blocks the
 * wizard.
 */
export const useClawResearchAgentOptions = (): ClawResearchAgentOptions => {
  const products = useQuery({
    queryKey: ['claw-research-agent-products'],
    queryFn: listResearchAgentProducts,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
  const repositories = useQuery({
    queryKey: ['claw-research-agent-repositories'],
    queryFn: listResearchAgentRepositories,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
  return {
    products: products.data ?? [],
    repositories: repositories.data ?? [],
    isLoading: products.isLoading || repositories.isLoading,
  };
};
