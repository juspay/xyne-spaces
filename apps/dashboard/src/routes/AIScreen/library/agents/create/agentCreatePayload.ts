import type { AgentCreateFormState } from '@/components/flowUI/nodes/agent/create/types';
import { AVATAR_KEY_CONFIG } from '@/components/agents/agentAvatarKey';
import { normalizePermissionMode } from '@/components/flowUI/nodes/agent/create/agentPromptContract';
import { schedulePromptLine } from '@/components/flowUI/nodes/agent/create/agentSchedule';
import { customPropertyPromptLine } from '@/components/flowUI/nodes/agent/create/customProperty';
import type { CreateAgentPayload } from '@/services/claw/clawAgentWizardService';

export const AGENT_PROPERTIES_HEADING = '## Agent properties';

/**
 * The properties and schedule, as a section appended to the saved instructions,
 * so the running agent actually sees them. Empty when there is nothing to say.
 * Built at save time; the editable Instructions field never contains it.
 */
export function agentPropertiesSection(
  form: Pick<AgentCreateFormState, 'customProperties' | 'schedule'>,
): string {
  const lines = form.customProperties
    .map(customPropertyPromptLine)
    .filter((line): line is string => line !== null);
  if (form.schedule) lines.push(schedulePromptLine(form.schedule));
  if (lines.length === 0) return '';
  return [AGENT_PROPERTIES_HEADING, '', ...lines.map(line => `- ${line}`)].join('\n');
}

/**
 * One POST body for the create canvas: identity, prompt, tools, permission
 * mode, skills and knowledge together, so the agent never exists half-configured.
 */
export function buildCreateAgentPayload(
  form: AgentCreateFormState,
  slug: string,
  ownerUserId: string | undefined,
  /** The face the draft had (its id), kept so it doesn't change on Save. */
  avatarKey?: string,
): CreateAgentPayload {
  const userScopedKb = form.selectedKbScope === 'USER';
  const properties = agentPropertiesSection(form);
  return {
    slug,
    name: form.name.trim(),
    description: form.description.trim(),
    systemPrompt: properties
      ? `${form.systemPrompt.trim()}\n\n${properties}`
      : form.systemPrompt.trim(),
    color: form.color,
    kbScope: form.selectedKbScope,
    ...(ownerUserId ? { ownerUserId } : {}),
    ...(userScopedKb || form.selectedKbResources.length === 0
      ? {}
      : { knowledgeBase: form.selectedKbResources }),
    config: {
      // Model and behaviour picked in Settings while creating. The canvas-owned
      // keys below win over anything with the same name.
      ...form.settings,
      permissionMode: normalizePermissionMode(form.permissionMode),
      tools: {
        subagents: form.tools.subagents,
        direct: form.tools.direct,
        custom: form.tools.custom,
        gateway: form.tools.gateway,
        callableAgents: form.tools.callableAgents,
      },
      // Kept on the config so the agent's page can show (and later edit) them.
      ...(form.customProperties.length > 0 ? { customProperties: form.customProperties } : {}),
      ...(form.schedule ? { schedule: form.schedule } : {}),
      ...(avatarKey ? { [AVATAR_KEY_CONFIG]: avatarKey } : {}),
    },
    ...(form.selectedSkillIds.length > 0 ? { skills: [...new Set(form.selectedSkillIds)] } : {}),
  };
}
