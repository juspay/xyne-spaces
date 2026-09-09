import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FileText, Loader2, Mail, Power, RefreshCw, Tag, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  archiveAutomation,
  setDeskLabelRuleStatus,
  type Automation,
} from '../../../api/automationsApi';
import { AutomationStatusValues } from '../../Automation/Automation.types';
import { Button } from '../../ui/Button/Button';
import { Tooltip } from '../../ui/Tooltip/Tooltip';
import { cn } from '../../../utils/classNames';

interface MyAutoLabelRulesProps {
  channelId: string;
  automations: Automation[];
  totalCount: number;
  activeCount: number;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  hasMore: boolean;
  isFetchingMore: boolean;
  onLoadMore: () => void;
}

export const deskLabelRulesQueryKey = (channelId: string) =>
  ['automations', 'desk-label-rules', channelId] as const;

export function MyAutoLabelRules({
  channelId,
  automations,
  totalCount,
  activeCount,
  isLoading,
  isError,
  onRetry,
  hasMore,
  isFetchingMore,
  onLoadMore,
}: MyAutoLabelRulesProps): React.ReactElement {
  const queryClient = useQueryClient();
  const queryKey = deskLabelRulesQueryKey(channelId);

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey });
  };

  const statusMutation = useMutation({
    mutationFn: ({ item, status }: { item: Automation; status: 'ACTIVE' | 'DISABLED' }) =>
      setDeskLabelRuleStatus(item.id, status),
    onSuccess: (_data, variables) => {
      toast.success(variables.status === 'ACTIVE' ? 'Rule activated' : 'Rule disabled');
      invalidate();
    },
    onError: err => toast.error(err instanceof Error ? err.message : 'Status update failed'),
  });

  const archiveMutation = useMutation({
    mutationFn: async (item: Automation) => {
      await archiveAutomation(item.id);
    },
    onSuccess: () => {
      toast.success('Rule archived');
      invalidate();
    },
    onError: err => toast.error(err instanceof Error ? err.message : 'Archive failed'),
  });

  if (isLoading) {
    return (
      <div className='flex min-h-40 items-center justify-center gap-2 text-xs text-muted-foreground'>
        <Loader2 className='size-4 animate-spin' />
        Loading rules…
      </div>
    );
  }

  if (isError) {
    return (
      <div className='flex min-h-40 flex-col items-center justify-center gap-3 text-center'>
        <p className='text-sm text-muted-foreground'>Could not load your auto-label rules.</p>
        <Button
          type='button'
          variant='outline'
          size='sm'
          onClick={onRetry}
          data-track-category='xyne-desk'
          data-track-name='auto-label-rules-retry'
        >
          <RefreshCw className='size-4' />
          Try again
        </Button>
      </div>
    );
  }

  if (automations.length === 0) {
    return (
      <div className='flex min-h-40 flex-col items-center justify-center gap-2 text-center'>
        <div className='flex size-9 items-center justify-center rounded-full bg-muted'>
          <Tag className='size-4 text-muted-foreground' />
        </div>
        <p className='text-sm font-medium text-foreground'>No rules yet</p>
        <p className='max-w-xs text-xs text-muted-foreground'>
          Create a rule to label incoming emails automatically.
        </p>
      </div>
    );
  }

  return (
    <section>
      <div className='mb-2 flex items-center justify-between text-xs text-muted-foreground'>
        <span>
          {totalCount} {totalCount === 1 ? 'rule' : 'rules'}
        </span>
        <span>{activeCount} active</span>
      </div>
      <ul className='divide-y divide-border border-y border-border'>
        {automations.map(item => {
          const isActive = item.status === AutomationStatusValues.ACTIVE;
          const isEmailRule = item.config.trigger.type === 'EMAIL_RECEIVED';
          const isUpdatingStatus =
            statusMutation.isPending && statusMutation.variables?.item.id === item.id;
          const isArchiving =
            archiveMutation.isPending && archiveMutation.variables?.id === item.id;

          return (
            <li key={item.id} className='flex min-h-14 items-center gap-3 py-3'>
              <div className='flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground'>
                {isEmailRule ? <Mail className='size-4' /> : <FileText className='size-4' />}
              </div>
              <div className='min-w-0 flex-1'>
                <div className='truncate text-sm font-medium text-foreground'>{item.name}</div>
                <div className='mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground'>
                  <span>{isEmailRule ? 'Incoming email' : 'Board field update'}</span>
                  <span aria-hidden='true'>·</span>
                  <span
                    className={cn(
                      'inline-flex items-center gap-1',
                      isActive ? 'text-emerald-600' : 'text-muted-foreground',
                    )}
                  >
                    <span
                      className={cn(
                        'size-1.5 rounded-full',
                        isActive ? 'bg-emerald-500' : 'bg-muted-foreground',
                      )}
                    />
                    {isActive ? 'Active' : 'Disabled'}
                  </span>
                </div>
              </div>
              <div className='flex items-center gap-1'>
                <Tooltip content={isActive ? 'Disable rule' : 'Activate rule'} side='top'>
                  <Button
                    type='button'
                    variant='ghost'
                    size='iconSm'
                    disabled={statusMutation.isPending}
                    onClick={() =>
                      statusMutation.mutate({
                        item,
                        status: isActive ? 'DISABLED' : 'ACTIVE',
                      })
                    }
                    data-track-category='xyne-desk'
                    data-track-name='auto-label-toggle-rule'
                    aria-label={isActive ? 'Disable rule' : 'Activate rule'}
                  >
                    {isUpdatingStatus ? (
                      <Loader2 className='size-4 animate-spin' />
                    ) : (
                      <Power className='size-4' />
                    )}
                  </Button>
                </Tooltip>
                <Tooltip content='Archive rule' side='top'>
                  <Button
                    type='button'
                    variant='ghost'
                    size='iconSm'
                    className='text-muted-foreground hover:text-destructive'
                    disabled={archiveMutation.isPending}
                    onClick={() => archiveMutation.mutate(item)}
                    data-track-category='xyne-desk'
                    data-track-name='auto-label-archive-rule'
                    aria-label='Archive rule'
                  >
                    {isArchiving ? (
                      <Loader2 className='size-4 animate-spin' />
                    ) : (
                      <Trash2 className='size-4' />
                    )}
                  </Button>
                </Tooltip>
              </div>
            </li>
          );
        })}
      </ul>
      {hasMore && (
        <div className='mt-3 flex justify-center'>
          <Button
            type='button'
            variant='outline'
            size='sm'
            disabled={isFetchingMore}
            onClick={onLoadMore}
            data-track-category='xyne-desk'
            data-track-name='auto-label-load-more-rules'
          >
            {isFetchingMore ? (
              <>
                <Loader2 className='size-4 animate-spin' />
                Loading…
              </>
            ) : (
              'Load more'
            )}
          </Button>
        </div>
      )}
    </section>
  );
}
