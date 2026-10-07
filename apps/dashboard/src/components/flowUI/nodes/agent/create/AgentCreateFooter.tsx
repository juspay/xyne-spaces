import type { ReactElement, ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { cn } from '@/utils/classNames';
import { ChatWithAgentButton } from '../ChatWithAgentButton';

interface AgentCreateFooterProps {
  phase: 'pending' | 'created' | 'rejected';
  canCreate: boolean;
  creating: boolean;
  discarding: boolean;
  onCreate: () => void;
  onDiscard: () => void;
  createdSlug?: string | undefined;
  audit?: ReactNode;
  createError?: string | null;
}

export function AgentCreateFooter({
  phase,
  canCreate,
  creating,
  discarding,
  onCreate,
  onDiscard,
  createdSlug,
  audit,
  createError,
}: AgentCreateFooterProps): ReactElement {
  if (phase === 'created') {
    return (
      <div className='flex w-full flex-col gap-2'>
        {createError ? (
          <p className='text-sm leading-5 text-destructive' role='alert'>
            {createError}
          </p>
        ) : null}
        <div className='flex w-full min-h-[44px] items-center justify-between gap-3'>
          {audit ?? <span className='text-sm text-muted-foreground'>Created</span>}
          {createdSlug ? <ChatWithAgentButton slug={createdSlug} /> : null}
        </div>
      </div>
    );
  }

  if (phase === 'rejected') {
    return (
      <div className='flex w-full min-h-[44px] items-center'>
        {audit ?? <span className='text-sm text-muted-foreground'>Declined</span>}
      </div>
    );
  }

  return (
    <div className='flex w-full flex-col gap-2'>
      {createError ? (
        <p className='text-sm leading-5 text-destructive' role='alert'>
          {createError}
        </p>
      ) : null}
      <div className='flex w-full min-h-[44px] items-center justify-between gap-3'>
        <Button
          type='button'
          variant='ghost'
          onClick={onDiscard}
          disabled={creating || discarding}
          className='h-11 rounded-xl px-3 text-[15px]'
          data-track-category='AGENT_ARTIFACT'
          data-track-name='CLICK_DECLINE'
          trackId='agent_draft_decline'
        >
          {discarding ? 'Declining…' : 'Decline'}
        </Button>
        <Button
          type='button'
          onClick={onCreate}
          disabled={!canCreate || creating || discarding}
          loading={creating}
          className={cn(
            'h-11 rounded-xl bg-foreground px-4 text-[15px] text-background hover:bg-foreground/90',
          )}
          data-track-category='AGENT_ARTIFACT'
          data-track-name='CLICK_APPROVE'
          trackId='agent_draft_approve'
        >
          Create Agent
        </Button>
      </div>
    </div>
  );
}
