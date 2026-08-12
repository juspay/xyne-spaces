import { ReactElement } from 'react';
import { Button } from '@/components/ui/Button';
import { useDisableDigitalTwin } from '@/hooks/useClawDigitalTwin';
import { DigitalTwinModal } from './DigitalTwinModal';

export const DisableModal = ({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}): ReactElement => {
  const disableMutation = useDisableDigitalTwin();

  const submit = (): void => {
    disableMutation.mutate({ deleteMemories: false }, { onSuccess: () => onClose() });
  };

  return (
    <DigitalTwinModal
      open={open}
      onClose={onClose}
      title='Disable Digital Twin'
      description='Disabling stops the Twin from responding to mentions and pauses nightly learning. Your approved memories, Persona files, and review history remain available.'
      footer={
        <>
          <Button variant='ghost' size='sm' onClick={onClose} disabled={disableMutation.isPending}>
            Cancel
          </Button>
          <Button
            variant='destructive'
            size='sm'
            onClick={submit}
            loading={disableMutation.isPending}
          >
            Disable
          </Button>
        </>
      }
    >
      <p className='rounded-lg border border-border bg-muted/30 p-4 text-sm leading-6 text-muted-foreground'>
        No data is deleted by this action. Use Data controls in Settings if you want to remove
        memories separately.
      </p>
    </DigitalTwinModal>
  );
};
