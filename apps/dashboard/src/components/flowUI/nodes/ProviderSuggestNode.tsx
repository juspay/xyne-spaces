import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { cn } from '../../../utils/classNames';
import type { FlowComponent } from '@xyne/shared';
import { useAuth } from '../../../hooks/useAuth';
import { Button, buttonVariants } from '../../ui/Button/Button';
import { listProviderCredentials } from '../../../services/claw/clawSettingsService';
import { AgentKeysDialog } from '../../../routes/AIScreen/library/agents/detail/persona/credentials/AgentKeysDialog';
import { userCredentialScope } from '../../../routes/AIScreen/library/agents/detail/persona/credentials/credentialScope';
import { CardShell } from './cardPrimitives';

/**
 * AI provider suggestions inside a conversation.
 *
 * Mirrors McpSuggestNode, with one difference that matters: providers are a
 * fixed list in code rather than DB rows, so the display text posted with the
 * card is authoritative. Only the connected state is re-read live, so a card
 * sitting in an old thread does not claim you are disconnected after you have
 * since connected.
 */
interface ProviderSuggestItem {
  provider: string;
  name: string;
  description?: string;
  connected?: boolean;
  sharedName?: string;
  connectMethod?: 'oauth' | 'device' | 'api_key' | 'none';
}

interface ProviderSuggestProps {
  title?: string;
  reason?: string;
  providers?: ProviderSuggestItem[];
  browseAll?: boolean;
  totalCount?: number;
}

const LINK_BUTTON = '!text-foreground !no-underline hover:!text-foreground';

export const ProviderSuggestNode: React.FC<{ node: FlowComponent; children?: React.ReactNode }> = ({
  node,
}) => {
  const props = node.props as ProviderSuggestProps | undefined;
  const { user } = useAuth();
  const [connectFor, setConnectFor] = useState<string | null>(null);

  const { data: credentials, refetch } = useQuery({
    queryKey: ['claw-user-provider-credentials', user?.id],
    queryFn: () => listProviderCredentials(user?.id as string),
    enabled: Boolean(user?.id),
    staleTime: 30_000,
  });

  const connectedProviders = useMemo(
    () => new Set((credentials ?? []).map(c => c.provider)),
    [credentials],
  );

  const providers = props?.providers ?? [];
  if (providers.length === 0) return null;

  return (
    <CardShell style={node.style}>
      <div className='flex flex-col gap-4 rounded-b-[11px] border-b border-border bg-card/80 px-3 pb-4 pt-3'>
        <div className='flex h-6 items-center gap-2 pl-1'>
          <span className='min-w-0 truncate text-sm font-medium leading-5 tracking-[-0.5px] text-muted-foreground'>
            {props?.title ?? 'AI providers you can connect'}
          </span>
          {props?.browseAll && (
            <span
              title='Shows providers you have connected yourself. Your organization may already provide others.'
              className='shrink-0 rounded-full border border-border px-2 py-0.5 text-[11px] font-medium leading-4 text-muted-foreground'
            >
              Personal
            </span>
          )}
        </div>

        {props?.reason && (
          <span className='pl-1 text-xs leading-5 text-muted-foreground'>{props.reason}</span>
        )}

        <div className='flex flex-col'>
          {providers.map(item => {
            const isConnected = connectedProviders.has(item.provider) || (item.connected ?? false);
            const connectable = item.connectMethod !== 'none';

            return (
              <div
                key={item.provider}
                className='-mx-1 flex items-center gap-3 rounded-xl px-2 py-2.5 hover:bg-foreground/[0.04]'
              >
                <div className='flex min-w-0 flex-1 flex-col'>
                  <span className='truncate text-sm font-medium leading-5 text-foreground'>
                    {item.name}
                  </span>
                  {item.description && (
                    <span className='truncate text-xs leading-5 text-muted-foreground'>
                      {item.description}
                    </span>
                  )}
                  {item.sharedName && (
                    <span className='truncate text-xs leading-5 text-muted-foreground'>
                      {item.sharedName}
                    </span>
                  )}
                </div>

                {!connectable ? (
                  <span className='shrink-0 rounded-lg px-2 py-1 text-xs font-medium leading-5 text-muted-foreground'>
                    Always available
                  </span>
                ) : isConnected ? (
                  <span className='flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium leading-5 text-status-success'>
                    <span
                      className='size-[6px] shrink-0 rounded-full bg-status-success'
                      aria-hidden
                    />
                    Connected
                  </span>
                ) : (
                  <Button
                    size='sm'
                    variant='outline'
                    className='h-7 shrink-0 rounded-lg px-2.5 text-sm font-medium'
                    onClick={(): void => setConnectFor(item.provider)}
                    data-track-category='Claw Provider'
                    data-track-name='ConnectSuggestedProvider'
                  >
                    Connect
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
            {props.totalCount !== undefined
              ? `${props.totalCount} providers available`
              : 'All providers'}
          </span>
          <Link
            to='/ai/settings'
            className={cn(
              buttonVariants({ variant: 'ghost', size: 'sm' }),
              'h-7 shrink-0 rounded-[10px] px-2.5 text-sm font-medium',
              LINK_BUTTON,
            )}
            data-track-category='Claw Provider'
            data-track-name='OpenProviderSettings'
          >
            Open settings
          </Link>
        </div>
      )}

      {connectFor && user?.id && (
        <AgentKeysDialog
          open
          onOpenChange={(next: boolean): void => {
            if (!next) {
              setConnectFor(null);
              void refetch();
            }
          }}
          scope={userCredentialScope(user.id)}
          canManage
          initialProvider={connectFor}
        />
      )}
    </CardShell>
  );
};
