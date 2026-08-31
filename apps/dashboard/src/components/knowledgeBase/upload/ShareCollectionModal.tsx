import { ReactElement, useState, useCallback, useMemo, useEffect } from 'react';
import { toast } from 'sonner';
import {
  ChevronDown,
  Check,
  Crown,
  Globe,
  Hash,
  Link2,
  Lock,
  Search,
  Share2,
  UsersRound,
  X,
} from 'lucide-react';
import Dialog from '../../ui/Dialog';
import { Button } from '../../ui/Button/Button';
import Avatar from '../../ui/Avatar/Avatar';
import { User } from '@xyne/shared';
import { useAuth } from '../../../hooks/useAuth';
import { useActiveUserSearch } from '../../../hooks/useUsers';
import { getUserDisplayName } from '../../../utils/userDisplayName';
import { CollectionRole } from '../../../services/Knowledge/collectionService';
import { CollectionRole as CollectionRoleEnum } from '@xyne/shared';
import { useZero } from '../../../hooks/useZero';
import { mutators } from '../../../zero/mutators';
import { useProjectCollections } from '../hooks/useProjectCollections';
import { useProjectCollectionMutations } from '../hooks/useProjectCollectionMutations';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { queries } from '../../../zero/queries';
import { useUserGroups } from '../../../hooks/useUserGroup';
import { useAllVisibleChannels } from '../../../hooks/useChannels';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../ui/dropdown-menu';

type UserGroupLike = ReturnType<typeof useUserGroups>[number];
type VisibleChannelLike = ReturnType<typeof useAllVisibleChannels>[number];

// Combined search result kind — mirrors Canvas's own share dialog
// (CanvasShareModal's AddKind/AddCandidate), which searches people, groups,
// and channels from a single input instead of three separate pickers.
type AddKind = 'user' | 'group' | 'channel';
interface AddCandidate {
  kind: AddKind;
  id: string;
  name: string;
  sub: string;
  user?: User;
  group?: UserGroupLike;
  channel?: VisibleChannelLike;
}

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
  /** Deep link to the collection. Renders a "Copy link" row in the footer
   *  when present; omitted entirely otherwise. */
  link?: string;
}

