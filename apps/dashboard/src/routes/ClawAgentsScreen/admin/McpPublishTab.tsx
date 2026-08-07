import { useState, type ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CheckTickCircle, MultipleCrossCancelCircle } from '@xyne/icons';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Skeleton } from '@/components/ui/Skeleton';
import { clawErrorText } from '@/services/claw/clawRequest';
import {
  approveServerPublish,
  listMcpPublishRequests,
  rejectServerPublish,
} from '@/services/claw/clawAdminService';
import type { McpPublishRequest } from '@/services/claw/clawAdminTypes';
import { TabMessage } from './components/TabMessage';
import { mcpPublishKey } from './hooks/adminQueryKeys';

const connectorDefinition = (server: McpPublishRequest): string =>
  JSON.stringify(
    {
      type: server.type,
      transport: server.transport,
      credentialForm: server.credentialForm,
      launchConfigTemplate: server.launchConfigTemplate,
      httpConfigTemplate: server.httpConfigTemplate,
      healthcheckSpec: server.healthcheckSpec,
      writeToolPolicy: server.writeToolPolicy,
    },
    null,
    2,
  );

const ownerOf = (server: McpPublishRequest): string => {
  const meta = server.connectorMeta ?? {};
  const owner = meta['ownerUserId'];
  return typeof owner === 'string' ? owner : (server.publishRequestedByUserId ?? 'unknown');
};

const requestedAt = (server: McpPublishRequest): string | null => {
  const meta = server.connectorMeta ?? {};
  const at = meta['publishRequestedAt'] ?? server.publishRequestedAt;
  return typeof at === 'string' ? at : null;
};

export function McpPublishTab({ userId }: { userId: string }): ReactElement {
  const queryClient = useQueryClient();
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState('');

  const {
    data: requests,
    isPending,
    isError,
  } = useQuery({
    queryKey: mcpPublishKey(),
    queryFn: () => listMcpPublishRequests(userId),
    enabled: Boolean(userId),
  });

  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: mcpPublishKey() });
  };

  const approve = useMutation({
    mutationFn: (serverId: string) => approveServerPublish(userId, serverId),
    onSuccess: () => {
      toast.success('Connector published');
      refresh();
    },
    onError: error => toast.error(clawErrorText(error, 'Approve failed')),
  });

  const reject = useMutation({
    mutationFn: ({ serverId, note }: { serverId: string; note?: string }) =>
      rejectServerPublish(userId, serverId, note),
    onSuccess: () => {
      toast.success('Publish request rejected');
      setRejectingId(null);
      setRejectNote('');
      refresh();
    },
    onError: error => toast.error(clawErrorText(error, 'Could not reject the request')),
  });

  const busy = approve.isPending || reject.isPending;

  if (isPending) return <Skeleton className='mt-4 h-24 w-full' />;
  if (isError) return <TabMessage>Couldn’t load MCP publish requests.</TabMessage>;
  if (!requests || requests.length === 0) {
    return <TabMessage>No pending MCP connector publish requests.</TabMessage>;
  }

  return (
    <div className='flex flex-col gap-6 pt-4'>
      {requests.map((server: McpPublishRequest) => (
        <div key={server.id} className='rounded-xl border border-border px-4 py-3'>
          <div className='flex flex-wrap items-start justify-between gap-3'>
            <div className='flex min-w-0 flex-1 flex-col gap-1'>
              <div className='flex min-w-0 flex-wrap items-center gap-2'>
                <span className='truncate text-sm font-medium text-foreground'>{server.name}</span>
                <Badge variant='secondary'>{server.type}</Badge>
                <Badge variant='secondary'>{server.transport ?? 'stdio'}</Badge>
              </div>

              {server.description && (
                <p className='text-xs text-muted-foreground'>{server.description}</p>
              )}

              <p className='text-xs text-muted-foreground'>
                Owner: {ownerOf(server)}
                {requestedAt(server)
                  ? ` · Requested ${new Date(requestedAt(server) as string).toLocaleString()}`
                  : ''}
              </p>
            </div>

            <div className='flex shrink-0 items-center gap-2'>
              <Button
                type='button'
                disabled={busy}
                onClick={() => approve.mutate(server.id)}
                data-track-category='Claw Admin'
                data-track-name='Approve MCP publish'
              >
                <CheckTickCircle className='size-4' />
                Approve
              </Button>
              <Button
                type='button'
                variant='ghost'
                disabled={busy}
                onClick={() => {
                  setRejectNote('');
                  setRejectingId(prev => (prev === server.id ? null : server.id));
                }}
                data-track-category='Claw Admin'
                data-track-name='Reject MCP publish'
              >
                <MultipleCrossCancelCircle className='size-4' />
                Reject
              </Button>
            </div>
          </div>

          {rejectingId === server.id && (
            <div className='mt-3 flex flex-wrap items-center gap-2'>
              <Input
                value={rejectNote}
                onChange={event => setRejectNote(event.target.value)}
                placeholder='Reason for rejection (shown to the connector author)'
                className='min-w-0 flex-1'
                aria-label='Rejection reason'
              />
              <Button
                type='button'
                variant='outline'
                disabled={reject.isPending}
                onClick={() =>
                  reject.mutate({
                    serverId: server.id,
                    ...(rejectNote.trim() ? { note: rejectNote.trim() } : {}),
                  })
                }
              >
                Confirm reject
              </Button>
            </div>
          )}

          <details className='mt-3'>
            <summary className='cursor-pointer text-xs text-muted-foreground hover:text-foreground'>
              View connector definition
            </summary>
            <pre className='mt-2 max-h-72 overflow-auto rounded-lg border border-border bg-muted/50 p-2 text-xs text-muted-foreground'>
              {connectorDefinition(server)}
            </pre>
          </details>
        </div>
      ))}
    </div>
  );
}
