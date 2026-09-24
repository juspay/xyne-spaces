import { useMemo, useState, type ReactElement } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { UserType, type User } from '@xyne/shared';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox/Checkbox';
import { SearchUserV2 } from '@/components/ui/SearchUser/SearchUserV2';
import { useActiveUsers } from '@/hooks/useUsers';
import {
  callAdminErrorText,
  changeAdminCallOwner,
  type CallAdminCallRow,
} from '@/services/Call/callAdminService';
import { CALLS_ADMIN_TRACK, userLabel } from './CallsAdminScreen.utils';
import { callsAdminPrefix } from './callsAdminQueryKeys';

/**
 * Pick a new owner for a call. Mount it with `key={call?.externalId}` so each call
 * opens with a fresh selection.
 */
export function ChangeOwnerDialog({
  call,
  onClose,
}: {
  call: CallAdminCallRow | null;
  onClose: () => void;
}): ReactElement {
  const queryClient = useQueryClient();
  const users = useActiveUsers();
  const [newOwner, setNewOwner] = useState<User | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [applyToSeries, setApplyToSeries] = useState(false);

  // The backend only accepts active human members of the workspace.
  const candidates = useMemo(
    () => users.filter(user => user.userType === UserType.USER && user.id !== call?.owner.id),
    [users, call?.owner.id],
  );

  const changeOwner = useMutation({
    mutationFn: (target: { externalId: string; newOwnerUserId: string }) =>
      changeAdminCallOwner(target.externalId, {
        newOwnerUserId: target.newOwnerUserId,
        applyToSeries,
      }),
    onSuccess: result => {
      toast.success(
        result.transferredCallIds.length > 1
          ? `Owner changed on ${result.transferredCallIds.length} calls`
          : 'Owner changed',
      );
      if (result.warning) toast.warning(result.warning);
      void queryClient.invalidateQueries({ queryKey: callsAdminPrefix });
      onClose();
    },
    onError: error => toast.error(callAdminErrorText(error, 'Could not change the owner')),
  });

  return (
    <Dialog
      open={call !== null}
      onOpenChange={open => {
        if (!open) onClose();
      }}
      title='Change owner'
      description='Move this call to another member of the workspace'
    >
      <div className='flex flex-col gap-4 p-6'>
        <div className='flex flex-col gap-1.5'>
          <h2 className='text-base font-semibold text-foreground'>Change owner</h2>
          {call && (
            <p className='text-sm text-muted-foreground'>
              {call.title || 'Untitled call'} is owned by {userLabel(call.owner)}. The new owner
              gets full control; the current owner keeps access to view it.
            </p>
          )}
        </div>

        <div className='rounded border border-input'>
          <SearchUserV2
            options={candidates}
            selectedUsers={newOwner ? [newOwner] : []}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            // Single choice: the picker appends, so keep only the latest pick.
            onSelect={selected => setNewOwner(selected[selected.length - 1] ?? null)}
            isOpen={isPickerOpen}
            setIsOpen={setIsPickerOpen}
          />
        </div>

        {call?.recurringSeriesId && (
          <Checkbox
            checked={applyToSeries}
            onChange={setApplyToSeries}
            label='Apply to the whole series (organizer and every upcoming instance)'
            size='sm'
            data-track-category={CALLS_ADMIN_TRACK}
            data-track-name='Change owner: apply to series'
          />
        )}

        <div className='flex justify-end gap-2'>
          <Button
            type='button'
            variant='outline'
            size='sm'
            onClick={onClose}
            disabled={changeOwner.isPending}
            data-track-category={CALLS_ADMIN_TRACK}
            data-track-name='Change owner: cancel'
          >
            Cancel
          </Button>
          <Button
            type='button'
            size='sm'
            disabled={!newOwner}
            loading={changeOwner.isPending}
            onClick={() => {
              if (call && newOwner) {
                changeOwner.mutate({ externalId: call.externalId, newOwnerUserId: newOwner.id });
              }
            }}
            data-track-category={CALLS_ADMIN_TRACK}
            data-track-name='Change owner: confirm'
          >
            Change owner
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
