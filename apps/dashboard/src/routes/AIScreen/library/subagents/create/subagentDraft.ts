import { toToolboxSelection } from '@/services/claw/subagentToolsBridge';
import type { AvailableTools, ToolboxSelection } from '@/services/claw/clawToolsTypes';
import type { SubagentDef } from '@/services/claw/clawSubagentsTypes';
import {
  DEFAULT_PARAM_NAME,
  INITIAL_SUBAGENT_STATE,
  type SubagentWizardState,
} from './subagentWizardState';

export function wizardStateFromSubagent(
  def: SubagentDef,
  catalog: AvailableTools | null,
): SubagentWizardState {
  return {
    ...INITIAL_SUBAGENT_STATE,
    name: def.name,
    description: def.description,
    paramName: def.paramName || DEFAULT_PARAM_NAME,
    paramDescription: def.paramDescription,
    systemPrompt: def.systemPrompt,
    tools: toToolboxSelection(def.tools, catalog) as Required<ToolboxSelection>,
    progressLabels:
      def.progressLabels.length > 0 ? def.progressLabels : INITIAL_SUBAGENT_STATE.progressLabels,
    skillIds: def.skills.map(skill => skill.id),
  };
}
