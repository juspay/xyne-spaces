import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from './useAuth';
import {
  approveCloneRequest,
  listIncomingCloneRequests,
  rejectCloneRequest,
} from '../services/claw/clawAuthAgentsService';
import type { Agent, CloneRequestItem } from '../services/claw/clawAuthAgentTypes';

export const clawCloneRequestsKey = (userId: string | undefined): readonly unknown[] => [
  'claw-clone-requests',
  'incoming',
  userId,
];

export const useClawCloneRequests = (
  agentId: string | undefined,
  agentSlug: string | undefined,
) => {
  const { user } = useAuth();
  const userId = user?.id;
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: clawCloneRequestsKey(userId),
    queryFn: () => listIncomingCloneRequests(userId!),
    enabled: !!userId && !!agentSlug,
    staleTime: 30 * 1000,
    select: requests =>
      requests.filter(
        request =>
          request.status === 'pending' &&
          (request.agentId === agentId || request.agentSlug === agentSlug),
      ),
  });

  const approve = useMutation<Agent | null, Error, CloneRequestItem>({
    mutationFn: request => approveCloneRequest(request.id, userId!),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: clawCloneRequestsKey(userId) });
      void queryClient.invalidateQueries({ queryKey: ['claw-auth-agents'] });
    },
  });

  const reject = useMutation<void, Error, CloneRequestItem>({
    mutationFn: request => rejectCloneRequest(request.id, userId!),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: clawCloneRequestsKey(userId) });
    },
  });

  return { ...query, approve, reject };
};
