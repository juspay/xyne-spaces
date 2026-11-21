import { useMemo, useState, type ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Settings2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { PhoneDefault } from '@xyne/icons';
import {
  deleteCallConnection,
  getCallProviders,
  listCallConnections,
  TELEPHONY_QUERY_KEYS,
  type CallConnectionSummary,
} from '../../../services/clients/telephonyApi';
import { getApiErrorMessage } from '../../../utils/apiError';
import { useAllChannels } from '../../../hooks/useChannels';
import { useConfirmDialog } from '../../../hooks/useConfirmDialog';
import { CallConnectionDialog } from './CallConnectionDialog';

const buttonClass =
  'inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground shadow-sm transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50';

/** Workspace call-provider connections; desks pick theirs in Desk Settings → Telephony. */
export const WorkspaceTelephonyCard = (): ReactElement => {
  const queryClient = useQueryClient();
  const allChannels = useAllChannels();
  const { confirm, ConfirmDialog } = useConfirmDialog();
  const [dialog, setDialog] = useState<{ open: boolean; connectionId: string | null }>({
    open: false,
    connectionId: null,
  });

  const { data: providersData } = useQuery({
    queryKey: TELEPHONY_QUERY_KEYS.providers,
    queryFn: getCallProviders,
  });
  // Stable while loading: the dialog resets its form when this changes.
  const providers = useMemo(() => providersData ?? [], [providersData]);
  const { data: connections = [], isLoading } = useQuery({
    queryKey: TELEPHONY_QUERY_KEYS.connections,
    queryFn: listCallConnections,
  });

  // Desks the viewer can't see still count; they just aren't named.
  const deskName = (channelId: string): string =>
    allChannels.find(channel => channel.id === channelId)?.name || 'Private desk';

  const removeMutation = useMutation({
    mutationFn: deleteCallConnection,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: TELEPHONY_QUERY_KEYS.connections });
      void queryClient.invalidateQueries({ queryKey: TELEPHONY_QUERY_KEYS.softphoneAll });
      toast.success('Connection removed');
    },
    onError: error => {
      toast.error('Could not remove the connection', {
        description: getApiErrorMessage(error),
      });
    },
  });

  const onRemove = async (connection: CallConnectionSummary): Promise<void> => {
    const confirmed = await confirm({
      title: `Remove ${connection.name}?`,
      description: 'Calls sent to its webhook will stop reaching Xyne.',
      confirmLabel: 'Remove',
      variant: 'destructive',
    });
    if (confirmed) removeMutation.mutate(connection.id);
  };

  const summary = (connection: CallConnectionSummary): string => {
    const count = connection.desks.length;
    if (count === 0) return 'Not used by any desk yet';
    const defaultDesk = connection.desks.find(desk => desk.isDefault);
    return `${count} desk${count === 1 ? '' : 's'}${defaultDesk ? ` · default: ${deskName(defaultDesk.channelId)}` : ''}`;
  };

  const editing = connections.find(connection => connection.id === dialog.connectionId);

  return (
    <>
      <div className='rounded-xl border border-border bg-card p-3'>
        <div className='flex items-center justify-between gap-2'>
          <p className='text-sm font-medium text-foreground'>Call connections</p>
          <button
            type='button'
            onClick={() => setDialog({ open: true, connectionId: null })}
            disabled={providers.length === 0}
            className={buttonClass}
            data-track-category='workspace-telephony'
            data-track-name='AddConnection'
          >
            <Plus size={14} />
            Add connection
          </button>
        </div>

        {isLoading ? (
          <p className='mt-2 text-xs text-muted-foreground'>Loading connections…</p>
        ) : connections.length === 0 ? (
          <p className='mt-2 text-xs text-muted-foreground'>
            No call connections yet. Add one, then pick it on each call desk.
          </p>
        ) : (
          <ul className='mt-2 flex flex-col gap-2'>
            {connections.map(connection => (
              <li
                key={connection.id}
                className='rounded-lg border border-border bg-background px-3 py-2'
              >
                <div className='flex items-center gap-2'>
                  <PhoneDefault size={14} className='shrink-0 text-muted-foreground' />
                  <span
                    className='truncate text-sm font-medium text-foreground'
                    title={connection.name}
                  >
                    {connection.name}
                  </span>
                  <span className='shrink-0 text-xs text-muted-foreground'>
                    {connection.providerName}
                  </span>
                  <div className='ml-auto flex shrink-0 items-center gap-1.5'>
                    <button
                      type='button'
                      onClick={() => setDialog({ open: true, connectionId: connection.id })}
                      className={buttonClass}
                      data-track-category='workspace-telephony'
                      data-track-name='ManageConnection'
                    >
                      <Settings2 size={13} />
                      Manage
                    </button>
                    <button
                      type='button'
                      onClick={() => void onRemove(connection)}
                      disabled={removeMutation.isPending}
                      aria-label={`Remove ${connection.name}`}
                      className={buttonClass}
                      data-track-category='workspace-telephony'
                      data-track-name='RemoveConnection'
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
                <p className='mt-1 text-xs text-muted-foreground'>{summary(connection)}</p>
              </li>
            ))}
          </ul>
        )}
      </div>

      <CallConnectionDialog
        open={dialog.open}
        onOpenChange={open => setDialog(current => ({ ...current, open }))}
        connectionId={dialog.connectionId}
        providers={providers}
        deskNames={(editing?.desks ?? []).map(desk => deskName(desk.channelId))}
      />
      <ConfirmDialog />
    </>
  );
};
