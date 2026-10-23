import { ReactElement } from 'react';
import { Dialog } from '../../ui/Dialog';
import { useUserGroupById } from '../../../hooks/useUserGroup';
import { useUserGroupDialog } from '../../../store/useUserGroupDialogStore';
import { UserGroupSidePanel } from '../UserGroupSidePanel/UserGroupSidePanel';

export const UserGroupDialog = (): ReactElement => {
  const groupId = useUserGroupDialog(state => state.groupId);
  const isOpen = useUserGroupDialog(state => state.isOpen);
  const close = useUserGroupDialog(state => state.close);
  const userGroup = useUserGroupById(groupId ?? '');

  return (
    <Dialog
      open={isOpen && !!userGroup}
      onOpenChange={close}
      title={userGroup?.name}
      className='flex flex-col max-h-[80vh] overflow-hidden'
    >
      {groupId && <UserGroupSidePanel groupId={groupId} onClose={close} />}
    </Dialog>
  );
};
