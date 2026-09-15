import { useState } from 'react';
import { toast } from 'sonner';
import { useUpdateClawSubagent } from '@/hooks/useClawSubagents';
import { clawErrorText } from '@/services/claw/clawRequest';
import type { SubagentDef, SubagentInputBody } from '@/services/claw/clawSubagentsTypes';

export function toSubagentBody(
  def: SubagentDef,
  patch: Partial<SubagentInputBody> = {},
): SubagentInputBody {
  return {
    name: def.name,
    description: def.description,
    progressLabels: def.progressLabels,
    systemPrompt: def.systemPrompt,
    paramName: def.paramName,
    paramDescription: def.paramDescription,
    tools: { direct: def.tools?.direct ?? [], custom: def.tools?.custom ?? [] },
    skillIds: def.skills.map(skill => skill.id),
    ...(def.mcpInstanceMap ? { mcpInstanceMap: def.mcpInstanceMap } : {}),
    ...patch,
  };
}

export interface SaveSubagent {
  save: (patch: Partial<SubagentInputBody>, message: string) => Promise<boolean>;
  saving: boolean;
}

export function useSaveSubagent(def: SubagentDef): SaveSubagent {
  const update = useUpdateClawSubagent(def.name);
  const [saving, setSaving] = useState(false);

  const save = async (patch: Partial<SubagentInputBody>, message: string): Promise<boolean> => {
    if (saving) return false;
    setSaving(true);
    try {
      await update.mutateAsync(toSubagentBody(def, patch));
      toast.success(message);
      return true;
    } catch (err) {
      toast.error(clawErrorText(err, 'Could not update this subagent'));
      return false;
    } finally {
      setSaving(false);
    }
  };

  return { save, saving };
}
