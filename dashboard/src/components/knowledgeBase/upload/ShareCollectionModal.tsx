import { ReactElement, useState, useCallback, useMemo } from 'react';
import { toast } from 'sonner';
import { Share2, X } from 'lucide-react';
import Dialog from '../../ui/Dialog';
import { Button } from '../../ui/Button/Button';
import { SearchUser } from '../../ui/SearchUser/SearchUser';
import { User } from '@xyne/shared';
import { useAuth } from '../../../hooks/useAuth';
import { getProjectMemberIds, CollectionRole } from '../../../services/Knowledge/collectionService';
import { CollectionRole as CollectionRoleEnum } from '@xyne/shared';
import { useCollectionTree } from '../context/CollectionTreeContext';
import { useQuery } from '@tanstack/react-query';
import { useZero } from '../../../hooks/useZero';
import { mutators } from '../../../zero/mutators';
import { useProjectCollections } from '../context/ProjectCollectionsContext';

interface ShareCollectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  collectionId: string;
  collectionName: string;
  /** Project the collection belongs to; only project members are shown as share targets */
  projectId: string | null;
}

export const ShareCollectionModal = ({
  isOpen,
  onClose,
  collectionId,
  collectionName,
  projectId,
}: ShareCollectionModalProps): ReactElement => {
  const { user } = useAuth();
  const zero = useZero();
  const { collectionRole, collectionCanShare } = useCollectionTree();
  const { activeCollection } = useProjectCollections();
  const [selectedUsers, setSelectedUsers] = useState<User[]>([]);
  const [userPermissions, setUserPermissions] = useState<Record<string, CollectionRole>>({});
  const [userCanShare, setUserCanShare] = useState<Record<string, boolean>>({});
  const [isLoading, setIsLoading] = useState(false);

  // Only project members can be shared with; fetch their IDs when projectId is set
  const { data: projectMemberIds = [] } = useQuery({
    queryKey: ['project-members', projectId],
    queryFn: () => (projectId ? getProjectMemberIds(projectId) : Promise.resolve([])),
    enabled: isOpen && !!projectId,
  });
  const allowedUserIds = useMemo(
    () => (projectId ? new Set(projectMemberIds) : null),
    [projectId, projectMemberIds],
  );

  // Determine what roles and permissions the current user can assign
  const allowedRoles = useMemo(() => {
    if (!collectionRole) return [];

    // OWNER can assign all roles
    if (collectionRole === 'OWNER') {
      return ['VIEWER', 'EDITOR'] as CollectionRole[];
    }

    // EDITOR can assign VIEWER and EDITOR
    if (collectionRole === 'EDITOR') {
      return ['VIEWER', 'EDITOR'] as CollectionRole[];
    }

    // VIEWER can only assign VIEWER
    if (collectionRole === 'VIEWER') {
      return ['VIEWER'] as CollectionRole[];
    }

    return [];
  }, [collectionRole]);

  // Whether the current user can grant canShare permission
  const canGrantCanShare = useMemo(() => {
    return collectionCanShare === true;
  }, [collectionCanShare]);

  const handleClose = useCallback(() => {
    if (!isLoading) {
      setSelectedUsers([]);
      setUserPermissions({});
      setUserCanShare({});
      onClose();
    }
  }, [isLoading, onClose]);

  // Update permissions when users are added/removed
  const handleUsersChange = useCallback(
    (users: User[]) => {
      setSelectedUsers(users);
      // Set default permission (viewer) for new users
      const newPermissions: Record<string, CollectionRole> = { ...userPermissions };
      const newCanShare: Record<string, boolean> = { ...userCanShare };
      users.forEach(user => {
        if (
          !newPermissions[user.id] ||
          !allowedRoles.includes(newPermissions[user.id] as CollectionRole)
        ) {
          newPermissions[user.id] = 'VIEWER';
        }
        if (!newCanShare[user.id] || !canGrantCanShare) {
          newCanShare[user.id] = false;
        }
      });
      // Remove permissions for users that are no longer selected
      Object.keys(newPermissions).forEach(userId => {
        if (!users.some(u => u.id === userId)) {
          delete newPermissions[userId];
          delete newCanShare[userId];
        }
      });
      setUserPermissions(newPermissions);
      setUserCanShare(newCanShare);
    },
    [userPermissions, userCanShare, allowedRoles, canGrantCanShare],
  );

  const handlePermissionChange = useCallback(
    (userId: string, permission: CollectionRole) => {
      // Only allow setting permissions that are in allowedRoles
      if (!allowedRoles.includes(permission)) {
        return;
      }
      setUserPermissions(prev => ({
        ...prev,
        [userId]: permission,
      }));
    },
    [allowedRoles],
  );

  const handleCanShareChange = useCallback(
    (userId: string, canShare: boolean) => {
      // Only allow setting canShare if the current user can grant it
      if (!canGrantCanShare) {
        return;
      }
      setUserCanShare(prev => ({
        ...prev,
        [userId]: canShare,
      }));
    },
    [canGrantCanShare],
  );

  const handleShare = async (): Promise<void> => {
    if (!user?.id) {
      toast.error('You must be logged in to share a collection');
      return;
    }

    // Validate that at least one user is provided
    if (selectedUsers.length === 0) {
      toast.error('Please select at least one user');
      return;
    }

    setIsLoading(true);

    try {
      const timestamp = Date.now();
      await Promise.all(
        selectedUsers.map(
          selectedUser =>
            zero.mutate(
              mutators.collection.grantPermission({
                id: crypto.randomUUID(),
                collectionId,
                userId: selectedUser.id,
                role: (userPermissions[selectedUser.id] ?? 'VIEWER') as CollectionRoleEnum,
                canShare: userCanShare[selectedUser.id] ?? false,
                timestamp,
              }),
            ).server,
        ),
      );

      toast.success('Collection shared successfully');
      handleClose();
    } catch {
      toast.error('Failed to share collection. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const canSubmit = selectedUsers.length > 0 && !isLoading;

  return (
    <Dialog
      open={isOpen}
      onOpenChange={open => {
        if (!open) handleClose();
      }}
      title='Share Collection'
      description={`Share "${collectionName}" with other users`}
      className='max-w-md'
    >
      <div className='p-6'>
        {/* Header */}
        <div className='flex items-center justify-between mb-6'>
          <h2 className='text-lg font-semibold text-gray-900'>Share Collection</h2>
          <button
            onClick={handleClose}
            className='p-1 hover:bg-gray-100 rounded transition-colors'
            disabled={isLoading}
            data-track-category='knowledge-base'
            data-track-name='close-modal'
          >
            <X size={20} className='text-gray-500' />
          </button>
        </div>

        {/* Collection Info */}
        <div className='mb-6'>
          <p className='text-sm text-gray-600 mb-2'>
            Collection: <span className='font-medium text-gray-900'>{collectionName}</span>
          </p>
          <p className='text-xs text-gray-500'>
            {projectId
              ? 'Only users in this project can be shared with. Choose viewer or editor permission for each user.'
              : 'Search and select users from your workspace. Choose viewer or editor permission for each user.'}
          </p>
        </div>

        {/* User Search */}
        <div className='mb-4'>
          <label htmlFor='user-search' className='block text-sm font-medium text-gray-700 mb-2'>
            Select Users
          </label>
          <SearchUser
            excludeUserIds={[
              user?.id || '',
              ...selectedUsers.map(u => u.id),
              activeCollection?.ownerId || '',
            ]}
            selectedUsers={[]}
            onUsersChange={handleUsersChange}
            placeholder='Search users by name or email...'
            label=''
            hintText={
              projectId
                ? 'Only users in this project can be selected. Search by name or email.'
                : ''
            }
            disabled={{ value: isLoading }}
            allowedUserIds={allowedUserIds}
          />
        </div>

        {/* Permission Selection for Selected Users */}
        {selectedUsers.length > 0 && (
          <div className='mb-6'>
            <div className='block text-sm font-medium text-gray-700 mb-3'>Set Permissions</div>
            <div className='max-h-64 overflow-y-auto space-y-3 pr-2'>
              {selectedUsers.map(user => (
                <div
                  key={user.id}
                  className='flex items-center justify-between p-3 g-3 border border-gray-200 rounded-md bg-gray-50'
                >
                  <div className='flex items-center gap-3 flex-1 min-w-0'>
                    <div className='flex-shrink-0'>
                      <div className='w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-medium text-sm'>
                        {user.name?.[0]?.toUpperCase() || user.email?.[0]?.toUpperCase() || '?'}
                      </div>
                    </div>
                    <div className='flex-1 min-w-0'>
                      <div className='text-sm font-medium text-gray-900 truncate'>
                        {user.name || 'Unnamed User'}
                      </div>
                      <div className='text-xs text-gray-500 truncate'>{user.email}</div>
                    </div>
                  </div>
                  <div className='flex flex-col gap-2 flex-shrink-0'>
                    <div className='flex items-center gap-2'>
                      {allowedRoles.includes('VIEWER') && (
                        <button
                          type='button'
                          onClick={() => handlePermissionChange(user.id, 'VIEWER')}
                          disabled={isLoading}
                          data-track-category='knowledge-base'
                          data-track-name='set-viewer-permission'
                          className={`
                            px-3 py-1.5 text-xs font-medium rounded-md transition-colors
                            ${
                              (userPermissions[user.id] || 'VIEWER') === 'VIEWER'
                                ? 'bg-blue-600 text-white'
                                : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
                            }
                            disabled:opacity-50 disabled:cursor-not-allowed
                          `}
                        >
                          Viewer
                        </button>
                      )}
                      {allowedRoles.includes('EDITOR') && (
                        <button
                          type='button'
                          onClick={() => handlePermissionChange(user.id, 'EDITOR')}
                          disabled={isLoading}
                          data-track-category='knowledge-base'
                          data-track-name='set-editor-permission'
                          className={`
                            px-3 py-1.5 text-xs font-medium rounded-md transition-colors
                            ${
                              userPermissions[user.id] === 'EDITOR'
                                ? 'bg-blue-600 text-white'
                                : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
                            }
                            disabled:opacity-50 disabled:cursor-not-allowed
                          `}
                        >
                          Editor
                        </button>
                      )}
                    </div>
                    {canGrantCanShare && (
                      <label className='flex justify-center items-center gap-2 text-xs text-gray-600 cursor-pointer'>
                        <input
                          type='checkbox'
                          checked={userCanShare[user.id] || false}
                          onChange={e => handleCanShareChange(user.id, e.target.checked)}
                          disabled={isLoading}
                          data-track-category='knowledge-base'
                          data-track-name='toggle-can-share'
                          className='w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500'
                        />
                        <span>Can share</span>
                      </label>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Submit Button */}
        <div className='flex justify-end gap-2'>
          <Button variant='outline' onClick={handleClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button
            disabled={!canSubmit}
            loading={isLoading}
            onClick={() => {
              void handleShare();
            }}
            className='px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors'
          >
            <Share2 size={16} />
            Share Collection
          </Button>
        </div>
      </div>
    </Dialog>
  );
};
