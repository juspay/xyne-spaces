import { ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Mail } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '../../ui/Button/Button';
import { useAuthContextValues } from '../../../hooks/useAuth';
import { API_BASE_URL } from '../../../config';
import { getWorkspaceChannelEmailMailboxStatus } from '../../../services/clients/workspaceDeskApi';
import { initWorkspaceChannelEmailOAuth } from '../../../services/clients/integrationOAuthApi';

export const WorkspaceChannelEmailCard = (): ReactElement => {
  const { role } = useAuthContextValues();
  const location = useLocation();
  const canManage = role === 'OWNER' || role === 'ADMIN';

  const { data: status, isLoading } = useQuery({
    queryKey: ['workspace-channel-email-mailbox-status'],
    queryFn: getWorkspaceChannelEmailMailboxStatus,
  });

  const handleConnect = (provider: 'google' | 'microsoft'): void => {
    const isElectron = typeof window.electronAPI?.openExternal === 'function';
    if (isElectron && window.electronAPI?.openExternal) {
      void initWorkspaceChannelEmailOAuth(provider, {
        returnPath: `${location.pathname}${location.search}`,
        platform: 'electron',
      })
        .then(authUrl => {
          window.electronAPI?.openExternal(authUrl);
        })
        .catch(error => {
          toast.error(error instanceof Error ? error.message : 'Failed to start mailbox OAuth');
        });
      return;
    }

    const params = new URLSearchParams();
    params.set('returnPath', `${location.pathname}${location.search}`);
    const qs = params.toString() ? `?${params.toString()}` : '';
    const url = `${API_BASE_URL}/integrations/${provider}/connect/channel-email-workspace${qs}`;
    window.location.href = url;
  };

  const isConfigured = !!status?.configured;
  const provider = status?.sourceType === 'microsoft-channel-email' ? 'microsoft' : 'google';

  return (
    <div className='bg-card p-3 rounded-xl border border-border'>
      <div className='flex flex-col gap-y-2'>
        <p className='text-sm font-medium text-foreground'>Email Alerts to channel</p>

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
          <p className='text-xs text-muted-foreground'>
            No separate channel-email mailbox configured.
          </p>
        )}

        {canManage && !isLoading && (
          <div className='flex items-center gap-2 pt-1 flex-wrap'>
            {isConfigured ? (
              <Button
                variant='secondary'
                size='sm'
                onClick={() => handleConnect(provider)}
                data-track-category='workspace-channel-email'
                data-track-name='reconnect'
              >
                Reconnect
              </Button>
            ) : (
              <>
                <Button
                  variant='secondary'
                  size='sm'
                  onClick={() => handleConnect('google')}
                  data-track-category='workspace-channel-email'
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
                  data-track-category='workspace-channel-email'
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
            {isConfigured && !status?.isActive && (
              <span className='text-xs text-amber-600 dark:text-amber-400'>Currently inactive</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
