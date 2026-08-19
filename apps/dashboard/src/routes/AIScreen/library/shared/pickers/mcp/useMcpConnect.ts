import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { clawErrorText } from '@/services/claw/clawRequest';
import type { CredentialField, McpServer } from '@/services/claw/clawMcpTypes';
import {
  connectMcpServer,
  connectStrategyFor,
  getCredentialFields,
  type ConnectStrategy,
} from './mcpConnectionService';

export interface McpConnect {
  fields: CredentialField[];
  strategy: ConnectStrategy;
  isPending: boolean;
  error: string | null;
  connect: (credentials: Record<string, string>) => void;
  reset: () => void;
}

export function useMcpConnect(server: McpServer | undefined, onConnected: () => void): McpConnect {
  const { user } = useAuth();
  const userId = user?.id;
  const queryClient = useQueryClient();

  const fieldsQuery = useQuery({
    queryKey: ['claw-mcp-credential-fields'],
    queryFn: getCredentialFields,
    staleTime: 5 * 60 * 1000,
  });

  const mutation = useMutation({
    mutationFn: async (credentials: Record<string, string>) => {
      if (!userId || !server) throw new Error('Not signed in');
      return connectMcpServer(userId, server, credentials);
    },
    onSuccess: async result => {
      if (result.redirected) return;
      await queryClient.invalidateQueries({ queryKey: ['claw-mcp', userId] });
      onConnected();
    },
  });

  const fields = server
    ? (fieldsQuery.data?.[server.type] ?? server.credentialForm?.fields ?? [])
    : [];

  return {
    fields,
    strategy: server ? connectStrategyFor(server) : 'credentials',
    isPending: mutation.isPending,
    error: mutation.error ? clawErrorText(mutation.error, 'Could not connect') : null,
    connect: credentials => mutation.mutate(credentials),
    reset: mutation.reset,
  };
}
