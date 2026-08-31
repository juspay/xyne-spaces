/**
 * Workspace-level shared mailbox card. Mirrors DeskIntegrationCard but for the
 * single workspace-scoped mailbox that DL desks ride on. The button reuses the
 * same OAuth connect URL for both initial setup and reconnect — the backend
 * routes to the right branch.
 */

import { ReactElement, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Mail, Plug, Loader2, Unplug, AlertTriangle } from 'lucide-react';
import { Button } from '../../ui/Button/Button';
import { Dialog } from '../../ui/Dialog';
import { useAuthContextValues } from '../../../hooks/useAuth';
import { WorkspaceRole } from '@xyne/shared';
import { API_BASE_URL } from '../../../config';
import {
  getWorkspaceSharedMailboxStatus,
  disconnectWorkspaceDeskIntegration,
} from '../../../services/clients/workspaceDeskApi';
import { initWorkspaceDeskOAuth } from '../../../services/clients/integrationOAuthApi';

export const WorkspaceDeskEmailCard = (): ReactElement => {
  const { role } = useAuthContextValues();
  const canManage =
    (role as WorkspaceRole) === WorkspaceRole.OWNER ||
    (role as WorkspaceRole) === WorkspaceRole.ADMIN;
  const queryClient = useQueryClient();

  const { data: status, isLoading } = useQuery({
    queryKey: ['workspace-shared-mailbox-status'],
    queryFn: getWorkspaceSharedMailboxStatus,
  });

  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  const handleConnect = (provider: 'google' | 'microsoft'): void => {
    const isElectron = typeof window.electronAPI?.openExternal === 'function';
    if (isElectron && window.electronAPI?.openExternal) {
      void initWorkspaceDeskOAuth(provider, 'electron')
        .then(authUrl => {
          window.electronAPI?.openExternal(authUrl);
        })
        .catch(error => {
          toast.error(error instanceof Error ? error.message : 'Failed to start mailbox OAuth');
        });
    } else {
      const url = `${API_BASE_URL}/integrations/${provider}/connect/workspace`;
      window.location.href = url;
    }
  };

  const handleDisconnect = async (): Promise<void> => {
    setIsDisconnecting(true);
    try {
      await disconnectWorkspaceDeskIntegration();
      toast.success('Shared mailbox disconnected.');
      setShowDisconnectConfirm(false);
      void queryClient.invalidateQueries({ queryKey: ['workspace-shared-mailbox-status'] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to disconnect — please try again.');
    } finally {
      setIsDisconnecting(false);
    }
  };

  const isConfigured = !!status?.configured;
  const provider = status?.sourceType === 'microsoft' ? 'microsoft' : 'google';

  return (
    <div className='bg-card p-3 rounded-xl border border-border'>
      <div className='flex flex-col gap-y-2'>
        <p className='text-sm font-medium text-foreground'>Desk Email (workspace shared)</p>

        {isLoading ? (
          <div className='flex items-center gap-2 text-sm text-muted-foreground'>
            <Loader2 size={14} className='animate-spin flex-shrink-0' />
            <span className='text-xs'>Loading...</span>
          </div>
        ) : isConfigured ? (
          <div className='flex items-center gap-2 text-sm text-muted-foreground'>
            <Mail size={14} className='flex-shrink-0' />
            <span className='truncate font-mono text-xs' title={status?.displayName ?? ''}>
              {status?.displayName}
            </span>
          </div>
        ) : (
          <p className='text-xs text-muted-foreground'>No shared mailbox configured.</p>
        )}

        {canManage && !isLoading && (
          <div className='flex items-center gap-2 pt-1 flex-wrap'>
            {isConfigured ? (
              <>
                <Button
                  variant='secondary'
                  size='sm'
                  onClick={() => handleConnect(provider)}
                  disabled={isDisconnecting}
                  data-track-category='workspace-desk-email'
                  data-track-name='reconnect'
                >
                  <Plug size={14} className='mr-1.5' />
                  Reconnect
                </Button>
                <Button
                  variant='destructive'
                  size='sm'
                  onClick={() => setShowDisconnectConfirm(true)}
                  disabled={isDisconnecting}
                  data-track-category='workspace-desk-email'
                  data-track-name='open-disconnect-confirm'
                >
                  <Unplug size={14} className='mr-1.5' />
                  Disconnect
                </Button>
                {!status?.isActive && (
                  <span className='text-xs text-amber-600 dark:text-amber-400'>
                    Currently disconnected
                  </span>
                )}
              </>
            ) : (
              <>
                <Button
                  variant='secondary'
                  size='sm'
                  onClick={() => handleConnect('google')}
                  data-track-category='workspace-desk-email'
                  data-track-name='setup-google'
                  className='gap-1.5'
                >
                  <svg className='w-4 h-4' viewBox='0 0 24 24' fill='currentColor'>
                    <path d='M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z' />
                    <path d='M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z' />
                    <path d='M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z' />
                    <path d='M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z' />
                  </svg>
                  Google
                </Button>
                <Button
                  variant='secondary'
                  size='sm'
                  onClick={() => handleConnect('microsoft')}
                  data-track-category='workspace-desk-email'
                  data-track-name='setup-microsoft'
                  className='gap-1.5'
                >
                  <svg className='w-4 h-4' viewBox='0 0 21 21' fill='currentColor'>
                    <path d='M10 0H0v10h10V0zM21 0H11v10h10V0zM10 11H0v10h10V11zM21 11H11v10h10V11z' />
                  </svg>
                  Microsoft
                </Button>
              </>
            )}
          </div>
        )}
      </div>

      <Dialog
        open={showDisconnectConfirm}
        onOpenChange={open => !open && setShowDisconnectConfirm(false)}
        title='Disconnect shared mailbox'
      >
        <div className='p-5 flex flex-col gap-3'>
          <div className='flex gap-3'>
            <AlertTriangle size={18} className='flex-shrink-0 text-amber-500 mt-0.5' />
            <div className='flex flex-col gap-2 text-sm'>
              <p className='text-foreground'>
                Disconnect <span className='font-mono text-xs'>{status?.displayName}</span> from
                this workspace?
              </p>
              <ul className='text-muted-foreground list-disc pl-4 space-y-1 text-xs'>
                <li>New emails will stop syncing immediately.</li>
                <li>Existing email history on desks is kept.</li>
                <li>You can reconnect later with the same mailbox.</li>
              </ul>
            </div>
          </div>
          <div className='flex justify-end gap-2 pt-2'>
            <Button
              variant='secondary'
              size='sm'
              onClick={() => setShowDisconnectConfirm(false)}
              data-track-category='workspace-desk-email'
              data-track-name='CANCEL_DISCONNECT'
              disabled={isDisconnecting}
            >
              Cancel
            </Button>
            <Button
              variant='destructive'
              size='sm'
              onClick={() => void handleDisconnect()}
              disabled={isDisconnecting}
              data-track-category='workspace-desk-email'
              data-track-name='confirm-disconnect'
            >
              {isDisconnecting ? 'Disconnecting...' : 'Disconnect'}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
};
