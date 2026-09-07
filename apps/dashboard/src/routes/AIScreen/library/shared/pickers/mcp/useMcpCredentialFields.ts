import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { mcpCredentialFields } from '@/services/claw/clawMcpService';
import type { CredentialField, McpServer } from '@/services/claw/clawMcpTypes';
import { getCredentialFields } from './mcpConnectionService';

export const MCP_CREDENTIAL_FIELDS_KEY = ['claw-mcp-credential-fields'];

const STALE_TIME = 5 * 60 * 1000;

/**
 * A connector's credential fields, resolved the same way the connect form
 * renders them: the server-side registry first (which knows every connector
 * with a static adapter), then the connector's own DB columns.
 *
 * Deciding "does this need a form?" from the DB columns alone is what broke
 * pre-prod: `mcp_servers.credentialForm` is nullable and unset there for
 * connectors whose fields live only in code (amplitude, asana, bigquery,
 * bitbucket…), so the UI concluded "no fields", skipped the dialog and posted
 * an empty credential bag. The registry answers correctly in every
 * environment, so both the decision and the form must read from here.
 */
export interface McpCredentialFields {
  /** Render-time lookup; falls back to the DB columns until the query lands. */
  fieldsFor: (server: McpServer | undefined) => CredentialField[];
  /**
   * Click-time lookup. Awaits the registry rather than guessing from whatever
   * is cached, so a Connect pressed before the query resolves still gets the
   * right answer instead of silently taking the no-credentials path.
   */
  ensureFieldsFor: (server: McpServer | undefined) => Promise<CredentialField[]>;
  loading: boolean;
}

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
        // Registry unreachable — fall back to whatever the row declares rather
        // than blocking the connect entirely.
        return mcpCredentialFields(server);
      }
    },
    [queryClient],
  );

  return { fieldsFor, ensureFieldsFor, loading: query.isLoading };
}
