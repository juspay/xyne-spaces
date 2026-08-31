import { ReactElement, useState } from 'react';
import { ArrowRight, Brain } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { useEnableDigitalTwin } from '@/hooks/useClawDigitalTwin';
import { DigitalTwinModal } from './DigitalTwinModal';
import { DigitalTwinRangeSelector, type DigitalTwinRange } from './DigitalTwinRangeSelector';

/**
 * Dialog for the backfill action (triggered from the header while the Twin is
 * enabled). The first-time enable flow is handled in-page by
 * `DigitalTwinEnablePanel`, not here.
 */
export const EnableModal = ({
  open,
  mode,
  onClose,
}: {
  open: boolean;
  mode: 'enable' | 'backfill';
  onClose: () => void;
}): ReactElement => {
  const [range, setRange] = useState<DigitalTwinRange>(null);
  const enableMutation = useEnableDigitalTwin();
  const enabling = enableMutation.isPending;

  const submit = (): void => {
    enableMutation.mutate(
      { backfill: range },
      {
        onSuccess: () => {
          toast.success(mode === 'enable' ? 'Digital Twin enabled' : 'Backfill started');
          onClose();
        },
      },
    );
  };

  const ctaLabel = enabling
    ? mode === 'enable'
      ? 'Enabling…'
      : 'Starting…'
    : mode === 'enable'
      ? 'Enable & start'
      : 'Start backfill';

  return (
    <DigitalTwinModal
      open={open}
      onClose={onClose}
      title={mode === 'enable' ? 'Enable Digital Twin' : 'Backfill history'}
      footer={
        <>
          <Button
            variant='ghost'
            size='sm'
            onClick={onClose}
            data-track-category='Claw Agents'
            data-track-name='CANCEL_ENABLE_DIGITAL_TWIN'
            disabled={enabling}
          >
            Cancel
          </Button>
          <Button
            size='sm'
            onClick={submit}
            data-track-category='Claw Agents'
            data-track-name='ENABLE_DIGITAL_TWIN'
            loading={enabling}
          >
            {ctaLabel}
            {!enabling && <ArrowRight className='size-3.5' />}
          </Button>
        </>
      }
    >
      <div className='flex items-center gap-3.5 rounded-xl border border-border bg-muted/40 p-3.5'>
        <div className='flex size-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary'>
          <Brain className='size-5' />
        </div>
        <p className='text-xs leading-relaxed text-muted-foreground'>
          {mode === 'enable'
            ? 'Your Twin learns from your public Spaces activity — messages you sent, calls you hosted, canvases you authored. Nothing in DMs or private channels is read.'
            : 'Run another pass over your Spaces history. Adds candidate memories to your review queue.'}
        </p>
      </div>

      <DigitalTwinRangeSelector mode={mode} active={open} onRangeChange={setRange} />
    </DigitalTwinModal>
  );
};
