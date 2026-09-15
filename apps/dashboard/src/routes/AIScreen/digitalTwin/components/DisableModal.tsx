import { ReactElement, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox/Checkbox';
import { useDisableDigitalTwin } from '@/hooks/useClawDigitalTwin';
import { V2Dialog } from '@/routes/AIScreen/library/shared/primitives/V2Dialog';

const DESCRIPTION =
  'Disabling stops the Twin from responding to mentions and pauses the nightly curator. Your approved memories and candidates remain unless you choose to delete them.';

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
    <V2Dialog
      open={open}
      onOpenChange={next => {
        if (!next) onClose();
      }}
      title='Disable Digital Twin'
      description={DESCRIPTION}
      testId='digital-twin-disable-dialog'
      footer={
        <>
          <Button
            variant='ghost'
            size='sm'
            onClick={onClose}
            disabled={disableMutation.isPending}
            data-track-category='Claw Agents'
            data-track-name='Digital Twin: cancel disable'
          >
            Cancel
          </Button>
          <Button
            variant='destructive'
            size='sm'
            onClick={submit}
            loading={disableMutation.isPending}
            data-track-category='Claw Agents'
            data-track-name='Digital Twin: confirm disable'
          >
            Disable
          </Button>
        </>
      }
    >
      <p className='text-sm font-normal leading-5 text-muted-foreground'>{DESCRIPTION}</p>

      <div className='rounded-lg border border-border p-2.5'>
        <Checkbox
          checked={deleteMemories}
          onChange={setDeleteMemories}
          size='sm'
          label='Also delete all my memories and candidates — this cannot be undone'
        />
      </div>
    </V2Dialog>
  );
};
