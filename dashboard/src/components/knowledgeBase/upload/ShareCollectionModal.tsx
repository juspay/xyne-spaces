import { ReactElement, useState, useCallback, useMemo, useEffect } from 'react';
import { toast } from 'sonner';
import { ChevronDown, Check, Globe, Lock, Share2, X } from 'lucide-react';
import Dialog from '../../ui/Dialog';
import { Button } from '../../ui/Button/Button';
import { SearchUser } from '../../ui/SearchUser/SearchUser';
import { User } from '@xyne/shared';
import { useAuth } from '../../../hooks/useAuth';
import { CollectionRole } from '../../../services/Knowledge/collectionService';
import { CollectionRole as CollectionRoleEnum } from '@xyne/shared';
import { useZero } from '../../../hooks/useZero';
import { mutators } from '../../../zero/mutators';
import { useProjectCollections } from '../hooks/useProjectCollections';
import { useProjectCollectionMutations } from '../hooks/useProjectCollectionMutations';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { queries } from '../../../zero/queries';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../ui/dropdown-menu';

interface ShareCollectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  collectionId: string;
  collectionName: string;
  /** Channel the collection belongs to; only channel participants are shown as share targets */
  channelId: string | null;
  /** Current visibility of the collection. Drives the General access selector
   *  in the modal. When undefined the selector is hidden (older callers that
   *  haven't been updated yet). */
  isPrivate?: boolean;
  /** Whether the current user can flip Public/Private. Owner-only — the server
   *  enforces this too, but hiding the control for non-owners avoids a wasted
   *  round-trip + error toast. */
  canEditVisibility?: boolean;
}

