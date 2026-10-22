/**
 * Which WhatsApp accounts each agent answers on. Read-only: adding an account,
 * the QR / token login and per-account policies still live in the claw app.
 *
 * Visibility follows claw-auth's own rules: a personal (linked-device) number
 * is listed for its owner, the org's business number for org admins only — a
 * member gets 403 there, shown as a note rather than as "no accounts".
 */
import { ReactElement, useMemo } from 'react';
import { Bot, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { useClawChannelAccess } from '@/hooks/useClawMessaging';
import type { ChannelAccountView } from '@/services/claw/clawMessagingTypes';
import { ChannelAccountRow } from './ChannelAccountRow';
import { groupAccountsByAgent } from './messagingChannels';

export const ConnectedChannelsCard = (): ReactElement => {
  // One hook per channel (fixed list, so hook order is stable).
  const cloud = useClawChannelAccess('whatsapp-cloud');
  const device = useClawChannelAccess('whatsapp');
  const queries = [cloud, device];

  const loading = queries.some(query => query.isLoading);
  const failed = queries.filter(query => query.isError);
  const businessAdminOnly = cloud.data?.kind === 'forbidden';

  const groups = useMemo(() => {
    const accounts: ChannelAccountView[] = [];
    for (const access of [cloud.data, device.data]) {
      if (access?.kind === 'ok') {
        accounts.push(...access.accounts);
      }
    }
    return groupAccountsByAgent(accounts);
  }, [cloud.data, device.data]);

  const refetchAll = (): void => {
    for (const query of queries) {
      void query.refetch();
    }
  };

  return (
    <div
      data-testid='claw-settings-connected-channels'
      className='rounded-2xl border border-border bg-muted/30'
    >
      <div className='flex items-start justify-between gap-3 border-b border-border px-4 py-3'>
        <div className='min-w-0'>
          <h3 className='text-sm font-semibold text-foreground'>Connected channels</h3>
          <p className='text-xs text-muted-foreground'>
            WhatsApp numbers each agent answers on. A message starting with{' '}
            <code className='font-mono'>/agent-slug</code> picks a different agent.
          </p>
        </div>
        <Button
          variant='ghost'
          size='sm'
          onClick={refetchAll}
          data-track-category='claw-settings'
          data-track-name='CONNECTED_CHANNELS_REFRESH'
        >
          <RefreshCw className='size-3.5' />
          Refresh
        </Button>
      </div>

      {loading ? (
        <div className='space-y-2 p-4'>
          <Skeleton className='h-10 w-full rounded-lg' />
          <Skeleton className='h-10 w-full rounded-lg' />
        </div>
      ) : (
        <div className='divide-y divide-border'>
          {groups.map(group => (
            <div
              key={group.agent?.slug ?? '__none__'}
              data-testid={`claw-settings-agent-channels-${group.agent?.slug ?? 'none'}`}
              className='flex gap-3 px-4 py-3'
            >
              <div className='flex size-8 shrink-0 items-center justify-center rounded-md bg-background text-muted-foreground'>
                <Bot className='size-4' />
              </div>
              <div className='min-w-0 flex-1'>
                <p className='truncate text-sm font-medium text-foreground'>
                  {group.agent ? group.agent.name : 'No default agent'}
                  {group.agent && (
                    <span className='ml-1.5 text-xs font-normal text-muted-foreground'>
                      /{group.agent.slug}
                    </span>
                  )}
                </p>
                {group.accounts.map(account => (
                  <ChannelAccountRow key={account.id} account={account} />
                ))}
              </div>
            </div>
          ))}

          {groups.length === 0 && failed.length === 0 && (
            <p className='px-4 py-3 text-sm text-muted-foreground'>
              No agent is connected to WhatsApp yet.
            </p>
          )}

          {failed.length > 0 && (
            <p className='px-4 py-3 text-sm text-muted-foreground'>
              Couldn’t load some WhatsApp accounts.{' '}
              <Button
                variant='link'
                size='inline'
                onClick={refetchAll}
                data-track-category='claw-settings'
                data-track-name='CONNECTED_CHANNELS_RETRY'
              >
                Try again
              </Button>
            </p>
          )}

          {businessAdminOnly && (
            <p className='px-4 py-3 text-xs text-muted-foreground'>
              Your organization’s WhatsApp business number is managed by its owners and admins, so
              it isn’t listed here. You can still message it once your number is linked.
            </p>
          )}
        </div>
      )}
    </div>
  );
};
