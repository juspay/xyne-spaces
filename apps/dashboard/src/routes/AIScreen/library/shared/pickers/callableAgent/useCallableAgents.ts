import { useCallback, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { useClawAuthAgents } from '@/hooks/useClawAuthAgents';
import { clawErrorText } from '@/services/claw/clawRequest';
import {
  createDelegationGrant,
  deleteDelegationGrant,
  listDelegationGrants,
} from '@/services/claw/clawDelegationService';
import type { AgentDelegationGrant } from '@/services/claw/clawDelegationTypes';
import type { CallableAgentEntry } from './callableAgentCatalog';

export const delegationGrantsKey = (slug: string): string[] => ['claw-delegation-grants', slug];

export interface UseCallableAgentsResult {
  catalog: CallableAgentEntry[];
  loading: boolean;
  isError: boolean;
  refetch: () => void;
  busySlug: string | null;
  add: (calleeSlug: string, requestReason: string) => void;
  remove: (calleeSlug: string) => void;
}

/**
 * Delegation is a live grant, not a draft: adding an agent calls the API before
 * the slug is written anywhere, because a slug with no approved grant behind it
 * is a config the runtime silently refuses.
 */
export function useCallableAgents({
  agentSlug,
  agentOwnerUserId,
  selected,
  onSelectedChange,
}: {
  agentSlug: string;
  agentOwnerUserId: string | null;
  selected: readonly string[];
  onSelectedChange: (next: string[]) => void;
}): UseCallableAgentsResult {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [busySlug, setBusySlug] = useState<string | null>(null);
  const agents = useClawAuthAgents();

  const grantsQuery = useQuery({
    queryKey: delegationGrantsKey(agentSlug),
    queryFn: () => listDelegationGrants(agentSlug, user!.id),
    enabled: !!user?.id && !!agentSlug,
    staleTime: 60 * 1000,
  });

  const grantBySlug = useMemo(() => {
    const map = new Map<string, AgentDelegationGrant>();
    for (const grant of grantsQuery.data ?? []) {
      if (grant.callee?.slug) map.set(grant.callee.slug, grant);
    }
    return map;
  }, [grantsQuery.data]);

  const catalog = useMemo<CallableAgentEntry[]>(() => {
    const rows = (agents.data ?? [])
      .filter(entry => entry.slug !== agentSlug)
      .map<CallableAgentEntry>(entry => {
        const grant = grantBySlug.get(entry.slug);
        const added = selected.includes(entry.slug);
        return {
          slug: entry.slug,
          name: entry.name,
          description: entry.description ?? '',
          ownerName: grant?.callee?.ownerName ?? entry.owner?.name ?? entry.owner?.email ?? null,
          status: added ? (grant?.status ?? 'missing') : null,
          needsApproval:
            !entry.ownerUserId || !agentOwnerUserId || entry.ownerUserId !== agentOwnerUserId,
          agent: entry,
        };
      });

    // A slug the user can no longer see (deleted, or access removed) still has
    // to be listed — otherwise removing it is impossible from this screen.
    const known = new Set(rows.map(row => row.slug));
    for (const slug of selected) {
      if (known.has(slug)) continue;
      const grant = grantBySlug.get(slug);
      rows.push({
        slug,
        name: grant?.callee?.name ?? slug,
        description: grant?.callee?.description ?? '',
        ownerName: grant?.callee?.ownerName ?? null,
        status: grant?.status ?? 'missing',
        needsApproval: true,
        agent: null,
      });
    }
    return rows;
  }, [agents.data, agentSlug, agentOwnerUserId, grantBySlug, selected]);

  const add = useCallback(
    (calleeSlug: string, requestReason: string): void => {
      if (!user?.id || busySlug) return;
      setBusySlug(calleeSlug);
      void (async (): Promise<void> => {
        try {
          const grant = await createDelegationGrant(agentSlug, user.id, {
            calleeSlug,
            identityMode: 'user',
            ...(requestReason ? { requestReason } : {}),
          });
          void queryClient.invalidateQueries({ queryKey: delegationGrantsKey(agentSlug) });
          onSelectedChange([...selected.filter(entry => entry !== calleeSlug), calleeSlug]);
          toast.success(
            grant.status === 'approved'
              ? `${grant.callee?.name ?? calleeSlug} can now be called`
              : `Approval requested from ${grant.callee?.ownerName ?? 'the owner'}`,
          );
        } catch (err) {
          toast.error(clawErrorText(err, 'Could not request delegation'));
        } finally {
          setBusySlug(null);
        }
      })();
    },
    [agentSlug, busySlug, onSelectedChange, queryClient, selected, user?.id],
  );

  const remove = useCallback(
    (calleeSlug: string): void => {
      if (!user?.id || busySlug) return;
      setBusySlug(calleeSlug);
      void (async (): Promise<void> => {
        const grantId = grantBySlug.get(calleeSlug)?.id ?? null;
        try {
          if (grantId) {
            await deleteDelegationGrant(agentSlug, grantId, user.id);
            void queryClient.invalidateQueries({ queryKey: delegationGrantsKey(agentSlug) });
          }
          onSelectedChange(selected.filter(entry => entry !== calleeSlug));
        } catch (err) {
          toast.error(clawErrorText(err, 'Could not remove delegation'));
        } finally {
          setBusySlug(null);
        }
      })();
    },
    [agentSlug, busySlug, grantBySlug, onSelectedChange, queryClient, selected, user?.id],
  );

  return {
    catalog,
    loading: grantsQuery.isLoading || agents.isLoading,
    isError: grantsQuery.isError || agents.isError,
    refetch: (): void => {
      void grantsQuery.refetch();
      void agents.refetch();
    },
    busySlug,
    add,
    remove,
  };
}
