import { ReactElement, useState } from 'react';
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
  const [deleteMemories, setDeleteMemories] = useState(false);
  const disableMutation = useDisableDigitalTwin();

  const submit = (): void => {
    disableMutation.mutate({ deleteMemories }, { onSuccess: () => onClose() });
  };

  return (
    <DigitalTwinModal
      open={open}
      onClose={onClose}
      title='Disable Digital Twin'
      description='Disabling stops the Twin from responding to mentions and pauses the nightly curator. Your approved memories and candidates remain unless you choose to delete them.'
      footer={
        <>
          <Button
            variant='ghost'
            size='sm'
            onClick={onClose}
            data-track-category='Claw Agents'
            data-track-name='CANCEL_DISABLE_DIGITAL_TWIN'
            disabled={disableMutation.isPending}
          >
            Cancel
          </Button>
          <Button
            variant='destructive'
            size='sm'
            onClick={submit}
            data-track-category='Claw Agents'
            data-track-name='DISABLE_DIGITAL_TWIN'
            loading={disableMutation.isPending}
          >
            Disable
          </Button>
        </>
      }
    >
      <label className='flex cursor-pointer items-center gap-2 rounded-lg border border-border p-2.5'>
        <input
          type='checkbox'
          checked={deleteMemories}
          onChange={e => setDeleteMemories(e.target.checked)}
          data-track-category='Claw Agents'
          data-track-name='Digital Twin disable delete-all toggle'
          className='accent-destructive'
        />
        <span className='text-xs text-foreground'>
          Also delete all my memories and candidates — this cannot be undone
        </span>
      </label>
    </DigitalTwinModal>
  );
};
