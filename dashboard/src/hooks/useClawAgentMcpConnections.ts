import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from './useAuth';
import { deleteAgentMcpConnection, listAgentMcpConnections } from '../services/claw/clawMcpService';
import type { AgentMcpConnectionMeta } from '../services/claw/clawMcpTypes';

export const useClawAgentMcpConnections = (agentSlug: string | undefined) => {
  const { user } = useAuth();
  const userId = user?.id;
  const queryClient = useQueryClient();
  const queryKey = ['claw-agent-mcp-connections', agentSlug, userId];
  const query = useQuery({
    queryKey,
    queryFn: () => listAgentMcpConnections(agentSlug!, userId!),
    enabled: !!agentSlug && !!userId,
    staleTime: 60 * 1000,
  });
  const remove = useMutation({
    mutationFn: (connection: AgentMcpConnectionMeta) =>
      deleteAgentMcpConnection(agentSlug!, userId!, connection.mcpServerType, connection.slug),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey });
    },
  });
  return { ...query, remove };
};
