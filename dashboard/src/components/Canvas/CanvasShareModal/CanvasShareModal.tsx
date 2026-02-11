import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { CanvasVisibility, CanvasRole } from '@xyne/shared';
import type { Canvas } from '../Canvas.types';
import type { User } from '@xyne/shared';
import { Globe, Crown, Shield, Eye, X, CornerDownRight } from 'lucide-react';
import { useZero } from '../../../hooks/useZero';
import { queries } from '../../../zero/queries';
import { useAuth } from '../../../hooks/useAuth';
import { SearchUser } from '../../ui/SearchUser/SearchUser';
import Avatar from '../../ui/Avatar/Avatar';
import Input from '../../ui/Input';
import { Dialog } from '../../ui/Dialog';
import { Button } from '../../ui/Button';
import * as Select from '@radix-ui/react-select';
import { ChevronDown, Check } from 'lucide-react';
import { mutators } from '../../../zero/mutators';
import { useUsers } from '../../../hooks/useUsers';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { v4 as uuidv4 } from 'uuid';

export interface CanvasShareModalProps {
  canvas: Canvas;
  isOwner: boolean;
  isEditor: boolean;
  channelId?: string;
}

export const CanvasShareModal: React.FC<CanvasShareModalProps> = ({
  canvas,
  isOwner,
  isEditor,
  channelId,
}) => {
  const { user: currentUser } = useAuth();
  const z = useZero();
  const [selectedUsers, setSelectedUsers] = useState<User[]>([]);
  const [isAddingUser, setIsAddingUser] = useState(false);
  const [localVisibility, setLocalVisibility] = useState(canvas.visibility);
  const [confirmationModal, setConfirmationModal] = useState<{
    isOpen: boolean;
    userId: string | null;
  }>({ isOpen: false, userId: null });

  const [participants] = useCachedQuery(queries.canvasParticipants({ canvasId: canvas.id }));
  const participantUserIds = participants ? participants.map(p => p.userId) : [];
  const allUsers = useUsers();
  const usersById = useMemo(() => {
    const map = new Map<string, User>();
    for (const u of allUsers) {
      map.set(u.id, u);
    }
    return map;
  }, [allUsers]);

  const handleVisibilityToggle = (): void => {
    if (!isOwner || !z) return;
    const newVisibility =
      localVisibility === CanvasVisibility.PUBLIC
        ? CanvasVisibility.PRIVATE
        : CanvasVisibility.PUBLIC;
    setLocalVisibility(newVisibility);

    try {
      z.mutate(
        mutators.canvas.update({
          id: canvas.id,
          visibility: newVisibility,
          timestamp: Date.now(),
        }),
      );
    } catch {
      setLocalVisibility(localVisibility);
      toast.error('Error', {
        description: 'Failed to update visibility',
        duration: 2000,
      });
    }
  };

  const handleCopyLink = (): void => {
    const viewLink = canvas.viewAccessId
      ? `${window.location.origin}/chat/canvas/${canvas.viewAccessId}`
      : `${window.location.origin}/chat/canvas/${canvas.id}`;
    void navigator.clipboard.writeText(viewLink);
    toast.success('Link Copied', {
      description: 'The link has been copied to your clipboard.',
      duration: 2000,
    });
  };

  const handleAddParticipants = (role: CanvasRole): void => {
    if (!z || selectedUsers.length === 0) return;

    setIsAddingUser(true);
    try {
      // Generate participant IDs for each user
      const participantIds = selectedUsers.reduce(
        (acc, user) => {
          acc[user.id] = uuidv4();
          return acc;
        },
        {} as Record<string, string>,
      );

      z.mutate(
        mutators.canvas.addParticipants({
          canvasId: canvas.id,
          userIds: selectedUsers.map(u => u.id),
          role,
          timestamp: Date.now(),
          participantIds,
        }),
      );
      setSelectedUsers([]);
      toast.success('Participants Added', {
        description: `${selectedUsers.length} user(s) have been added to the canvas`,
        duration: 2000,
      });
    } catch {
      toast.error('Failed to Add Participants', {
        description: 'Could not add participants. Please try again.',
        duration: 2000,
      });
    } finally {
      setIsAddingUser(false);
    }
  };

  const handleRemoveParticipant = (userId: string): void => {
    if (!z) return;
    setConfirmationModal({ isOpen: true, userId });
  };

  const confirmRemoveParticipant = (): void => {
    if (!z || !confirmationModal.userId) return;

    try {
      z.mutate(
        mutators.canvas.removeParticipant({
          canvasId: canvas.id,
          userId: confirmationModal.userId,
        }),
      );
      toast.success('Participant Removed', {
        description: 'User has been removed from the canvas',
        duration: 2000,
      });
    } catch {
      toast.error('Failed to Remove Participant', {
        description: 'Could not remove participant. Please try again.',
        duration: 2000,
      });
    } finally {
      setConfirmationModal({ isOpen: false, userId: null });
    }
  };

  const handleUpdateRole = (userId: string, newRole: CanvasRole): void => {
    if (!z) return;

    try {
      z.mutate(
        mutators.canvas.updateParticipantRole({
          canvasId: canvas.id,
          userId,
          role: newRole,
          timestamp: Date.now(),
        }),
      );
      toast.success('Role Updated', {
        description: 'Participant role has been updated successfully',
        duration: 2000,
      });
    } catch {
      toast.error('Failed to Update Role', {
        description: 'Could not update participant role. Please try again.',
        duration: 2000,
      });
    }
  };

  const getRoleIcon = (role: CanvasRole): React.ReactNode => {
    switch (role) {
      case CanvasRole.OWNER:
        return <Crown className='w-4 h-4 text-yellow-500' />;
      case CanvasRole.EDITOR:
        return <Shield className='w-4 h-4 text-blue-500' />;
      case CanvasRole.VIEWER:
        return <Eye className='w-4 h-4 text-gray-500' />;
      default:
        return null;
    }
  };

  const getRoleName = (role: CanvasRole): string => {
    switch (role) {
      case CanvasRole.OWNER:
        return 'Owner';
      case CanvasRole.EDITOR:
        return 'Editor';
      case CanvasRole.VIEWER:
        return 'Viewer';
      default:
        return 'Unknown';
    }
  };

  const viewLink = canvas.viewAccessId
    ? `${window.location.origin}/chat/canvas/${canvas.viewAccessId}`
    : `${window.location.origin}/chat/canvas/${canvas.id}`;

  const isPublic = localVisibility === CanvasVisibility.PUBLIC;
  const canManageParticipants = isOwner || isEditor;

  return (
    <>
      <div className='w-full max-w-md p-6' data-testid='canvas-share-modal'>
        {/* Make Visible to Channel Toggle */}
        <div className='flex items-center justify-between py-4'>
          <div className='flex items-center gap-3'>
            <CornerDownRight size={18} className='text-gray-500' />
            <span className='text-sm font-medium'>Make visible to channel</span>
          </div>
          <button
            role='switch'
            aria-checked={isPublic}
            aria-label='Make visible to channel'
            onClick={handleVisibilityToggle}
            disabled={!isOwner}
            className={`relative w-12 h-6 rounded-full transition-all duration-200 ${
              isPublic ? 'bg-green-500' : 'bg-gray-300'
            } ${!isOwner ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
            data-testid='canvas-visibility-toggle'
          >
            <span
              aria-hidden='true'
              className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all duration-200 ${
                isPublic ? 'left-7' : 'left-1'
              }`}
            />
          </button>
        </div>

        <div className='border-t border-gray-300 my-4' />

        {/* Anyone with this link */}
        <div className='py-4 space-y-3'>
          <div className='flex items-center gap-3'>
            <Globe size={18} className='text-gray-500' />
            <span className='text-sm'>Anyone with this link can view</span>
          </div>

          {/* Shareable Link */}
          <div className='flex items-center gap-2'>
            <Input
              id='view-link-input'
              type='text'
              readOnly
              value={viewLink || 'Not available'}
              className='flex-1 text-sm bg-gray-50 visual-regression-hide'
              disabled={!viewLink}
            />
            <button
              onClick={handleCopyLink}
              className='px-3 py-2 text-sm text-gray-500 hover:text-gray-700 font-medium border border-gray-300 rounded-md bg-white hover:bg-gray-50'
              data-testid='canvas-copy-link-button'
            >
              Copy
            </button>
          </div>
        </div>

        <div className='border-t border-gray-300 my-4' />

        <div className='pt-4'></div>

        {/* Invite (Owner only) */}
        {canManageParticipants && (
          <div className='mb-4'>
            <SearchUser
              excludeUserIds={participantUserIds}
              selectedUsers={selectedUsers}
              onUsersChange={setSelectedUsers}
              placeholder='Search users to add...'
              label=''
              hintText=''
              {...(channelId && { channelId })}
              data-testid='canvas-user-search-input'
            />

            {/* Role Selection Buttons */}
            {selectedUsers.length > 0 && (
              <div className='mt-2 flex items-center flex-wrap gap-2'>
                <span className='text-sm text-gray-500'>Add as:</span>
                <Button
                  onClick={() => void handleAddParticipants(CanvasRole.VIEWER)}
                  disabled={isAddingUser}
                  size='sm'
                  variant='secondary'
                >
                  <Eye className='w-3 h-3' />
                  Viewer
                </Button>
                <Button
                  onClick={() => void handleAddParticipants(CanvasRole.EDITOR)}
                  disabled={isAddingUser}
                  size='sm'
                  variant='secondary'
                >
                  <Shield className='w-3 h-3' />
                  Editor
                </Button>
                {isOwner && ( // Only show Owner button to actual owners
                  <Button
                    onClick={() => void handleAddParticipants(CanvasRole.OWNER)}
                    disabled={isAddingUser}
                    size='sm'
                    variant='secondary'
                  >
                    <Crown className='w-3 h-3' />
                    Owner
                  </Button>
                )}
              </div>
            )}
          </div>
        )}

        {/* People with Access */}
        <div className='mb-2'>
          <span className='text-xs text-gray-400 uppercase tracking-wider'>People with access</span>
        </div>

        <div className='max-h-60 overflow-y-auto space-y-1'>
          {participants?.map(participant => (
            <div
              key={participant.userId}
              className='flex items-center justify-between py-2 px-2 hover:bg-gray-50 rounded-lg'
            >
              <div className='flex items-center gap-3 flex-1 min-w-0'>
                <Avatar userId={participant.userId} size='md' />
                <div className='flex-1 min-w-0'>
                  <p className='text-sm font-medium text-gray-900 truncate'>
                    {usersById.get(participant.userId)?.name || 'Unknown User'}
                    {participant.userId === currentUser?.id && (
                      <span className='ml-2 text-xs text-gray-500'>(You)</span>
                    )}
                  </p>
                  <p className='text-xs text-gray-500 truncate'>
                    {usersById.get(participant.userId)?.email || ''}
                  </p>
                </div>
              </div>

              <div className='flex items-center gap-2 ml-2'>
                {/* Role Display / Dropdown */}
                {canManageParticipants &&
                participant.userId !== currentUser?.id &&
                participant.userId !== canvas.createdBy ? (
                  <Select.Root
                    value={participant.role}
                    onValueChange={value =>
                      void handleUpdateRole(participant.userId, value as CanvasRole)
                    }
                  >
                    <Select.Trigger className='w-[100px] h-8 text-xs flex items-center justify-between px-2 border border-gray-300 rounded bg-white'>
                      <Select.Value />
                      <Select.Icon>
                        <ChevronDown className='size-3 opacity-50' />
                      </Select.Icon>
                    </Select.Trigger>
                    <Select.Portal>
                      <Select.Content className='bg-white rounded border border-gray-200 shadow-md z-[60] overflow-hidden'>
                        <Select.Viewport className='p-1'>
                          {[
                            CanvasRole.VIEWER,
                            CanvasRole.EDITOR,
                            ...(isOwner ? [CanvasRole.OWNER] : []),
                          ].map(role => (
                            <Select.Item
                              key={role}
                              value={role}
                              className='relative flex items-center px-6 py-1.5 text-xs rounded-sm cursor-pointer hover:bg-gray-100 outline-none select-none data-[highlighted]:bg-gray-100'
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
                  <div className='flex items-center gap-1 text-sm text-gray-600'>
                    {getRoleIcon(participant.role)}
                    <span>{getRoleName(participant.role)}</span>
                    {participant.userId === canvas.createdBy && (
                      <span className='text-xs text-gray-400'>(Creator)</span>
                    )}
                  </div>
                )}

                {/* Remove Button */}
                {canManageParticipants &&
                  participant.userId !== currentUser?.id &&
                  participant.userId !== canvas.createdBy && (
                    <button
                      onClick={() => void handleRemoveParticipant(participant.userId)}
                      className='p-1 hover:bg-red-100 rounded text-red-600'
                      title='Remove participant'
                    >
                      <X className='w-4 h-4' />
                    </button>
                  )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Confirmation Modal for Removal */}
      {confirmationModal.isOpen && (
        <Dialog
          open={confirmationModal.isOpen}
          onOpenChange={open => !open && setConfirmationModal({ isOpen: false, userId: null })}
          title='Remove Participant'
        >
          <div className='p-6'>
            <p className='text-gray-600 mb-6'>
              Are you sure you want to remove this participant from the canvas?
            </p>
            <div className='flex justify-end gap-3'>
              <Button
                variant='secondary'
                onClick={() => setConfirmationModal({ isOpen: false, userId: null })}
              >
                Cancel
              </Button>
              <Button variant='default' onClick={() => void confirmRemoveParticipant()}>
                Remove
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </>
  );
};
