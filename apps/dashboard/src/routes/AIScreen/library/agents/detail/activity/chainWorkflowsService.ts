import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { clawApiRequest } from '@/services/claw/clawRequest';

export interface ChainWorkflowNode {
  readonly id?: string;
  readonly agentSlug?: string;
}

export interface ChainWorkflowTrigger {
  readonly id: string;
  readonly type?: string;
}

export interface ChainWorkflow {
  readonly id: string;
  readonly name: string;
  readonly definition: { readonly nodes?: ChainWorkflowNode[] };
  readonly isPublished: boolean;
  readonly global?: boolean;
  readonly createdByUserId: string;
  readonly triggers?: ChainWorkflowTrigger[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

type ChainWorkflowRow = ChainWorkflow | { readonly workflow: ChainWorkflow };

function unwrap(row: ChainWorkflowRow): ChainWorkflow {
  return 'workflow' in row ? row.workflow : row;
}

export function listChainWorkflows(userId: string): Promise<ChainWorkflowRow[]> {
  return clawApiRequest<ChainWorkflowRow[]>('/chain-workflows', { userId });
}

export function useAgentChainWorkflows(
  agentSlug: string | undefined,
): UseQueryResult<ChainWorkflow[], Error> {
  const { user } = useAuth();
  const userId = user?.id;

  return useQuery({
    queryKey: ['claw-chain-workflows', userId, agentSlug],
    queryFn: () => listChainWorkflows(userId!),
    enabled: !!userId && !!agentSlug,
    retry: false,
    staleTime: 60 * 1000,
    select: rows =>
      rows
        .map(unwrap)
        .filter(workflow =>
          (workflow.definition?.nodes ?? []).some(node => node.agentSlug === agentSlug),
        ),
  });
}
