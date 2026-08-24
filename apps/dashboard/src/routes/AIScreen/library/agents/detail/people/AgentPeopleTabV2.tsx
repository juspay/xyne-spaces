import { useMemo, useRef, useState, type ReactElement } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import {
  CheckTickSingle,
  MultipleCrossCancelDefault,
  PlusDefault,
  SearchDefault,
} from '@xyne/icons';
import { Skeleton } from '@/components/ui/Skeleton';
import { useAuth } from '@/hooks/useAuth';
import { matchesUserQuery } from '@/utils/userDisplayName';
import { useClawAgentShares } from '@/hooks/useClawAgentDetail';
import { useClawCloneRequests } from '@/hooks/useClawCloneRequests';
import { addClawAgentShare, removeClawAgentShare } from '@/services/claw/clawAuthAgentsService';
import { clawErrorText } from '@/services/claw/clawRequest';
import type { Agent, AgentShareRole, ClawUser } from '@/services/claw/clawAuthAgentTypes';
import { Pill } from '../../../shared/primitives/Pill';
import { BehaviourSelect } from '../behaviour/BehaviourRows';
import {
  DetailCard,
  DetailEmpty,
  DetailLockedNote,
  DetailRow,
  DetailSection,
  DetailValue,
  ReadOnlyBadge,
} from '../../../shared/primitives/DetailPrimitives';
import type { AgentDetailActions } from '../useAgentDetailActions';
import { AddMemberDialog } from './AddMemberDialog';
import { PersonRow } from './PersonRow';
import { isShareRole, ROLE_OPTIONS, roleLabel } from './roles';

const VISIBILITY_OPTIONS = [
  { value: 'global', label: 'Global (Anyone in the workspace)' },
  { value: 'personal', label: 'Personal (Only people you add)' },
];

const ICON_BUTTON =
  'flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40';

