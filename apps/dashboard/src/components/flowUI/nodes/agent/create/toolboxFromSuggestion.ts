import type { AvailableTools, ToolSuggestion } from '@/services/claw/clawToolsTypes';
import { parseGatewaySource } from '@/components/ClawAgents/gatewayKeys';
import type { AgentToolboxSelection } from '@/services/claw/clawToolsTypes';
import { EMPTY_TOOLS } from './types';

/** Additive merge of /suggest-tools into a toolbox selection (Hub ToolboxPicker). */
export function toolboxFromSuggestion(
  current: AgentToolboxSelection,
  suggestion: ToolSuggestion,
  availableTools: AvailableTools | null,
): AgentToolboxSelection {
  if (!availableTools) {
    return {
      ...current,
      subagents: [...new Set([...current.subagents, ...(suggestion.subagents ?? [])])],
    };
  }
  const subagentSet = new Set(current.subagents);
  for (const name of suggestion.subagents ?? []) subagentSet.add(name);
  const suggestedNames = new Set<string>();
  for (const sugg of suggestion.integrations ?? []) {
    for (const name of sugg.readTools ?? []) suggestedNames.add(name);
    for (const name of sugg.writeTools ?? []) suggestedNames.add(name);
  }
  const directSet = new Set(current.direct);
  const customSet = new Set(current.custom);
  for (const tool of availableTools.writeTools) {
    if (suggestedNames.has(tool.name)) directSet.add(tool.name);
  }
  for (const [source, tools] of Object.entries(availableTools.serverTools)) {
    for (const tool of tools) {
      if (suggestedNames.has(tool.name)) {
        directSet.add(parseGatewaySource(source) ? tool.slug : tool.name);
      }
    }
  }
  for (const group of availableTools.customGroups) {
    for (const tool of group.tools) {
      if (suggestedNames.has(tool.name)) customSet.add(tool.slug);
    }
  }
  return {
    subagents: Array.from(subagentSet),
    direct: Array.from(directSet),
    custom: Array.from(customSet),
    gateway: current.gateway ?? EMPTY_TOOLS.gateway,
    callableAgents: current.callableAgents,
  };
}
