import { ReactElement, useState } from 'react';
import { ArrowRight, Brain } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { useEnableDigitalTwin } from '@/hooks/useClawDigitalTwin';
import { V2Dialog } from '@/routes/AIScreen/library/shared/primitives/V2Dialog';
import { DigitalTwinRangeSelector, type DigitalTwinRange } from './DigitalTwinRangeSelector';

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

  const blurb =
    mode === 'enable'
      ? 'Your Twin learns from your public Spaces activity — messages you sent, calls you hosted, canvases you authored. Nothing in DMs or private channels is read.'
      : 'Run another pass over your Spaces history. Adds candidate memories to your review queue.';

  return (
    <V2Dialog
      open={open}
      onOpenChange={next => {
        if (!next) onClose();
      }}
      title={mode === 'enable' ? 'Enable Digital Twin' : 'Backfill history'}
      description={blurb}
      testId='digital-twin-enable-dialog'
      footer={
        <>
          <Button
            variant='ghost'
            size='sm'
            onClick={onClose}
            disabled={enabling}
            data-track-category='Claw Agents'
            data-track-name={`Digital Twin: cancel ${mode}`}
          >
            Cancel
          </Button>
          <Button
            size='sm'
            onClick={submit}
            loading={enabling}
            data-track-category='Claw Agents'
            data-track-name={`Digital Twin: confirm ${mode}`}
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
        <p className='text-xs leading-relaxed text-muted-foreground'>{blurb}</p>
      </div>

      <DigitalTwinRangeSelector mode={mode} active={open} onRangeChange={setRange} />
    </V2Dialog>
  );
};
