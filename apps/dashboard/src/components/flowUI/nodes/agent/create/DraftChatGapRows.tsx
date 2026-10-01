import type { ReactElement, ReactNode } from 'react';
import {
  ClockDefault,
  LinkHorizontalBroken,
  LockClose,
  PluginAddonPuzzle,
  PlusDefault,
  RotateLeft,
  Spinner,
} from '@xyne/icons';
import { Button } from '@/components/ui/Button';
import { capabilityGapKey, type CapabilityGap, type CapabilityGapStatus } from './draftChatGaps';

/** Where a message sent to the Build chat from the test chat has got to. */
export type HandoffPhase = 'queued' | 'running' | 'done';

function statusText(status: CapabilityGapStatus): string {
  switch (status) {
    case 'not_added':
      return 'Not on this agent';
    case 'not_connected':
      return 'Account not connected';
    case 'after_save':
      return 'Connects once you save';
    case 'test_blocked':
      return 'Writes are off while testing';
  }
}

function StatusIcon({ status }: { status: CapabilityGapStatus }): ReactElement {
  const className = 'size-3.5';
  switch (status) {
    case 'not_added':
      return <PluginAddonPuzzle className={className} aria-hidden />;
    case 'not_connected':
      return <LinkHorizontalBroken className={className} aria-hidden />;
    case 'after_save':
      return <ClockDefault className={className} aria-hidden />;
    case 'test_blocked':
      return <LockClose className={className} aria-hidden />;
  }
}

function busy(phase: HandoffPhase | undefined): boolean {
  return phase === 'queued' || phase === 'running';
}

function AskAgainButton({ onAskAgain }: { onAskAgain: () => void }): ReactElement {
  return (
    <Button
      type='button'
      variant='outline'
      size='sm'
      onClick={onAskAgain}
      data-testid='draft-chat-ask-again'
      data-track-category='Claw Agents'
      data-track-name='Create agent test chat: ask again'
      className='self-start rounded-lg'
    >
      <RotateLeft className='size-3.5' aria-hidden />
      Ask again
    </Button>
  );
}

/**
 * What the agent said it can't use in this test, under its reply: a row each,
 * then the Connect card for connectors it needed, then Ask again once
 * something was added or connected.
 */
export function DraftChatGapList({
  gaps,
  phaseOf,
  latest,
  onAdd,
  addable = () => true,
  connect,
  connected = false,
  onAskAgain,
}: {
  gaps: CapabilityGap[];
  phaseOf: (gap: CapabilityGap) => HandoffPhase | undefined;
  latest: boolean;
  /** Asks the Build chat to add a missing capability. Absent where there is no Build chat. */
  onAdd?: ((gap: CapabilityGap) => void) | undefined;
  /** Rows that get Add; the rest only say what's missing. */
  addable?: (gap: CapabilityGap) => boolean;
  /** The Connect card, between the rows and Ask again. */
  connect?: ReactNode;
  /** Every connector the card offers is now on the agent and connected. */
  connected?: boolean;
  onAskAgain: () => void;
}): ReactElement {
  const phases = gaps.map(phaseOf);
  const settled = (phases.some(phase => phase === 'done') || connected) && !phases.some(busy);
  return (
    <div className='flex flex-col gap-2.5'>
      {gaps.length > 0 ? (
        <ul
          className='divide-y divide-border overflow-hidden rounded-xl border border-border'
          data-testid='draft-chat-gaps'
        >
          {gaps.map(gap => {
            const phase = phaseOf(gap);
            return (
              <li
                key={capabilityGapKey(gap)}
                className='flex items-center gap-3 px-3 py-2.5'
                data-gap-status={gap.status}
              >
                <span className='flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground'>
                  <StatusIcon status={gap.status} />
                </span>
                <div className='min-w-0 flex-1'>
                  <p className='truncate text-sm font-medium leading-5 text-foreground'>
                    {gap.capability}
                  </p>
                  <p className='text-xs leading-5 text-muted-foreground'>
                    {phase === 'done'
                      ? 'Asked the Build chat to add it'
                      : `${statusText(gap.status)} · needed to ${gap.need}`}
                  </p>
                </div>
                {gap.status === 'not_added' && onAdd && addable(gap) && phase === undefined ? (
                  <Button
                    type='button'
                    variant='outline'
                    size='sm'
                    onClick={() => onAdd(gap)}
                    aria-label={`Add ${gap.capability}`}
                    data-testid='draft-chat-gap-add'
                    data-track-category='Claw Agents'
                    data-track-name='Create agent test chat: add capability'
                    className='shrink-0 rounded-lg'
                  >
                    <PlusDefault className='size-3.5' aria-hidden />
                    Add
                  </Button>
                ) : null}
                {busy(phase) ? (
                  <span
                    className='inline-flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground'
                    role='status'
                  >
                    <Spinner className='size-3.5 animate-spin' aria-hidden />
                    {phase === 'queued' ? 'Queued' : 'Adding'}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      {connect}
      {settled && latest ? <AskAgainButton onAskAgain={onAskAgain} /> : null}
    </div>
  );
}
