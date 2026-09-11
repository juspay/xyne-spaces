import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { useIsClawAdmin } from '@/hooks/useIsClawAdmin';
import { useToggleClawSubagent } from '@/hooks/useClawSubagents';
import { clawErrorText } from '@/services/claw/clawRequest';
import {
  getSubagentPermissions,
  type SubagentDef,
  type SubagentPermissions,
} from '@/services/claw/clawSubagentsTypes';

export interface SubagentDetailActions {
  permissions: SubagentPermissions | null;
  isAdmin: boolean;
  busy: { toggling: boolean };
  libraryPath: string;
  toggleEnabled: (next: boolean) => Promise<void>;
  /** Disabling is claw's delete for subagents — the definition is retained. */
  remove: () => Promise<void>;
}

export function useSubagentDetailActions(subagent: SubagentDef | undefined): SubagentDetailActions {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { workspaceId } = useParams<{ workspaceId?: string }>();
  const { data: isAdmin = false } = useIsClawAdmin();
  const toggle = useToggleClawSubagent();
  const [removing, setRemoving] = useState(false);

  const libraryPath = workspaceId ? `/${workspaceId}/ai/library` : '/ai/library';

  const permissions = useMemo(
    () => (subagent ? getSubagentPermissions(subagent, user?.id, isAdmin) : null),
    [subagent, user?.id, isAdmin],
  );

  const toggleEnabled = async (next: boolean): Promise<void> => {
    if (!subagent || toggle.isPending) return;
    try {
      await toggle.mutateAsync({ name: subagent.name, enabled: next });
      toast.success(next ? `${subagent.name} enabled` : `${subagent.name} disabled`);
    } catch (err) {
      toast.error(clawErrorText(err, 'Could not update this subagent'));
    }
  };

  const remove = async (): Promise<void> => {
    if (!subagent || removing) return;
    setRemoving(true);
    try {
      await toggle.mutateAsync({ name: subagent.name, enabled: false });
      toast.success(`${subagent.name} removed`);
      void navigate(`${libraryPath}?tab=subagents`);
    } catch (err) {
      toast.error(clawErrorText(err, 'Could not remove this subagent'));
      setRemoving(false);
    }
  };

  return {
    permissions,
    isAdmin,
    busy: { toggling: toggle.isPending },
    libraryPath,
    toggleEnabled,
    remove,
  };
}
