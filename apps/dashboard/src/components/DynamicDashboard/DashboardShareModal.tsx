import { useMemo, useState, type ReactElement } from 'react';
import { toast } from 'sonner';
import { DashboardRole, DashboardVisibility } from '@xyne/shared';
import type { User } from '@xyne/shared';
import * as Select from '@radix-ui/react-select';
import { Crown, Shield, Eye, X, ChevronDown, Check, Globe } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { useUsers } from '../../hooks/useUsers';
import {
  useDashboardParticipants,
  useParticipantMutations,
  useUpdateDashboard,
} from '../../hooks/useDashboards';
import { getApiErrorMessage } from '../../utils/apiError';
import { SearchUser } from '../ui/SearchUser/SearchUser';
import Avatar from '../ui/Avatar/Avatar';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { usePlatform } from '../../hooks/usePlatform';

interface DashboardSummary {
  id: string;
  createdBy: string;
  visibility: DashboardVisibility;
}

export interface DashboardShareModalProps {
  dashboard: DashboardSummary;
  isOwner: boolean;
  isEditor: boolean;
  preloadedParticipants?:
    | ReadonlyArray<{
        readonly userId: string;
        readonly role: DashboardRole;
      }>
    | undefined;
}

export const DashboardShareModal = ({
  dashboard,
  isOwner,
  isEditor,
  preloadedParticipants,
}: DashboardShareModalProps): ReactElement => {
  const { user: currentUser } = useAuth();
  const { isMobile } = usePlatform();
  const [selectedUsers, setSelectedUsers] = useState<User[]>([]);
  const [isAddingUser, setIsAddingUser] = useState(false);
  const [localVisibility, setLocalVisibility] = useState(dashboard.visibility);
  const [confirmationModal, setConfirmationModal] = useState<{
    isOpen: boolean;
    userId: string | null;
  }>({ isOpen: false, userId: null });

  const fetchParticipants = Boolean(dashboard.id) && !preloadedParticipants;

  const { data: fetchedParticipants } = useDashboardParticipants(dashboard.id, {
    enabled: fetchParticipants,
  });

  const participants = preloadedParticipants ?? fetchedParticipants ?? [];
  const participantUserIds = participants.map(p => p.userId);
  const allUsers = useUsers();
  const usersById = useMemo(() => {
    const map = new Map<string, User>();
    for (const u of allUsers) {
      map.set(u.id, u);
    }
    return map;
  }, [allUsers]);

  const canManageParticipants = isOwner || isEditor;
  const isPublic = localVisibility === DashboardVisibility.PUBLIC;

  const visibilityMutation = useUpdateDashboard(dashboard.id);
  const participantMutations = useParticipantMutations(dashboard.id);

  const handleVisibilityToggle = async (): Promise<void> => {
    if (!isOwner) return;
    const prev = localVisibility;
    const next =
      prev === DashboardVisibility.PUBLIC
        ? DashboardVisibility.PRIVATE
        : DashboardVisibility.PUBLIC;
    setLocalVisibility(next);
    try {
      await visibilityMutation.mutateAsync({ visibility: next });
    } catch (err) {
      setLocalVisibility(prev);
      toast.error('Failed to update visibility', {
        description: getApiErrorMessage(err),
      });
    }
  };

  const handleAddParticipants = async (role: DashboardRole): Promise<void> => {
    if (selectedUsers.length === 0) return;
    const count = selectedUsers.length;
    setIsAddingUser(true);
    try {
      await participantMutations.add.mutateAsync(selectedUsers.map(u => ({ userId: u.id, role })));
      setSelectedUsers([]);
      toast.success(`${count} participant(s) added`);
    } catch (err) {
      toast.error('Failed to add participants', {
        description: getApiErrorMessage(err),
      });
    } finally {
      setIsAddingUser(false);
    }
  };

  const handleRemoveParticipant = (userId: string): void => {
    setConfirmationModal({ isOpen: true, userId });
  };

  const confirmRemoveParticipant = async (): Promise<void> => {
    if (!confirmationModal.userId) return;
    const targetUserId = confirmationModal.userId;
    try {
      await participantMutations.remove.mutateAsync(targetUserId);
      toast.success('Participant removed');
    } catch (err) {
      toast.error('Failed to remove participant', {
        description: getApiErrorMessage(err),
      });
    } finally {
      setConfirmationModal({ isOpen: false, userId: null });
    }
  };

  const handleUpdateRole = async (userId: string, role: DashboardRole): Promise<void> => {
    try {
      await participantMutations.updateRole.mutateAsync({ userId, role });
      toast.success('Role updated');
    } catch (err) {
      toast.error('Failed to update role', {
        description: getApiErrorMessage(err),
      });
    }
  };

  const getRoleIcon = (role: DashboardRole): React.ReactNode => {
    switch (role) {
      case DashboardRole.OWNER:
        return <Crown className='w-4 h-4 text-yellow-500' />;
      case DashboardRole.EDITOR:
        return <Shield className='w-4 h-4 text-blue-500' />;
      case DashboardRole.VIEWER:
        return <Eye className='w-4 h-4 text-muted-foreground' />;
      default:
        return null;
    }
  };

  const getRoleName = (role: DashboardRole): string => {
    switch (role) {
      case DashboardRole.OWNER:
        return 'Owner';
      case DashboardRole.EDITOR:
        return 'Editor';
      case DashboardRole.VIEWER:
        return 'Viewer';
      default:
        return 'Unknown';
    }
  };

  return (
    <>
      <div className='w-full max-w-md p-6'>
        <div className='flex items-center justify-between py-4'>
          <div className='flex items-center gap-3'>
            <Globe size={18} className='text-muted-foreground' />
            <span className='text-sm font-medium text-foreground'>Make visible to workspace</span>
          </div>
          <button
            role='switch'
            aria-checked={isPublic}
            aria-label='Make visible to workspace'
            onClick={() => {
              void handleVisibilityToggle();
            }}
            disabled={!isOwner}
            className={`relative w-12 h-6 rounded-full transition-all duration-200 ${
              isPublic ? 'bg-green-500' : 'bg-muted'
            } ${!isOwner ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
            data-track-category='DYNAMIC_DASHBOARD'
            data-track-name='Toggle_Visibility'
          >
            <span
              aria-hidden='true'
              className={`absolute top-1 w-4 h-4 bg-background rounded-full shadow transition-all duration-200 ${
                isPublic ? 'left-7' : 'left-1'
              }`}
            />
          </button>
        </div>

        <div className='border-t border-border my-4' />

        {canManageParticipants && (
          <div className='mb-4'>
            <SearchUser
              excludeUserIds={participantUserIds}
              selectedUsers={selectedUsers}
              onUsersChange={setSelectedUsers}
              placeholder='Search users to add...'
              label=''
              hintText=''
              autoFocus={!isMobile}
            />

            {selectedUsers.length > 0 && (
              <div className='mt-2 flex items-center flex-wrap gap-2'>
                <span className='text-sm text-muted-foreground'>Add as:</span>
                <Button
                  onClick={() => {
                    void handleAddParticipants(DashboardRole.VIEWER);
                  }}
                  disabled={isAddingUser}
                  size='sm'
                  variant='secondary'
                  data-track-category='DYNAMIC_DASHBOARD'
                  data-track-name='Add_Participant_Viewer'
                >
                  <Eye className='w-3 h-3' />
                  Viewer
                </Button>
                <Button
                  onClick={() => {
                    void handleAddParticipants(DashboardRole.EDITOR);
                  }}
                  disabled={isAddingUser}
                  size='sm'
                  variant='secondary'
                  data-track-category='DYNAMIC_DASHBOARD'
                  data-track-name='Add_Participant_Editor'
                >
                  <Shield className='w-3 h-3' />
                  Editor
                </Button>
                {isOwner && (
                  <Button
                    onClick={() => {
                      void handleAddParticipants(DashboardRole.OWNER);
                    }}
                    disabled={isAddingUser}
                    size='sm'
                    variant='secondary'
                    data-track-category='DYNAMIC_DASHBOARD'
                    data-track-name='Add_Participant_Owner'
                  >
                    <Crown className='w-3 h-3' />
                    Owner
                  </Button>
                )}
              </div>
            )}
          </div>
        )}

        <div className='mb-2'>
          <span className='text-xs text-muted-foreground uppercase tracking-wider'>
            People with access
          </span>
        </div>

        <div className='max-h-60 overflow-y-auto space-y-1'>
          {participants?.map(participant => {
            const isCreator = participant.userId === dashboard.createdBy;
            const isSelf = participant.userId === currentUser?.id;
            const canEditThisRole = canManageParticipants && !isCreator && !isSelf;
            return (
              <div
                key={participant.userId}
                className='flex items-center justify-between py-2 px-2 hover:bg-accent rounded-lg'
              >
                <div className='flex items-center gap-3 flex-1 min-w-0'>
                  <Avatar userId={participant.userId} size='md' />
                  <div className='flex-1 min-w-0'>
                    <p className='text-sm font-medium text-foreground truncate'>
                      {usersById.get(participant.userId)?.name || 'Unknown User'}
                      {isSelf && <span className='ml-2 text-xs text-muted-foreground'>(You)</span>}
                    </p>
                    <p className='text-xs text-muted-foreground truncate'>
                      {usersById.get(participant.userId)?.email || ''}
                    </p>
                  </div>
                </div>

                <div className='flex items-center gap-2 ml-2'>
                  {canEditThisRole ? (
                    <Select.Root
                      value={participant.role}
                      onValueChange={value => {
                        void handleUpdateRole(participant.userId, value as DashboardRole);
                      }}
                    >
                      <Select.Trigger
                        className='w-[100px] h-8 text-xs flex items-center justify-between px-2 border border-border rounded bg-background'
                        data-track-category='DYNAMIC_DASHBOARD'
                        data-track-name='Open_Role_Select'
                      >
                        <Select.Value />
                        <Select.Icon>
                          <ChevronDown className='size-3 opacity-50' />
                        </Select.Icon>
                      </Select.Trigger>
                      <Select.Portal>
                        <Select.Content className='bg-background rounded border border-border shadow-md z-[60] overflow-hidden'>
                          <Select.Viewport className='p-1'>
                            {[
                              DashboardRole.VIEWER,
                              DashboardRole.EDITOR,
                              ...(isOwner ? [DashboardRole.OWNER] : []),
                            ].map(role => (
                              <Select.Item
                                key={role}
                                value={role}
                                className='relative flex items-center px-6 py-1.5 text-xs rounded-sm cursor-pointer hover:bg-accent outline-none select-none data-[highlighted]:bg-accent'
                              >
                                <Select.ItemText>{getRoleName(role)}</Select.ItemText>
                                <Select.ItemIndicator className='absolute left-1.5'>
                                  <Check className='size-3' />
                                </Select.ItemIndicator>
                              </Select.Item>
                            ))}
                          </Select.Viewport>
                        </Select.Content>
                      </Select.Portal>
                    </Select.Root>
                  ) : (
                    <div className='flex items-center gap-1 text-sm text-muted-foreground'>
                      {getRoleIcon(participant.role)}
                      <span>{getRoleName(participant.role)}</span>
                      {isCreator && (
                        <span className='text-xs text-muted-foreground'>(Creator)</span>
                      )}
                    </div>
                  )}

                  {canEditThisRole && (
                    <button
                      onClick={() => handleRemoveParticipant(participant.userId)}
                      className='p-1 hover:bg-red-100 rounded text-red-600'
                      title='Remove participant'
                      data-track-category='DYNAMIC_DASHBOARD'
                      data-track-name='Remove_Participant'
                    >
                      <X className='w-4 h-4' />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {confirmationModal.isOpen && (
        <Dialog
          open={confirmationModal.isOpen}
          onOpenChange={open => !open && setConfirmationModal({ isOpen: false, userId: null })}
          title='Remove Participant'
        >
          <div className='p-6'>
            <p className='text-muted-foreground mb-6'>
              Are you sure you want to remove this participant from the dashboard?
            </p>
            <div className='flex justify-end gap-3'>
              <Button
                variant='secondary'
                onClick={() => setConfirmationModal({ isOpen: false, userId: null })}
                data-track-category='DYNAMIC_DASHBOARD'
                data-track-name='Cancel_Remove_Participant'
              >
                Cancel
              </Button>
              <Button
                variant='destructive'
                onClick={() => {
                  void confirmRemoveParticipant();
                }}
                data-track-category='DYNAMIC_DASHBOARD'
                data-track-name='Confirm_Remove_Participant'
              >
                Remove
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </>
  );
};
