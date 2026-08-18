import { logger, Event as LogEvent } from '../../utils/logger';
import { ReactElement, useEffect, useRef, useState } from 'react';
import {
  Building2,
  Plus,
  X,
  Loader2,
  KeyRound,
  Users,
  ChevronDown,
  ChevronRight,
  UserPlus,
  CheckCircle,
  AlertTriangle,
  Shield,
  User,
  Globe2,
  LockKeyhole,
  UserCheck,
} from 'lucide-react';
import { Button } from '../../components/ui/Button/Button';
import Input from '../../components/ui/Input/Input';
import { useSelf } from '../../hooks/useUsers';
import { useZero } from '../../hooks/useZero';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { queries } from '../../zero/queries';
import { mutators } from '../../zero/mutators';
import Dialog from '../../components/ui/Dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu';
import { toast } from 'sonner';
import { cn } from '../../utils/classNames';
import { getApiErrorMessage } from '../../utils/apiError';
import { v4 as uuidv4 } from 'uuid';
import { OrgRole, WorkspaceJoinPolicy, WorkspaceType } from '@xyne/shared';
import axios from 'axios';
import { API_BASE_URL } from '../../config';
import { usePlatform } from '../../hooks/usePlatform';
import { setLastActiveWorkspaceId, setLastActiveWorkspaceName } from '../../machines/authMachine';
import { apiInstance } from '../../services/clients/apiClient';
import { JoinRequestsSection } from './JoinRequestsSection';

// ─── types ───────────────────────────────────────────────────────────────────

interface OrgMemberRow {
  memberId: string;
  orgId: string;
  email: string;
  role: OrgRole;
  joinedAt: number;
  leftAt?: number | null;
}

type ProvisionWorkspaceEncryptionResponse = {
  ok: boolean;
  results: Array<{
    workspaceId: string;
    ok: boolean;
    keyId?: string;
    message?: string;
  }>;
};

interface CreateWorkspaceResponse {
  user: { id: string; email: string; workspaceId: string };
}

// Zero instance type (return type of useZero)
type ZeroInstance = ReturnType<typeof useZero>;

// ─── Card shell ──────────────────────────────────────────────────────────────

const Card = ({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}): ReactElement => (
  <div className={cn('rounded-lg border border-border bg-card shadow-sm', className)}>
    {children}
  </div>
);

const COMMUNITY_JOIN_POLICY_OPTIONS = [
  {
    value: WorkspaceJoinPolicy.OPEN,
    label: 'Open',
    description: 'Anyone with the community entry point can join.',
    icon: Globe2,
  },
  {
    value: WorkspaceJoinPolicy.REQUEST_TO_JOIN,
    label: 'Request to join',
    description: 'Applicants must be approved by a workspace admin.',
    icon: UserCheck,
  },
  {
    value: WorkspaceJoinPolicy.INVITE_ONLY,
    label: 'Invite only',
    description: 'Only invited users can access this community.',
    icon: LockKeyhole,
  },
] as const;

// ─── Role badge ───────────────────────────────────────────────────────────────

const RoleBadge = ({ role }: { role: OrgRole }): ReactElement => {
  const styles: Record<OrgRole, string> = {
    [OrgRole.OWNER]: 'bg-amber-500/10 text-amber-600',
    [OrgRole.ADMIN]: 'bg-blue-500/10 text-blue-600',
    [OrgRole.MEMBER]: 'bg-muted text-muted-foreground',
    [OrgRole.VIEWER]: 'bg-muted text-muted-foreground',
    [OrgRole.COMMUNITY_MEMBER]: 'bg-muted text-muted-foreground',
    [OrgRole.GUEST]: 'bg-purple-500/10 text-purple-600',
  };
  return (
    <span
      className={cn(
        'text-xs px-2 py-0.5 rounded-full font-medium capitalize',
        styles[role] ?? styles['MEMBER'],
      )}
    >
      {role.toLowerCase()}
    </span>
  );
};

