import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertCircle, Plug, Plus, Unplug } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/Select';
import { DisconnectConfirmDialog } from '../DisconnectConfirmDialog';
import {
  connectChannelApp,
  disconnectChannelApp,
  listAppDeskEligibleApps,
  listChannelApps,
} from '../../../services/clients/appDeskApi';

interface ConnectedAppsSectionProps {
  channelId: string;
  canManage: boolean;
}

const channelAppsQueryKey = (channelId: string) => ['app-desk-channel-apps', channelId] as const;

export const ConnectedAppsSection: React.FC<ConnectedAppsSectionProps> = ({
  channelId,
  canManage,
}) => {
  const queryClient = useQueryClient();
  const [selectedInstalledAppId, setSelectedInstalledAppId] = useState('');
  // Disconnecting stops ticket intake and reply delivery for that app, so it is
  // confirmed rather than applied straight from the row button.
  const [pendingDisconnect, setPendingDisconnect] = useState<{
    installedAppId: string;
    appName: string | null;
  } | null>(null);

  const {
    data: connectedApps,
    isLoading,
    isError,
  } = useQuery({
    queryKey: channelAppsQueryKey(channelId),
    queryFn: () => listChannelApps(channelId),
    enabled: !!channelId,
  });

  const { data: eligibleApps, isLoading: isLoadingEligibleApps } = useQuery({
    queryKey: ['app-desk-eligible-apps'],
    queryFn: listAppDeskEligibleApps,
    enabled: canManage,
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: channelAppsQueryKey(channelId) });
    // Each connection changes the per-app desk count the create-desk picker shows,
    // and that list sits behind the global 5-minute staleTime.
    void queryClient.invalidateQueries({ queryKey: ['app-desk-eligible-apps'] });
  };

  const connectMutation = useMutation({
    mutationFn: (installedAppId: string) => connectChannelApp(channelId, installedAppId),
    onSuccess: () => {
      setSelectedInstalledAppId('');
      toast.success('App connected to this desk.');
      refresh();
    },
    onError: err => {
      if ((err as { status?: number } | null)?.status === 409) {
        toast.error('App already connected', {
          description: 'This app is already connected to this desk.',
        });
      } else {
        toast.error(
          err instanceof Error ? err.message : 'Failed to connect app — please try again.',
        );
      }
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: (installedAppId: string) => disconnectChannelApp(channelId, installedAppId),
    onSuccess: () => {
      setPendingDisconnect(null);
      toast.success('App disconnected. Conversation history is preserved.');
      void refresh();
    },
    onError: err => {
      toast.error(
        err instanceof Error ? err.message : 'Failed to disconnect app — please try again.',
      );
    },
  });

  const activeConnectedIds = useMemo(
    () => new Set((connectedApps ?? []).filter(a => a.isActive).map(a => a.installedAppId)),
    [connectedApps],
  );
  const connectableApps = (eligibleApps ?? []).filter(
    a => !activeConnectedIds.has(a.installedAppId),
  );

  return (
    <div className='flex flex-col gap-[16px]'>
      <div className='flex flex-col gap-[4px]'>
        <div className='text-desk-label'>Connected apps</div>
        <div className='text-desk-helper w-full max-w-[500px]'>
          Xyne Apps connected here can push tickets into this desk and receive replies through their
          webhook.
        </div>
      </div>

      {isLoading ? (
        <div className='flex items-center gap-2 py-3 text-sm text-muted-foreground'>
          <div className='h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent' />
          Loading connected apps...
        </div>
      ) : isError ? (
        <p className='text-[12px] leading-[120%] text-red-500'>
          Failed to load connected apps. Please try again.
        </p>
      ) : !connectedApps?.length ? (
        <p className='text-[13px] leading-[18px] text-desk-helper'>
          No apps connected to this desk yet.
        </p>
      ) : (
        <div className='flex w-full max-w-[480px] max-h-[240px] overflow-y-auto flex-col gap-[6px] rounded-[14px] border border-border bg-background p-[6px] shadow-sm'>
          {connectedApps.map(app => {
            const rowPending =
              (disconnectMutation.isPending &&
                disconnectMutation.variables === app.installedAppId) ||
              (connectMutation.isPending && connectMutation.variables === app.installedAppId);
            return (
              <div
                key={app.sourceId}
                className='group flex h-[32px] items-center justify-between rounded-[10px] px-[10px] py-[8px] transition-colors hover:bg-muted/60'
              >
                <div className='flex min-w-0 items-center gap-2'>
                  <Plug size={16} className='shrink-0 text-muted-foreground' />
                  <span className='truncate text-desk-label'>{app.appName ?? 'Unknown app'}</span>
                  {!app.isActive && (
                    <span className='ml-2 shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground'>
                      Disconnected
                    </span>
                  )}
                </div>
                {canManage && (
                  <button
                    type='button'
                    onClick={() =>
                      app.isActive
                        ? setPendingDisconnect({
                            installedAppId: app.installedAppId,
                            appName: app.appName,
                          })
                        : connectMutation.mutate(app.installedAppId)
                    }
                    disabled={rowPending}
                    className={`shrink-0 text-[13px] font-medium leading-[120%] tracking-[-0.1px] transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                      app.isActive ? 'text-desk-muted hover:text-red-500' : 'text-foreground'
                    }`}
                    data-track-category='DeskSettings'
                    data-track-name={
                      app.isActive ? 'DisconnectConnectedApp' : 'ReconnectConnectedApp'
                    }
                  >
                    <span className='flex items-center gap-1'>
                      {app.isActive ? (
                        <Unplug size={14} className='shrink-0' />
                      ) : (
                        <Plug size={14} className='shrink-0' />
                      )}
                      {app.isActive ? 'Disconnect' : 'Reconnect'}
                    </span>
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {canManage &&
        !isLoading &&
        !isError &&
        (isLoadingEligibleApps ? (
          <div className='flex items-center gap-2 py-3 text-sm text-muted-foreground'>
            <div className='h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent' />
            Loading apps...
          </div>
        ) : !eligibleApps?.length ? (
          <div className='flex w-full max-w-[500px] items-start gap-2 rounded-lg border border-border bg-muted/50 p-3'>
            <AlertCircle
              size={16}
              className='mt-0.5 flex-shrink-0 text-amber-600 dark:text-amber-400'
            />
            <div className='text-sm text-foreground'>
              <div className='font-medium'>No eligible apps found</div>
              <div className='mt-1 text-xs text-muted-foreground'>
                An app must be installed with the <span className='font-mono'>desk:write</span>{' '}
                permission. Set this up in <span className='font-medium'>Xyne Apps</span> first.
              </div>
            </div>
          </div>
        ) : (
          <div className='flex w-full max-w-[480px] items-center gap-2'>
            <Select value={selectedInstalledAppId} onValueChange={setSelectedInstalledAppId}>
              <SelectTrigger className='w-full'>
                <SelectValue placeholder='Select a Xyne App' />
              </SelectTrigger>
              <SelectContent>
                {connectableApps.map(app => (
                  <SelectItem key={app.installedAppId} value={app.installedAppId}>
                    {app.name}
                    {app.description && (
                      <span className='ml-2 text-xs text-muted-foreground'>{app.description}</span>
                    )}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <button
              type='button'
              onClick={() => {
                if (selectedInstalledAppId) connectMutation.mutate(selectedInstalledAppId);
              }}
              disabled={!selectedInstalledAppId || connectMutation.isPending}
              className='inline-flex h-[32px] shrink-0 items-center gap-1.5 rounded-[10px] border border-border bg-background px-3 py-1.5 text-desk-label text-foreground shadow-sm transition-colors hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-50'
              data-track-category='DeskSettings'
              data-track-name='ConnectApp'
            >
              <Plus size={14} />
              <span>{connectMutation.isPending ? 'Connecting…' : 'Connect'}</span>
            </button>
          </div>
        ))}

      <DisconnectConfirmDialog
        open={!!pendingDisconnect}
        onOpenChange={open => !open && setPendingDisconnect(null)}
        title='Disconnect app from this desk'
        prompt={`Disconnect ${pendingDisconnect?.appName ?? 'this app'} from this desk?`}
        bullets={[
          'New messages from this app will stop creating tickets immediately.',
          'Replies on its existing tickets will stop delivering to the app.',
          'Other apps and email on this desk are unaffected.',
          'Conversation history is kept, and you can reconnect the same app later.',
        ]}
        isPending={disconnectMutation.isPending}
        onConfirm={() => {
          if (pendingDisconnect) disconnectMutation.mutate(pendingDisconnect.installedAppId);
        }}
        trackCategory='DeskSettings'
      />
    </div>
  );
};
