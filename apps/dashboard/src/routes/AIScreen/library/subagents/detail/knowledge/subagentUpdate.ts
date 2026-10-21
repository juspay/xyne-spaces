import { toast } from 'sonner';
import { useUpdateClawSubagent } from '@/hooks/useClawSubagents';
import { clawErrorText } from '@/services/claw/clawRequest';
import type { SubagentDef, SubagentInputBody } from '@/services/claw/clawSubagentsTypes';

const TOAST_ID = 'subagent-save';

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
  save: (patch: Partial<SubagentInputBody>, message: string) => Promise<void>;
}

export function useSaveSubagent(def: SubagentDef): SaveSubagent {
  const update = useUpdateClawSubagent(def.name);

  const save = async (patch: Partial<SubagentInputBody>, message: string): Promise<void> => {
    try {
      await update.mutateAsync(toSubagentBody(def, patch));
      toast.success(message, { id: TOAST_ID });
    } catch (err) {
      toast.error(clawErrorText(err, 'Could not update this subagent'), { id: TOAST_ID });
    }
  };

  return { save };
}