export const ShareCollectionModal = ({
  isOpen,
  onClose,
  collectionId,
  collectionName,
  channelId,
  isPrivate: isPrivateProp,
  canEditVisibility = false,
  link,
}: ShareCollectionModalProps): ReactElement => {
  const { user } = useAuth();
  const zero = useZero();
  const { activeCollection } = useProjectCollections();
  const { setCollectionVisibility } = useProjectCollectionMutations();
  const collectionRole = activeCollection?.role;
  // Only owners get the management UI (search/invite, add group, edit
  // others' roles, remove access, change visibility). Viewer/Editor get a
  // read-only view — Who has access + General access, Copy link + Done —
  // matching the simpler ShareLinkModal pattern used for folders/files.
  const isManager = collectionRole === 'OWNER';
  const [selectedUsers, setSelectedUsers] = useState<User[]>([]);
  const [userPermissions, setUserPermissions] = useState<Record<string, CollectionRole>>({});
  const [selectedGroups, setSelectedGroups] = useState<UserGroupLike[]>([]);
  const [groupPermissions, setGroupPermissions] = useState<Record<string, CollectionRole>>({});
  const allUserGroups = useUserGroups();
  // Channel grants — Viewer-only, only offered for workspace-scoped
  // collections (channelId prop is null). A channel-scoped collection
  // already restricts its own invite search to that channel's members, so
  // it doesn't need this.
  const [selectedChannels, setSelectedChannels] = useState<VisibleChannelLike[]>([]);
  const allVisibleChannels = useAllVisibleChannels();
  // Combined "Add people, groups, or channels" search — one input searching
  // all three kinds at once, mirroring Canvas's share dialog.
  const [query, setQuery] = useState('');
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

  // Existing collaborators — "Who has access". Includes the owner's own
  // OWNER row (createCollection inserts one at creation time).
  const [accessList] = useCachedQuery(queries.collectionPermissions({ collectionId }), {
    enabled: isOpen,
  });
  // Role edits on existing rows are staged (not applied) until
  // "Share Collection" is clicked — mirrors Canvas's share dialog ("Unsaved
  // changes" next to Done). Remove stays immediate, matching Canvas's own
  // precedent there. Keyed by permission row id.
  const [pendingAccessRoles, setPendingAccessRoles] = useState<Record<string, CollectionRole>>({});
  const hasPendingAccessChanges = Object.keys(pendingAccessRoles).length > 0;
  // People who already have explicit access — excluded from the search below
  // so they can't be "re-added" there; their role is managed via the Viewer/
  // Editor toggle on their row above instead.
  const existingAccessUserIds = useMemo(
    () => accessList.map(row => row.userId).filter((id): id is string => !!id),
    [accessList],
  );
  // Same, for groups — excluded from the "Add a group" picker below.
  const existingAccessGroupIds = useMemo(
    () => accessList.map(row => row.userGroupId).filter((id): id is string => !!id),
    [accessList],
  );
  const availableGroups = useMemo(
    () =>
      allUserGroups.filter(
        g => !existingAccessGroupIds.includes(g.id) && !selectedGroups.some(sg => sg.id === g.id),
      ),
    [allUserGroups, existingAccessGroupIds, selectedGroups],
  );
  // Same, for channels — excluded from the "Add a channel" picker below.
  const existingAccessChannelIds = useMemo(
    () => accessList.map(row => row.channelId).filter((id): id is string => !!id),
    [accessList],
  );
  const availableChannels = useMemo(
    () =>
      allVisibleChannels.filter(
        ch =>
          !existingAccessChannelIds.includes(ch.id) &&
          !selectedChannels.some(sc => sc.id === ch.id),
      ),
    [allVisibleChannels, existingAccessChannelIds, selectedChannels],
  );

  // Stages a role change — applied on "Share Collection", not immediately.
  const handleAccessRoleChange = useCallback(
    (
      row: { id: string; userId: string | null; userGroupId: string | null },
      role: CollectionRole,
    ) => {
      if (!row.userId && !row.userGroupId) return;
      setPendingAccessRoles(prev => ({ ...prev, [row.id]: role }));
    },
    [],
  );

  const handleRemoveAccess = useCallback(
    (row: { id: string }) => {
      void zero
        .mutate(mutators.collection.revokePermission({ id: row.id, collectionId }))
        .server.then(res => {
          if (res.type === 'error') {
            toast.error(res.error.message || 'Failed to remove access');
          }
        });
    },
    [zero, collectionId],
  );

  // Determine what roles the current user can assign. The backend
  // (grantPermission) actually allows any explicit role to share, capped by
  // escalation — but the invite/role-change UI below is gated to `isManager`
  // (collectionRole === 'OWNER') only, so an EDITOR or VIEWER can never
  // reach a point where this value is used. Reflects that reality directly
  // instead of computing EDITOR/VIEWER cases that are dead code here.
  const allowedRoles = useMemo(
    () => (collectionRole === 'OWNER' ? (['VIEWER', 'EDITOR', 'OWNER'] as CollectionRole[]) : []),
    [collectionRole],
  );

  const handleClose = useCallback(() => {
    if (!isLoading) {
      setSelectedUsers([]);
      setUserPermissions({});
      setSelectedGroups([]);
      setGroupPermissions({});
      setSelectedChannels([]);
      setQuery('');
      // Discard any staged "Who has access" edits — nothing was ever sent.
      setPendingAccessRoles({});
      onClose();
    }
  }, [isLoading, onClose]);

  const addUser = useCallback((u: User) => {
    setSelectedUsers(prev => [...prev, u]);
    setUserPermissions(prev => ({ ...prev, [u.id]: 'VIEWER' }));
  }, []);

  const removeUser = useCallback((userId: string) => {
    setSelectedUsers(prev => prev.filter(u => u.id !== userId));
    setUserPermissions(prev => {
      const next = { ...prev };
      delete next[userId];
      return next;
    });
  }, []);

  const addGroup = useCallback((group: UserGroupLike) => {
    setSelectedGroups(prev => [...prev, group]);
    setGroupPermissions(prev => ({ ...prev, [group.id]: 'VIEWER' }));
  }, []);

  const removeGroup = useCallback((groupId: string) => {
    setSelectedGroups(prev => prev.filter(g => g.id !== groupId));
    setGroupPermissions(prev => {
      const next = { ...prev };
      delete next[groupId];
      return next;
    });
  }, []);

  const handleGroupPermissionChange = useCallback(
    (groupId: string, permission: CollectionRole) => {
      if (!allowedRoles.includes(permission)) return;
      setGroupPermissions(prev => ({ ...prev, [groupId]: permission }));
    },
    [allowedRoles],
  );

  // Channel grants are always Viewer — no permission picker, just add/remove.
  const addChannel = useCallback((channel: VisibleChannelLike) => {
    setSelectedChannels(prev => [...prev, channel]);
  }, []);

  const removeChannel = useCallback((channelId: string) => {
    setSelectedChannels(prev => prev.filter(c => c.id !== channelId));
  }, []);

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

  // Combined search across people / groups / channels — one input, like
  // Canvas's share dialog. Channels are only candidates for workspace-scoped
  // collections (channelId prop null); a channel-scoped collection already
  // restricts its own people search to that channel's participants.
  const userSearchResults = useActiveUserSearch(query, 6);
  const results = useMemo((): AddCandidate[] => {
    const q = query.trim().toLowerCase();
    if (!q) return [];

    const excludedUserIds = new Set([
      user?.id || '',
      activeCollection?.ownerId || '',
      ...existingAccessUserIds,
      ...selectedUsers.map(u => u.id),
    ]);
    const users: AddCandidate[] = userSearchResults
      .filter(u => !excludedUserIds.has(u.id) && (!allowedUserIds || allowedUserIds.has(u.id)))
      .map(u => ({
        kind: 'user',
        id: u.id,
        name: getUserDisplayName(u),
        sub: u.email ?? '',
        user: u,
      }));

    const groups: AddCandidate[] = availableGroups
      .filter(g => g.name.toLowerCase().includes(q))
      .slice(0, 4)
      .map(g => ({ kind: 'group', id: g.id, name: g.name, sub: 'Group', group: g }));

    const channels: AddCandidate[] = channelId
      ? []
      : availableChannels
          .filter(ch => ch.name.toLowerCase().includes(q))
          .slice(0, 4)
          .map(ch => ({ kind: 'channel', id: ch.id, name: ch.name, sub: 'Channel', channel: ch }));

    return [...users, ...groups, ...channels];
  }, [
    query,
    userSearchResults,
    user?.id,
    activeCollection?.ownerId,
    existingAccessUserIds,
    selectedUsers,
    allowedUserIds,
    availableGroups,
    availableChannels,
    channelId,
  ]);

  const addCandidate = useCallback(
    (c: AddCandidate) => {
      if (c.kind === 'user' && c.user) addUser(c.user);
      else if (c.kind === 'group' && c.group) addGroup(c.group);
      else if (c.kind === 'channel' && c.channel) addChannel(c.channel);
      setQuery('');
    },
    [addUser, addGroup, addChannel],
  );

  const searchCandidateIcon = (kind: AddKind): ReactElement =>
    kind === 'group' ? (
      <UsersRound size={16} className='text-muted-foreground' />
    ) : (
      <Hash size={16} className='text-muted-foreground' />
    );

  const visibilityChanged =
    isPrivateProp !== undefined && (visibility === 'private') !== isPrivateProp;

  const handleShare = async (): Promise<void> => {
    if (!user?.id) {
      toast.error('You must be logged in to share a collection');
      return;
    }

    // Allow submitting the dialog if the user has either picked someone (or a
    // group) to share with, changed an existing collaborator's role, OR
    // flipped the visibility. Visibility is persisted first so the new
    // permissions are evaluated against the correct visibility.
    const hasNewInvites =
      selectedUsers.length > 0 || selectedGroups.length > 0 || selectedChannels.length > 0;
    const hasPending = hasNewInvites || hasPendingAccessChanges;
    if (!hasPending && !visibilityChanged) {
      toast.error('Pick a user or group to share with, or change visibility');
      return;
    }

    setIsLoading(true);

    try {
      if (visibilityChanged) {
        await setCollectionVisibility(collectionId, visibility === 'private');
      }

      if (hasPending) {
        const timestamp = Date.now();
        const changedAccessRows = accessList.filter(row => row.id in pendingAccessRoles);
        await Promise.all([
          ...selectedUsers.map(
            selectedUser =>
              zero.mutate(
                mutators.collection.grantPermission({
                  id: crypto.randomUUID(),
                  collectionId,
                  userId: selectedUser.id,
                  role: (userPermissions[selectedUser.id] ?? 'VIEWER') as CollectionRoleEnum,
                  timestamp,
                }),
              ).server,
          ),
          ...selectedGroups.map(
            selectedGroup =>
              zero.mutate(
                mutators.collection.grantPermission({
                  id: crypto.randomUUID(),
                  collectionId,
                  userGroupId: selectedGroup.id,
                  role: (groupPermissions[selectedGroup.id] ?? 'VIEWER') as CollectionRoleEnum,
                  timestamp,
                }),
              ).server,
          ),
          ...selectedChannels.map(
            selectedChannel =>
              zero.mutate(
                mutators.collection.grantPermission({
                  id: crypto.randomUUID(),
                  collectionId,
                  channelId: selectedChannel.id,
                  role: 'VIEWER' as CollectionRoleEnum,
                  timestamp,
                }),
              ).server,
          ),
          ...changedAccessRows.map(
            row =>
              zero.mutate(
                mutators.collection.grantPermission({
                  id: row.id,
                  collectionId,
                  ...(row.userId ? { userId: row.userId } : { userGroupId: row.userGroupId! }),
                  role: (pendingAccessRoles[row.id] ?? row.role) as CollectionRoleEnum,
                  timestamp,
                }),
              ).server,
          ),
        ]);
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

  const hasUnsavedChanges =
    selectedUsers.length > 0 ||
    selectedGroups.length > 0 ||
    selectedChannels.length > 0 ||
    visibilityChanged ||
    hasPendingAccessChanges;
  const canSubmit = hasUnsavedChanges && !isLoading;

  const handleCopyLink = (): void => {
    if (!link) return;
    void navigator.clipboard.writeText(link).then(
      () => toast.success('Link copied'),
      () => toast.error('Could not copy link'),
    );
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={open => {
        if (!open) handleClose();
      }}
      title='Share Collection'
      description={`Share "${collectionName}" with other users`}
      className='max-w-md max-h-[85vh] overflow-y-auto bg-popover border border-border'
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
          {isManager && (
            <p className='text-xs text-muted-foreground'>
              {channelId
                ? 'Only users in this channel can be shared with. Choose viewer or editor permission for each user.'
                : 'Search and select users from your workspace. Choose viewer or editor permission for each user.'}
            </p>
          )}
        </div>

        {/* Search/invite, "Add a group", and "Set Permissions" are
            owner-only — Viewer/Editor get a read-only view (Who has access +
            General access) below instead. */}
        {isManager && (
          <>
            {/* Combined search — one input for people, groups, and channels,
            mirroring Canvas's share dialog (CanvasShareModal) instead of
            three separate pickers. Channel results only appear for
            workspace-scoped collections (channelId prop null). */}
            <div className='mb-4 relative'>
              <label
                htmlFor='share-search'
                className='block text-sm font-medium text-foreground mb-2'
              >
                Select Users
              </label>
              <div className='relative'>
                <Search
                  size={16}
                  className='absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none'
                />
                <input
                  id='share-search'
                  type='text'
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && results[0]) {
                      e.preventDefault();
                      addCandidate(results[0]);
                    } else if (e.key === 'Escape') {
                      setQuery('');
                    }
                  }}
                  disabled={isLoading}
                  placeholder={
                    channelId ? 'Add people or groups...' : 'Add people, groups, or channels...'
                  }
                  data-track-category='knowledge-base'
                  data-track-name='share-collection-search-input'
                  className='w-full rounded-md border border-border bg-background pl-9 pr-3 py-2 text-sm text-foreground outline-none focus:border-ring focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50'
                />
              </div>
              {query.trim() && (
                <div className='absolute left-0 right-0 top-[calc(100%+4px)] z-[60] max-h-64 overflow-y-auto rounded-md border border-border bg-popover shadow-md p-1'>
                  {results.length > 0 ? (
                    results.map(c => (
                      <button
                        key={`${c.kind}:${c.id}`}
                        type='button'
                        onMouseDown={e => {
                          e.preventDefault();
                          addCandidate(c);
                        }}
                        data-track-category='knowledge-base'
                        data-track-name='share-collection-add-candidate'
                        className='w-full flex items-center gap-3 px-2 py-1.5 rounded-md text-left hover:bg-muted'
                      >
                        {c.kind === 'user' ? (
                          <Avatar userId={c.id} size='sm' />
                        ) : (
                          <span className='flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-muted'>
                            {searchCandidateIcon(c.kind)}
                          </span>
                        )}
                        <span className='min-w-0 flex-1'>
                          <span className='block text-sm font-medium text-foreground truncate'>
                            {c.name}
                          </span>
                          <span className='block text-xs text-muted-foreground truncate'>
                            {c.sub}
                          </span>
                        </span>
                      </button>
                    ))
                  ) : (
                    <div className='px-3 py-2.5 text-sm text-muted-foreground'>
                      {channelId
                        ? 'No people or groups found'
                        : 'No people, groups, or channels found'}
                    </div>
                  )}
                </div>
              )}
              {channelId && (
                <p className='mt-1.5 text-xs text-muted-foreground'>
                  Only users in this channel can be selected.
                </p>
              )}
            </div>

            {/* Permission Selection for Selected Users + Groups + Channels */}
            {(selectedUsers.length > 0 ||
              selectedGroups.length > 0 ||
              selectedChannels.length > 0) && (
              <div className='mb-6'>
                <div className='block text-sm font-medium text-foreground mb-3'>
                  Set Permissions
                </div>
                <div className='max-h-64 overflow-y-auto space-y-3 pr-2'>
                  {selectedUsers.map(user => (
                    <div
                      key={user.id}
                      className='flex items-center justify-between p-3 gap-3 border border-border rounded-md bg-muted/40'
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
                      <div className='flex items-center gap-2 flex-shrink-0'>
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
                        {allowedRoles.includes('OWNER') && (
                          <button
                            type='button'
                            onClick={() => handlePermissionChange(user.id, 'OWNER')}
                            disabled={isLoading}
                            data-track-category='knowledge-base'
                            data-track-name='set-owner-permission'
                            className={`
                          px-3 py-1.5 text-xs font-medium rounded-md transition-colors
                          ${
                            userPermissions[user.id] === 'OWNER'
                              ? 'bg-muted-foreground text-background'
                              : 'bg-background text-foreground border border-border hover:bg-muted'
                          }
                          disabled:opacity-50 disabled:cursor-not-allowed
                        `}
                          >
                            Owner
                          </button>
                        )}
                        <button
                          type='button'
                          onClick={() => removeUser(user.id)}
                          disabled={isLoading}
                          aria-label={`Remove ${user.name || user.email || 'user'}`}
                          data-track-category='knowledge-base'
                          data-track-name='remove-pending-user'
                          className='p-1 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60'
                        >
                          <X size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                  {selectedGroups.map(group => (
                    <div
                      key={group.id}
                      className='flex items-center justify-between p-3 gap-3 border border-border rounded-md bg-muted/40'
                    >
                      <div className='flex items-center gap-3 flex-1 min-w-0'>
                        <div className='flex-shrink-0'>
                          <div className='w-8 h-8 rounded-full bg-muted flex items-center justify-center text-muted-foreground'>
                            <UsersRound size={16} />
                          </div>
                        </div>
                        <div className='flex-1 min-w-0'>
                          <div className='text-sm font-medium text-foreground truncate'>
                            {group.name}
                          </div>
                          <div className='text-xs text-muted-foreground truncate'>Group</div>
                        </div>
                      </div>
                      <div className='flex items-center gap-2 flex-shrink-0'>
                        {allowedRoles.includes('VIEWER') && (
                          <button
                            type='button'
                            onClick={() => handleGroupPermissionChange(group.id, 'VIEWER')}
                            disabled={isLoading}
                            data-track-category='knowledge-base'
                            data-track-name='set-group-viewer-permission'
                            className={`
                          px-3 py-1.5 text-xs font-medium rounded-md transition-colors
                          ${
                            (groupPermissions[group.id] || 'VIEWER') === 'VIEWER'
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
                            onClick={() => handleGroupPermissionChange(group.id, 'EDITOR')}
                            disabled={isLoading}
                            data-track-category='knowledge-base'
                            data-track-name='set-group-editor-permission'
                            className={`
                          px-3 py-1.5 text-xs font-medium rounded-md transition-colors
                          ${
                            groupPermissions[group.id] === 'EDITOR'
                              ? 'bg-muted-foreground text-background'
                              : 'bg-background text-foreground border border-border hover:bg-muted'
                          }
                          disabled:opacity-50 disabled:cursor-not-allowed
                        `}
                          >
                            Editor
                          </button>
                        )}
                        <button
                          type='button'
                          onClick={() => removeGroup(group.id)}
                          disabled={isLoading}
                          aria-label={`Remove ${group.name}`}
                          data-track-category='knowledge-base'
                          data-track-name='remove-pending-group'
                          className='p-1 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60'
                        >
                          <X size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                  {selectedChannels.map(channel => (
                    <div
                      key={channel.id}
                      className='flex items-center justify-between p-3 gap-3 border border-border rounded-md bg-muted/40'
                    >
                      <div className='flex items-center gap-3 flex-1 min-w-0'>
                        <div className='flex-shrink-0'>
                          <div className='w-8 h-8 rounded-full bg-muted flex items-center justify-center text-muted-foreground'>
                            <Hash size={16} />
                          </div>
                        </div>
                        <div className='flex-1 min-w-0'>
                          <div className='text-sm font-medium text-foreground truncate'>
                            {channel.name}
                          </div>
                          <div className='text-xs text-muted-foreground truncate'>Channel</div>
                        </div>
                      </div>
                      <div className='flex items-center gap-2 flex-shrink-0'>
                        <span className='px-3 py-1.5 text-xs font-medium text-muted-foreground'>
                          Viewer
                        </span>
                        <button
                          type='button'
                          onClick={() => removeChannel(channel.id)}
                          disabled={isLoading}
                          aria-label={`Remove ${channel.name}`}
                          data-track-category='knowledge-base'
                          data-track-name='remove-pending-channel'
                          className='p-1 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60'
                        >
                          <X size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* Who has access — existing collaborators. OWNER is a real,
            multi-holder role here (like EDITOR/VIEWER) — the creator
            (activeCollection.ownerId) is a separate, permanent label shown
            on their row only, always first and locked. Everyone else
            (including other OWNER-role holders) gets a single role dropdown
            (Viewer/Editor/Owner + Remove access) mirroring Canvas's
            share-dialog RoleSelect. Anyone with an explicit role can share —
            there's no separate delegated "canShare" permission anymore. */}
        {accessList.length > 0 && (
          <div className='mb-6'>
            <div className='block text-sm font-medium text-foreground mb-2'>Who has access</div>
            <div className='max-h-56 overflow-y-auto -mx-1 space-y-1 pr-0.5'>
              {[...accessList]
                .sort((a, b) => {
                  const aIsCreator = a.userId === activeCollection?.ownerId;
                  const bIsCreator = b.userId === activeCollection?.ownerId;
                  if (aIsCreator !== bIsCreator) return aIsCreator ? -1 : 1;
                  const rank = { OWNER: 0, EDITOR: 1, VIEWER: 2 } as const;
                  return (
                    (rank[a.role as keyof typeof rank] ?? 3) -
                    (rank[b.role as keyof typeof rank] ?? 3)
                  );
                })
                .map(row => {
                  const isCreatorRow = !!row.userId && row.userId === activeCollection?.ownerId;
                  // Your own row is always locked too — matches Canvas's
                  // share dialog (isYou locks the same as isCreator), so you
                  // can't change or remove your own access from this list.
                  const isOwnRow = !!row.userId && row.userId === user?.id;
                  const locked = isCreatorRow || isOwnRow || !isManager;
                  // Reflect staged edits, if any, rather than the synced value.
                  const displayRole = (pendingAccessRoles[row.id] ?? row.role) as CollectionRole;
                  const roleLabel =
                    displayRole === 'OWNER'
                      ? 'Owner'
                      : displayRole === 'EDITOR'
                        ? 'Editor'
                        : 'Viewer';
                  return (
                    <div
                      key={row.id}
                      className='flex items-center gap-3 px-1 py-1.5 rounded-lg hover:bg-muted/60'
                    >
                      {row.channelId ? (
                        <div className='flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground'>
                          <Hash size={16} />
                        </div>
                      ) : row.userGroupId ? (
                        <div className='flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground'>
                          <UsersRound size={16} />
                        </div>
                      ) : (
                        <Avatar userId={row.userId} size='sm' />
                      )}
                      <div className='min-w-0 flex-1'>
                        <p className='text-sm font-medium text-foreground truncate'>
                          {row.channelId
                            ? row.channel?.name || 'Unknown channel'
                            : row.userGroupId
                              ? row.userGroup?.name || 'Unknown group'
                              : row.user?.name || row.user?.email || 'Unknown user'}
                          {row.userId === user?.id ? (
                            <span className='ml-1.5 text-xs text-muted-foreground'>You</span>
                          ) : null}
                        </p>
                      </div>
                      {row.channelId ? (
                        // Channel grants are always Viewer — no role dropdown,
                        // just a fixed label and a standalone remove button.
                        <div className='flex items-center gap-1 pr-1'>
                          <span className='text-xs text-muted-foreground'>Viewer</span>
                          {collectionRole === 'OWNER' && (
                            <button
                              type='button'
                              onClick={() => handleRemoveAccess(row)}
                              aria-label={`Remove ${row.channel?.name || 'channel'} access`}
                              data-track-category='knowledge-base'
                              data-track-name='access-remove-channel'
                              className='p-1 rounded-md text-muted-foreground hover:bg-muted hover:text-red-600'
                            >
                              <X size={14} />
                            </button>
                          )}
                        </div>
                      ) : locked ? (
                        isCreatorRow ? (
                          <span className='flex items-center gap-1.5 text-sm text-muted-foreground pr-1'>
                            <Crown size={14} className='text-amber-500' />
                            Owner
                            <span className='text-xs'>(Creator)</span>
                          </span>
                        ) : (
                          <span className='text-xs text-muted-foreground pr-1'>{roleLabel}</span>
                        )
                      ) : (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button
                              type='button'
                              aria-label={`Change role for ${row.userGroupId ? row.userGroup?.name || 'group' : row.user?.name || 'user'}`}
                              data-track-category='knowledge-base'
                              data-track-name='access-change-role'
                              className='inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm font-medium text-foreground transition hover:bg-muted'
                            >
                              {roleLabel}
                              <ChevronDown size={14} className='text-muted-foreground' />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align='end' className='w-40'>
                            <DropdownMenuItem
                              onClick={() => handleAccessRoleChange(row, 'VIEWER')}
                              className='flex items-center justify-between cursor-pointer'
                            >
                              Viewer
                              {displayRole === 'VIEWER' && (
                                <Check size={14} className='text-blue-600' />
                              )}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => handleAccessRoleChange(row, 'EDITOR')}
                              className='flex items-center justify-between cursor-pointer'
                            >
                              Editor
                              {displayRole === 'EDITOR' && (
                                <Check size={14} className='text-blue-600' />
                              )}
                            </DropdownMenuItem>
                            {collectionRole === 'OWNER' && row.userId && (
                              <DropdownMenuItem
                                onClick={() => handleAccessRoleChange(row, 'OWNER')}
                                className='flex items-center justify-between cursor-pointer'
                              >
                                Owner
                                {displayRole === 'OWNER' && (
                                  <Check size={14} className='text-blue-600' />
                                )}
                              </DropdownMenuItem>
                            )}
                            {collectionRole === 'OWNER' && (
                              <>
                                <div
                                  className='h-px bg-border my-1'
                                  role='separator'
                                  aria-hidden='true'
                                />
                                <DropdownMenuItem
                                  onClick={() => handleRemoveAccess(row)}
                                  className='cursor-pointer text-red-600 focus:text-red-600'
                                >
                                  Remove access
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                  );
                })}
            </div>
          </div>
        )}

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
                      data-track-category='knowledge-base'
                      data-track-name='SET_COLLECTION_PUBLIC'
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
                      data-track-category='knowledge-base'
                      data-track-name='SET_COLLECTION_PRIVATE'
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

        {/* Footer — Copy link (left) alongside Share Collection (right) for
            owners; the X at the top already covers "cancel". Viewer/Editor
            get just Copy link + Done — there's nothing for them to submit. */}
        <div className='flex items-center justify-between gap-3 border-t border-border pt-4'>
          {link ? (
            <button
              type='button'
              onClick={handleCopyLink}
              data-track-category='knowledge-base'
              data-track-name='share-collection-copy-link'
              className='inline-flex items-center gap-2 rounded-md px-2.5 py-1.5 -ml-2.5 text-sm font-medium text-foreground transition-colors hover:bg-accent hover:text-primary'
            >
              <Link2 size={16} />
              Copy link
            </button>
          ) : (
            <span />
          )}
          {isManager ? (
            <div className='flex items-center justify-end gap-3'>
              {hasUnsavedChanges && !isLoading ? (
                <span className='text-xs italic text-muted-foreground'>Unsaved changes</span>
              ) : null}
              <Button
                disabled={!canSubmit}
                loading={isLoading}
                onClick={() => {
                  void handleShare();
                }}
                data-track-category='knowledge-base'
                data-track-name='SHARE_COLLECTION'
                className='px-4 py-2 bg-muted-foreground text-background rounded-lg hover:bg-muted-foreground/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors'
              >
                <Share2 size={16} />
                Share Collection
              </Button>
            </div>
          ) : (
            <Button
              onClick={handleClose}
              data-track-category='knowledge-base'
              data-track-name='CANCEL_SHARE_COLLECTION'
            >
              Done
            </Button>
          )}
        </div>
      </div>
    </Dialog>
  );
};
