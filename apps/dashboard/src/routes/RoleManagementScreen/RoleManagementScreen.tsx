import { ReactElement, useEffect, useMemo, useRef, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { toast } from 'sonner';
import { Plus, Check, X, Users, Search, UserPlus } from 'lucide-react';
import { useZero } from '../../hooks/useZero';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { useUsers } from '../../hooks/useUsers';
import { queries } from '../../zero/queries';
import { mutators } from '../../zero/mutators';
import { Button } from '../../components/ui/Button/Button';
import Input from '../../components/ui/Input/Input';
import { Dialog } from '../../components/ui/Dialog/Dialog';
import Avatar from '../../components/ui/Avatar/Avatar';
import RolesSidebar from '../../components/Roles/RolesSidebar';
import RoleDetailHeader from '../../components/Roles/RoleDetailHeader';
import { Panel, ResizableGroup, Separator } from '../../components/ui/Resizable/Resizable';
import { cn } from '../../utils/classNames';
import { getUserDisplayNameById } from '../../utils/userDisplayName';
import type { Role, UserRoleMapping } from '@xyne/shared';
import {
  ROLES_SIDEBAR_DEFAULT_WIDTH,
  ROLES_SIDEBAR_MAX_WIDTH,
  ROLES_SIDEBAR_MIN_WIDTH,
} from './rolesSidebarWidth';

type RoleCursor = { id: string; createdAt: number };

type RoleWithMappings = Role & {
  readonly userMappings?: ReadonlyArray<
    UserRoleMapping & {
      readonly user?:
        | { readonly id: string; readonly name?: string | null; readonly email?: string | null }
        | undefined;
    }
  >;
};

const PAGE_SIZE = 20;

function toRoleCursor(role: Role): RoleCursor {
  return { id: role.id, createdAt: role.createdAt };
}

// ─── Create role dialog ──────────────────────────────────────────────────────

interface CreateRoleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (id: string) => void;
}

/**
 * Auto-format role name input (live, as the user types): uppercase letters,
 * spaces → underscores, silently drop digits and other special characters,
 * collapse consecutive underscores. Leading/trailing underscores are kept here
 * so the user can type "XYNE_" and continue to "XYNE_PM" — they're stripped at
 * submit.
 */
const formatRoleName = (value: string): string =>
  value
    .toUpperCase()
    .replace(/ /g, '_')
    .replace(/[^A-Z_]/g, '')
    .replace(/_+/g, '_');

/** Final cleanup before persisting: strip leading/trailing underscores. */
const cleanRoleName = (value: string): string => formatRoleName(value).replace(/^_+|_+$/g, '');

const CreateRoleDialog = ({
  open,
  onOpenChange,
  onCreated,
}: CreateRoleDialogProps): ReactElement => {
  const zero = useZero();
  const nameRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      setName('');
      setDescription('');
    }
  }, [open]);

  const cleanedName = cleanRoleName(name);
  const canSubmit = cleanedName.length > 0 && !saving;

  const handleCreate = async (): Promise<void> => {
    const cleanedName = cleanRoleName(name);
    if (!cleanedName) return;
    setSaving(true);
    const id = uuidv4();
    const timestamp = Date.now();
    const result = zero.mutate(
      mutators.role.create({
        id,
        name: cleanedName,
        description: description.trim() || undefined,
        timestamp,
      }),
    );
    const res = await result.server;
    setSaving(false);
    if (res.type === 'error') {
      toast.error('Failed to create role', {
        description: res.error.message,
        duration: 5000,
      });
      return;
    }
    toast.success(`Role "${cleanedName}" created`);
    onOpenChange(false);
    onCreated(id);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title='Create role'
      description='Name and describe the new role for this workspace.'
      className='max-w-sm'
      focusRef={nameRef}
    >
      <div className='p-5'>
        <h2 className='text-base font-semibold text-foreground mb-1'>Create role</h2>
        <p className='text-xs text-muted-foreground mb-4'>
          Roles are reusable named sets of users you can reference across the workspace.
        </p>

        <label
          htmlFor='role-create-name'
          className='block text-xs font-medium text-foreground mb-1.5'
        >
          Name
        </label>
        <Input
          id='role-create-name'
          ref={nameRef}
          value={name}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setName(formatRoleName(e.target.value))
          }
          onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
            if (e.key === 'Enter' && canSubmit) void handleCreate();
          }}
          maxLength={40}
          placeholder='e.g. XYNE_PM'
          autoFocus
        />
        <p className='text-xs text-muted-foreground mt-1.5'>
          Uppercase letters and underscores only. Spaces become underscores; other characters are
          ignored.
        </p>

        <label
          htmlFor='role-create-description'
          className='block text-xs font-medium text-foreground mt-4 mb-1.5'
        >
          Description <span className='text-muted-foreground font-normal'>(optional)</span>
        </label>
        <Input
          id='role-create-description'
          value={description}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDescription(e.target.value)}
          maxLength={80}
          placeholder='What is this role for?'
        />

        <div className='flex justify-end gap-2 mt-5'>
          <Button
            variant='outline'
            size='sm'
            onClick={() => onOpenChange(false)}
            data-track-category='ROLES'
            data-track-name='CANCEL_CREATE_ROLE'
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            size='sm'
            onClick={() => void handleCreate()}
            data-track-category='ROLES'
            data-track-name='CREATE_ROLE'
            disabled={!canSubmit}
            loading={saving}
          >
            <Plus size={14} /> Create
          </Button>
        </div>
      </div>
    </Dialog>
  );
};

