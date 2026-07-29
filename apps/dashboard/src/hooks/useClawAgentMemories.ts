import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { deleteClawAgentMemory, listClawAgentMemories } from '../services/claw/clawMemoryService';

export const useClawAgentMemories = (agentSlug: string, search: string) => {
  const queryClient = useQueryClient();
  const key = ['claw-agent-memories', agentSlug, search];
  const query = useQuery({
    queryKey: key,
    queryFn: () => listClawAgentMemories(agentSlug, search),
    staleTime: 30 * 1000,
  });
  const remove = useMutation({
    mutationFn: (hindsightMemoryId: string) => deleteClawAgentMemory(agentSlug, hindsightMemoryId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['claw-agent-memories', agentSlug] });
    },
  });
  return { ...query, remove };
};