export function AgentPeopleTabV2({
  agent,
  actions,
}: {
  agent: Agent;
  actions: AgentDetailActions;
}): ReactElement {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const shares = useClawAgentShares(agent.slug);
  const cloneRequests = useClawCloneRequests(agent.id, agent.slug);

  const [addOpen, setAddOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const [defaultRole, setDefaultRole] = useState<AgentShareRole>('VIEWER');

  const { isAdmin, isOwner } = actions;
  const canShare = isOwner || isAdmin;

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const entries = (shares.data ?? []).map(share => ({
      key: share.id,
      userId: share.userId,
      name: share.user.name || share.user.email,
      detail: share.user.email,
      role: share.role,
      owner: false,
    }));

    if (agent.ownerUserId) {
      entries.unshift({
        key: `owner-${agent.ownerUserId}`,
        userId: agent.ownerUserId,
        name: agent.owner?.name || agent.owner?.email || 'Owner',
        detail: agent.owner?.email ?? 'Agent creator',
        role: 'OWNER',
        owner: true,
      });
    }

    return q
      ? entries.filter(entry => matchesUserQuery({ name: entry.name, email: entry.detail }, query))
      : entries;
  }, [shares.data, agent.ownerUserId, agent.owner, query]);

  const existingUserIds = useMemo(
    () =>
      new Set([
        ...(agent.ownerUserId ? [agent.ownerUserId] : []),
        ...(shares.data ?? []).map(share => share.userId),
      ]),
    [agent.ownerUserId, shares.data],
  );

  const refreshShares = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['claw-agent-shares', agent.slug, user?.id] });
  };

  const setRole = async (targetUserId: string, role: AgentShareRole): Promise<void> => {
    if (!user?.id || busyUserId) return;
    setBusyUserId(targetUserId);
    try {
      // The shares endpoint upserts, so a role change is the same call as an add.
      await addClawAgentShare(agent.slug, user.id, targetUserId, role);
      refreshShares();
      toast.success('Role updated');
    } catch (err) {
      toast.error(clawErrorText(err, 'Could not change that role'));
    } finally {
      setBusyUserId(null);
    }
  };

  const addMember = async (target: ClawUser, role: AgentShareRole): Promise<void> => {
    if (!user?.id || busyUserId) return;
    setBusyUserId(target.id);
    try {
      await addClawAgentShare(agent.slug, user.id, target.id, role);
      refreshShares();
      toast.success(`${target.name || target.email} added`);
    } catch (err) {
      toast.error(clawErrorText(err, 'Could not add that person'));
    } finally {
      setBusyUserId(null);
    }
  };

  const removeMember = async (targetUserId: string, name: string): Promise<void> => {
    if (!user?.id || busyUserId) return;
    setBusyUserId(targetUserId);
    try {
      await removeClawAgentShare(agent.slug, user.id, targetUserId);
      refreshShares();
      toast.success(`${name} removed`);
    } catch (err) {
      toast.error(clawErrorText(err, 'Could not remove that person'));
    } finally {
      setBusyUserId(null);
    }
  };

  const toggleSearch = (): void => {
    setSearchOpen(open => {
      if (open) {
        setQuery('');
        return false;
      }
      setTimeout(() => searchRef.current?.focus(), 0);
      return true;
    });
  };

  const pending = cloneRequests.data ?? [];
  const resolving = cloneRequests.approve.isPending || cloneRequests.reject.isPending;

  return (
    <div className='flex w-full flex-col gap-8'>
      <DetailSection
        label='Access'
        info='Who can find and run this agent'
        {...(isAdmin ? {} : { trailing: <ReadOnlyBadge />, trailingAlign: 'end' as const })}
      >
        <DetailCard>
          {!isAdmin && (
            <DetailLockedNote>
              Only an admin can change who this agent is visible to.
            </DetailLockedNote>
          )}

          <DetailRow title='Visibility' hint='Who can find and run this agent'>
            <BehaviourSelect
              value={agent.scope === 'global' ? 'global' : 'personal'}
              options={VISIBILITY_OPTIONS}
              editable={isAdmin}
              disabled={actions.busy.moderating !== null}
              label='Agent visibility'
              trackName='Agent detail v2: set visibility'
              onChange={next => {
                const wantsGlobal = next === 'global';
                if (wantsGlobal === (agent.scope === 'global')) return;
                void actions.moderate(wantsGlobal ? 'promote' : 'demote');
              }}
            />
          </DetailRow>

          <DetailRow title='Default role' hint='What new people get when added' last>
            <BehaviourSelect
              value={defaultRole}
              options={ROLE_OPTIONS}
              editable={canShare}
              disabled={busyUserId !== null}
              label='Default role for new people'
              trackName='Agent detail v2: set default role'
              onChange={next => {
                if (isShareRole(next)) setDefaultRole(next);
              }}
            />
          </DetailRow>
        </DetailCard>
      </DetailSection>

      <DetailSection
        label='Members'
        trailing={
          <span className='flex items-center gap-1'>
            <button
              type='button'
              onClick={toggleSearch}
              aria-label={searchOpen ? 'Hide search' : 'Search members'}
              aria-expanded={searchOpen}
              data-track-category='Claw Agents'
              data-track-name='Agent detail v2: toggle member search'
              className={ICON_BUTTON}
            >
              <SearchDefault className='size-4' aria-hidden />
            </button>
            {canShare && (
              <button
                type='button'
                onClick={() => setAddOpen(true)}
                aria-label='Add people'
                data-track-category='Claw Agents'
                data-track-name='Agent detail v2: open add member'
                className={ICON_BUTTON}
              >
                <PlusDefault className='size-4' aria-hidden />
              </button>
            )}
          </span>
        }
        trailingAlign='end'
      >
        <DetailCard>
          {searchOpen && (
            <div className='border-b border-border p-3'>
              <input
                ref={searchRef}
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder='Filter members'
                aria-label='Filter members'
                data-track-category='Claw Agents'
                data-track-name='Agent detail v2: filter members'
                className='h-9 w-full rounded-[10px] border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring'
              />
            </div>
          )}

          {shares.isLoading ? (
            <div className='flex w-full flex-col'>
              {[0, 1, 2].map(row => (
                <div
                  key={row}
                  className='flex items-center gap-3 border-b border-border p-4 last:border-b-0'
                >
                  <Skeleton className='size-10 shrink-0 rounded-full' />
                  <div className='flex min-w-0 flex-1 flex-col gap-1.5'>
                    <Skeleton className='h-3.5 w-32' />
                    <Skeleton className='h-3 w-48' />
                  </div>
                </div>
              ))}
            </div>
          ) : rows.length === 0 ? (
            <DetailEmpty>
              {query.trim() ? 'No members matched that search.' : 'No one has access yet.'}
            </DetailEmpty>
          ) : (
            rows.map(row => (
              <PersonRow
                key={row.key}
                userId={row.userId}
                name={row.name}
                detail={row.detail}
                trailing={
                  row.owner ? (
                    <Pill tone='neutral'>Agent Creator</Pill>
                  ) : (
                    <>
                      {busyUserId === row.userId && (
                        <Loader2
                          className='size-3.5 animate-spin text-muted-foreground'
                          aria-hidden
                        />
                      )}
                      {canShare ? (
                        <BehaviourSelect
                          value={row.role}
                          options={ROLE_OPTIONS}
                          editable
                          disabled={busyUserId !== null}
                          label={`Role for ${row.name}`}
                          trackName='Agent detail v2: set member role'
                          onChange={next => {
                            if (isShareRole(next)) void setRole(row.userId, next);
                          }}
                        />
                      ) : (
                        <DetailValue>{roleLabel(row.role)}</DetailValue>
                      )}
                      {canShare && (
                        <button
                          type='button'
                          onClick={() => void removeMember(row.userId, row.name)}
                          disabled={busyUserId !== null}
                          aria-label={`Remove ${row.name}`}
                          title={`Remove ${row.name}`}
                          data-track-category='Claw Agents'
                          data-track-name='Agent detail v2: remove member'
                          className={ICON_BUTTON}
                        >
                          <MultipleCrossCancelDefault className='size-4' aria-hidden />
                        </button>
                      )}
                    </>
                  )
                }
              />
            ))
          )}
        </DetailCard>
      </DetailSection>

      {canShare && (
        <DetailSection label='Pending Requests' info='People asking for a copy of this agent'>
          <DetailCard>
            {cloneRequests.isLoading ? (
              <DetailEmpty>Loading requests…</DetailEmpty>
            ) : pending.length === 0 ? (
              <DetailEmpty>No pending requests.</DetailEmpty>
            ) : (
              pending.map(request => (
                <PersonRow
                  key={request.id}
                  userId={request.requesterId}
                  name={request.requesterName || request.requesterEmail || request.requesterId}
                  detail={request.requesterEmail ?? 'Requested a copy of this agent'}
                  trailing={
                    <>
                      <button
                        type='button'
                        onClick={() => cloneRequests.approve.mutate(request)}
                        disabled={resolving}
                        aria-label='Approve request'
                        title='Approve request'
                        data-track-category='Claw Agents'
                        data-track-name='Agent detail v2: approve clone request'
                        className={ICON_BUTTON}
                      >
                        <CheckTickSingle className='size-4' aria-hidden />
                      </button>
                      <button
                        type='button'
                        onClick={() => cloneRequests.reject.mutate(request)}
                        disabled={resolving}
                        aria-label='Reject request'
                        title='Reject request'
                        data-track-category='Claw Agents'
                        data-track-name='Agent detail v2: reject clone request'
                        className={ICON_BUTTON}
                      >
                        <MultipleCrossCancelDefault className='size-4' aria-hidden />
                      </button>
                    </>
                  }
                />
              ))
            )}
          </DetailCard>
        </DetailSection>
      )}

      <AddMemberDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        existingUserIds={existingUserIds}
        defaultRole={defaultRole}
        saving={busyUserId !== null}
        onAdd={(target, role) => void addMember(target, role)}
      />
    </div>
  );
}
