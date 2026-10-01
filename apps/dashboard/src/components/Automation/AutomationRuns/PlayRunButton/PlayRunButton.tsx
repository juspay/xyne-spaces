import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '../../../ui/Button/Button';
import { Dialog } from '../../../ui/Dialog/Dialog';
import { Tooltip } from '../../../ui/Tooltip';
import { useSelf } from '../../../../hooks/useUsers';
import { useIsAutomationsAdmin } from '../../useIsAutomationsAdmin';
import { playAutomationRun, type RunAutomationRef } from '../../../../api/automationsApi';

export interface PlayRunButtonProps {
  runId: string;
  /** The version the run belongs to; null while loading. */
  automation: RunAutomationRef | null | undefined;
}

/** Why ▶ is disabled, or null when the current user can play this held run. */
function usePlayDisabledReason(
  automation: RunAutomationRef | null | undefined,
): string | null {
  const me = useSelf();
  const isAdmin = useIsAutomationsAdmin();
  if (!automation) return 'Loading…';
  if (automation.status !== 'PLAYGROUND') {
    return `Held runs can only be played while this version is in Playground (it is now ${automation.status}).`;
  }
  if (!isAdmin && me?.id !== automation.createdById) {
    return 'Only the automation owner or an Automations admin can play held runs.';
  }
  return null;
}

function errorMessage(err: unknown): string {
  const apiError = (err as { response?: { data?: { error?: unknown } } })?.response?.data?.error;
  if (typeof apiError === 'string' && apiError) return apiError;
  return err instanceof Error ? err.message : 'Failed to play run';
}

/** ▶ Play for a HELD playground run: confirm, then HELD → PENDING on the server. */
export function PlayRunButton({ runId, automation }: PlayRunButtonProps): React.ReactElement {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const disabledReason = usePlayDisabledReason(automation);
  const queryClient = useQueryClient();
  // Play from either the list or the detail page changes both views of the run.
  const refreshRuns = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['automation-runs'] });
    void queryClient.invalidateQueries({ queryKey: ['automation-run', runId] });
  };

  const playMutation = useMutation({
    mutationFn: () => playAutomationRun(runId),
    onSuccess: () => {
      toast.success('Run queued');
      setConfirmOpen(false);
      refreshRuns();
    },
    onError: err => {
      toast.error(errorMessage(err));
      setConfirmOpen(false);
      // The server may have refused because the version left Playground — refresh state.
      refreshRuns();
    },
  });

  const button = (
    <Button
      variant='outline'
      size='sm'
      disabled={disabledReason !== null || playMutation.isPending}
      loading={playMutation.isPending}
      aria-label='Play held run'
      onClick={e => {
        e.stopPropagation();
        setConfirmOpen(true);
      }}
      data-track-category='automation-runs'
      data-track-name='play-held-run'
    >
      ▶ Play
    </Button>
  );

  return (
    <>
      {disabledReason ? (
        <Tooltip content={disabledReason}>
          {/* Disabled buttons swallow pointer events; the span keeps the reason hoverable. */}
          <span aria-label={disabledReason}>{button}</span>
        </Tooltip>
      ) : (
        button
      )}
      <Dialog
        open={confirmOpen}
        onOpenChange={open => {
          if (!playMutation.isPending) setConfirmOpen(open);
        }}
        title='Play this held run?'
        className='sm:max-w-md'
      >
        <div className='flex flex-col gap-3 px-5 py-4 text-sm text-foreground'>
          <p>
            This runs the automation for real. It may perform real actions: send emails, update
            tickets, call webhooks, run agents.
          </p>
          <p className='text-muted-foreground'>Played runs always use default priority.</p>
          <div className='flex justify-end gap-2 pt-2'>
            <Button
              variant='outline'
              size='sm'
              disabled={playMutation.isPending}
              onClick={() => setConfirmOpen(false)}
              data-track-category='automation-runs'
              data-track-name='play-held-run-cancel'
            >
              Cancel
            </Button>
            <Button
              size='sm'
              disabled={playMutation.isPending}
              loading={playMutation.isPending}
              onClick={() => playMutation.mutate()}
              data-track-category='automation-runs'
              data-track-name='play-held-run-confirm'
            >
              Play
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
