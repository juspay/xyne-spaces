import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useAuth } from './useAuth';
import {
  addClawSubagentShare,
  createClawSubagent,
  disableClawSubagent,
  enableClawSubagent,
  getClawSubagent,
  listClawSubagents,
  removeClawSubagentShare,
  updateClawSubagent,
} from '../services/claw/clawSubagentsService';
import type {
  SubagentDef,
  SubagentInputBody,
  SubagentShareEntry,
} from '../services/claw/clawSubagentsTypes';

export const clawSubagentsKey = (userId: string | undefined): readonly unknown[] => [
  'claw-subagents',
  userId,
];

export const clawSubagentDetailKey = (
  name: string | undefined,
  userId: string | undefined,
): readonly unknown[] => ['claw-subagent-detail', name, userId];

export const useClawSubagents = (): UseQueryResult<SubagentDef[], Error> => {
  const { user } = useAuth();
  const userId = user?.id;
  return useQuery({
    queryKey: clawSubagentsKey(userId),
    queryFn: () => listClawSubagents(userId!),
    enabled: !!userId,
    staleTime: 30 * 1000,
  });
};

export const useClawSubagentDetail = (
  name: string | undefined,
): UseQueryResult<SubagentDef, Error> => {
  const { user } = useAuth();
  const userId = user?.id;
  return useQuery({
    queryKey: clawSubagentDetailKey(name, userId),
    queryFn: () => getClawSubagent(name!, userId!),
    enabled: !!name && !!userId,
    staleTime: 30 * 1000,
  });
};

const useInvalidateSubagents = (name?: string) => {
  const { user } = useAuth();
  const userId = user?.id;
  const queryClient = useQueryClient();
  return async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: clawSubagentsKey(userId) });
    if (name) {
      await queryClient.invalidateQueries({ queryKey: clawSubagentDetailKey(name, userId) });
    }
  };
};

export const useCreateClawSubagent = (): UseMutationResult<
  SubagentDef,
  Error,
  SubagentInputBody
> => {
  const { user } = useAuth();
  const invalidate = useInvalidateSubagents();
  return useMutation({
    mutationFn: payload => createClawSubagent(payload, user!.id),
    onSuccess: invalidate,
  });
};

export const useUpdateClawSubagent = (
  name: string,
): UseMutationResult<SubagentDef, Error, SubagentInputBody> => {
  const { user } = useAuth();
  const invalidate = useInvalidateSubagents(name);
  return useMutation({
    mutationFn: payload => updateClawSubagent(name, payload, user!.id),
    onSuccess: invalidate,
  });
};

export const useToggleClawSubagent = (): UseMutationResult<
  SubagentDef | null,
  Error,
  { name: string; enabled: boolean }
> => {
  const { user } = useAuth();
  const invalidate = useInvalidateSubagents();
  const queryClient = useQueryClient();
  const userId = user?.id;
  return useMutation({
    mutationFn: async ({ name, enabled }) => {
      if (enabled) return enableClawSubagent(name, user!.id);
      await disableClawSubagent(name, user!.id);
      return null;
    },
    onSuccess: async (_, variables) => {
      await invalidate();
      await queryClient.invalidateQueries({
        queryKey: clawSubagentDetailKey(variables.name, userId),
      });
    },
  });
};

export const useClawSubagentShares = (
  name: string,
): {
  add: UseMutationResult<SubagentShareEntry, Error, string>;
  remove: UseMutationResult<void, Error, string>;
} => {
  const { user } = useAuth();
  const userId = user?.id;
  const invalidate = useInvalidateSubagents(name);
  const add = useMutation<SubagentShareEntry, Error, string>({
    mutationFn: userIdOrEmail => addClawSubagentShare(name, userIdOrEmail, userId!),
    onSuccess: invalidate,
  });
  const remove = useMutation<void, Error, string>({
    mutationFn: targetUserId => removeClawSubagentShare(name, targetUserId, userId!),
    onSuccess: invalidate,
  });
  return { add, remove };
};
