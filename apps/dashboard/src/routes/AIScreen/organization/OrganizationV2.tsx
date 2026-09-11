import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Crown, Loader2, ShieldCheck, UserRound } from 'lucide-react';
import { DeleteDustbin01, PlusDefault, BuildingApartmentTwo } from '@xyne/icons';
import Avatar from '@/components/ui/Avatar/Avatar';
import { Button } from '@/components/ui/Button/index';
import { Skeleton } from '@/components/ui/Skeleton';
import { Tabs } from '@/components/ui/Tabs';
import Tooltip from '@/components/ui/Tooltip';
import { ConfirmDialog } from '@/components/ClawAgents/ConfirmDialog';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import {
  useAddClawOrganizationMember,
  useClawOrganizationMembers,
  useClawOrganizationSummary,
  useRemoveClawOrganizationMember,
  useUpdateClawOrganizationMemberRole,
} from '@/hooks/useClawOrganization';
import { clawErrorText } from '@/services/claw/clawRequest';
import type { ClawUser } from '@/services/claw/clawAuthAgentTypes';
import type { AddableOrgRole, OrgMemberRow, OrgRole } from '@/services/claw/clawOrgTypes';
import { Pill } from '../library/shared/primitives/Pill';
import { BehaviourSelect } from '../library/agents/detail/behaviour/BehaviourRows';
import { AdminPager } from '../library/admin/components/AdminTable';
import { AdminSearchField } from '../library/admin/components/AdminSearchField';
import { DetailCard, DetailEmptyState } from '../library/shared/primitives/DetailPrimitives';
import { PersonPill } from '../library/shared/primitives/PersonPill';
import { AddOrgMemberDialog } from './components/AddOrgMemberDialog';
import { OrganizationSurfacesSection } from './components/OrganizationSurfacesSection';
import { OrganizationServiceTokensSection } from './components/OrganizationServiceTokensSection';
import { ADDABLE_ROLE_OPTIONS, isOrgRole, OWNER_ROLE_OPTION, orgRoleLabel } from './orgRoles';
import {
  ORGANIZATION_TABS,
  resolveOrganizationTab,
  type OrganizationTabId,
} from './organizationTabs';

const PAGE_SIZE = 50;

