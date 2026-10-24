import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useAuth } from './useAuth';
import { useUserProviderCredentials } from './useUserProviderCredentials';
import {
  clearUserAgentProvider,
  getUserAgentProvider,
  setUserAgentProvider,
  type UserAgentProvider,
} from '../services/claw/localHarnessService';
import { clawErrorText } from '../services/claw/clawRequest';
import {
  AGENT_DEFAULT_PROVIDER,
  chatProviderLabel,
  chatProviderOptions,
  chatProviderValue,
} from '../services/claw/chatProvider';
import type { ComposerProviderControl } from '../components/Composer/Composer.types';

const chatProviderKey = (agentSlug: string, userId: string): [string, string, string] => [
  'claw-user-agent-provider',
  agentSlug,
  userId,
];

export function useChatProvider(
  agentSlug: string,
  disabled: boolean,
): ComposerProviderControl | null {
  const { user } = useAuth();
  const userId = user?.id ?? '';
  const queryClient = useQueryClient();
  const key = chatProviderKey(agentSlug, userId);
  const { data: credentials = [] } = useUserProviderCredentials();
  const { data: config } = useQuery({
    queryKey: key,
    queryFn: () => getUserAgentProvider(agentSlug, userId),
    enabled: Boolean(userId),
    staleTime: 30_000,
  });

  const save = useMutation({
    mutationFn: async (value: string): Promise<UserAgentProvider> => {
      if (value === AGENT_DEFAULT_PROVIDER) {
        await clearUserAgentProvider(agentSlug, userId);
        return { provider: 'spaces', inherited: true };
      }
      const saved = await setUserAgentProvider(agentSlug, userId, value);
      return { provider: saved.provider, inherited: false };
    },
    onMutate: async (value: string) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<UserAgentProvider>(key);
      queryClient.setQueryData<UserAgentProvider>(
        key,
        value === AGENT_DEFAULT_PROVIDER
          ? { provider: 'spaces', inherited: true }
          : { provider: value, inherited: false },
      );
      return { previous };
    },
    onError: (err, _value, context) => {
      queryClient.setQueryData(key, context?.previous);
      toast.error(clawErrorText(err, 'Could not switch the provider'));
    },
    onSuccess: (saved, value) => {
      queryClient.setQueryData(key, saved);
      toast.success(
        value === AGENT_DEFAULT_PROVIDER
          ? 'Your next messages use the agent’s own provider'
          : `Your next messages run on ${chatProviderLabel(value)}`,
      );
    },
  });

  if (!config) return null;
  const selected = chatProviderValue(config);
  const options = chatProviderOptions(credentials, selected);
  if (options.length < 2) return null;

  return {
    options,
    selected,
    saving: save.isPending,
    disabled,
    onSelect: (value): void => {
      if (value !== selected && !save.isPending) save.mutate(value);
    },
  };
}