// ─── Member row ──────────────────────────────────────────────────────────────

interface MemberRowProps {
  mapping: UserRoleMapping & {
    readonly user?:
      | { readonly id: string; readonly name?: string | null; readonly email?: string | null }
      | undefined;
  };
  workspaceUsers: Array<{
    id: string;
    name?: string | null;
    email?: string | null;
    displayName?: string | null;
  }>;
  onRemove: (mappingId: string, userId: string) => Promise<void> | void;
  removing: boolean;
}

const MemberRow = ({
  mapping,
  workspaceUsers,
  onRemove,
  removing,
}: MemberRowProps): ReactElement => {
  const userId = mapping.user?.id ?? mapping.userId;
  const displayName = mapping.user
    ? getUserDisplayNameById([mapping.user], userId)
    : getUserDisplayNameById(workspaceUsers, userId);
  const email = mapping.user?.email ?? '';

  return (
    <div className='flex items-center px-4 py-2.5 hover:bg-muted/60 transition-colors border-b border-border last:border-b-0 group'>
      <Avatar userId={userId} size='md' />
      <div className='ml-3 flex-1 min-w-0'>
        <p className='text-sm font-medium text-foreground truncate'>{displayName}</p>
        {email && <p className='text-xs text-muted-foreground truncate'>{email}</p>}
      </div>
      <Button
        size='sm'
        variant='ghost'
        onClick={() => void onRemove(mapping.id, userId)}
        data-track-category='ROLES'
        data-track-name='REMOVE_ROLE_MEMBER'
        disabled={removing}
        className='opacity-0 group-hover:opacity-100 transition-opacity h-7 px-2 text-muted-foreground hover:text-destructive'
      >
        <X size={14} /> Remove
      </Button>
    </div>
  );
};

// ─── Add members dialog ──────────────────────────────────────────────────────

interface AddMembersDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roleId: string;
  roleName: string;
  memberUserIds: ReadonlySet<string>;
  workspaceUsers: Array<{ id: string; name?: string | null; email?: string | null }>;
}

