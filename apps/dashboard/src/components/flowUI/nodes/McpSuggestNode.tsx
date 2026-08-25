import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { MaximizeTwoArrow } from '@xyne/icons';
import { cn } from '../../../utils/classNames';
import type { FlowComponent } from '@xyne/shared';
import { useAuth } from '../../../hooks/useAuth';
import { Button, buttonVariants } from '../../ui/Button/Button';
import { useMcpCatalog } from '../../../routes/AIScreen/library/shared/pickers/mcp/useMcpCatalog';
import { McpLogo } from '../../../routes/AIScreen/library/shared/pickers/mcp/McpLogo';
import { McpConnectDialog } from '../../../routes/AIScreen/library/mcp/detail/McpConnectDialog';
import { openOAuthConsent } from '../../../routes/AIScreen/library/shared/pickers/mcp/openOAuthConsent';
import {
  autoConnectSpaces,
  createMcpConnection,
  mcpRequiresCredentials,
  startMcpOAuth,
} from '../../../services/claw/clawMcpService';
import type { McpServer } from '../../../services/claw/clawMcpTypes';
import { CardShell } from './cardPrimitives';

/**
 * Connector suggestions inside a conversation, each row connectable in place.
 *
 * Display text comes from props (frozen when the card was posted), but the
 * server row used to CONNECT is resolved live from the catalog by `serverType`.
 * A card sitting in an old thread therefore still connects the right thing, and
 * shows the real current connected state rather than the one captured at post
 * time.
 */
interface McpSuggestItem {
  serverType: string;
  name: string;
  description?: string;
  connected?: boolean;
}

interface McpSuggestProps {
  title?: string;
  reason?: string;
  connectors?: McpSuggestItem[];
  browseAll?: boolean;
  totalCount?: number;
}

export const McpSuggestNode: React.FC<{ node: FlowComponent; children?: React.ReactNode }> = ({
  node,
}) => {
  const props = node.props as McpSuggestProps | undefined;
  const { user } = useAuth();
  const { entries, connectedServerIds, refetch } = useMcpCatalog();
  const [busyType, setBusyType] = useState<string | null>(null);
  const [errorType, setErrorType] = useState<string | null>(null);
  const [credentialsFor, setCredentialsFor] = useState<McpServer | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connectedKey = [...params.keys()].find(key => key.endsWith('_connected'));
    if (!connectedKey || params.get(connectedKey) !== 'true') return;
    refetch();
  }, [refetch]);

  const connectors = props?.connectors ?? [];
  if (connectors.length === 0) return null;

  const serverFor = (serverType: string): McpServer | undefined =>
    entries.find(entry => entry.server?.type === serverType)?.server;

  const handleConnect = async (serverType: string): Promise<void> => {
    const server = serverFor(serverType);
    if (!server || !user?.id) return;
    setErrorType(null);

    if (mcpRequiresCredentials(server)) {
      setCredentialsFor(server);
      return;
    }

    setBusyType(serverType);
    try {
      if (server.type === 'xyne-spaces') {
        await autoConnectSpaces(user.id);
        refetch();
      } else if (server.oauth || server.type === 'google' || server.type === 'microsoft') {
        openOAuthConsent(await startMcpOAuth(user.id, server.type));
        return;
      } else {
        await createMcpConnection(user.id, server.id);
        refetch();
      }
    } catch {
      setErrorType(serverType);
    } finally {
      setBusyType(null);
    }
  };

  return (
    <CardShell style={node.style}>
      <div className='flex flex-col gap-4 rounded-b-[11px] border-b border-border bg-card/80 px-3 pb-4 pt-3'>
        <div className='flex h-6 items-center gap-2 pl-1'>
          <span className='min-w-0 flex-1 truncate text-sm font-medium leading-5 tracking-[-0.5px] text-muted-foreground'>
            {props?.title ?? 'Connectors that could help'}
          </span>
          <MaximizeTwoArrow size={16} className='shrink-0 text-muted-foreground' aria-hidden />
        </div>

        <div className='flex flex-col gap-2'>
          {connectors.map(item => {
            const server = serverFor(item.serverType);
            const isConnected = server
              ? connectedServerIds.has(server.id)
              : (item.connected ?? false);
            const entry = entries.find(e => e.server?.type === item.serverType);

            return (
              <div key={item.serverType} className='flex items-start gap-3 rounded-xl py-1.5 pl-1'>
                <div className='flex min-w-0 flex-1 items-start gap-2'>
                  <McpLogo type={entry?.iconType ?? item.serverType} name={item.name} size='sm' />
                  <div className='flex min-w-0 flex-1 flex-col'>
                    <span className='truncate text-sm font-medium leading-5 text-foreground'>
                      {item.name}
                    </span>
                    {item.description && (
                      <span className='truncate text-xs leading-5 text-muted-foreground'>
                        {item.description}
                      </span>
                    )}
                    {errorType === item.serverType && (
                      <span className='text-xs leading-5 text-destructive'>
                        Could not connect. Try again.
                      </span>
                    )}
                  </div>
                </div>

                {isConnected ? (
                  <span className='shrink-0 rounded-lg px-2 py-1 text-xs font-medium leading-5 text-muted-foreground'>
                    Connected
                  </span>
                ) : (
                  <Button
                    size='sm'
                    variant='outline'
                    className='h-7 shrink-0 rounded-lg px-2.5 text-sm font-medium'
                    disabled={!server || busyType === item.serverType}
                    onClick={(): void => void handleConnect(item.serverType)}
                    data-track-category='Claw MCP'
                    data-track-name='ConnectSuggestedMcp'
                  >
                    {busyType === item.serverType ? 'Connecting…' : 'Connect'}
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {props?.browseAll && (
        <div className='flex items-center justify-between gap-3 px-4 py-3'>
          <span className='min-w-0 truncate text-xs leading-5 text-muted-foreground'>
            {props.totalCount !== undefined && props.totalCount > connectors.length
              ? `${props.totalCount} connectors available`
              : 'All connectors'}
          </span>
          <Link
            to='/ai/library?tab=mcp'
            className={cn(
              buttonVariants({ variant: 'ghost', size: 'sm' }),
              'h-7 shrink-0 rounded-[10px] px-2.5 text-sm font-medium',
              // global.css paints every anchor inside message content link-blue
              // and underlined; this is a button by intent, not a link in prose.
              '!text-foreground !no-underline hover:!text-foreground',
            )}
            data-track-category='Claw MCP'
            data-track-name='BrowseMcpLibrary'
          >
            Browse MCPs
          </Link>
        </div>
      )}

      {credentialsFor && user?.id && (
        <McpConnectDialog
          server={credentialsFor}
          iconType={credentialsFor.type}
          label={credentialsFor.name}
          {...(credentialsFor.description ? { description: credentialsFor.description } : {})}
          userId={user.id}
          open={!!credentialsFor}
          onOpenChange={(open): void => {
            if (!open) setCredentialsFor(null);
          }}
          onConnected={refetch}
        />
      )}
    </CardShell>
  );
};
