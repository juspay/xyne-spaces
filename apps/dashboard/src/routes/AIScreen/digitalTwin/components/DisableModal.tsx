import { ReactElement, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox/Checkbox';
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
      <div className='rounded-lg border border-border p-2.5'>
        <Checkbox
          checked={deleteMemories}
          onChange={setDeleteMemories}
          size='sm'
          label='Also delete all my memories and candidates — this cannot be undone'
        />
      </div>
    </DigitalTwinModal>
  );
};