const roleIcon = (role: OrgRole): ReactElement => {
  const className = 'size-4 text-current';
  if (role === 'OWNER') return <Crown className={className} aria-hidden />;
  if (role === 'ADMIN') return <ShieldCheck className={className} aria-hidden />;
  return <UserRound className={className} aria-hidden />;
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

const OrganizationV2 = (): ReactElement => {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = resolveOrganizationTab(searchParams.get('tab'));
  const query = searchParams.get('q') ?? '';
  const debouncedQuery = useDebouncedValue(query.trim(), 300);

  const [offset, setOffset] = useState(0);
  const [addOpen, setAddOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<OrgMemberRow | null>(null);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const org = useClawOrganizationSummary();
  const summary = org.data ?? null;
  const orgId = summary?.id ?? '';
  const myRole = summary?.role;
  const canManage = myRole === 'OWNER' || myRole === 'ADMIN';
  const isOwner = myRole === 'OWNER';

  const members = useClawOrganizationMembers(orgId, {
    q: debouncedQuery,
    limit: PAGE_SIZE,
    offset,
  });
  const rows = useMemo(() => members.data?.rows ?? [], [members.data]);
  const total = members.data?.total ?? 0;

  const addMember = useAddClawOrganizationMember(orgId);
  const updateRole = useUpdateClawOrganizationMemberRole(orgId);
  const removeMember = useRemoveClawOrganizationMember(orgId);

  useEffect(() => {
    setOffset(0);
  }, [debouncedQuery]);

  const setQuery = (value: string): void => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set('q', value);
    else next.delete('q');
    setSearchParams(next, { replace: true });
  };

  const setActiveTab = (nextTab: OrganizationTabId): void => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', nextTab);
    next.delete('q');
    setOffset(0);
    setSearchParams(next, { replace: true });
  };

  const roleOptions = useMemo(
    () =>
      (isOwner ? [OWNER_ROLE_OPTION, ...ADDABLE_ROLE_OPTIONS] : ADDABLE_ROLE_OPTIONS).map(
        option => ({ ...option, icon: roleIcon(option.value) }),
      ),
    [isOwner],
  );

  const changeRole = async (member: OrgMemberRow, role: OrgRole): Promise<void> => {
    if (!canManage || member.role === role || busyUserId) return;
    setBusyUserId(member.userId);
    try {
      await updateRole.mutateAsync({ targetUserId: member.userId, role });
      toast.success(`${member.name || member.email} is now ${role.toLowerCase()}`);
    } catch (reason) {
      toast.error(clawErrorText(reason, 'Failed to change member role'));
    } finally {
      setBusyUserId(null);
    }
  };

  const submitMembers = async (targets: ClawUser[], role: AddableOrgRole): Promise<void> => {
    if (!canManage || targets.length === 0) return;
    setAdding(true);
    const failed: string[] = [];
    for (const target of targets) {
      try {
        await addMember.mutateAsync({ userIdOrEmail: target.id, role });
      } catch {
        failed.push(target.name || target.email);
      }
    }
    setAdding(false);

    const added = targets.length - failed.length;
    if (added > 0) {
      toast.success(
        added === 1 ? `${targets[0]?.name ?? 'Member'} added` : `${added} people added`,
      );
    }
    if (failed.length > 0) {
      toast.error(`Couldn’t add ${failed.join(', ')}`);
    }
  };

  const confirmRemove = async (): Promise<void> => {
    if (!removeTarget || !canManage) return;
    try {
      await removeMember.mutateAsync(removeTarget.userId);
      toast.success(`${removeTarget.name || removeTarget.email} removed`);
      if (rows.length === 1 && offset > 0) setOffset(current => Math.max(0, current - PAGE_SIZE));
      setRemoveTarget(null);
    } catch (reason) {
      toast.error(clawErrorText(reason, 'Failed to remove member'));
    }
  };

  if (org.isLoading) {
    return (
      <div className='max-w-ai-content mx-auto flex w-full flex-col gap-5 px-6 py-8'>
        <Skeleton className='h-20 w-full' />
        <Skeleton className='h-72 w-full' />
      </div>
    );
  }

  if (org.isError) {
    return (
      <div className='max-w-ai-content mx-auto w-full px-6 py-8'>
        <DetailCard>
          <DetailEmptyState
            icon={<BuildingApartmentTwo className='size-6' aria-hidden />}
            title='Organization unavailable'
            description={org.error.message}
            action={
              <Button
                variant='outline'
                onClick={() => void org.refetch()}
                data-track-category='Claw Organization'
                data-track-name='Organization: retry load'
              >
                Try again
              </Button>
            }
          />
        </DetailCard>
      </div>
    );
  }

  if (!summary) {
    return (
      <div className='max-w-ai-content mx-auto w-full px-6 py-8'>
        <DetailCard>
          <DetailEmptyState
            icon={<BuildingApartmentTwo className='size-6' aria-hidden />}
            title='No organization yet'
            description='You are not currently a member of an organization.'
          />
        </DetailCard>
      </div>
    );
  }

  return (
    <div className='max-w-ai-content mx-auto flex min-h-full w-full flex-col px-6'>
      <div className='bg-background sticky top-0 z-10 flex flex-col'>
        <div className='flex flex-col justify-center gap-1 pt-5'>
          <div className='flex min-w-0 items-center gap-2'>
            <h1 className='truncate text-2xl font-semibold leading-tight tracking-tight text-foreground'>
              {summary.name}
            </h1>
            <Pill tone={summary.status.toLowerCase() === 'active' ? 'success' : 'neutral'}>
              {summary.status}
            </Pill>
            <Pill tone='neutral'>{orgRoleLabel(summary.role)}</Pill>
            {canManage && activeTab === 'members' && (
              <Button
                type='button'
                className='ml-auto shrink-0'
                onClick={() => setAddOpen(true)}
                data-track-category='Claw Organization'
                data-track-name='Organization: open add member'
              >
                <PlusDefault className='size-4' aria-hidden />
                Add member
              </Button>
            )}
          </div>
          <p className='text-sm leading-tight text-muted-foreground'>
            {summary.description || 'Manage your organization and its members.'}
          </p>
        </div>

        <div className='mt-3 flex flex-col gap-3 pb-3 pt-2'>
          <Tabs
            items={ORGANIZATION_TABS}
            activeId={activeTab}
            onSelect={id => setActiveTab(id as OrganizationTabId)}
            trackCategory='Claw Organization'
            trackPrefix='Organization tab'
          />
          {activeTab === 'members' && (
            <AdminSearchField
              value={query}
              onChange={setQuery}
              placeholder='Search members'
              ariaLabel='Search members'
              trackCategory='Claw Organization'
              trackName='Organization: search members'
              className='w-full'
            />
          )}
        </div>
      </div>

      <div className='flex w-full flex-col gap-6'>
        {activeTab === 'members' ? (
          <section className='flex w-full flex-col gap-3'>
            {!canManage && (
              <p className='text-xs text-muted-foreground'>
                Only an owner or admin can add, remove, or re-role members.
              </p>
            )}

            {members.isLoading ? (
              <ul className='flex flex-col'>
                {[0, 1, 2].map(row => (
                  <li
                    key={row}
                    className='flex items-center gap-3 border-b border-border px-1 py-4'
                  >
                    <Skeleton className='size-8 shrink-0 rounded-full' />
                    <div className='flex min-w-0 flex-1 flex-col gap-1.5'>
                      <Skeleton className='h-3.5 w-32' />
                      <Skeleton className='h-3 w-48' />
                    </div>
                  </li>
                ))}
              </ul>
            ) : members.isError ? (
              <p className='text-xs text-muted-foreground'>Couldn’t load members.</p>
            ) : rows.length === 0 ? (
              <p className='text-xs text-muted-foreground'>
                {debouncedQuery
                  ? `No members matched “${debouncedQuery}”.`
                  : 'This organization has no active members.'}
              </p>
            ) : (
              <ul className='flex flex-col'>
                {rows.map(member => {
                  const canActOnMember = canManage && (isOwner || member.role !== 'OWNER');
                  const displayName = member.name || member.email;
                  return (
                    <li
                      key={member.userId}
                      className='flex items-center justify-between gap-3 border-b border-border px-1 py-4'
                    >
                      <div className='flex min-w-0 items-center gap-3'>
                        <Avatar
                          userId={member.userId}
                          size='sm'
                          showActiveStatus
                          className='size-8 shrink-0'
                        />
                        <div className='flex min-w-0 flex-wrap items-center gap-2'>
                          <PersonPill
                            userId={member.userId}
                            name={displayName}
                            className='truncate text-sm font-medium'
                          />
                          <span className='truncate text-xs text-muted-foreground'>
                            Joined {displayDate(member.joinedAt)}
                          </span>
                        </div>
                      </div>

                      <div className='relative grid shrink-0 grid-cols-[8rem_2.25rem] items-center gap-2'>
                        {busyUserId === member.userId && (
                          <Loader2
                            className='absolute -left-5 top-1/2 size-3.5 -translate-y-1/2 animate-spin text-muted-foreground'
                            aria-hidden
                          />
                        )}
                        {canActOnMember ? (
                          <BehaviourSelect
                            value={member.role}
                            options={roleOptions}
                            editable
                            disabled={busyUserId !== null}
                            label={`Role for ${displayName}`}
                            trackName='Organization: set member role'
                            triggerClassName='h-8 !w-32 rounded-md border-0 bg-transparent px-3 text-muted-foreground shadow-none hover:bg-muted hover:text-foreground focus-visible:bg-muted focus-visible:ring-0 dark:bg-transparent [&>svg]:text-current [&>svg]:opacity-100'
                            onChange={next => {
                              if (isOrgRole(next)) void changeRole(member, next);
                            }}
                          />
                        ) : (
                          <span className='flex h-8 w-32 items-center gap-2 px-3 text-sm text-muted-foreground'>
                            {roleIcon(member.role)}
                            <span>{orgRoleLabel(member.role)}</span>
                          </span>
                        )}
                        {canActOnMember && (
                          <Tooltip content={`Remove ${displayName}`} side='top'>
                            <Button
                              type='button'
                              variant='ghost'
                              size='icon'
                              onClick={() => setRemoveTarget(member)}
                              disabled={busyUserId !== null}
                              aria-label={`Remove ${displayName}`}
                              data-track-category='Claw Organization'
                              data-track-name='Organization: remove member'
                              className='text-muted-foreground hover:text-destructive focus-visible:bg-muted focus-visible:ring-0'
                            >
                              <DeleteDustbin01 className='size-4' aria-hidden />
                            </Button>
                          </Tooltip>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        ) : (
          <div className='flex w-full flex-col gap-3'>
            <OrganizationSurfacesSection orgId={orgId} canManage={canManage} />
            <OrganizationServiceTokensSection orgId={orgId} canManage={canManage} />
          </div>
        )}
      </div>

      {activeTab === 'members' && total > 0 && (
        <div className='bg-background sticky bottom-0 z-10 mt-auto py-3 empty:hidden'>
          <AdminPager
            offset={offset}
            count={rows.length}
            total={total}
            onPrev={() => setOffset(current => Math.max(0, current - PAGE_SIZE))}
            onNext={() => setOffset(current => current + PAGE_SIZE)}
          />
        </div>
      )}

      <AddOrgMemberDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        orgId={orgId}
        saving={adding}
        onAdd={submitMembers}
      />

      <ConfirmDialog
        open={removeTarget !== null}
        onOpenChange={open => {
          if (!open && !removeMember.isPending) setRemoveTarget(null);
        }}
        title='Remove member'
        description={
          removeTarget
            ? `Remove ${removeTarget.name || removeTarget.email} from ${summary.name}?`
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

export default OrganizationV2;
