import { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { useClawAgentMcpConnections } from '@/hooks/useClawAgentMcpConnections';
import type { Agent } from '@/services/claw/clawAuthAgentTypes';
import type { AgentPermissions } from '@/services/claw/agentPermissions';
import type { AgentMcpConnectionMeta } from '@/services/claw/clawMcpTypes';
import { DetailSection, EmptyPanel, InfoRow } from './detailTabUtils';

interface ConnectionsTabProps {
  agent: Agent;
  permissions: AgentPermissions;
}

const ConnectionsTab = ({ agent, permissions }: ConnectionsTabProps): ReactElement => {
  const { data: connections = [], isLoading, remove } = useClawAgentMcpConnections(agent.slug);

  const hasSpacesApp = Boolean(agent.spacesAppId || agent.spacesAppUserId || agent.spacesAppToken);

  const removeConnection = async (connection: AgentMcpConnectionMeta): Promise<void> => {
    if (!window.confirm(`Remove the ${connection.displayName} connection from this agent?`)) return;
    try {
      await remove.mutateAsync(connection);
      toast.success('Agent connection removed');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to remove connection');
    }
  };

  return (
    <div className='flex max-w-2xl flex-col gap-6'>
      <DetailSection
        title='Spaces app'
        description='App credentials used when this agent needs to post results back into Spaces.'
      >
        <div className='divide-y divide-border rounded-lg border border-border px-4 py-1'>
          <InfoRow
            label='Status'
            value={
              <Badge variant={hasSpacesApp ? 'success' : 'outline'}>
                {hasSpacesApp ? 'Configured' : 'Not configured'}
              </Badge>
            }
          />
          <InfoRow label='App ID' value={agent.spacesAppId ?? 'Not set'} />
          <InfoRow label='App user' value={agent.spacesAppUserId ?? 'Not set'} />
          <InfoRow label='Token' value={agent.spacesAppToken ? 'Stored' : 'Not set'} />
        </div>
      </DetailSection>

      <DetailSection
        title='Agent MCP connections'
        description='Credentials pinned to this agent take priority over user and global connections.'
      >
        {isLoading ? (
          <div className='flex flex-col gap-2 rounded-lg border border-border p-4'>
            <Skeleton className='h-4 w-full' />
            <Skeleton className='h-4 w-3/4' />
          </div>
        ) : connections.length === 0 ? (
          <EmptyPanel
            title='No pinned connections'
            description='This agent currently resolves MCP credentials from the running user or global defaults.'
          />
        ) : (
          <div className='divide-y divide-border overflow-hidden rounded-lg border border-border'>
            {connections.map(connection => (
              <div
                key={connection.id}
                className='flex items-center justify-between gap-4 px-3 py-3'
              >
                <div className='min-w-0'>
                  <p className='truncate text-sm font-medium text-foreground'>
                    {connection.displayName || connection.mcpServerName}
                  </p>
                  <p className='font-mono text-[11px] text-muted-foreground'>
                    {connection.mcpServerType}-{connection.slug}
                  </p>
                </div>
                <div className='flex items-center gap-2'>
                  <Badge variant='success'>Pinned</Badge>
                  {permissions.canEdit && (
                    <Button
                      type='button'
                      variant='ghost'
                      size='iconSm'
                      disabled={remove.isPending}
                      onClick={() => void removeConnection(connection)}
                      data-track-category='Claw Agents'
                      data-track-name='REMOVE_CONNECTION'
                      aria-label={`Remove ${connection.displayName}`}
                      className='text-muted-foreground hover:text-destructive'
                    >
                      <Trash2 className='size-4' />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        <Link
          to='/claw-agents/mcp'
          className='text-sm font-medium text-foreground underline underline-offset-2'
        >
          Manage MCP connections
        </Link>
      </DetailSection>
    </div>
  );
};

export default ConnectionsTab;
