import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { useUpdateClawSubagent } from '@/hooks/useClawSubagents';
import { clawErrorText } from '@/services/claw/clawRequest';
import { fromToolboxSelection } from '@/services/claw/subagentToolsBridge';
import type { AvailableTools } from '@/services/claw/clawToolsTypes';
import type { SubagentDef } from '@/services/claw/clawSubagentsTypes';
import { DEFAULT_PARAM_NAME, type SubagentWizardState } from './subagentWizardState';

export interface SaveClawSubagent {
  save: (state: SubagentWizardState, catalog: AvailableTools | null) => Promise<void>;
  saving: boolean;
}

export function useSaveClawSubagent(def: SubagentDef | undefined): SaveClawSubagent {
  const navigate = useNavigate();
  const { workspaceId } = useParams<{ workspaceId?: string }>();
  const update = useUpdateClawSubagent(def?.name ?? '');
  const [saving, setSaving] = useState(false);

  const save = async (
    state: SubagentWizardState,
    catalog: AvailableTools | null,
  ): Promise<void> => {
    if (!def || saving) return;
    setSaving(true);
    try {
      await update.mutateAsync({
        // The name is the permanent identifier — never re-sent as a change.
        name: def.name,
        description: state.description.trim(),
        systemPrompt: state.systemPrompt.trim(),
        paramName: state.paramName.trim() || DEFAULT_PARAM_NAME,
        paramDescription: state.paramDescription.trim(),
        progressLabels: state.progressLabels.map(label => label.trim()).filter(Boolean),
        tools: fromToolboxSelection(state.tools, catalog),
        skillIds: state.skillIds,
        ...(def.mcpInstanceMap ? { mcpInstanceMap: def.mcpInstanceMap } : {}),
      });

      toast.success('Changes saved');
      const base = workspaceId ? `/${workspaceId}/ai/library` : '/ai/library';
      void navigate(`${base}/subagent/${encodeURIComponent(def.name)}?tab=persona`);
    } catch (err) {
      toast.error(clawErrorText(err, 'Could not save this subagent'));
    } finally {
      setSaving(false);
    }
  };

  return { save, saving };
}
