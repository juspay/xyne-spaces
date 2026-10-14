import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { getCredentialFields, mcpCredentialFields } from '@/src/services/claw/clawMcpService';
import type { CredentialField, McpServer } from '@/src/services/claw/clawMcpTypes';

export const MCP_CREDENTIAL_FIELDS_KEY = ['claw-mcp-credential-fields'] as const;

const STALE_TIME = 5 * 60 * 1000;

export type McpCredentialFields = {
  fieldsFor: (server: McpServer | undefined) => CredentialField[];
  ensureFieldsFor: (server: McpServer | undefined) => Promise<CredentialField[]>;
  loading: boolean;
};

/**
 * Credential fields: registry first, then connector DB columns.
 * Required so Connect does not skip the form when credentialForm is null.
 */
export function useMcpCredentialFields(): McpCredentialFields {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: MCP_CREDENTIAL_FIELDS_KEY,
    queryFn: getCredentialFields,
    staleTime: STALE_TIME,
  });

  const fieldsFor = useCallback(
    (server: McpServer | undefined): CredentialField[] => {
      if (!server) return [];
      return query.data?.[server.type] ?? mcpCredentialFields(server);
    },
    [query.data],
  );

  const ensureFieldsFor = useCallback(
    async (server: McpServer | undefined): Promise<CredentialField[]> => {
      if (!server) return [];
      try {
        const map = await queryClient.fetchQuery({
          queryKey: MCP_CREDENTIAL_FIELDS_KEY,
          queryFn: getCredentialFields,
          staleTime: STALE_TIME,
        });
        return map[server.type] ?? mcpCredentialFields(server);
      } catch {
        return mcpCredentialFields(server);
      }
    },
    [queryClient],
  );

  return { fieldsFor, ensureFieldsFor, loading: query.isLoading };
}
