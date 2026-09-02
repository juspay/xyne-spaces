import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { Loader2, Check, X, Shield } from 'lucide-react';
import type { PendingAction } from '../utils/XyneAITypes';
import {
  getStoredPendingActionResolution,
  subscribeToPendingActionResolutions,
} from '../../../../services/XyneAI/XyneAIPendingActionStore';
import { Button } from '../../../ui/Button/Button';

interface PendingActionBlockProps {
  actions: PendingAction[];
  onApprove?: (action: PendingAction, index: number) => Promise<void> | void;
  onDecline?: (action: PendingAction, index: number) => Promise<void> | void;
}

/**
 * Turn a raw tool name into a user-facing label.
 * Strips prefixes and title-cases.
 */
function humanizeToolName(raw: string): string {
  if (!raw) return raw;
  const stripped = raw.includes('__') ? raw.split('__').slice(1).join('__') : raw;
  const trimmed = stripped.includes(':') ? stripped.split(':').slice(-1)[0]! : stripped;
  return trimmed
    .split(/[-_]/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

export function PendingActionBlock({
  actions,
  onApprove,
  onDecline,
}: PendingActionBlockProps): ReactElement {
  return (
    <div className='space-y-2'>
      {actions.map((action, i) => (
        <PendingActionItem
          key={action.id || `${action.serverType}-${action.tool}-${i}`}
          action={action}
          index={i}
          onApprove={onApprove}
          onDecline={onDecline}
        />
      ))}
    </div>
  );
}

interface PendingActionItemProps {
  action: PendingAction;
  index: number;
  onApprove?: ((action: PendingAction, index: number) => Promise<void> | void) | undefined;
  onDecline?: ((action: PendingAction, index: number) => Promise<void> | void) | undefined;
}

function PendingActionItem({
  action,
  index,
  onApprove,
  onDecline,
}: PendingActionItemProps): ReactElement {
  const [state, setState] = useState<'idle' | 'running' | 'approved' | 'declined' | 'error'>(
    action.resolution ?? 'idle',
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const syncResolution = (): void => {
      setState(action.resolution ?? getStoredPendingActionResolution(action.id) ?? 'idle');
      setError(null);
    };
    syncResolution();
    return subscribeToPendingActionResolutions(syncResolution);
  }, [action.id, action.resolution]);

  const handleApprove = async (): Promise<void> => {
    if (!onApprove) return;
    setState('running');
    setError(null);
    try {
      await onApprove(action, index);
      setState('approved');
    } catch (err) {
      setState('error');
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDecline = async (): Promise<void> => {
    if (!onDecline) return;
    setState('running');
    setError(null);
    try {
      await onDecline(action, index);
      setState('declined');
    } catch (err) {
      setState('error');
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  if (state === 'approved') {
    return (
      <div className='flex items-center gap-2 py-1 text-[11px]'>
        <Check size={12} className='text-emerald-500' />
        <span className='text-muted-foreground'>{humanizeToolName(action.tool)}</span>
        <span className='text-emerald-600'>approved</span>
      </div>
    );
  }

  if (state === 'declined') {
    return (
      <div className='flex items-center gap-2 py-1 text-[11px]'>
        <X size={12} className='text-muted-foreground' />
        <span className='text-muted-foreground'>{humanizeToolName(action.tool)}</span>
        <span className='text-muted-foreground/70'>declined</span>
      </div>
    );
  }

  return (
    <div className='py-2'>
      {/* Header */}
      <div className='flex items-center gap-2 mb-2'>
        <Shield size={12} className='text-yellow-500' />
        <span className='text-[11px] text-muted-foreground'>
          The agent wants to{' '}
          <span className='text-foreground'>{humanizeToolName(action.tool)}</span>
        </span>
      </div>

      {/* Params preview */}
      <pre className='mb-2 max-h-32 overflow-auto whitespace-pre-wrap break-all rounded bg-muted px-2 py-1.5 font-mono text-[10px] text-muted-foreground'>
        {JSON.stringify(action.params, null, 2)}
      </pre>

      {/* Error message */}
      {error && <div className='mb-2 text-[10px] text-destructive'>{error}</div>}

      {/* Action buttons */}
      <div className='flex items-center gap-2'>
        <Button
          variant='ghost'
          onClick={() => void handleApprove()}
          trackId='approve_pending_action'
          disabled={state === 'running'}
          className='inline-flex items-center gap-1 rounded bg-emerald-600 px-2.5 py-1 text-[10px] font-medium text-white transition hover:bg-emerald-700 disabled:opacity-50'
          type='button'
          data-track-category='xyne-ai'
          data-track-name='approve-action'
        >
          {state === 'running' ? (
            <Loader2 size={10} className='animate-spin' />
          ) : (
            <Check size={10} />
          )}
          Approve
        </Button>
        <Button
          variant='ghost'
          onClick={() => void handleDecline()}
          trackId='decline_pending_action'
          disabled={state === 'running'}
          className='inline-flex items-center gap-1 rounded bg-secondary px-2.5 py-1 text-[10px] text-secondary-foreground transition hover:bg-secondary/80 disabled:opacity-50'
          type='button'
          data-track-category='xyne-ai'
          data-track-name='decline-action'
        >
          <X size={10} />
          Decline
        </Button>
      </div>
    </div>
  );
}