export const ShareCollectionModal = ({
  isOpen,
  onClose,
  collectionId,
  collectionName,
  channelId,
  isPrivate: isPrivateProp,
  canEditVisibility = false,
}: ShareCollectionModalProps): ReactElement => {
  const { user } = useAuth();
  const zero = useZero();
  const { activeCollection } = useProjectCollections();
  const { setCollectionVisibility } = useProjectCollectionMutations();
  const collectionRole = activeCollection?.role;
  const collectionCanShare = activeCollection?.canShare;
  const [selectedUsers, setSelectedUsers] = useState<User[]>([]);
  const [userPermissions, setUserPermissions] = useState<Record<string, CollectionRole>>({});
  const [userCanShare, setUserCanShare] = useState<Record<string, boolean>>({});
  const [isLoading, setIsLoading] = useState(false);
  // Local-only mirror of the visibility — we don't fire the mutator until the
  // user clicks Share Collection. Re-syncs to the prop whenever the modal
  // opens or the upstream value changes so cancelling discards the choice.
  const [visibility, setVisibility] = useState<'public' | 'private'>(
    isPrivateProp ? 'private' : 'public',
  );

  useEffect(() => {
    if (isOpen) {
      setVisibility(isPrivateProp ? 'private' : 'public');
    }
  }, [isOpen, isPrivateProp]);

  const pickVisibility = useCallback(
    (next: 'public' | 'private') => {
      if (!canEditVisibility) return;
      setVisibility(next);
    },
    [canEditVisibility],
  );

  // Only channel participants can be shared with; query via Zero (already synced, no round-trip)
  const [channelParticipants] = useCachedQuery(
    queries.channelParticipants({ channelId: channelId ?? '' }),
    { enabled: isOpen && !!channelId },
  );
  const allowedUserIds = useMemo(
    () => (channelId ? new Set(channelParticipants.map(p => p.userId)) : null),
    [channelId, channelParticipants],
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

  const visibilityChanged =
    isPrivateProp !== undefined && (visibility === 'private') !== isPrivateProp;

  const handleShare = async (): Promise<void> => {
    if (!user?.id) {
      toast.error('You must be logged in to share a collection');
      return;
    }

    // Allow submitting the dialog if the user has either picked someone to
    // share with OR flipped the visibility. Both branches can apply in the
    // same click — visibility is persisted first so the new permissions are
    // evaluated against the correct visibility.
    if (selectedUsers.length === 0 && !visibilityChanged) {
      toast.error('Pick a user to share with, or change visibility');
      return;
    }

    setIsLoading(true);

    try {
      if (visibilityChanged) {
        await setCollectionVisibility(collectionId, visibility === 'private');
      }

      if (selectedUsers.length > 0) {
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
      } else if (visibilityChanged) {
        toast.success(`"${collectionName}" is now ${visibility}`);
      }
      handleClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to update collection';
      toast.error(msg);
    } finally {
      setIsLoading(false);
    }
  };

  const canSubmit = (selectedUsers.length > 0 || visibilityChanged) && !isLoading;

  return (
    <Dialog
      open={isOpen}
      onOpenChange={open => {
        if (!open) handleClose();
      }}
      title='Share Collection'
      description={`Share "${collectionName}" with other users`}
      className='max-w-md bg-secondary border border-border'
    >
      <div className='p-6'>
        {/* Header */}
        <div className='flex items-center justify-between mb-6'>
          <h2 className='text-lg font-semibold text-foreground'>Share Collection</h2>
          <button
            onClick={handleClose}
            className='p-1 hover:bg-muted rounded transition-colors'
            disabled={isLoading}
            data-track-category='knowledge-base'
            data-track-name='close-modal'
          >
            <X size={20} className='text-muted-foreground' />
          </button>
        </div>

        {/* Collection Info */}
        <div className='mb-6'>
          <p className='text-sm text-muted-foreground mb-2'>
            Collection: <span className='font-medium text-foreground'>{collectionName}</span>
          </p>
          <p className='text-xs text-muted-foreground'>
            {channelId
              ? 'Only users in this channel can be shared with. Choose viewer or editor permission for each user.'
              : 'Search and select users from your workspace. Choose viewer or editor permission for each user.'}
          </p>
        </div>

        {/* General access — Google Drive style: pick Public or Private. The
            choice is only persisted when the user clicks Share Collection,
            so cancelling discards it. Owner-only; non-owners see it disabled.
            Hidden when the caller didn't pass an initial visibility. */}
        {isPrivateProp !== undefined && (
          <div className='mb-6'>
            <div className='block text-sm font-medium text-foreground mb-2'>General access</div>
            <div className='flex items-center gap-3 rounded-md border border-border bg-muted/40 p-3'>
              <div className='flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-background ring-1 ring-border text-muted-foreground'>
                {visibility === 'public' ? <Globe size={16} /> : <Lock size={16} />}
              </div>
              <div className='flex-1 min-w-0'>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type='button'
                      disabled={!canEditVisibility || isLoading}
                      aria-label='Collection visibility'
                      data-track-category='knowledge-base'
                      data-track-name='change-collection-visibility'
                      className='inline-flex items-center gap-1 rounded-md px-2 py-1 -ml-2 text-sm font-medium text-foreground transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent'
                    >
                      {visibility === 'public' ? 'Public' : 'Private'}
                      {canEditVisibility && (
                        <ChevronDown size={14} className='text-muted-foreground' />
                      )}
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align='start' className='w-56'>
                    <DropdownMenuItem
                      onClick={() => pickVisibility('public')}
                      className='flex items-start gap-2 cursor-pointer'
                    >
                      <Globe size={16} className='mt-0.5 text-muted-foreground flex-shrink-0' />
                      <div className='flex-1 min-w-0'>
                        <div className='flex items-center gap-2'>
                          <span className='text-sm font-medium'>Public</span>
                          {visibility === 'public' && <Check size={14} className='text-blue-600' />}
                        </div>
                        <p className='text-xs text-muted-foreground'>
                          Anyone in the channel can access.
                        </p>
                      </div>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => pickVisibility('private')}
                      className='flex items-start gap-2 cursor-pointer'
                    >
                      <Lock size={16} className='mt-0.5 text-muted-foreground flex-shrink-0' />
                      <div className='flex-1 min-w-0'>
                        <div className='flex items-center gap-2'>
                          <span className='text-sm font-medium'>Private</span>
                          {visibility === 'private' && (
                            <Check size={14} className='text-blue-600' />
                          )}
                        </div>
                        <p className='text-xs text-muted-foreground'>
                          Only invited users can access.
                        </p>
                      </div>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <p className='mt-0.5 text-xs text-muted-foreground'>
                  {visibility === 'public'
                    ? 'Anyone in the channel can view and edit this collection.'
                    : 'Only people you invite below can access this collection.'}
                </p>
              </div>
            </div>
            {!canEditVisibility && (
              <p className='mt-1 text-xs text-muted-foreground'>
                Only the collection owner can change visibility.
              </p>
            )}
            {canEditVisibility && visibilityChanged && (
              <p className='mt-1 text-xs text-amber-600'>
                Visibility will change when you click &quot;Share Collection&quot;.
              </p>
            )}
          </div>
        )}

        {/* User Search */}
        <div className='mb-4'>
          <label htmlFor='user-search' className='block text-sm font-medium text-foreground mb-2'>
            Select Users
          </label>
          <SearchUser
            excludeUserIds={[user?.id || '', activeCollection?.ownerId || '']}
            selectedUsers={selectedUsers}
            onUsersChange={handleUsersChange}
            placeholder='Search users by name or email...'
            label=''
            hintText={
              channelId
                ? 'Only users in this channel can be selected. Search by name or email.'
                : ''
            }
            disabled={{ value: isLoading }}
            allowedUserIds={allowedUserIds}
          />
        </div>

        {/* Permission Selection for Selected Users */}
        {selectedUsers.length > 0 && (
          <div className='mb-6'>
            <div className='block text-sm font-medium text-foreground mb-3'>Set Permissions</div>
            <div className='max-h-64 overflow-y-auto space-y-3 pr-2'>
              {selectedUsers.map(user => (
                <div
                  key={user.id}
                  className='flex items-center justify-between p-3 g-3 border border-border rounded-md bg-muted/40'
                >
                  <div className='flex items-center gap-3 flex-1 min-w-0'>
                    <div className='flex-shrink-0'>
                      <div className='w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-500/20 flex items-center justify-center text-blue-600 dark:text-blue-300 font-medium text-sm'>
                        {user.name?.[0]?.toUpperCase() || user.email?.[0]?.toUpperCase() || '?'}
                      </div>
                    </div>
                    <div className='flex-1 min-w-0'>
                      <div className='text-sm font-medium text-foreground truncate'>
                        {user.name || 'Unnamed User'}
                      </div>
                      <div className='text-xs text-muted-foreground truncate'>{user.email}</div>
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
                                ? 'bg-muted-foreground text-background'
                                : 'bg-background text-foreground border border-border hover:bg-muted'
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
                                ? 'bg-muted-foreground text-background'
                                : 'bg-background text-foreground border border-border hover:bg-muted'
                            }
                            disabled:opacity-50 disabled:cursor-not-allowed
                          `}
                        >
                          Editor
                        </button>
                      )}
                    </div>
                    {canGrantCanShare && (
                      <label className='flex justify-center items-center gap-2 text-xs text-muted-foreground cursor-pointer'>
                        <input
                          type='checkbox'
                          checked={userCanShare[user.id] || false}
                          onChange={e => handleCanShareChange(user.id, e.target.checked)}
                          disabled={isLoading}
                          data-track-category='knowledge-base'
                          data-track-name='toggle-can-share'
                          className='w-4 h-4 text-blue-600 border-border rounded focus:ring-blue-500'
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
            className='px-4 py-2 bg-muted-foreground text-background rounded-lg hover:bg-muted-foreground/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors'
          >
            <Share2 size={16} />
            Share Collection
          </Button>
        </div>
      </div>
    </Dialog>
  );
};
