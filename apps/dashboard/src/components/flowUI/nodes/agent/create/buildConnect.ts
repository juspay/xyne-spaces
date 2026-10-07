import {
  isEntryEnabled,
  type McpCatalogEntry,
} from '@/routes/AIScreen/library/shared/pickers/mcp/mcpCatalog';
import { SPACES_SESSION_SERVER_TYPES } from '@/routes/AIScreen/library/shared/pickers/mcp/mcpConnectStrategy';
import type { ToolboxSelection } from '@/services/claw/clawToolsTypes';

/**
 * Connectors a Build turn put on the agent that the user hasn't connected
 * themselves, by catalog slug. The reply shows a connect card for each. An
 * org-shared key still counts: the card offers a personal one. Gateway
 * services connect per agent after save, and Spaces runs on the user's
 * sign-in, so both are left out.
 */
export function connectorsToConnect(
  entries: readonly McpCatalogEntry[],
  before: ToolboxSelection,
  after: ToolboxSelection,
  personal: ReadonlySet<string>,
): string[] {
  return entries
    .filter(
      entry =>
        !entry.isGateway &&
        entry.server !== undefined &&
        !SPACES_SESSION_SERVER_TYPES.has(entry.server.type) &&
        isEntryEnabled(after, entry) &&
        !isEntryEnabled(before, entry) &&
        !personal.has(entry.server.id),
    )
    .map(entry => entry.slug);
}
