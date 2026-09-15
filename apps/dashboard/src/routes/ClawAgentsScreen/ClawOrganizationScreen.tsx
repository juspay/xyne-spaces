import { ReactElement, useState } from 'react';
import { Building2, Trash2, UserPlus, Users } from 'lucide-react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/ClawAgents/ConfirmDialog';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/Select';
import { Skeleton } from '@/components/ui/Skeleton';
import {
  useAddClawOrganizationMember,
  useClawOrganization,
  useRemoveClawOrganizationMember,
  useUpdateClawOrganizationMemberRole,
} from '@/hooks/useClawOrganization';
import type { AddableOrgRole, OrgMemberRow, OrgRole } from '@/services/claw/clawOrgTypes';
import { clawErrorText } from '@/services/claw/clawRequest';
import { cn } from '@/utils/classNames';

const roleClassName: Record<OrgRole, string> = {
  OWNER: 'border-blue-500/25 bg-blue-500/10 text-blue-700 dark:text-blue-300',
  ADMIN: 'border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  MEMBER: 'border-border bg-muted text-muted-foreground',
};

const displayDate = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(date);
};

const RoleBadge = ({ role }: { role: OrgRole }): ReactElement => (
  <Badge variant='outline' className={cn('border', roleClassName[role])}>
    {role}
  </Badge>
);

