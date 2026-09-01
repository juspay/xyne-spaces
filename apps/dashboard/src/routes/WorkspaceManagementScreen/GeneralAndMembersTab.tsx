import { ReactElement, useState, useEffect, useMemo, useRef } from 'react';
import {
  Save,
  Users,
  Search,
  Shield,
  User,
  X,
  Loader2,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Globe,
  Monitor,
} from 'lucide-react';
import { Button } from '../../components/ui/Button/Button';
import Input from '../../components/ui/Input/Input';
import { SegmentedToggle } from '../../components/ui/SegmentedToggle';
import { useSelf, useUsers, useUserSearch } from '../../hooks/useUsers';
import { useZero } from '../../hooks/useZero';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { queries } from '../../zero/queries';
import { mutators } from '../../zero/mutators';
import { toast } from 'sonner';
import { cn } from '../../utils/classNames';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu';
import Dialog from '../../components/ui/Dialog';
import type { User as UserType } from '../../machines/stateMachine';
import { WorkspaceRole } from '@xyne/shared';
import { usePlatform } from '../../hooks/usePlatform';
import { WorkspaceChannelEmailCard } from '../../components/xyne-desk/WorkspaceChannelEmailCard/WorkspaceChannelEmailCard';
import {
  workspaceSettingsApi,
  type InviteExperience,
} from '../../services/workspaceSettingsService';

const MEMBERS_PAGE_SIZE = 15;

const Card = ({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}): ReactElement => (
  <div className={cn('rounded-xl border border-border bg-card shadow-sm', className)}>
    {children}
  </div>
);

const RoleBadge = ({ role }: { role: WorkspaceRole | null }): ReactElement => {
  const isAdmin = role === WorkspaceRole.ADMIN || role === WorkspaceRole.OWNER;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium',
        isAdmin
          ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
          : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-400',
      )}
    >
      {isAdmin ? <Shield className='w-3 h-3' /> : <User className='w-3 h-3' />}
      {isAdmin ? 'Admin' : 'Member'}
    </span>
  );
};

interface GeneralAndMembersTabProps {
  isActive?: boolean;
}

