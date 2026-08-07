import { useCallback, useState, type ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { DeleteDustbin01, UserPlus } from '@xyne/icons';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Skeleton } from '@/components/ui/Skeleton';
import Tooltip from '@/components/ui/Tooltip';
import { ConfirmDialog } from '@/components/ClawAgents/ConfirmDialog';
import { clawErrorText } from '@/services/claw/clawRequest';
import { grantAdminRole, listAdminRoles, revokeAdminRole } from '@/services/claw/clawAdminService';
import type { AdminRole, GrantableRole } from '@/services/claw/clawAdminTypes';
import { TabMessage } from './components/TabMessage';
import { adminRolesKey } from './hooks/adminQueryKeys';
import { orgLabel } from './orgLabel';

interface RoleSectionCopy {
  heading: string;
  description?: string;
  grantLabel: string;
  grantButtonLabel: string;
  revokeLabel: string;
}

const ROLE_COPY: Record<GrantableRole, RoleSectionCopy> = {
  CLAW_ADMIN: {
    heading: 'Admins',
    grantLabel: 'Grant admin',
    grantButtonLabel: 'Grant admin',
    revokeLabel: 'Revoke admin',
  },
  SEARCH_EVAL_ACCESS: {
    heading: 'Search Eval access',
    description:
      'Lets someone use Search Evals (including its ACL-bypassing “without permission” mode) without granting full admin.',
    grantLabel: 'Grant Search Eval access',
    grantButtonLabel: 'Grant access',
    revokeLabel: 'Revoke Search Eval access',
  },
};

