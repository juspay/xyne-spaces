import { ReactElement, useEffect, useState } from 'react';
import type { User } from '@xyne/shared';
import { Dialog } from '../../../ui/Dialog/Dialog';
import { Button } from '../../../ui/Button/Button';
import { Checkbox } from '../../../ui/Checkbox/Checkbox';
import { getUserDisplayName } from '../../../../utils/userDisplayName';

interface RemoveMemberDialogProps {
  /** Member being removed. `null` keeps the dialog closed. */
  user: User | null;
  /** Group's `reassignOnUnavailable` setting — gates the handoff opt-in. */
  canReassignTickets: boolean;
  isRemoving: boolean;
  onCancel: () => void;
  onConfirm: (reassignTickets: boolean) => void;
  userGroupId: string | undefined;
}

export const RemoveMemberDialog = ({
  user,
  canReassignTickets,
  isRemoving,
  onCancel,
  onConfirm,
  userGroupId,
}: RemoveMemberDialogProps): ReactElement => {
  const [reassignTickets, setReassignTickets] = useState(false);

  // Every removal starts from the safe default: open tickets stay with the member.
  useEffect(() => {
    if (user) setReassignTickets(false);
  }, [user]);

  return (
    // Opened from inside the "Edit User Group" dialog, so it needs to sit above it and
    // stay a centered modal on mobile rather than nesting a drawer inside a drawer.
    <Dialog
      open={user !== null}
      onOpenChange={open => {
        if (!open && !isRemoving) onCancel();
      }}
      title='Remove member from group?'
      zIndexClassName='z-[60]'
      className='max-w-md rounded-xl border border-border'
      mobileVariant='dialog'
      testId='remove-member-confirm'
    >
      <div className='p-6'>
        <h2 className='mb-1.5 text-[15px] font-semibold text-foreground'>
          Remove member from group?
        </h2>
        <p className='text-[13px] leading-[1.5] text-muted-foreground'>
          {user ? getUserDisplayName(user) : 'This member'} will stop receiving new tickets from
          this group.
        </p>

        {canReassignTickets ? (
          <div className='mt-4 space-y-1 rounded-lg border border-border bg-muted/30 p-3'>
            <Checkbox
              checked={reassignTickets}
              onChange={setReassignTickets}
              label='Reassign their existing open tickets'
            />
            <p className='pl-[26px] text-xs leading-[1.4] text-muted-foreground'>
              If unchecked, their open tickets stay assigned to them even after they leave the
              group. If no eligible replacement exists, the tickets stay with them either way.
            </p>
          </div>
        ) : (
          <p className='mt-4 text-[13px] leading-[1.5] text-muted-foreground'>
            Their open tickets stay assigned to them. Turn on existing-ticket reassignment in
            Assignment Configuration to hand tickets off on removal.
          </p>
        )}

        <div className='mt-6 flex justify-end gap-3'>
          <Button
            type='button'
            variant='secondary'
            onClick={onCancel}
            disabled={isRemoving}
            data-track-category='UserGroups'
            data-track-name='CancelRemoveUserFromGroup'
          >
            Cancel
          </Button>
          <Button
            type='button'
            variant='destructive'
            loading={isRemoving}
            onClick={() => onConfirm(reassignTickets)}
            data-track-category='UserGroups'
            data-track-name='ConfirmRemoveUserFromGroup'
            data-track-metadata={JSON.stringify({ userGroupId, reassignTickets })}
          >
            Remove
          </Button>
        </div>
      </div>
    </Dialog>
  );
};
