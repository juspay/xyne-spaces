import { ReactElement, useEffect, useState } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

interface CloneAgentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sourceName: string;
  /** Viewer lacks edit rights → cloning raises an approval request instead. */
  needsApproval: boolean;
  submitting: boolean;
  onConfirm: (name: string) => void;
}

/** Names and confirms an agent clone (or clone request). */
export const CloneAgentDialog = ({
  open,
  onOpenChange,
  sourceName,
  needsApproval,
  submitting,
  onConfirm,
}: CloneAgentDialogProps): ReactElement => {
  const [name, setName] = useState('');

  // Reset the suggested name each time the dialog opens.
  useEffect(() => {
    if (open) setName(`${sourceName} copy`);
  }, [open, sourceName]);

  const trimmed = name.trim();
  const canSubmit = trimmed.length > 0 && !submitting;

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={`Clone ${sourceName}`}>
      <form
        className='flex flex-col gap-4 p-6'
        onSubmit={e => {
          e.preventDefault();
          if (canSubmit) onConfirm(trimmed);
        }}
      >
        <div className='flex flex-col gap-1.5'>
          <h2 className='text-base font-semibold text-foreground'>Clone agent</h2>
          <p className='text-sm text-muted-foreground'>
            {needsApproval
              ? `You don't have edit access, so this sends a clone request to ${sourceName}'s owner.`
              : 'Creates your own copy of this agent that you can customise.'}
          </p>
        </div>

        <div className='flex flex-col gap-1.5'>
          <label htmlFor='clone-agent-name' className='text-sm font-medium text-foreground'>
            Name
          </label>
          <Input
            id='clone-agent-name'
            autoFocus
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder='New agent name'
          />
        </div>

        <div className='flex justify-end gap-2'>
          <Button
            type='button'
            variant='outline'
            size='sm'
            onClick={() => onOpenChange(false)}
            data-track-category='Claw Agents'
            data-track-name='CANCEL_CLONE_AGENT'
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button type='submit' size='sm' loading={submitting} disabled={!canSubmit}>
            {needsApproval ? 'Request clone' : 'Clone agent'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
};