export const GeneralAndMembersTab = ({
  isActive = false,
}: GeneralAndMembersTabProps): ReactElement => {
  const self = useSelf();
  const z = useZero();
  const workspaceId = self?.workspaceId;

  // General settings state
  const [workspace] = useCachedQuery(queries.getWorkspaceById({ workspaceId: workspaceId || '' }), {
    enabled: !!workspaceId,
  });

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [hasChanges, setHasChanges] = useState(false);
  const { isMobile } = usePlatform();
  const workspaceNameInputRef = useRef<HTMLInputElement>(null);

  // Invite experience: per-workspace toggle between the desktop-app-required
  // invite flow (default) and a browser-only flow with no install step.
  const [inviteExperience, setInviteExperience] = useState<InviteExperience>('DESKTOP');
  const [savingInviteExperience, setSavingInviteExperience] = useState(false);

  // Load workspace data when available
  useEffect(() => {
    if (workspace) {
      setName(workspace.name || '');
      setDescription(workspace.description || '');
      setHasChanges(false);
      const workspaceMetadata = workspace.metadata as Record<string, unknown> | null | undefined;
      setInviteExperience(
        workspaceMetadata?.['inviteExperience'] === 'BROWSER' ? 'BROWSER' : 'DESKTOP',
      );
    }
  }, [workspace]);

  // Track changes
  useEffect(() => {
    if (workspace) {
      const nameChanged = name !== (workspace.name || '');
      const descChanged = description !== (workspace.description || '');
      setHasChanges(nameChanged || descChanged);
    }
  }, [name, description, workspace]);

  useEffect(() => {
    if (!isActive || isMobile) return;
    const rafId = requestAnimationFrame(() => {
      workspaceNameInputRef.current?.focus();
    });
    return () => cancelAnimationFrame(rafId);
  }, [isActive, isMobile]);

  const handleSaveGeneral = (): void => {
    if (!workspaceId) {
      toast.error('No workspace selected');
      return;
    }

    if (!name.trim()) {
      toast.error('Workspace name is required');
      return;
    }

    z.mutate(
      mutators.workspace.update({
        workspaceId,
        timestamp: Date.now(),
        updates: {
          name: name.trim(),
          description: description.trim() || undefined,
        },
      }),
    );
    toast.success('Workspace settings saved');
    setHasChanges(false);
  };

  const handleInviteExperienceChange = (next: InviteExperience): void => {
    if (!workspaceId || next === inviteExperience) return;

    const previous = inviteExperience;
    setInviteExperience(next);
    setSavingInviteExperience(true);

    workspaceSettingsApi
      .updateInviteExperience(workspaceId, next)
      .then(() => {
        toast.success(
          next === 'BROWSER'
            ? 'New invites will now open directly in the browser'
            : 'New invites will now require the desktop app',
        );
      })
      .catch((error: unknown) => {
        setInviteExperience(previous);
        toast.error(error instanceof Error ? error.message : 'Failed to update invite experience');
      })
      .finally(() => {
        setSavingInviteExperience(false);
      });
  };

  // Members section state
  const allUsers = useUsers();
  const [searchQuery, setSearchQuery] = useState('');
  const [processingUserId, setProcessingUserId] = useState<string | null>(null);
  const [showRemoveDialog, setShowRemoveDialog] = useState(false);
  const [userToRemove, setUserToRemove] = useState<{ id: string; name: string } | null>(null);

  // Search users
  const searchedUsers = useUserSearch(searchQuery, 100);
  const users = searchQuery ? searchedUsers : allUsers;

  // Client-side pagination — batches of MEMBERS_PAGE_SIZE
  const [currentPage, setCurrentPage] = useState(1);
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery]);
  const totalPages = Math.max(1, Math.ceil(users.length / MEMBERS_PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedUsers = users.slice(
    (safePage - 1) * MEMBERS_PAGE_SIZE,
    safePage * MEMBERS_PAGE_SIZE,
  );

  // Count admins for validation
  const adminCount = useMemo(() => {
    return allUsers.filter(u => u.role === WorkspaceRole.ADMIN).length;
  }, [allUsers]);

  const handleUpdateRole = (
    userId: string,
    newRole: WorkspaceRole.ADMIN | WorkspaceRole.MEMBER,
  ): void => {
    if (!workspaceId) return;

    setProcessingUserId(userId);
    z.mutate(
      mutators.users.updateRole({
        workspaceId,
        userId,
        updates: { role: newRole },
        timestamp: Date.now(),
      }),
    );
    toast.success(`Role updated to ${newRole.toLowerCase()}`);
    setProcessingUserId(null);
  };

  const handleRemoveMember = (userId: string, userName: string): void => {
    if (!workspaceId) return;

    const targetUser = allUsers.find(u => u.id === userId);
    if (targetUser?.role === WorkspaceRole.ADMIN && adminCount <= 1) {
      toast.error('Cannot remove the only admin');
      return;
    }

    setUserToRemove({ id: userId, name: userName });
    setShowRemoveDialog(true);
  };

  const confirmRemoveMember = (): void => {
    if (!workspaceId || !userToRemove) return;

    setProcessingUserId(userToRemove.id);
    z.mutate(
      mutators.users.remove({
        workspaceId,
        userId: userToRemove.id,
        timestamp: Date.now(),
      }),
    );
    toast.success(`${userToRemove.name} has been removed from the workspace`);
    setProcessingUserId(null);
    setShowRemoveDialog(false);
    setUserToRemove(null);
  };

  const isSelf = (userId: string): boolean => userId === self?.id;
  const canRemoveAdmin = (user: UserType): boolean => {
    if (user.role !== WorkspaceRole.ADMIN) return true;
    return adminCount > 1;
  };
  const canManageMembers = self?.role === WorkspaceRole.ADMIN || self?.role === WorkspaceRole.OWNER;

  return (
    <div className='space-y-6'>
      {/* General Settings Section */}
      <div className='space-y-4'>
        {/* Header */}
        <div>
          <h2 className='text-lg font-semibold text-foreground'>General Settings</h2>
          <p className='text-sm text-muted-foreground'>
            Manage your workspace name and description
          </p>
        </div>

        {/* Settings Form */}
        <Card className='p-6'>
          <div className='space-y-6'>
            {/* Workspace Name */}
            <div>
              <label
                htmlFor='workspace-name'
                className='block text-sm font-medium text-foreground mb-2'
              >
                Workspace Name <span className='text-destructive'>*</span>
              </label>
              <Input
                ref={workspaceNameInputRef}
                id='workspace-name'
                type='text'
                placeholder='Enter workspace name...'
                value={name}
                onChange={e => setName(e.target.value)}
                className='w-full max-w-lg'
              />
              <p className='text-xs text-muted-foreground mt-1.5'>
                This is the name that will be displayed to all workspace members.
              </p>
            </div>

            {/* Workspace Description */}
            <div>
              <label
                htmlFor='workspace-description'
                className='block text-sm font-medium text-foreground mb-2'
              >
                Description
              </label>
              <textarea
                id='workspace-description'
                placeholder='Enter workspace description...'
                value={description}
                onChange={e => setDescription(e.target.value)}
                data-track-category='workspace-management'
                data-track-name='edit-workspace-description'
                rows={4}
                className={cn(
                  'w-full max-w-lg px-3 py-2 rounded-md border border-input bg-background',
                  'text-sm text-foreground placeholder:text-muted-foreground',
                  'focus:outline-none focus:ring-2 focus:ring-ring focus:border-ring',
                  'resize-none',
                )}
              />
              <p className='text-xs text-muted-foreground mt-1.5'>
                A brief description of your workspace and its purpose.
              </p>
            </div>

            {/* Save Button */}
            <div className='flex items-center gap-4 pt-2'>
              <Button
                onClick={() => void handleSaveGeneral()}
                data-track-category='workspace-management'
                data-track-name='SAVE_WORKSPACE_GENERAL'
                disabled={!hasChanges || !name.trim()}
                className='gap-2'
              >
                <Save className='w-4 h-4' />
                Save Changes
              </Button>
              {hasChanges && (
                <span className='text-sm text-amber-600'>You have unsaved changes</span>
              )}
            </div>
          </div>
        </Card>
      </div>

      {/* Invite Experience Section — admin/owner only */}
      {canManageMembers && (
        <div className='space-y-4'>
          <div>
            <h2 className='text-lg font-semibold text-foreground'>Invite Experience</h2>
            <p className='text-sm text-muted-foreground'>
              Choose what happens when someone accepts an invitation to this workspace.
            </p>
          </div>

          <Card className='p-6'>
            <div className='flex items-start justify-between gap-6 flex-wrap'>
              <div className='max-w-md'>
                <p className='text-sm font-medium text-foreground mb-1'>
                  {inviteExperience === 'BROWSER'
                    ? 'Opens directly in the browser'
                    : 'Requires the desktop app'}
                </p>
                <p className='text-sm text-muted-foreground'>
                  {inviteExperience === 'BROWSER'
                    ? 'New members accept their invite and land straight in the workspace in their browser — nothing to install.'
                    : 'New members are asked to install the Xyne Spaces desktop app before their invite link will work.'}
                </p>
              </div>

              <div className='flex items-center gap-2'>
                {savingInviteExperience && (
                  <Loader2 className='w-4 h-4 animate-spin text-muted-foreground' />
                )}
                <SegmentedToggle<InviteExperience>
                  options={[
                    {
                      value: 'DESKTOP',
                      label: 'Desktop App',
                      icon: <Monitor className='w-3.5 h-3.5' />,
                    },
                    { value: 'BROWSER', label: 'Browser', icon: <Globe className='w-3.5 h-3.5' /> },
                  ]}
                  value={inviteExperience}
                  onChange={handleInviteExperienceChange}
                />
              </div>
            </div>
            <p className='text-xs text-muted-foreground mt-4 pt-4 border-t border-border'>
              Only applies to invites sent after this change — invites already in someone&apos;s
              inbox keep working the way they were sent.
            </p>
          </Card>
        </div>
      )}

      <div className='space-y-4'>
        <div>
          <h2 className='text-lg font-semibold text-foreground'>Email alerts to channel</h2>
          <p className='text-sm text-muted-foreground'>
            Connect the workspace mailbox used to route inbound email alerts into channels.
          </p>
        </div>
        <WorkspaceChannelEmailCard />
      </div>

      {/* Members Section */}
      <div className='space-y-4'>
        {/* Header */}
        <div>
          <h2 className='text-lg font-semibold text-foreground'>Workspace Members</h2>
          <p className='text-sm text-muted-foreground'>
            {allUsers.length} member{allUsers.length !== 1 ? 's' : ''} • {adminCount} admin
            {adminCount !== 1 ? 's' : ''}
          </p>
        </div>

        {/* Search */}
        <Card className='p-4'>
          <div className='relative'>
            <Search className='absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground' />
            <Input
              type='text'
              placeholder='Search by name or email...'
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className='pl-10'
            />
          </div>
        </Card>

        {/* Members List */}
        <Card>
          {users.length === 0 ? (
            <div className='p-8 text-center text-muted-foreground'>
              <Users className='w-12 h-12 mx-auto mb-3 opacity-50' />
              <p>No members found</p>
              {searchQuery && <p className='text-sm'>Try a different search term</p>}
            </div>
          ) : (
            <div className='divide-y divide-border'>
              {paginatedUsers.map(user => (
                <div
                  key={user.id}
                  className='flex items-center justify-between p-4 hover:bg-muted/50 transition-colors'
                >
                  <div className='flex items-center gap-3'>
                    {/* Avatar */}
                    <div className='w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center overflow-hidden'>
                      {user.picture ? (
                        <img
                          src={user.picture}
                          alt={user.name}
                          className='w-full h-full object-cover'
                        />
                      ) : (
                        <span className='text-sm font-medium text-primary'>
                          {user.name.charAt(0).toUpperCase()}
                        </span>
                      )}
                    </div>

                    {/* User Info */}
                    <div>
                      <div className='flex items-center gap-2'>
                        <span className='font-medium text-foreground'>{user.name}</span>
                        {isSelf(user.id) && (
                          <span className='text-xs text-muted-foreground'>(You)</span>
                        )}
                      </div>
                      <div className='flex items-center gap-2 text-sm text-muted-foreground'>
                        <span>{user.email}</span>
                        <span>•</span>
                        <RoleBadge role={user.role} />
                      </div>
                    </div>
                  </div>

                  {/* Actions — only workspace admins/owners can change roles or remove members */}
                  {canManageMembers && (
                    <div className='flex items-center gap-2'>
                      {/* Role Dropdown */}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant='outline'
                            size='sm'
                            disabled={processingUserId === user.id}
                            className='gap-1'
                          >
                            {processingUserId === user.id ? (
                              <Loader2 className='w-3 h-3 animate-spin' />
                            ) : (
                              <>
                                Change Role
                                <Shield className='w-3 h-3 ml-1' />
                              </>
                            )}
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align='end'>
                          {user.role !== WorkspaceRole.ADMIN && (
                            <DropdownMenuItem
                              onClick={() => handleUpdateRole(user.id, WorkspaceRole.ADMIN)}
                              data-track-category='workspace-management'
                              data-track-name='SET_MEMBER_ROLE_ADMIN'
                            >
                              <Shield className='w-4 h-4 mr-2' />
                              Admin
                            </DropdownMenuItem>
                          )}
                          {user.role !== WorkspaceRole.MEMBER && (
                            <DropdownMenuItem
                              onClick={() => handleUpdateRole(user.id, WorkspaceRole.MEMBER)}
                              data-track-category='workspace-management'
                              data-track-name='SET_MEMBER_ROLE_MEMBER'
                              disabled={!canRemoveAdmin(user)}
                            >
                              <User className='w-4 h-4 mr-2' />
                              Member
                              {!canRemoveAdmin(user) && (
                                <span className='ml-2 text-xs text-muted-foreground'>
                                  (Last admin)
                                </span>
                              )}
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>

                      {/* Remove Button */}
                      <Button
                        variant='ghost'
                        size='sm'
                        onClick={() => handleRemoveMember(user.id, user.name)}
                        data-track-category='workspace-management'
                        data-track-name='OPEN_REMOVE_MEMBER_CONFIRM'
                        disabled={processingUserId === user.id || !canRemoveAdmin(user)}
                        className='text-destructive hover:text-destructive hover:bg-destructive/10'
                      >
                        {processingUserId === user.id ? (
                          <Loader2 className='w-4 h-4 animate-spin' />
                        ) : (
                          <X className='w-4 h-4' />
                        )}
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {users.length > MEMBERS_PAGE_SIZE && (
            <div className='flex items-center justify-between px-4 py-3 border-t border-border'>
              <span className='text-xs text-muted-foreground'>
                Showing {(safePage - 1) * MEMBERS_PAGE_SIZE + 1}-
                {Math.min(safePage * MEMBERS_PAGE_SIZE, users.length)} of {users.length}
              </span>
              <div className='flex items-center gap-2'>
                <button
                  type='button'
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={safePage <= 1}
                  className='p-1.5 rounded-full border border-border hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed'
                  aria-label='Previous page'
                  data-track-category='workspace-management'
                  data-track-name='members-pagination-prev'
                >
                  <ChevronLeft className='w-3.5 h-3.5' />
                </button>
                <span className='text-sm text-muted-foreground px-1'>
                  {safePage} / {totalPages}
                </span>
                <button
                  type='button'
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={safePage >= totalPages}
                  className='p-1.5 rounded-full border border-border hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed'
                  aria-label='Next page'
                  data-track-category='workspace-management'
                  data-track-name='members-pagination-next'
                >
                  <ChevronRight className='w-3.5 h-3.5' />
                </button>
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* Remove Member Confirmation Dialog */}
      <Dialog
        open={showRemoveDialog}
        onOpenChange={setShowRemoveDialog}
        className='max-w-md rounded-xl'
      >
        <div className='p-6 space-y-4'>
          <div className='flex items-center gap-3'>
            <div className='w-10 h-10 rounded-full bg-destructive/10 flex items-center justify-center'>
              <AlertTriangle className='w-5 h-5 text-destructive' />
            </div>
            <h2 className='text-lg font-semibold text-foreground'>Remove Member</h2>
          </div>

          <p className='text-sm text-muted-foreground'>
            Are you sure you want to remove{' '}
            <span className='font-medium text-foreground'>{userToRemove?.name}</span> from this
            workspace? They will lose access to all workspace resources.
          </p>

          <div className='flex gap-3 justify-end pt-2'>
            <Button
              variant='outline'
              onClick={() => {
                setShowRemoveDialog(false);
                setUserToRemove(null);
              }}
              data-track-category='workspace-management'
              data-track-name='CANCEL_REMOVE_MEMBER'
              disabled={processingUserId === userToRemove?.id}
            >
              Cancel
            </Button>
            <Button
              variant='destructive'
              onClick={confirmRemoveMember}
              data-track-category='workspace-management'
              data-track-name='CONFIRM_REMOVE_MEMBER'
              disabled={processingUserId === userToRemove?.id}
              className='gap-2'
            >
              {processingUserId === userToRemove?.id ? (
                <Loader2 className='w-4 h-4 animate-spin' />
              ) : null}
              Remove
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
};

export default GeneralAndMembersTab;