// ─── OrgMembersSection ────────────────────────────────────────────────────────
// Per-org sub-component so each expansion has its own reactive query + local state.

interface OrgMembersSectionProps {
  orgId: string;
  orgCreatedBy: string;
  selfEmail: string | undefined;
  selfId: string | undefined;
  z: ZeroInstance;
}

const OrgMembersSection = ({
  orgId,
  orgCreatedBy,
  selfEmail,
  selfId,
  z,
}: OrgMembersSectionProps): ReactElement => {
  const [members] = useCachedQuery(queries.getOrgMembers({ orgId }), { enabled: true });
  logger.info(LogEvent.INFO, {
    type: 'migrated_console_log',
    message: String('[DEBUG] OrgMembersSection query'),
    context: [{ orgId }],
  });
  logger.info(LogEvent.INFO, {
    type: 'migrated_console_log',
    message: String('[DEBUG] OrgMembersSection render'),
    context: [{ orgId, members }],
  }); // Debug log to trace renders and data

  const [emailInput, setEmailInput] = useState('');
  const [selectedRole, setSelectedRole] = useState<OrgRole>(OrgRole.MEMBER);
  const [isAdding, setIsAdding] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [updatingRoleId, setUpdatingRoleId] = useState<string | null>(null);
  const emailInputRef = useRef<HTMLInputElement>(null);
  const { isMobile } = usePlatform();

  // Determine if the current user can manage this org (matched by email).
  // Fallback: the org creator can always manage (mirrors canInsert ACL bootstrap path).
  const selfMembership = (members as OrgMemberRow[] | undefined)?.find(
    m => m.email.toLowerCase() === (selfEmail ?? '').toLowerCase(),
  );
  const isOrgCreator = !!selfId && selfId === orgCreatedBy;
  const canManage =
    selfMembership?.role === OrgRole.OWNER ||
    selfMembership?.role === OrgRole.ADMIN ||
    isOrgCreator;

  // Count admins/owners for the "last admin" guard, mirroring workspace member management.
  const adminCount = ((members as OrgMemberRow[] | undefined) ?? []).filter(
    m => m.role === OrgRole.ADMIN || m.role === OrgRole.OWNER,
  ).length;

  const canDemote = (member: OrgMemberRow): boolean => {
    if (member.role !== OrgRole.ADMIN && member.role !== OrgRole.OWNER) return true;
    return adminCount > 1;
  };

  useEffect(() => {
    if (!canManage || isMobile) return;
    const rafId = requestAnimationFrame(() => {
      emailInputRef.current?.focus();
    });
    return () => cancelAnimationFrame(rafId);
  }, [canManage, isMobile]);

  const handleAdd = async (): Promise<void> => {
    const email = emailInput.trim().toLowerCase();
    if (!email) {
      toast.error('Please enter an email address');
      return;
    }

    const alreadyMember = (members as OrgMemberRow[] | undefined)?.find(
      m => m.email.toLowerCase() === email,
    );
    if (alreadyMember) {
      toast.error(`${email} is already a member of this organisation`);
      return;
    }

    // If the org creator is bootstrapping themselves (no membership yet), use OWNER role.
    // This mirrors the server-side canInsert ACL bootstrap path.
    const isCreatorBootstrap =
      isOrgCreator && !selfMembership && email === (selfEmail ?? '').toLowerCase();
    const role = isCreatorBootstrap ? OrgRole.OWNER : selectedRole;

    setIsAdding(true);
    try {
      const result = z.mutate(
        mutators.orgMember.add({
          memberId: uuidv4(),
          orgId,
          email,
          role,
          timestamp: Date.now(),
        }),
      );
      const res = await result.server;
      if (res.type === 'error') {
        toast.error(`Failed to add ${email}: ${res.error.message}`);
        return;
      }
      setEmailInput('');
      toast.success(`${email} added to organisation`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : `Failed to add ${email}`);
    } finally {
      setIsAdding(false);
    }
  };

  const handleUpdateRole = async (
    memberId: string,
    newRole: OrgRole.ADMIN | OrgRole.MEMBER,
  ): Promise<void> => {
    setUpdatingRoleId(memberId);
    try {
      const result = z.mutate(
        mutators.orgMember.updateRole({
          memberId,
          updates: { role: newRole },
        }),
      );
      const res = await result.server;
      if (res.type === 'error') {
        toast.error(`Failed to update role: ${res.error.message}`);
        return;
      }
      toast.success(`Role updated to ${newRole.toLowerCase()}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to update role');
    } finally {
      setUpdatingRoleId(null);
    }
  };

  const handleRemove = async (memberId: string, memberEmail: string): Promise<void> => {
    setRemovingId(memberId);
    try {
      const result = z.mutate(
        mutators.orgMember.remove({
          memberId,
          timestamp: Date.now(),
        }),
      );
      const res = await result.server;
      if (res.type === 'error') {
        toast.error(`Failed to remove ${memberEmail}: ${res.error.message}`);
        return;
      }
      toast.success(`${memberEmail} removed from organisation`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : `Failed to remove ${memberEmail}`);
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <div className='border-t border-border'>
      {/* Add member row — only visible to admins/owners */}
      {canManage && (
        <div className='p-4 bg-muted/30 border-b border-border'>
          <p className='text-sm font-medium text-foreground mb-3 flex items-center gap-2'>
            <UserPlus className='w-4 h-4 text-primary' />
            Add Member by Email
          </p>
          <div className='flex gap-2 flex-wrap'>
            <Input
              ref={emailInputRef}
              type='email'
              placeholder='Enter email address...'
              value={emailInput}
              onChange={e => setEmailInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !isAdding) {
                  void handleAdd();
                }
              }}
              className='flex-1 min-w-[200px]'
            />
            <select
              value={selectedRole}
              onChange={e => setSelectedRole(e.target.value as OrgRole)}
              className='px-3 py-2 border border-border rounded-lg bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary min-w-[120px]'
              data-track-category='Organisations'
              data-track-name='SelectOrgMemberRole'
            >
              <option value={OrgRole.MEMBER}>Member</option>
              <option value={OrgRole.GUEST}>Guest</option>
            </select>
            <Button
              onClick={() => void handleAdd()}
              disabled={isAdding || !emailInput.trim()}
              className='gap-2 bg-foreground text-background hover:bg-foreground/90'
              data-track-category='Organisations'
              data-track-name='AddOrgMember'
            >
              {isAdding ? (
                <Loader2 className='w-4 h-4 animate-spin' />
              ) : (
                <Plus className='w-4 h-4' />
              )}
              Add
            </Button>
          </div>
        </div>
      )}

      {/* Members list */}
      {!members || (members as OrgMemberRow[]).length === 0 ? (
        <div className='p-6 text-center text-muted-foreground'>
          <Users className='w-8 h-8 mx-auto mb-2 opacity-50' />
          <p className='text-sm'>No members in this organisation</p>
        </div>
      ) : (
        <div className='divide-y divide-border'>
          {(members as OrgMemberRow[]).map(member => (
            <div
              key={member.memberId}
              className='flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors'
            >
              <div className='flex items-center gap-3'>
                {/* Avatar initials circle */}
                <div className='w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0'>
                  <span className='text-xs font-semibold text-primary'>
                    {member.email[0]?.toUpperCase()}
                  </span>
                </div>
                <div>
                  <p className='text-sm font-medium text-foreground'>{member.email}</p>
                </div>
                <RoleBadge role={member.role} />
              </div>

              {/* Actions — admins/owners can change roles / remove anyone except themselves */}
              {canManage && member.email.toLowerCase() !== (selfEmail ?? '').toLowerCase() && (
                <div className='flex items-center gap-2'>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant='outline'
                        size='sm'
                        disabled={updatingRoleId === member.memberId}
                        className='gap-1'
                        data-track-category='Organisations'
                        data-track-name='OpenOrgMemberRoleMenu'
                      >
                        {updatingRoleId === member.memberId ? (
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
                      {member.role !== OrgRole.ADMIN && (
                        <DropdownMenuItem
                          onClick={() => void handleUpdateRole(member.memberId, OrgRole.ADMIN)}
                          data-track-category='Organisations'
                          data-track-name='SetOrgMemberAdmin'
                        >
                          <Shield className='w-4 h-4 mr-2' />
                          Admin
                        </DropdownMenuItem>
                      )}
                      {member.role !== OrgRole.MEMBER && (
                        <DropdownMenuItem
                          onClick={() => void handleUpdateRole(member.memberId, OrgRole.MEMBER)}
                          disabled={!canDemote(member)}
                          data-track-category='Organisations'
                          data-track-name='SetOrgMemberMember'
                        >
                          <User className='w-4 h-4 mr-2' />
                          Member
                          {!canDemote(member) && (
                            <span className='ml-2 text-xs text-muted-foreground'>(Last admin)</span>
                          )}
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>

                  <Button
                    variant='ghost'
                    size='sm'
                    onClick={() => void handleRemove(member.memberId, member.email)}
                    disabled={removingId === member.memberId || !canDemote(member)}
                    className='text-destructive hover:text-destructive hover:bg-destructive/10'
                    data-track-category='Organisations'
                    data-track-name='RemoveOrgMember'
                  >
                    {removingId === member.memberId ? (
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
    </div>
  );
};

// ─── Main screen ─────────────────────────────────────────────────────────────

export const OrganisationsScreen = (): ReactElement => {
  const self = useSelf();
  const z = useZero();
  const workspaceId = self?.workspaceId ?? '';

  const [workspace] = useCachedQuery(queries.getWorkspaceById({ workspaceId }), {
    enabled: !!workspaceId,
  });

  const workspaceOrgId = workspace?.orgId ?? '';

  const [selfOrgMember] = useCachedQuery(
    queries.getOrgMemberById({ memberId: self?.orgMemberId ?? '' }),
    { enabled: !!self?.orgMemberId },
  );

  const orgMismatch =
    !!workspaceOrgId &&
    !!selfOrgMember &&
    (selfOrgMember as unknown as { orgId: string }).orgId !== workspaceOrgId;

  const [linkedOrgs] = useCachedQuery(queries.workspaceOrganizations({ workspaceId }), {
    enabled: !!workspaceId && !orgMismatch,
  });

  const [expandedOrgId, setExpandedOrgId] = useState<string | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newOrgName, setNewOrgName] = useState('');
  const [newWorkspaceName, setNewWorkspaceName] = useState('');
  const [newOwnerEmail, setNewOwnerEmail] = useState('');
  const [isCreatingOrg, setIsCreatingOrg] = useState(false);
  const [isProvisioningEncryption, setIsProvisioningEncryption] = useState(false);
  const [communityWorkspaceName, setCommunityWorkspaceName] = useState('');
  const [communityJoinPolicy, setCommunityJoinPolicy] = useState<
    (typeof WorkspaceJoinPolicy)[keyof typeof WorkspaceJoinPolicy]
  >(WorkspaceJoinPolicy.OPEN);
  const [isCreatingCommunityWorkspace, setIsCreatingCommunityWorkspace] = useState(false);
  const orgNameInputRef = useRef<HTMLInputElement>(null);
  const { isMobile } = usePlatform();

  const selfOrgRole = (selfOrgMember as unknown as { role?: string } | undefined)?.role;
  const canCreateCommunityWorkspace =
    selfOrgRole === OrgRole.OWNER || selfOrgRole === OrgRole.ADMIN;

  const handleToggleExpand = (orgId: string): void => {
    setExpandedOrgId(prev => (prev === orgId ? null : orgId));
  };

  const handleCreateOrg = async (): Promise<void> => {
    if (!newOrgName.trim()) {
      toast.error('Organisation name is required');
      return;
    }
    if (!newWorkspaceName.trim()) {
      toast.error('Workspace name is required');
      return;
    }
    if (!newOwnerEmail.trim()) {
      toast.error('Owner email is required');
      return;
    }

    setIsCreatingOrg(true);
    try {
      await axios.post(
        `${API_BASE_URL}/invitations/provision-org`,
        {
          orgName: newOrgName.trim(),
          workspaceName: newWorkspaceName.trim(),
          ownerEmail: newOwnerEmail.trim().toLowerCase(),
        },
        { withCredentials: true },
      );
      toast.success(`Organisation created and invitation sent to ${newOwnerEmail.trim()}`);
      setNewOrgName('');
      setNewWorkspaceName('');
      setNewOwnerEmail('');
      setShowCreateDialog(false);
    } catch (error) {
      if (axios.isAxiosError<{ error?: string }>(error)) {
        toast.error(error.response?.data?.error ?? 'Failed to create organisation');
      } else {
        toast.error('Failed to create organisation');
      }
    } finally {
      setIsCreatingOrg(false);
    }
  };

  const handleCreateCommunityWorkspace = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();

    if (!communityWorkspaceName.trim()) {
      toast.error('Community workspace name is required');
      return;
    }

    setIsCreatingCommunityWorkspace(true);
    try {
      const response = await axios.post<CreateWorkspaceResponse>(
        `${API_BASE_URL}/auth/create-workspace`,
        {
          workspaceName: communityWorkspaceName.trim(),
          workspaceType: WorkspaceType.COMMUNITY,
          joinPolicy: communityJoinPolicy,
        },
        { withCredentials: true },
      );

      const email = response.data.user.email;
      const newWorkspaceId = response.data.user.workspaceId;
      if (email) {
        setLastActiveWorkspaceId(email, newWorkspaceId);
        setLastActiveWorkspaceName(email, communityWorkspaceName.trim());
      }
      localStorage.setItem('user_id', response.data.user.id);
      toast.success('Community workspace created');
      window.location.href = `/${newWorkspaceId}`;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const message = (error.response?.data as { message?: string } | undefined)?.message;
        toast.error(message ?? 'Failed to create community workspace');
        return;
      }
      toast.error('Failed to create community workspace');
    } finally {
      setIsCreatingCommunityWorkspace(false);
    }
  };

  const handleProvisionEncryption = async (): Promise<void> => {
    setIsProvisioningEncryption(true);
    try {
      const response = await apiInstance.post<ProvisionWorkspaceEncryptionResponse>(
        '/encryption/workspaces/backfill-provision',
      );
      const succeeded = response.data.results.filter(result => result.ok).length;
      const failed = response.data.results.length - succeeded;

      if (response.data.results.length === 0) {
        toast.success('No workspaces found');
      } else if (failed > 0) {
        toast.error(
          `Provisioned encryption for ${succeeded}/${response.data.results.length} workspaces`,
        );
      } else {
        toast.success(`Provisioned encryption for ${succeeded} workspaces`);
      }
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Failed to provision workspace encryption'));
    } finally {
      setIsProvisioningEncryption(false);
    }
  };

  return (
    <div
      data-testid='organisations-page'
      className='h-full bg-muted flex flex-col md:rounded-2xl overflow-hidden shadow-[0_0_8px_0_rgba(0,0,0,0.15)] border-root-border border'
    >
      {/* ── Org mismatch guard ── */}
      {orgMismatch ? (
        <div className='flex-1 flex items-center justify-center p-8'>
          <div className='max-w-md w-full rounded-xl border border-border bg-card shadow-sm p-8 flex flex-col items-center gap-4 text-center'>
            <div className='w-14 h-14 rounded-full bg-destructive/10 flex items-center justify-center'>
              <AlertTriangle className='w-7 h-7 text-destructive' />
            </div>
            <div>
              <h2 className='text-lg font-semibold text-foreground'>Cannot Manage Organisation</h2>
              <p className='mt-2 text-sm text-muted-foreground'>
                You cannot manage organisation from this workspace.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className='flex-1 overflow-y-auto p-6'>
            <div className='max-w-4xl mx-auto space-y-6'>
              {/* ── Header + Create button ── */}
              <div className='flex items-start justify-between gap-4'>
                <div className='flex items-center gap-3'>
                  <Building2 className='w-8 h-8 text-primary shrink-0' />
                  <div>
                    <h1 className='text-2xl font-semibold text-foreground'>Organisations</h1>
                    <p className='text-muted-foreground'>Manage organisations and their members</p>
                  </div>
                </div>
                <div className='flex items-center gap-2 shrink-0'>
                  <Button
                    onClick={() => void handleProvisionEncryption()}
                    disabled={isProvisioningEncryption}
                    variant='outline'
                    className='gap-2'
                    data-track-category='Organisations'
                    data-track-name='ProvisionOrgEncryption'
                  >
                    {isProvisioningEncryption ? (
                      <Loader2 className='w-4 h-4 animate-spin' />
                    ) : (
                      <KeyRound className='w-4 h-4' />
                    )}
                    {isProvisioningEncryption
                      ? 'Provisioning...'
                      : 'Provision workspace encryption'}
                  </Button>
                  <Button
                    variant='outline'
                    className='gap-2 shrink-0'
                    onClick={() => setShowCreateDialog(true)}
                    data-track-category='Organisations'
                    data-track-name='OpenCreateOrgDialog'
                  >
                    <Plus className='w-4 h-4' />
                    Create New Org
                  </Button>
                </div>
              </div>

              {canCreateCommunityWorkspace ? (
                <Card className='p-6'>
                  <div className='mb-5 flex items-start gap-3'>
                    <div className='flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50'>
                      <Globe2 className='h-5 w-5 text-emerald-700' />
                    </div>
                    <div>
                      <h2 className='text-sm font-medium text-foreground'>
                        Create Community Workspace
                      </h2>
                      <p className='mt-1 text-sm text-muted-foreground'>
                        Community workspaces are created under your organisation.
                      </p>
                    </div>
                  </div>

                  <form
                    className='space-y-5'
                    onSubmit={event => void handleCreateCommunityWorkspace(event)}
                  >
                    <div className='space-y-2'>
                      <label
                        htmlFor='community-workspace-name'
                        className='text-sm font-medium text-foreground'
                      >
                        Workspace Name <span className='text-destructive'>*</span>
                      </label>
                      <Input
                        id='community-workspace-name'
                        value={communityWorkspaceName}
                        onChange={event => setCommunityWorkspaceName(event.target.value)}
                        placeholder='Enter community workspace name...'
                        disabled={isCreatingCommunityWorkspace}
                      />
                    </div>

                    <div className='space-y-3'>
                      <p className='text-sm font-medium text-foreground'>Joining Policy</p>
                      <div className='grid gap-3 md:grid-cols-3'>
                        {COMMUNITY_JOIN_POLICY_OPTIONS.map(option => {
                          const Icon = option.icon;
                          const isSelected = communityJoinPolicy === option.value;

                          return (
                            <button
                              key={option.value}
                              type='button'
                              disabled={isCreatingCommunityWorkspace}
                              onClick={() => setCommunityJoinPolicy(option.value)}
                              className={cn(
                                'flex min-h-[112px] flex-col items-start gap-2 rounded-lg border p-4 text-left transition',
                                isSelected
                                  ? 'border-primary bg-primary/5 text-foreground'
                                  : 'border-border bg-background hover:border-primary/50 hover:bg-muted/50',
                                'disabled:cursor-not-allowed disabled:opacity-60',
                              )}
                              data-track-category='Organisations'
                              data-track-name='SelectCommunityJoinPolicy'
                              data-track-metadata={JSON.stringify({ joinPolicy: option.value })}
                            >
                              <span
                                className={cn(
                                  'flex h-8 w-8 items-center justify-center rounded-md',
                                  isSelected
                                    ? 'bg-primary text-primary-foreground'
                                    : 'bg-muted text-muted-foreground',
                                )}
                              >
                                <Icon className='h-4 w-4' />
                              </span>
                              <span className='text-sm font-semibold'>{option.label}</span>
                              <span className='text-xs leading-5 text-muted-foreground'>
                                {option.description}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className='flex justify-end'>
                      <Button
                        type='submit'
                        disabled={!communityWorkspaceName.trim() || isCreatingCommunityWorkspace}
                        className='gap-2'
                        data-track-category='Organisations'
                        data-track-name='CreateCommunityWorkspace'
                      >
                        {isCreatingCommunityWorkspace ? (
                          <Loader2 className='h-4 w-4 animate-spin' />
                        ) : (
                          <Plus className='h-4 w-4' />
                        )}
                        {isCreatingCommunityWorkspace
                          ? 'Creating...'
                          : 'Create Community Workspace'}
                      </Button>
                    </div>
                  </form>
                </Card>
              ) : null}

              {canCreateCommunityWorkspace ? <JoinRequestsSection orgId={workspaceOrgId} /> : null}

              {/* ── Linked orgs accordion list ── */}
              <Card>
                {!linkedOrgs || linkedOrgs.length === 0 ? (
                  <div className='p-8 text-center text-muted-foreground'>
                    <Building2 className='w-12 h-12 mx-auto mb-3 opacity-50' />
                    <p>No organisations linked</p>
                    <p className='text-sm mt-1'>Create a new organisation to get started</p>
                  </div>
                ) : (
                  <div className='divide-y divide-border'>
                    {linkedOrgs.map(linkedOrg => {
                      const org = linkedOrg.organization;
                      if (!org) return null;
                      const isExpanded = expandedOrgId === org.orgId;

                      return (
                        <div key={linkedOrg.id}>
                          {/* Org header row — click to expand */}
                          <button
                            type='button'
                            className='w-full flex items-center justify-between p-4 hover:bg-muted/50 transition-colors text-left'
                            onClick={() => handleToggleExpand(org.orgId)}
                            data-track-category='Organisations'
                            data-track-name='ToggleOrgExpand'
                            data-track-metadata={JSON.stringify({ orgId: org.orgId })}
                          >
                            <div className='flex items-center gap-3'>
                              <div className='w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0'>
                                <Building2 className='w-5 h-5 text-primary' />
                              </div>
                              <div>
                                <p className='font-medium text-foreground'>{org.name}</p>
                                {org.description && (
                                  <p className='text-sm text-muted-foreground'>{org.description}</p>
                                )}
                                <p className='text-xs text-muted-foreground mt-0.5'>
                                  Linked {new Date(linkedOrg.createdAt).toLocaleDateString()}
                                </p>
                              </div>
                            </div>
                            {isExpanded ? (
                              <ChevronDown className='w-4 h-4 text-muted-foreground shrink-0' />
                            ) : (
                              <ChevronRight className='w-4 h-4 text-muted-foreground shrink-0' />
                            )}
                          </button>

                          {/* Expanded members section */}
                          {isExpanded && (
                            <OrgMembersSection
                              orgId={org.orgId}
                              orgCreatedBy={org.createdBy}
                              selfEmail={self?.email}
                              selfId={self?.id}
                              z={z}
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </Card>

              {/* ── Info card ── */}
              <Card className='p-6 bg-muted/50 border-dashed'>
                <div className='flex items-start gap-3'>
                  <CheckCircle className='w-5 h-5 text-primary mt-0.5 shrink-0' />
                  <div>
                    <h3 className='font-medium text-foreground'>About Organisations</h3>
                    <ul className='mt-2 text-sm text-muted-foreground space-y-1 list-disc list-inside'>
                      <li>Organisations group users across one or more workspaces</li>
                      <li>A user can only belong to one organisation at a time</li>
                      <li>Only org admins and owners can add or remove members</li>
                      <li>
                        Removing a member from an org does not remove them from this workspace
                      </li>
                    </ul>
                  </div>
                </div>
              </Card>
            </div>
          </div>

          {/* ── Create Organisation Dialog ── */}
          <Dialog
            open={showCreateDialog}
            onOpenChange={setShowCreateDialog}
            className='max-w-md rounded-xl'
            {...(!isMobile ? { focusRef: orgNameInputRef } : {})}
          >
            <div className='p-6 space-y-4'>
              {/* Dialog header */}
              <div className='flex items-center justify-between'>
                <div>
                  <h2 className='text-lg font-semibold text-foreground'>Create Organisation</h2>
                  <p className='text-sm text-muted-foreground mt-1'>
                    An invitation will be sent to the owner&apos;s email
                  </p>
                </div>
                <Button
                  variant='ghost'
                  size='sm'
                  onClick={() => setShowCreateDialog(false)}
                  className='size-7 p-0 text-muted-foreground hover:text-foreground rounded-lg border border-border hover:bg-muted'
                  disabled={isCreatingOrg}
                  data-track-category='Organisations'
                  data-track-name='CloseCreateOrgDialog'
                >
                  <X className='size-4' />
                </Button>
              </div>

              {/* Organisation Name field */}
              <div className='space-y-2'>
                <label htmlFor='org-name' className='text-sm font-medium text-foreground'>
                  Organisation Name <span className='text-destructive'>*</span>
                </label>
                <Input
                  ref={orgNameInputRef}
                  id='org-name'
                  type='text'
                  placeholder='Enter organisation name...'
                  value={newOrgName}
                  onChange={e => setNewOrgName(e.target.value)}
                  disabled={isCreatingOrg}
                />
              </div>

              {/* Workspace Name field */}
              <div className='space-y-2'>
                <label htmlFor='workspace-name' className='text-sm font-medium text-foreground'>
                  Workspace Name <span className='text-destructive'>*</span>
                </label>
                <Input
                  id='workspace-name'
                  type='text'
                  placeholder='Enter workspace name...'
                  value={newWorkspaceName}
                  onChange={e => setNewWorkspaceName(e.target.value)}
                  disabled={isCreatingOrg}
                />
              </div>

              {/* Owner Email field */}
              <div className='space-y-2'>
                <label htmlFor='owner-email' className='text-sm font-medium text-foreground'>
                  Owner Email <span className='text-destructive'>*</span>
                </label>
                <Input
                  id='owner-email'
                  type='email'
                  placeholder='owner@example.com'
                  value={newOwnerEmail}
                  onChange={e => setNewOwnerEmail(e.target.value)}
                  disabled={isCreatingOrg}
                />
              </div>

              {/* Actions */}
              <div className='flex gap-3 justify-end pt-2'>
                <Button
                  variant='outline'
                  disabled={isCreatingOrg}
                  onClick={() => setShowCreateDialog(false)}
                  size='sm'
                  data-track-category='Organisations'
                  data-track-name='CancelCreateOrg'
                >
                  Cancel
                </Button>
                <Button
                  onClick={() => void handleCreateOrg()}
                  disabled={
                    !newOrgName.trim() ||
                    !newWorkspaceName.trim() ||
                    !newOwnerEmail.trim() ||
                    isCreatingOrg
                  }
                  className='gap-2'
                  size='sm'
                  data-track-category='Organisations'
                  data-track-name='ConfirmCreateOrg'
                >
                  {isCreatingOrg ? (
                    <>
                      <Loader2 className='size-4 animate-spin' />
                      Creating...
                    </>
                  ) : (
                    <>
                      <Plus className='size-4' />
                      Create
                    </>
                  )}
                </Button>
              </div>
            </div>
          </Dialog>
        </>
      )}
    </div>
  );
};

export default OrganisationsScreen;
