import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { useIsClawAdmin } from '@/hooks/useIsClawAdmin';
import { clawAgentDetailKey, useClawAgentShares } from '@/hooks/useClawAgentDetail';
import { getAgentPermissions, type AgentPermissions } from '@/services/claw/agentPermissions';
import {
  ClawApiError,
  cloneClawAgent,
  demoteClawAgent,
  deleteClawAgent,
  promoteClawAgent,
  submitClawAgentRequest,
  updateClawAgent,
} from '@/services/claw/clawAuthAgentsService';
import { clawErrorText } from '@/services/claw/clawRequest';
import type { Agent } from '@/services/claw/clawAuthAgentTypes';

export type ModerationAction = 'promote' | 'demote';

export interface AgentDetailActions {
  permissions: AgentPermissions | null;
  isAdmin: boolean;
  /** True ownership — an admin is NOT an owner for Publish-vs-Promote gating. */
  isOwner: boolean;
  busy: {
    toggling: boolean;
    deleting: boolean;
    cloning: boolean;
    publishing: boolean;
    moderating: ModerationAction | null;
    renaming: boolean;
  };
  toggleEnabled: (next: boolean) => Promise<void>;
  remove: () => Promise<void>;
  clone: (name: string) => Promise<void>;
  publish: () => Promise<void>;
  moderate: (action: ModerationAction) => Promise<void>;
  rename: (nextSlug: string) => Promise<void>;
}
export function useAgentDetailActions(agent: Agent | undefined): AgentDetailActions {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const userId = user?.id;

  const { data: isAdmin = false } = useIsClawAdmin();
  const { data: shares } = useClawAgentShares(agent?.slug);

  const [toggling, setToggling] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [cloning, setCloning] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [moderating, setModerating] = useState<ModerationAction | null>(null);

  const permissions = useMemo(
    () => (agent ? getAgentPermissions(agent, userId ?? '', shares ?? [], isAdmin) : null),
    [agent, userId, shares, isAdmin],
  );

  const isOwner = Boolean(agent && userId && agent.ownerUserId === userId);

  // Absolute, not relative: `..` resolves against the matched route
  // (`library/agent/:slug`), which lands on `/library/agent` — not a real route.
  const { workspaceId } = useParams<{ workspaceId?: string }>();
  const libraryPath = workspaceId ? `/${workspaceId}/ai/library` : '/ai/library';
  const detailPath = (slug: string): string => `${libraryPath}/agent/${slug}?tab=persona`;

  const refreshLists = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['claw-auth-agents'] });
  };

  const toggleEnabled = async (next: boolean): Promise<void> => {
    if (!agent || toggling) return;
    setToggling(true);
    const previous = agent;
    queryClient.setQueryData(clawAgentDetailKey(agent.slug), { ...agent, enabled: next });
    try {
      const updated = await updateClawAgent(agent.slug, { enabled: next });
      queryClient.setQueryData(clawAgentDetailKey(agent.slug), updated);
      refreshLists();
      toast.success(next ? `${agent.name} enabled` : `${agent.name} paused`);
    } catch (err) {
      queryClient.setQueryData(clawAgentDetailKey(agent.slug), previous);
      toast.error(clawErrorText(err, 'Could not update this agent'));
    } finally {
      setToggling(false);
    }
  };

  const remove = async (): Promise<void> => {
    if (!agent || !userId || deleting) return;
    setDeleting(true);
    try {
      await deleteClawAgent(agent.slug, userId);
      refreshLists();
      toast.success(`${agent.name} deleted`);
      void navigate(`${libraryPath}?tab=agents`);
    } catch (err) {
      toast.error(clawErrorText(err, 'Failed to delete agent'));
      setDeleting(false);
    }
  };

  const clone = async (name: string): Promise<void> => {
    if (!agent || !userId || cloning) return;
    setCloning(true);
    try {
      const result = await cloneClawAgent(agent.slug, userId, name);
      refreshLists();
      if (result.cloned && result.agent) {
        toast.success(`Cloned “${agent.name}”`, { description: `Saved as ${result.agent.name}.` });
        void navigate(`${libraryPath}?tab=agents`);
      } else {
        toast.success('Clone request sent', {
          description: `${agent.name}’s owner will review it.`,
        });
      }
    } catch (err) {
      if (err instanceof ClawApiError && err.status === 409) {
        toast.info('Request already pending');
      } else {
        toast.error(clawErrorText(err, 'Clone failed'));
      }
    } finally {
      setCloning(false);
    }
  };

  const publish = async (): Promise<void> => {
    if (!agent || !userId || publishing) return;
    setPublishing(true);
    try {
      await submitClawAgentRequest(agent.slug, userId, 'push_to_global');
      toast.success('Publish request sent', { description: 'An admin will review it.' });
    } catch (err) {
      toast.error(clawErrorText(err, 'Publish failed'));
    } finally {
      setPublishing(false);
    }
  };

  const moderate = async (action: ModerationAction): Promise<void> => {
    if (!agent || !userId || moderating) return;
    setModerating(action);
    const previous = agent;
    const scope = action === 'promote' ? 'global' : 'personal';
    queryClient.setQueryData(clawAgentDetailKey(agent.slug), { ...agent, scope });
    try {
      if (action === 'promote') await promoteClawAgent(agent.slug, userId);
      else await demoteClawAgent(agent.slug, userId);
      refreshLists();
      void queryClient.invalidateQueries({ queryKey: clawAgentDetailKey(agent.slug) });
      toast.success(
        `${agent.name} ${action === 'promote' ? 'promoted to global' : 'demoted to personal'}`,
      );
    } catch (err) {
      queryClient.setQueryData(clawAgentDetailKey(agent.slug), previous);
      toast.error(clawErrorText(err, action === 'promote' ? 'Promote failed' : 'Demote failed'));
    } finally {
      setModerating(null);
    }
  };

  const rename = async (nextSlug: string): Promise<void> => {
    if (!agent || !isOwner || renaming) return;
    setRenaming(true);
    try {
      const updated = await updateClawAgent(agent.slug, { slug: nextSlug });
      queryClient.removeQueries({ queryKey: clawAgentDetailKey(agent.slug), exact: true });
      queryClient.setQueryData(clawAgentDetailKey(nextSlug), updated);
      refreshLists();
      toast.success(`Handle renamed to @${nextSlug}`);
      void navigate(detailPath(nextSlug), { replace: true });
    } catch (err) {
      if (err instanceof ClawApiError && err.status === 409) {
        throw new Error(`The handle “${nextSlug}” is already in use.`);
      }
      throw new Error(clawErrorText(err, 'Could not rename this handle'));
    } finally {
      setRenaming(false);
    }
  };

  return {
    permissions,
    isAdmin,
    isOwner,
    busy: { toggling, deleting, cloning, publishing, moderating, renaming },
    toggleEnabled,
    remove,
    clone,
    publish,
    moderate,
    rename,
  };
}
