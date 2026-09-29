import type { AgentCreateFormState } from '@/components/flowUI/nodes/agent/create/types';
import { normalizePermissionMode } from '@/components/flowUI/nodes/agent/create/agentPromptContract';
import type { CreateAgentPayload } from '@/services/claw/clawAgentWizardService';

/**
 * One POST body for the create canvas: identity, prompt, tools, permission
 * mode, skills and knowledge together, so the agent never exists half-configured.
 */
export function buildCreateAgentPayload(
  form: AgentCreateFormState,
  slug: string,
  ownerUserId: string | undefined,
): CreateAgentPayload {
  const userScopedKb = form.selectedKbScope === 'USER';
  return {
    slug,
    name: form.name.trim(),
    description: form.description.trim(),
    systemPrompt: form.systemPrompt.trim(),
    color: form.color,
    kbScope: form.selectedKbScope,
    ...(ownerUserId ? { ownerUserId } : {}),
    ...(userScopedKb || form.selectedKbResources.length === 0
      ? {}
      : { knowledgeBase: form.selectedKbResources }),
    config: {
      permissionMode: normalizePermissionMode(form.permissionMode),
      tools: {
        subagents: form.tools.subagents,
        direct: form.tools.direct,
        custom: form.tools.custom,
        gateway: form.tools.gateway,
        callableAgents: form.tools.callableAgents,
      },
    },
    ...(form.selectedSkillIds.length > 0 ? { skills: [...new Set(form.selectedSkillIds)] } : {}),
  };
}