const ClawOrganizationScreen = (): ReactElement => {
  const { data: organization, isLoading, error, refetch } = useClawOrganization();
  const orgId = organization?.detail.id ?? '';
  const addMember = useAddClawOrganizationMember(orgId);
  const updateRole = useUpdateClawOrganizationMemberRole(orgId);
  const removeMember = useRemoveClawOrganizationMember(orgId);
  const [newMember, setNewMember] = useState('');
  const [newRole, setNewRole] = useState<AddableOrgRole>('MEMBER');
  const [removeTarget, setRemoveTarget] = useState<OrgMemberRow | null>(null);

  const myRole = organization?.summary.role;
  const canManage = myRole === 'OWNER' || myRole === 'ADMIN';
  const isOwner = myRole === 'OWNER';

  const submitMember = async (): Promise<void> => {
    const userIdOrEmail = newMember.trim();
    if (!userIdOrEmail || !canManage) return;
    try {
      await addMember.mutateAsync({ userIdOrEmail, role: newRole });
      setNewMember('');
      setNewRole('MEMBER');
      toast.success(`${userIdOrEmail} added`);
    } catch (reason) {
      toast.error(clawErrorText(reason, 'Failed to add member'));
    }
  };

  const changeRole = async (member: OrgMemberRow, role: OrgRole): Promise<void> => {
    if (!canManage || member.role === role) return;
    try {
      await updateRole.mutateAsync({ targetUserId: member.userId, role });
      toast.success(`${member.name || member.email} is now ${role.toLowerCase()}`);
    } catch (reason) {
      toast.error(clawErrorText(reason, 'Failed to change member role'));
    }
  };

  const confirmRemove = async (): Promise<void> => {
    if (!removeTarget || !canManage) return;
    try {
      await removeMember.mutateAsync(removeTarget.userId);
      toast.success(`${removeTarget.name || removeTarget.email} removed`);
      setRemoveTarget(null);
    } catch (reason) {
      toast.error(clawErrorText(reason, 'Failed to remove member'));
    }
  };

  if (isLoading) {
    return (
      <div className='mx-auto flex w-full max-w-5xl flex-col gap-5 px-6 py-8'>
        <Skeleton className='h-20 w-full' />
        <Skeleton className='h-32 w-full' />
        <Skeleton className='h-72 w-full' />
      </div>
    );
  }

  if (error) {
    return (
      <div className='mx-auto flex max-w-lg flex-col items-center gap-3 px-6 py-24 text-center'>
        <Building2 className='size-9 text-muted-foreground' />
        <div>
          <h1 className='text-base font-semibold text-foreground'>Organization unavailable</h1>
          <p className='mt-1 text-sm text-muted-foreground'>{error.message}</p>
        </div>
        <Button
          variant='outline'
          size='sm'
          onClick={() => void refetch()}
          data-track-category='Claw Agents'
          data-track-name='RELOAD_ORGANIZATION'
        >
          Try again
        </Button>
      </div>
    );
  }

  if (!organization) {
    return (
      <div className='mx-auto flex max-w-lg flex-col items-center gap-3 px-6 py-24 text-center'>
        <Building2 className='size-9 text-muted-foreground' />
        <div>
          <h1 className='text-base font-semibold text-foreground'>No organization yet</h1>
          <p className='mt-1 text-sm text-muted-foreground'>
            You are not currently a member of a Claw organization.
          </p>
        </div>
      </div>
    );
  }

  const { detail } = organization;

  return (
    <div className='mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-6'>
      <header className='flex flex-wrap items-start justify-between gap-4'>
        <div className='flex min-w-0 items-start gap-3'>
          <div className='mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl border border-border bg-muted/50'>
            <Building2 className='size-5 text-muted-foreground' />
          </div>
          <div className='min-w-0'>
            <div className='flex flex-wrap items-center gap-2'>
              <h1 className='truncate text-xl font-semibold text-foreground'>{detail.name}</h1>
              <Badge variant={detail.status.toLowerCase() === 'active' ? 'success' : 'outline'}>
                {detail.status}
              </Badge>
              <RoleBadge role={myRole!} />
            </div>
            <p className='mt-1 text-sm text-muted-foreground'>
              {detail.description || 'Manage your organization and its members.'}
            </p>
            <p className='mt-1 text-xs text-muted-foreground'>
              Created {displayDate(detail.createdAt)}
            </p>
          </div>
        </div>
      </header>

      {canManage && (
        <section className='rounded-xl border border-border bg-card p-4'>
          <div className='mb-4 flex items-center gap-2'>
            <UserPlus className='size-4 text-muted-foreground' />
            <div>
              <h2 className='text-sm font-semibold text-foreground'>Add member</h2>
              <p className='text-xs text-muted-foreground'>
                The user must already have signed in to Claw.
              </p>
            </div>
          </div>
          <div className='flex flex-col gap-3 sm:flex-row sm:items-end'>
            <div className='flex min-w-0 flex-1 flex-col gap-1.5'>
              <label htmlFor='claw-org-new-member' className='text-xs font-medium text-foreground'>
                User email or ID
              </label>
              <Input
                id='claw-org-new-member'
                value={newMember}
                onChange={event => setNewMember(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter') void submitMember();
                }}
                placeholder='jane@example.com'
                disabled={addMember.isPending}
              />
            </div>
            <div className='flex flex-col gap-1.5 sm:w-36'>
              <label htmlFor='claw-org-new-role' className='text-xs font-medium text-foreground'>
                Role
              </label>
              <Select
                value={newRole}
                onValueChange={value => setNewRole(value as AddableOrgRole)}
                disabled={addMember.isPending}
              >
                <SelectTrigger id='claw-org-new-role' className='w-full'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='MEMBER'>Member</SelectItem>
                  <SelectItem value='ADMIN'>Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button
              size='sm'
              loading={addMember.isPending}
              disabled={!newMember.trim()}
              onClick={() => void submitMember()}
              data-track-category='Claw Agents'
              data-track-name='ADD_ORGANIZATION_MEMBER'
            >
              Add member
            </Button>
          </div>
        </section>
      )}

      <section className='min-w-0'>
        <div className='mb-3 flex items-center justify-between gap-3'>
          <div className='flex items-center gap-2'>
            <Users className='size-4 text-muted-foreground' />
            <h2 className='text-sm font-semibold text-foreground'>Members</h2>
            <Badge variant='secondary'>{detail.members.length}</Badge>
          </div>
          {!canManage && <span className='text-xs text-muted-foreground'>Read-only access</span>}
        </div>

        {detail.members.length === 0 ? (
          <div className='rounded-xl border border-dashed border-border px-6 py-12 text-center text-sm text-muted-foreground'>
            This organization has no active members.
          </div>
        ) : (
          <div className='overflow-x-auto rounded-xl border border-border bg-card'>
            <table className='w-full min-w-[680px] text-left'>
              <thead className='border-b border-border bg-muted/30 text-xs text-muted-foreground'>
                <tr>
                  <th className='px-4 py-3 font-medium'>Member</th>
                  <th className='px-4 py-3 font-medium'>Joined</th>
                  <th className='px-4 py-3 font-medium'>Role</th>
                  {canManage && (
                    <th className='w-12 px-4 py-3'>
                      <span className='sr-only'>Actions</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody className='divide-y divide-border'>
                {detail.members.map(member => {
                  const canChangeRole = canManage && (isOwner || member.role !== 'OWNER');
                  const changingThisMember =
                    updateRole.isPending && updateRole.variables?.targetUserId === member.userId;
                  return (
                    <tr key={member.userId} className='text-sm'>
                      <td className='px-4 py-3'>
                        <p className='font-medium text-foreground'>{member.name || member.email}</p>
                        <p className='text-xs text-muted-foreground'>{member.email}</p>
                      </td>
                      <td className='px-4 py-3 text-xs text-muted-foreground'>
                        {displayDate(member.joinedAt)}
                      </td>
                      <td className='px-4 py-3'>
                        <div className='flex items-center gap-2'>
                          <RoleBadge role={member.role} />
                          {canChangeRole && (
                            <Select
                              value={member.role}
                              onValueChange={value => void changeRole(member, value as OrgRole)}
                              disabled={changingThisMember}
                            >
                              <SelectTrigger size='sm' className='w-28 bg-background'>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {isOwner && <SelectItem value='OWNER'>Owner</SelectItem>}
                                <SelectItem value='ADMIN'>Admin</SelectItem>
                                <SelectItem value='MEMBER'>Member</SelectItem>
                              </SelectContent>
                            </Select>
                          )}
                        </div>
                      </td>
                      {canManage && (
                        <td className='px-4 py-3 text-right'>
                          <Button
                            type='button'
                            variant='ghost'
                            size='iconSm'
                            aria-label={`Remove ${member.email}`}
                            onClick={() => setRemoveTarget(member)}
                            data-track-category='Claw Agents'
                            data-track-name='OPEN_REMOVE_MEMBER_CONFIRM'
                          >
                            <Trash2 className='size-4 text-muted-foreground' />
                          </Button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <ConfirmDialog
        open={removeTarget !== null}
        onOpenChange={open => {
          if (!open && !removeMember.isPending) setRemoveTarget(null);
        }}
        title='Remove member'
        description={
          removeTarget
            ? `Remove ${removeTarget.name || removeTarget.email} from ${detail.name}?`
            : undefined
        }
        confirmLabel='Remove'
        danger
        loading={removeMember.isPending}
        onConfirm={() => void confirmRemove()}
      />
    </div>
  );
};

export default ClawOrganizationScreen;
