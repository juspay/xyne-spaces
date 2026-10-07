import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { useMcpCredentialFields } from './useMcpCredentialFields';
import { clawErrorText } from '@/services/claw/clawRequest';
import type { CredentialField, McpServer } from '@/services/claw/clawMcpTypes';
import { connectMcpServer } from './mcpConnectionService';
import { connectStrategyFor, needsMcpKey, type ConnectStrategy } from './mcpConnectStrategy';

export interface McpConnect {
  fields: CredentialField[];
  strategy: ConnectStrategy;
  /**
   * Whether the user has to connect anything: an OAuth sign-in or credential
   * fields. False for connectors that run on the Spaces sign-in ('auto').
   */
  needsKey: boolean;
  isPending: boolean;
  error: string | null;
  connect: (credentials: Record<string, string>) => void;
  reset: () => void;
}

export function useMcpConnect(server: McpServer | undefined, onConnected: () => void): McpConnect {
  const { user } = useAuth();
  const userId = user?.id;
  const queryClient = useQueryClient();

  const { fieldsFor } = useMcpCredentialFields();

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

  const fields = fieldsFor(server);
  const strategy = server ? connectStrategyFor(server) : 'credentials';

  return {
    fields,
    strategy,
    needsKey: server ? needsMcpKey(server, fields) : false,
    isPending: mutation.isPending,
    error: mutation.error ? clawErrorText(mutation.error, 'Could not connect') : null,
    connect: credentials => mutation.mutate(credentials),
    reset: mutation.reset,
  };
}