function RoleAccessSection({
  userId,
  roleKey: role,
  orgNamesById,
  showOrgLabels,
}: {
  userId: string;
  roleKey: GrantableRole;
  orgNamesById: Record<string, string>;
  showOrgLabels: boolean;
}): ReactElement {
  const queryClient = useQueryClient();
  const copy = ROLE_COPY[role];
  const [target, setTarget] = useState('');
  const [revokeTarget, setRevokeTarget] = useState<AdminRole | null>(null);

  const {
    data: holders,
    isPending,
    isError,
  } = useQuery({
    queryKey: adminRolesKey(role),
    queryFn: () => listAdminRoles(userId, role),
  });

  const refresh = useCallback((): void => {
    void queryClient.invalidateQueries({ queryKey: adminRolesKey(role) });
  }, [queryClient, role]);

  const grant = useMutation({
    mutationFn: (userIdOrEmail: string) => grantAdminRole(userId, userIdOrEmail, role),
    onSuccess: () => {
      toast.success(`${copy.heading} granted`);
      setTarget('');
      refresh();
    },
    onError: error => toast.error(clawErrorText(error, 'Could not grant the role')),
  });

  const revoke = useMutation({
    mutationFn: (targetUserId: string) => revokeAdminRole(userId, targetUserId, role),
    onSuccess: () => {
      toast.success(`${copy.heading} revoked`);
      setRevokeTarget(null);
      refresh();
    },
    onError: error => toast.error(clawErrorText(error, 'Could not revoke the role')),
  });

  const submitGrant = (): void => {
    const value = target.trim();
    if (value) grant.mutate(value);
  };
  const grantDisabled = !target.trim() || grant.isPending;
  const grantButton = (
    <Button
      type='button'
      onClick={submitGrant}
      disabled={grantDisabled}
      data-track-category='Claw Admin'
      data-track-name={copy.grantButtonLabel}
    >
      <UserPlus className='size-3.5' />
      {copy.grantButtonLabel}
    </Button>
  );

  return (
    <section className='flex flex-col gap-4'>
      <div className='flex flex-col gap-1'>
        <h3 className='text-sm font-medium text-foreground'>{copy.heading}</h3>
        {copy.description && <p className='text-xs text-muted-foreground'>{copy.description}</p>}
      </div>

      <div className='flex items-end gap-2'>
        <div className='flex min-w-0 flex-1 flex-col gap-1.5'>
          <label htmlFor={`grant-${role}`} className='text-xs font-medium text-muted-foreground'>
            {copy.grantLabel}
          </label>
          <Input
            id={`grant-${role}`}
            value={target}
            onChange={event => setTarget(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter') submitGrant();
            }}
            placeholder='User ID or email (e.g. user@example.com)'
          />
        </div>
        {grantDisabled ? (
          <Tooltip
            content={
              grant.isPending
                ? `${copy.grantButtonLabel} is in progress`
                : 'Enter a user ID or email first'
            }
            side='top'
          >
            <span className='inline-flex'>{grantButton}</span>
          </Tooltip>
        ) : (
          grantButton
        )}
      </div>

      {isPending ? (
        <Skeleton className='h-20 w-full' />
      ) : isError ? (
        <TabMessage>Couldn’t load role holders.</TabMessage>
      ) : !holders || holders.length === 0 ? (
        <TabMessage>Nobody holds this role yet.</TabMessage>
      ) : (
        <ul className='flex flex-col gap-2'>
          {holders.map((holder: AdminRole) => {
            const isSelf = holder.userId === userId;
            const holderOrgName = orgLabel(holder.user?.orgId, holder.user?.orgName, orgNamesById);
            return (
              <li
                key={holder.id}
                className='flex items-center justify-between gap-3 rounded-xl border border-border bg-background px-4 py-3'
              >
                <div className='flex min-w-0 flex-wrap items-center gap-2'>
                  <span className='truncate text-sm font-medium text-foreground'>
                    {holder.user?.name ?? holder.userId}
                  </span>
                  <span className='truncate text-xs text-muted-foreground'>
                    {holder.user?.email}
                  </span>
                  {/* Org only means something when the list spans orgs. */}
                  {showOrgLabels && holderOrgName && (
                    <Badge variant='secondary'>{holderOrgName}</Badge>
                  )}
                  <span className='text-xs text-muted-foreground'>
                    granted {new Date(holder.createdAt).toLocaleDateString()}
                  </span>
                </div>
                <Tooltip content={isSelf ? 'Cannot revoke yourself' : copy.revokeLabel} side='top'>
                  <span className='inline-flex'>
                    <Button
                      type='button'
                      variant='ghost'
                      size='icon'
                      disabled={isSelf || revoke.isPending}
                      onClick={() => setRevokeTarget(holder)}
                      aria-label={isSelf ? 'Cannot revoke yourself' : copy.revokeLabel}
                      data-track-category='Claw Admin'
                      data-track-name={copy.revokeLabel}
                    >
                      <DeleteDustbin01 className='size-3.5 text-destructive' />
                    </Button>
                  </span>
                </Tooltip>
              </li>
            );
          })}
        </ul>
      )}

      <ConfirmDialog
        open={revokeTarget !== null}
        onOpenChange={open => {
          if (!open) setRevokeTarget(null);
        }}
        title={`${copy.revokeLabel}?`}
        description={
          revokeTarget
            ? `${revokeTarget.user?.email ?? revokeTarget.userId} will lose this access immediately.`
            : undefined
        }
        confirmLabel='Revoke'
        danger
        loading={revoke.isPending}
        onConfirm={() => {
          if (revokeTarget) revoke.mutate(revokeTarget.userId);
        }}
      />
    </section>
  );
}

export function AdminsTab({
  userId,
  orgNamesById,
  showOrgLabels,
}: {
  userId: string;
  orgNamesById: Record<string, string>;
  showOrgLabels: boolean;
}): ReactElement {
  return (
    <div className='flex flex-col gap-6 pt-4'>
      <RoleAccessSection
        userId={userId}
        roleKey='CLAW_ADMIN'
        orgNamesById={orgNamesById}
        showOrgLabels={showOrgLabels}
      />
      <RoleAccessSection
        userId={userId}
        roleKey='SEARCH_EVAL_ACCESS'
        orgNamesById={orgNamesById}
        showOrgLabels={showOrgLabels}
      />
    </div>
  );
}
