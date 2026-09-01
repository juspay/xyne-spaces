import { useState, type ReactElement } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/hooks/useAuth';
import { clawErrorText } from '@/services/claw/clawRequest';
import {
  decideDelegationRequest,
  listDelegationGrants,
  listDelegationRequests,
  revokeDelegation,
} from '@/services/claw/clawDelegationService';
import type { AgentDelegationGrant } from '@/services/claw/clawDelegationTypes';
import type { Agent } from '@/services/claw/clawAuthAgentTypes';
import {
  DetailCard,
  DetailEmpty,
  DetailSection,
} from '../../../shared/primitives/DetailPrimitives';
import { DelegationStatusBadge } from '../tools/DelegationStatusBadge';
import { delegationGrantsKey } from '../../../shared/pickers/callableAgent/useCallableAgents';

const delegationRequestsKey = (slug: string): string[] => ['claw-delegation-requests', slug];

function GrantRow({
  title,
  subtitle,
  reason,
  badge,
  actions,
}: {
  title: string;
  subtitle: string;
  reason?: string | null;
  badge: ReactElement;
  actions?: ReactElement | null;
}): ReactElement {
  return (
    <div className='flex w-full flex-col gap-2 border-b border-border px-3 py-3 last:border-b-0'>
      <div className='flex items-start gap-3'>
        <div className='flex min-w-0 flex-1 flex-col'>
          <span className='truncate text-sm font-medium leading-5 text-foreground'>{title}</span>
          <span className='truncate text-xs leading-4 text-muted-foreground'>{subtitle}</span>
        </div>
        {badge}
      </div>
      {reason && (
        <p className='break-words rounded-md bg-muted/60 px-2.5 py-1.5 text-xs leading-4 text-muted-foreground'>
          {reason}
        </p>
      )}
      {actions && <div className='flex items-center justify-end gap-2'>{actions}</div>}
    </div>
  );
}

export function AgentCallGraphTabV2({ agent }: { agent: Agent }): ReactElement {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);

  const incoming = useQuery({
    queryKey: delegationRequestsKey(agent.slug),
    queryFn: () => listDelegationRequests(agent.slug, user!.id),
    enabled: !!user?.id,
  });

  const outgoing = useQuery({
    queryKey: delegationGrantsKey(agent.slug),
    queryFn: () => listDelegationGrants(agent.slug, user!.id),
    enabled: !!user?.id,
  });

  const refreshIncoming = (): void => {
    void queryClient.invalidateQueries({ queryKey: delegationRequestsKey(agent.slug) });
  };

  const decide = async (grant: AgentDelegationGrant, approve: boolean): Promise<void> => {
    if (!user?.id || busyId) return;
    setBusyId(grant.id);
    try {
      await decideDelegationRequest(agent.slug, grant.id, approve, user.id);
      refreshIncoming();
      toast.success(
        approve
          ? `${grant.caller?.name ?? 'The agent'} can now call ${agent.name}`
          : 'Request declined',
      );
    } catch (err) {
      toast.error(clawErrorText(err, 'Could not update this request'));
    } finally {
      setBusyId(null);
    }
  };

  const revoke = async (grant: AgentDelegationGrant): Promise<void> => {
    if (!user?.id || busyId) return;
    setBusyId(grant.id);
    try {
      await revokeDelegation(agent.slug, grant.id, user.id);
      refreshIncoming();
      toast.success(`${grant.caller?.name ?? 'That agent'} can no longer call ${agent.name}`);
    } catch (err) {
      toast.error(clawErrorText(err, 'Could not revoke this delegation'));
    } finally {
      setBusyId(null);
    }
  };

  const incomingRows = incoming.data ?? [];
  const pending = incomingRows.filter(grant => grant.status === 'pending');
  const active = incomingRows.filter(grant => grant.status === 'approved');
  const outgoingRows = outgoing.data ?? [];

  const loadingBlock = (
    <div className='flex items-center gap-2 px-3 py-3 text-sm text-muted-foreground'>
      <Loader2 className='size-4 animate-spin' aria-hidden />
      Loading…
    </div>
  );

  return (
    <div className='flex w-full flex-col gap-8'>
      <DetailSection
        label='Requests to call this agent'
        info='Another agent’s owner has asked to hand tasks to this one'
      >
        <DetailCard>
          {incoming.isLoading ? (
            loadingBlock
          ) : pending.length === 0 ? (
            <DetailEmpty>No pending requests.</DetailEmpty>
          ) : (
            pending.map(grant => (
              <GrantRow
                key={grant.id}
                title={grant.caller?.name ?? grant.callerAgentId}
                subtitle={
                  grant.caller?.ownerName
                    ? `@${grant.caller.slug} · owned by ${grant.caller.ownerName}`
                    : `@${grant.caller?.slug ?? grant.callerAgentId}`
                }
                reason={grant.requestReason}
                badge={<DelegationStatusBadge status={grant.status} />}
                actions={
                  <>
                    <Button
                      variant='ghost'
                      size='sm'
                      disabled={busyId !== null}
                      onClick={() => void decide(grant, false)}
                      data-track-category='Claw Agents'
                      data-track-name='DeclineDelegation'
                    >
                      Decline
                    </Button>
                    <Button
                      size='sm'
                      loading={busyId === grant.id}
                      disabled={busyId !== null}
                      onClick={() => void decide(grant, true)}
                      data-track-category='Claw Agents'
                      data-track-name='ApproveDelegation'
                    >
                      Approve
                    </Button>
                  </>
                }
              />
            ))
          )}
        </DetailCard>
      </DetailSection>

      <DetailSection
        label='Agents that can call this one'
        info='Approved delegations. Revoking stops the calls immediately.'
      >
        <DetailCard>
          {incoming.isLoading ? (
            loadingBlock
          ) : active.length === 0 ? (
            <DetailEmpty>No agent can call this one yet.</DetailEmpty>
          ) : (
            active.map(grant => (
              <GrantRow
                key={grant.id}
                title={grant.caller?.name ?? grant.callerAgentId}
                subtitle={
                  grant.caller?.ownerName
                    ? `@${grant.caller.slug} · owned by ${grant.caller.ownerName}`
                    : `@${grant.caller?.slug ?? grant.callerAgentId}`
                }
                badge={<DelegationStatusBadge status={grant.status} />}
                actions={
                  <Button
                    variant='ghost'
                    size='sm'
                    loading={busyId === grant.id}
                    disabled={busyId !== null}
                    onClick={() => void revoke(grant)}
                    data-track-category='Claw Agents'
                    data-track-name='RevokeDelegation'
                  >
                    Revoke
                  </Button>
                }
              />
            ))
          )}
        </DetailCard>
      </DetailSection>

      <DetailSection label='Agents this one can call' info='Manage these from the Tools tab'>
        <DetailCard>
          {outgoing.isLoading ? (
            loadingBlock
          ) : outgoingRows.length === 0 ? (
            <DetailEmpty>This agent doesn’t call any other agent.</DetailEmpty>
          ) : (
            outgoingRows.map(grant => (
              <GrantRow
                key={grant.id}
                title={grant.callee?.name ?? grant.calleeAgentId}
                subtitle={`@${grant.callee?.slug ?? grant.calleeAgentId}`}
                reason={grant.requestReason}
                badge={
                  <DelegationStatusBadge
                    status={grant.status}
                    ownerName={grant.callee?.ownerName ?? null}
                  />
                }
              />
            ))
          )}
        </DetailCard>
      </DetailSection>
    </div>
  );
}
