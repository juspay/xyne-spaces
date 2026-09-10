import { ReactElement, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ToolboxPicker } from '@/components/ClawAgents/ToolboxPicker/ToolboxPicker';
import { useClawAvailableTools } from '@/hooks/useClawAvailableTools';
import { clawAgentDetailKey } from '@/hooks/useClawAgentDetail';
import { updateClawAgent } from '@/services/claw/clawAuthAgentsService';
import {
  applyTools,
  EMPTY_TOOLS_DRAFT,
  readToolsDraft,
  toolsDirty,
  type ToolsDraft,
} from '@/services/claw/toolsConfig';
import type { Agent } from '@/services/claw/clawAuthAgentTypes';
import type { AgentPermissions } from '@/services/claw/agentPermissions';
import type { ToolboxSelection } from '@/services/claw/clawToolsTypes';
import { ChipList, DetailSection, EmptyPanel, humanizeKey } from './detailTabUtils';

interface ToolsTabProps {
  agent: Agent;
  permissions: AgentPermissions;
}

const permissionLabel = (permission: string): string =>
  permission ? humanizeKey(permission.toLowerCase()) : 'Allowed';

/**
 * Tools tab — the agent's toolbox (subagents, MCP/gateway integrations, and
 * built-in tools). Editable by anyone with `canEdit` (owner/editor/contributor,
 * same gate as Knowledge). Owns its own Save button, separate from the
 * header's Persona/Behaviour save — same convention as ModelProviderTab /
 * KnowledgeTab. Non-editors keep the original read-only summary.
 */
const ToolsTab = ({ agent, permissions }: ToolsTabProps): ReactElement => {
  const canEdit = permissions.canEdit;
  const queryClient = useQueryClient();
  const { data: availableTools, isLoading: toolsLoading } = useClawAvailableTools();

  const [draft, setDraft] = useState<ToolsDraft>(EMPTY_TOOLS_DRAFT);
  const [saving, setSaving] = useState(false);

  // Seed on mount / when the agent identity changes.
  useEffect(() => {
    setDraft(readToolsDraft(agent.config));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent.id]);

  const dirty = toolsDirty(agent.config, draft);

  const handleSave = async (): Promise<void> => {
    if (!canEdit || !dirty || saving) return;
    setSaving(true);
    try {
      const updated = await updateClawAgent(agent.slug, {
        config: applyTools(agent.config, draft),
      });
      queryClient.setQueryData(clawAgentDetailKey(agent.slug), updated);
      void queryClient.invalidateQueries({ queryKey: ['claw-auth-agents'] });
      setDraft(readToolsDraft(updated.config));
      toast.success('Tools saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  if (!canEdit) {
    const expandedTools = agent.tools ?? [];
    const configTools = readToolsDraft(agent.config);
    const configuredCount =
      configTools.subagents.length +
      configTools.direct.length +
      configTools.custom.length +
      configTools.gateway.length;
    const hasTools = expandedTools.length > 0 || configuredCount > 0;

    if (!hasTools) {
      return (
        <div className='max-w-2xl'>
          <EmptyPanel
            title='No tools attached'
            description='This agent can still answer from its prompt, but it has no delegated actions or connectors configured.'
          />
        </div>
      );
    }

    return (
      <div className='flex max-w-2xl flex-col gap-6'>
        {expandedTools.length > 0 && (
          <DetailSection
            title='Expanded tools'
            description='Tools resolved by the backend for this agent.'
          >
            <div className='divide-y divide-border overflow-hidden rounded-lg border border-border'>
              {expandedTools.map(agentTool => (
                <div
                  key={agentTool.id}
                  className='flex items-start justify-between gap-4 px-3 py-3'
                >
                  <div className='min-w-0'>
                    <p className='truncate text-sm font-medium text-foreground'>
                      {agentTool.tool.name}
                    </p>
                    {agentTool.tool.description && (
                      <p className='mt-0.5 line-clamp-2 text-xs text-muted-foreground'>
                        {agentTool.tool.description}
                      </p>
                    )}
                    <p className='mt-1 font-mono text-[11px] text-muted-foreground'>
                      {agentTool.tool.source} / {agentTool.tool.slug}
                    </p>
                  </div>
                  <Badge variant='secondary'>{permissionLabel(agentTool.permission)}</Badge>
                </div>
              ))}
            </div>
          </DetailSection>
        )}

        {configuredCount > 0 && (
          <DetailSection
            title='Configured toolbox'
            description='Raw toolbox selections saved on the agent config.'
          >
            <div className='flex flex-col gap-4 rounded-lg border border-border p-4'>
              {configTools.subagents.length > 0 && (
                <div className='flex flex-col gap-2'>
                  <span className='text-xs font-medium uppercase tracking-wide text-muted-foreground'>
                    Subagents
                  </span>
                  <ChipList values={configTools.subagents} />
                </div>
              )}
              {configTools.direct.length > 0 && (
                <div className='flex flex-col gap-2'>
                  <span className='text-xs font-medium uppercase tracking-wide text-muted-foreground'>
                    MCP tools
                  </span>
                  <ChipList values={configTools.direct} />
                </div>
              )}
              {configTools.gateway.length > 0 && (
                <div className='flex flex-col gap-2'>
                  <span className='text-xs font-medium uppercase tracking-wide text-muted-foreground'>
                    Gateway tools
                  </span>
                  <ChipList values={configTools.gateway} />
                </div>
              )}
              {configTools.custom.length > 0 && (
                <div className='flex flex-col gap-2'>
                  <span className='text-xs font-medium uppercase tracking-wide text-muted-foreground'>
                    Built-in tools
                  </span>
                  <ChipList values={configTools.custom} />
                </div>
              )}
            </div>
          </DetailSection>
        )}
      </div>
    );
  }

  return (
    <div className='flex flex-col gap-4'>
      <DetailSection
        title='Tools'
        description='Subagents, integrations, and built-in tools this agent can use during a run.'
      >
        <ToolboxPicker
          variant='large'
          largeHeight='clamp(420px, calc(100vh - 340px), 720px)'
          availableTools={availableTools ?? null}
          loading={toolsLoading}
          value={draft}
          onChange={(next: ToolboxSelection) =>
            setDraft({
              subagents: next.subagents,
              direct: next.direct,
              custom: next.custom,
              gateway: next.gateway ?? [],
            })
          }
          suggestContext={{
            ...(agent.systemPrompt ? { systemPrompt: agent.systemPrompt } : {}),
            ...(agent.description ? { description: agent.description } : {}),
          }}
          showCaption={false}
        />
      </DetailSection>

      <div className='flex items-center gap-3 border-t border-border pt-4'>
        <Button
          type='button'
          size='sm'
          loading={saving}
          disabled={!dirty}
          onClick={() => void handleSave()}
          data-track-category='Claw Agents'
          data-track-name='SAVE_TOOLS'
        >
          {saving ? 'Saving…' : 'Save changes'}
        </Button>
        {dirty && !saving && <span className='text-xs text-muted-foreground'>Unsaved changes</span>}
      </div>
    </div>
  );
};

export default ToolsTab;
