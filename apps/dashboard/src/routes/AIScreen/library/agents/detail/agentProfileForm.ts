import type { KbSelection } from '@/services/claw/clawKnowledgeBaseTypes';
import type { Agent, UpdateAgentPayload } from '@/services/claw/clawAuthAgentTypes';
import { normalizePermissionMode } from '@/components/flowUI/nodes/agent/create/agentPromptContract';
import { parseCreateSchedule } from '@/components/flowUI/nodes/agent/create/agentSchedule';
import { parseCustomProperties } from '@/components/flowUI/nodes/agent/create/customProperty';
import {
  EMPTY_CREATE_FORM,
  toolIdsFromForm,
  type AgentCreateFormState,
} from '@/components/flowUI/nodes/agent/create/types';
import { AGENT_PROPERTIES_HEADING, agentPropertiesSection } from '../create/agentCreatePayload';
import { readToolSelection } from '../create/agentDraft';

const HANDLE_REGEX = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

export function validateHandle(handle: string): string | null {
  if (!handle) return 'Handle is required.';
  if (handle.length < 2) return 'Handle must be at least 2 characters.';
  if (handle.length > 64) return 'Handle must be 64 characters or fewer.';
  if (!HANDLE_REGEX.test(handle)) {
    return 'Use lowercase letters, digits, and hyphens, with no leading or trailing hyphen.';
  }
  return null;
}

/**
 * The instructions as the user wrote them. Save appends a generated
 * "## Agent properties" section (see agentPropertiesSection); it is rebuilt
 * from the properties on every save, so the editable field never shows it.
 */
export function instructionsFromSaved(systemPrompt: string): string {
  const at = systemPrompt.lastIndexOf(`\n\n${AGENT_PROPERTIES_HEADING}\n`);
  if (at >= 0) return systemPrompt.slice(0, at).trimEnd();
  return systemPrompt.startsWith(`${AGENT_PROPERTIES_HEADING}\n`) ? '' : systemPrompt;
}

/** A saved agent as the profile canvas shows it. */
export function formFromAgent(agent: Agent): AgentCreateFormState {
  const config = agent.config ?? {};
  return {
    ...EMPTY_CREATE_FORM,
    name: agent.name,
    slug: agent.slug,
    slugManual: true,
    description: agent.description ?? '',
    systemPrompt: instructionsFromSaved(agent.systemPrompt ?? ''),
    color: agent.color || EMPTY_CREATE_FORM.color,
    permissionMode: normalizePermissionMode(config['permissionMode']),
    tools: readToolSelection(config),
    selectedSkillIds: (agent.skills ?? []).map(entry => entry.skillId),
    selectedKbScope: agent.kbScope === 'USER' ? 'USER' : 'COLLECTIONS',
    selectedKbResources: (agent.collections ?? []).map(entry => ({
      collectionId: entry.collectionId,
      ...(entry.fileId ? { fileId: entry.fileId } : {}),
    })) as KbSelection[],
    schedule: parseCreateSchedule(config['schedule']),
    customProperties: parseCustomProperties(config['customProperties']),
  };
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * Only what changed since `baseline` (the agent as loaded), so an untouched
 * prompt doesn't cut a new prompt version. The config is written over `config`,
 * the agent's latest, so settings changed meanwhile aren't lost.
 */
export function buildUpdateAgentPayload(
  form: AgentCreateFormState,
  baseline: AgentCreateFormState,
  config: Record<string, unknown>,
  canRenameHandle: boolean,
): UpdateAgentPayload {
  const payload: UpdateAgentPayload = {};
  const slug = form.slug.trim().toLowerCase();
  if (form.name.trim() !== baseline.name) payload.name = form.name.trim();
  if (form.description.trim() !== baseline.description.trim()) {
    payload.description = form.description.trim();
  }
  if (canRenameHandle && slug !== baseline.slug) payload.slug = slug;

  const propertiesChanged =
    !same(form.customProperties, baseline.customProperties) ||
    !same(form.schedule, baseline.schedule);
  if (form.systemPrompt.trim() !== baseline.systemPrompt.trim() || propertiesChanged) {
    const properties = agentPropertiesSection(form);
    const prompt = form.systemPrompt.trim();
    payload.systemPrompt = properties ? `${prompt}\n\n${properties}` : prompt;
  }

  const toolsChanged =
    !same(toolIdsFromForm(form), toolIdsFromForm(baseline)) ||
    !same(form.tools.callableAgents, baseline.tools.callableAgents);
  if (toolsChanged || propertiesChanged || form.permissionMode !== baseline.permissionMode) {
    const next: Record<string, unknown> = {
      ...config,
      permissionMode: normalizePermissionMode(form.permissionMode),
      tools: {
        subagents: form.tools.subagents,
        direct: form.tools.direct,
        custom: form.tools.custom,
        gateway: form.tools.gateway,
        callableAgents: form.tools.callableAgents,
      },
    };
    if (form.customProperties.length > 0) next['customProperties'] = form.customProperties;
    else delete next['customProperties'];
    if (form.schedule) next['schedule'] = form.schedule;
    else delete next['schedule'];
    payload.config = next;
  }

  if (!same([...new Set(form.selectedSkillIds)], [...new Set(baseline.selectedSkillIds)])) {
    payload.skills = [...new Set(form.selectedSkillIds)];
  }
  if (
    form.selectedKbScope !== baseline.selectedKbScope ||
    !same(form.selectedKbResources, baseline.selectedKbResources)
  ) {
    // A USER-scoped agent follows the running user's own access: no grants sent,
    // matching what the create flow and the old Knowledge tab write.
    payload.kbScope = form.selectedKbScope;
    if (form.selectedKbScope !== 'USER') payload.knowledgeBase = form.selectedKbResources;
  }
  return payload;
}
