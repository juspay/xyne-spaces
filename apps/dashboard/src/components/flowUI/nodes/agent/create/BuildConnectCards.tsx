import type { ReactElement } from 'react';
import { McpSuggestCard, type McpSuggestItem } from '@/components/flowUI/nodes/McpSuggestNode';
import { useMcpCatalog } from '@/routes/AIScreen/library/shared/pickers/mcp/useMcpCatalog';

/**
 * The connectors a Build turn added that still need the user's key, under its
 * reply, on the same card the chat posts ("Connect to unlock this").
 */
export function BuildConnectCards({ slugs }: { slugs: readonly string[] }): ReactElement | null {
  const { entries } = useMcpCatalog();
  const connectors: McpSuggestItem[] = slugs.flatMap(slug => {
    const entry = entries.find(item => item.slug === slug);
    if (!entry?.server) return [];
    return [
      {
        serverType: entry.server.type,
        name: entry.label,
        ...(entry.description ? { description: entry.description } : {}),
      },
    ];
  });
  if (connectors.length === 0) return null;
  return (
    <div className='flex w-full flex-col pt-1' data-testid='build-connect-cards'>
      <McpSuggestCard
        title='Connect to unlock this'
        connectors={connectors}
        fullWidth
        linkRows={false}
      />
    </div>
  );
}