const AddMembersDialog = ({
  open,
  onOpenChange,
  roleId,
  roleName,
  memberUserIds,
  workspaceUsers,
}: AddMembersDialogProps): ReactElement => {
  const zero = useZero();
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setPending(new Set());
    }
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const available = workspaceUsers.filter(u => !memberUserIds.has(u.id));
    if (!q) return available.slice(0, 30);
    return available
      .filter(
        u => (u.name ?? '').toLowerCase().includes(q) || (u.email ?? '').toLowerCase().includes(q),
      )
      .slice(0, 30);
  }, [workspaceUsers, memberUserIds, query]);

  const toggle = (userId: string): void => {
    setPending(prev => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  const handleAdd = async (): Promise<void> => {
    if (pending.size === 0) return;
    setSaving(true);
    try {
      const timestamp = Date.now();
      const userIds = Array.from(pending);
      const mappingIds = Object.fromEntries(userIds.map(userId => [userId, uuidv4()]));
      const result = zero.mutate(
        mutators.role.addMembers({
          roleId,
          userIds,
          mappingIds,
          timestamp,
        }),
      );
      const res = await result.server;
      if (res.type === 'error') {
        toast.error('Failed to add members', {
          description: res.error.message,
          duration: 5000,
        });
        return;
      }
      toast.success(
        `Added ${userIds.length} member${userIds.length === 1 ? '' : 's'} to ${roleName}`,
      );
      onOpenChange(false);
    } catch (err) {
      toast.error('Error', {
        description: err instanceof Error ? err.message : 'Failed to add members',
        duration: 5000,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title='Add members'
      description={`Add users to the "${roleName}" role.`}
      className='max-w-sm'
      focusRef={searchRef}
    >
      <div className='p-5'>
        <h2 className='text-base font-semibold text-foreground mb-1'>Add members</h2>
        <p className='text-xs text-muted-foreground mb-4'>
          Search and select users to add to this role.
        </p>

        <div className='relative mb-3'>
          <Search
            size={14}
            className='absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground'
          />
          <Input
            ref={searchRef}
            value={query}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)}
            placeholder='Search users by name or email'
            className='pl-8 h-8 text-sm'
          />
        </div>

        <div className='max-h-64 overflow-y-auto -mx-1 px-1 space-y-0.5'>
          {filtered.length === 0 ? (
            <p className='text-xs text-muted-foreground text-center py-6'>
              {workspaceUsers.length === 0
                ? 'No users available in this workspace.'
                : 'No users match your search.'}
            </p>
          ) : (
            filtered.map(u => {
              const selected = pending.has(u.id);
              return (
                <button
                  key={u.id}
                  type='button'
                  onClick={() => toggle(u.id)}
                  data-track-category='ROLES'
                  data-track-name='ToggleAddMember'
                  className={cn(
                    'w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md text-left transition-colors',
                    selected ? 'bg-accent' : 'hover:bg-accent/60',
                  )}
                >
                  <Avatar userId={u.id} size='sm' />
                  <div className='flex-1 min-w-0'>
                    <p className='text-sm font-medium text-foreground truncate'>
                      {getUserDisplayNameById([u], u.id)}
                    </p>
                    {u.email && <p className='text-xs text-muted-foreground truncate'>{u.email}</p>}
                  </div>
                  <span
                    className={cn(
                      'w-4 h-4 rounded border flex items-center justify-center shrink-0',
                      selected
                        ? 'bg-primary border-primary text-primary-foreground'
                        : 'border-border',
                    )}
                  >
                    {selected && <Check size={12} />}
                  </span>
                </button>
              );
            })
          )}
        </div>

        <div className='flex justify-end gap-2 mt-5'>
          <Button
            variant='outline'
            size='sm'
            onClick={() => onOpenChange(false)}
            data-track-category='ROLES'
            data-track-name='CANCEL_ADD_MEMBERS'
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            size='sm'
            onClick={() => void handleAdd()}
            data-track-category='ROLES'
            data-track-name='ADD_ROLE_MEMBERS'
            disabled={pending.size === 0 || saving}
            loading={saving}
          >
            <Plus size={14} /> Add {pending.size > 0 ? `(${pending.size})` : ''}
          </Button>
        </div>
      </div>
    </Dialog>
  );
};

// ─── Main screen ─────────────────────────────────────────────────────────────

export const RoleManagementScreen = (): ReactElement => {
  const zero = useZero();
  const workspaceUsers = useUsers() ?? [];

  // ── Paginated roles list ──────────────────────────────────────────────────
  const [cursor, setCursor] = useState<RoleCursor | null>(null);
  const [accumulated, setAccumulated] = useState<Role[]>([]);
  const [hasMore, setHasMore] = useState(true);

  const [rolesPage, rolesPageDetails] = useCachedQuery(
    queries.roles({ limit: PAGE_SIZE, start: cursor }),
  );

  useEffect(() => {
    if (rolesPageDetails.type !== 'complete') return;
    const page = rolesPage ?? [];
    if (page.length === 0) {
      if (cursor === null) setAccumulated([]);
      setHasMore(false);
      return;
    }
    setAccumulated(prev => {
      if (cursor === null) return page;
      const combined = [...prev, ...page];
      return Array.from(new Map(combined.map(r => [r.id, r])).values());
    });
    setHasMore(page.length >= PAGE_SIZE);
  }, [rolesPage, rolesPageDetails, cursor]);

  const loadMore = (): void => {
    if (!hasMore || accumulated.length === 0) return;
    const last = accumulated[accumulated.length - 1];
    if (!last) return;
    setCursor(toRoleCursor(last));
  };

  // ── Selected role + its members ───────────────────────────────────────────
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Auto-select first role once the first page lands.
  useEffect(() => {
    if (selectedId === null && accumulated.length > 0) {
      const first = accumulated[0];
      if (first) setSelectedId(first.id);
    }
  }, [accumulated, selectedId]);

  const [roleResult] = useCachedQuery(queries.roleById({ id: selectedId ?? '' }), {
    enabled: Boolean(selectedId),
  });
  const selectedRole = selectedId ? (roleResult as unknown as RoleWithMappings | null) : null;

  // Fallback to the list entry when roleById hasn't resolved yet.
  const listRole = useMemo(
    () => accumulated.find(r => r.id === selectedId) ?? null,
    [accumulated, selectedId],
  );
  const displayName = selectedRole?.name ?? listRole?.name ?? '';
  const displayDesc = selectedRole?.description ?? listRole?.description ?? null;
  const members = useMemo(() => selectedRole?.userMappings ?? [], [selectedRole]);

  // ── Inline edit (name + description) ───────────────────────────────────────
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [saving, setSaving] = useState(false);
  const editNameRef = useRef<HTMLInputElement>(null);

  const startEdit = (): void => {
    setEditName(displayName);
    setEditDesc(displayDesc ?? '');
    setEditing(true);
    requestAnimationFrame(() => editNameRef.current?.focus());
  };

  const cancelEdit = (): void => setEditing(false);

  const saveEdit = async (): Promise<void> => {
    const cleanedName = cleanRoleName(editName);
    if (!cleanedName || !selectedId) return;
    setSaving(true);
    try {
      const result = zero.mutate(
        mutators.role.update({
          id: selectedId,
          name: cleanedName,
          description: editDesc.trim() || undefined,
          timestamp: Date.now(),
        }),
      );
      const res = await result.server;
      if (res.type === 'error') {
        toast.error('Failed to update role', {
          description: res.error.message,
          duration: 5000,
        });
        return;
      }
      setEditing(false);
      toast.success('Role updated');
    } catch (err) {
      toast.error('Error', {
        description: err instanceof Error ? err.message : 'Failed to update role',
        duration: 5000,
      });
    } finally {
      setSaving(false);
    }
  };

  // ── Create dialog ──────────────────────────────────────────────────────────
  const [showCreate, setShowCreate] = useState(false);

  // ── Add members dialog + remove ────────────────────────────────────────────
  const [showAddMembers, setShowAddMembers] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const handleCreated = (id: string): void => {
    setSelectedId(id);
  };

  const handleSelectRole = (id: string): void => {
    setSelectedId(id);
    setEditing(false);
  };

  const memberUserIds = useMemo(() => new Set(members.map(m => m.userId)), [members]);
  const memberAvatarIds = useMemo(() => members.map(m => m.user?.id ?? m.userId), [members]);

  const handleRemoveMember = async (mappingId: string): Promise<void> => {
    if (!selectedId) return;
    setRemovingId(mappingId);
    try {
      const result = zero.mutate(mutators.role.removeMembers({ mappingIds: [mappingId] }));
      const res = await result.server;
      if (res.type === 'error') {
        toast.error('Failed to remove member', {
          description: res.error.message,
          duration: 5000,
        });
        return;
      }
      toast.success('Member removed');
    } catch (err) {
      toast.error('Error', {
        description: err instanceof Error ? err.message : 'Failed to remove member',
        duration: 5000,
      });
    } finally {
      setRemovingId(null);
    }
  };

  // ── Loading / empty states ─────────────────────────────────────────────────
  const listLoading = rolesPageDetails.type === 'unknown' && accumulated.length === 0;

  return (
    <div
      data-testid='role-management-page'
      data-component='RoleManagementScreen'
      className='h-full relative overflow-hidden'
    >
      <ResizableGroup
        orientation='horizontal'
        className='flex align-top h-full'
        autoSaveId='roles-panel-layout'
      >
        {/* Sidebar — sized in pixels + `preserve-pixel-size` so it keeps its width when
            the group shrinks (Ask AI opening, window resize) instead of scaling. */}
        <Panel
          id='roles-sidebar'
          defaultSize={ROLES_SIDEBAR_DEFAULT_WIDTH}
          minSize={ROLES_SIDEBAR_MIN_WIDTH}
          maxSize={ROLES_SIDEBAR_MAX_WIDTH}
          groupResizeBehavior='preserve-pixel-size'
        >
          <aside className='w-full h-full'>
            <RolesSidebar
              roles={accumulated}
              selectedId={selectedId}
              loading={listLoading}
              hasMore={hasMore}
              onSelect={handleSelectRole}
              onCreate={() => setShowCreate(true)}
              onLoadMore={loadMore}
            />
          </aside>
        </Panel>

        {/* RESIZE HANDLE */}
        <Separator className='w-[2px] transition-colors cursor-col-resize flex items-center justify-center group'>
          <div
            id='panel-resize-divider'
            className='w-[2px] h-full bg-transparent group-hover:bg-primary group-active:bg-primary'
          />
        </Separator>

        <Panel id='roles-main' minSize='30%'>
          <main
            data-id='roles-view'
            className='flex-1 h-full overflow-hidden relative flex flex-col rounded-2xl border border-border bg-background'
          >
            {!selectedId ? (
              <div className='flex-1 flex flex-col items-center justify-center text-center px-6'>
                <Users size={28} className='text-muted-foreground/30 mb-3' />
                <h3 className='text-sm font-semibold text-foreground mb-1'>Select a role</h3>
                <p className='text-xs text-muted-foreground max-w-xs'>
                  Roles are reusable named sets of users you can reference across the workspace.
                  Choose one from the list to view its members, or create a new one.
                </p>
                <Button
                  size='sm'
                  className='mt-4'
                  onClick={() => setShowCreate(true)}
                  data-track-category='ROLES'
                  data-track-name='OPEN_CREATE_ROLE_DIALOG'
                >
                  <Plus size={14} /> New role
                </Button>
              </div>
            ) : (
              <>
                <RoleDetailHeader
                  name={displayName}
                  description={displayDesc}
                  memberUserIds={memberAvatarIds}
                  createdAt={selectedRole?.createdAt ?? listRole?.createdAt}
                  editing={editing}
                  saving={saving}
                  editName={editName}
                  editDesc={editDesc}
                  editNameRef={editNameRef}
                  canSaveEdit={Boolean(cleanRoleName(editName)) && !saving}
                  onEditNameChange={value => setEditName(formatRoleName(value))}
                  onEditDescChange={setEditDesc}
                  onStartEdit={startEdit}
                  onCancelEdit={cancelEdit}
                  onSaveEdit={() => void saveEdit()}
                  onAddUsers={() => setShowAddMembers(true)}
                />

                {/* Members list */}
                <div className='flex-1 overflow-y-auto'>
                  {members.length === 0 ? (
                    <div className='flex flex-col items-center justify-center h-full text-center px-6'>
                      <Users size={24} className='text-muted-foreground/30 mb-2' />
                      <p className='text-sm text-muted-foreground'>No members in this role yet.</p>
                      <Button
                        size='sm'
                        variant='outline'
                        onClick={() => setShowAddMembers(true)}
                        data-track-category='ROLES'
                        data-track-name='OPEN_ADD_MEMBERS_DIALOG'
                        className='mt-3'
                      >
                        <UserPlus size={14} /> Add users
                      </Button>
                    </div>
                  ) : (
                    members.map(m => (
                      <MemberRow
                        key={m.id}
                        mapping={m}
                        workspaceUsers={workspaceUsers}
                        onRemove={handleRemoveMember}
                        removing={removingId !== null}
                      />
                    ))
                  )}
                </div>
              </>
            )}
          </main>
        </Panel>
      </ResizableGroup>

      <CreateRoleDialog open={showCreate} onOpenChange={setShowCreate} onCreated={handleCreated} />
      {selectedId && (
        <AddMembersDialog
          open={showAddMembers}
          onOpenChange={setShowAddMembers}
          roleId={selectedId}
          roleName={displayName}
          memberUserIds={memberUserIds}
          workspaceUsers={workspaceUsers}
        />
      )}
    </div>
  );
};

export default RoleManagementScreen;
