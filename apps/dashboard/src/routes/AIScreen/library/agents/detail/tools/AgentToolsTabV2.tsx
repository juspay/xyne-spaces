import { useMemo, useState, type ReactElement } from 'react';
import { Loader2 } from 'lucide-react';
import type { Agent } from '@/services/claw/clawAuthAgentTypes';
import type { ToolboxSelection } from '@/services/claw/clawToolsTypes';
import { BrowseBuiltinToolsDialog } from '../../../shared/pickers/builtin/BrowseBuiltinToolsDialog';
import {
  disableEntry as disableBuiltinEntry,
  isEntryEnabled as isBuiltinEnabled,
  selectedTools as selectedBuiltinTools,
} from '../../../shared/pickers/builtin/builtinCatalog';
import { useBuiltinCatalog } from '../../../shared/pickers/builtin/useBuiltinCatalog';
import { BrowseMcpsDialog } from '../../../shared/pickers/mcp/BrowseMcpsDialog';
import {
  disableEntry as disableMcpEntry,
  humanizeToolName,
  isEntryEnabled as isMcpEnabled,
  selectedTools as selectedMcpTools,
} from '../../../shared/pickers/mcp/mcpCatalog';
import { useMcpCatalog } from '../../../shared/pickers/mcp/useMcpCatalog';
import { BrowseSubagentsDialog } from '../../../shared/pickers/subagent/BrowseSubagentsDialog';
import {
  disableSubagent,
  isSubagentSelected,
} from '../../../shared/pickers/subagent/subagentCatalog';
import { useSubagentCatalog } from '../../../shared/pickers/subagent/useSubagentCatalog';
import {
  DetailLockedNote,
  DetailSection,
  ReadOnlyBadge,
} from '../../../shared/primitives/DetailPrimitives';
import { DetailListCard, type DetailListItem } from '../../../shared/primitives/DetailListCard';
import {
  useAgentToolSelection,
  type ManageSectionId,
  type ToolSelection,
} from './useAgentToolSelection';
import { useCallableAgents } from '../../../shared/pickers/callableAgent/useCallableAgents';
import { BrowseCallableAgentsDialog } from '../../../shared/pickers/callableAgent/BrowseCallableAgentsDialog';
import { DelegationStatusBadge } from './DelegationStatusBadge';

const LOCK_NOTE = 'Only the owner, a contributor, or an admin can change this agent’s tools.';

function toolCountLabel(count: number): string {
  return `${count} ${count === 1 ? 'tool' : 'tools'}`;
}

function ManageButton({ label, onClick }: { label: string; onClick: () => void }): ReactElement {
  return (
    <button
      type='button'
      onClick={onClick}
      aria-label={label}
      data-track-category='Claw Agents'
      data-track-name='Agent detail v2: manage tools'
      className='flex h-6 shrink-0 items-center rounded-md bg-muted px-1.5 text-sm leading-5 text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground'
    >
      Manage
    </button>
  );
}

export function AgentToolsTabV2({
  agent,
  canEdit,
}: {
  agent: Agent;
  canEdit: boolean;
}): ReactElement {
  const tools = useAgentToolSelection(agent);
  const subagents = useSubagentCatalog();
  const mcp = useMcpCatalog();
  const builtin = useBuiltinCatalog();

  const { saved } = tools;
  // Deliberately NOT routed through tools.openManage/closeManage: that flow
  // captures a draft on open and re-persists it on close, which would undo an
  // add made while the dialog was open (the grant call writes config itself).
  const [agentsPickerOpen, setAgentsPickerOpen] = useState(false);
  const callable = useCallableAgents({
    agentSlug: agent.slug,
    agentOwnerUserId: agent.ownerUserId,
    selected: saved.callableAgents,
    onSelectedChange: callableAgents =>
      tools.commit({ ...saved, callableAgents }, 'Agents updated'),
  });

  // The shared pickers only know the four toolbox lists. Re-attach the callable
  // agents so a subagent/MCP/built-in edit never writes them out of the config.
  const withCallableAgents = (next: Required<ToolboxSelection>): ToolSelection => ({
    ...next,
    callableAgents: tools.draft.callableAgents,
  });

  const subagentItems = useMemo<DetailListItem[]>(
    () =>
      subagents.entries
        .filter(entry => isSubagentSelected(saved, entry))
        .map(entry => ({
          key: entry.name,
          iconType: entry.serverType,
          name: entry.name,
          description: entry.description,
        })),
    [subagents.entries, saved],
  );

  const mcpItems = useMemo<DetailListItem[]>(
    () =>
      mcp.entries
        .filter(entry => isMcpEnabled(saved, entry))
        .map(entry => {
          const picked = selectedMcpTools(saved, entry);
          return {
            key: entry.slug,
            iconType: entry.iconType,
            name: entry.label,
            description:
              entry.description || picked.map(tool => humanizeToolName(tool.name)).join(', '),
            meta: toolCountLabel(picked.length),
          };
        }),
    [mcp.entries, saved],
  );

  const builtinItems = useMemo<DetailListItem[]>(
    () =>
      builtin.entries
        .filter(entry => isBuiltinEnabled(saved, entry))
        .map(entry => {
          const picked = selectedBuiltinTools(saved, entry);
          return {
            key: entry.source,
            iconType: '',
            name: entry.label,
            description: picked.map(tool => humanizeToolName(tool.name)).join(', '),
            meta: toolCountLabel(picked.length),
          };
        }),
    [builtin.entries, saved],
  );

  const callableItems = useMemo<DetailListItem[]>(
    () =>
      callable.catalog
        .filter(entry => entry.status !== null)
        .map(entry => ({
          key: entry.slug,
          iconType: '',
          name: entry.name,
          description: entry.description || `@${entry.slug}`,
          badge: (
            <DelegationStatusBadge status={entry.status ?? 'missing'} ownerName={entry.ownerName} />
          ),
        })),
    [callable.catalog],
  );

  const note = canEdit ? null : <DetailLockedNote>{LOCK_NOTE}</DetailLockedNote>;

  /** Manage opens the same browse dialog the create flow uses; read-only says why. */
  const trailingFor = (label: string, section: ManageSectionId): ReactElement =>
    canEdit ? (
      <ManageButton label={`Manage ${label}`} onClick={() => tools.openManage(section)} />
    ) : (
      <ReadOnlyBadge />
    );

  return (
    <div className='flex w-full flex-col gap-8'>
      <DetailSection
        label='Subagents'
        info='Specialists this agent can delegate a whole task to'
        trailing={trailingFor('subagents', 'subagents')}
        trailingAlign='end'
      >
        <DetailListCard
          items={subagentItems}
          loading={subagents.loading}
          emptyLabel='No subagents added yet.'
          canEdit={canEdit}
          note={note}
          removeLabel={item => `Remove ${item.name}`}
          onRemove={item => {
            const entry = subagents.entries.find(candidate => candidate.name === item.key);
            if (!entry) return;
            tools.commit(withCallableAgents(disableSubagent(saved, entry)), `${item.name} removed`);
          }}
        />
      </DetailSection>

      <DetailSection
        label='Agents'
        info='Other agents this agent can hand a task to, once their owner approves'
        trailing={
          canEdit ? (
            <ManageButton label='Manage agents' onClick={() => setAgentsPickerOpen(true)} />
          ) : (
            <ReadOnlyBadge />
          )
        }
        trailingAlign='end'
      >
        <DetailListCard
          items={callableItems}
          loading={callable.loading}
          emptyLabel='No agents added yet.'
          canEdit={canEdit}
          note={note}
          removeLabel={item => `Remove ${item.name}`}
          onRemove={item => callable.remove(item.key)}
        />
      </DetailSection>

      <DetailSection
        label='MCP Tools'
        info='Tools this agent calls directly on connected integrations'
        trailing={trailingFor('MCP tools', 'mcp')}
        trailingAlign='end'
      >
        <DetailListCard
          items={mcpItems}
          loading={mcp.loading}
          emptyLabel='No MCP tools added yet.'
          canEdit={canEdit}
          note={note}
          removeLabel={item => `Remove ${item.name}`}
          onRemove={item => {
            const entry = mcp.entries.find(candidate => candidate.slug === item.key);
            if (!entry) return;
            tools.commit(
              withCallableAgents(disableMcpEntry(mcp.entries, saved, entry)),
              `${item.name} removed`,
            );
          }}
        />
      </DetailSection>

      <DetailSection
        label='Built-In tools'
        info='Tools that ship with the platform, no connection needed'
        trailing={trailingFor('built-in tools', 'builtin')}
        trailingAlign='end'
      >
        <DetailListCard
          items={builtinItems}
          loading={builtin.loading}
          emptyLabel='No built-in tools added yet.'
          canEdit={canEdit}
          note={note}
          removeLabel={item => `Remove ${item.name}`}
          onRemove={item => {
            const entry = builtin.entries.find(candidate => candidate.source === item.key);
            if (!entry) return;
            tools.commit(
              withCallableAgents(disableBuiltinEntry(saved, entry)),
              `${item.name} removed`,
            );
          }}
        />
      </DetailSection>

      {tools.saving && (
        <span className='flex items-center gap-2 text-xs font-normal leading-4 text-muted-foreground'>
          <Loader2 className='size-3.5 animate-spin' aria-hidden />
          Saving…
        </span>
      )}

      <BrowseSubagentsDialog
        open={tools.manage === 'subagents'}
        onOpenChange={open => {
          if (!open) tools.closeManage();
        }}
        catalog={subagents.entries}
        loading={subagents.loading}
        isError={subagents.isError}
        onRetry={subagents.refetch}
        selection={tools.draft}
        onSelectionChange={next => tools.setDraft(withCallableAgents(next))}
        suggested={[]}
      />

      <BrowseCallableAgentsDialog
        open={agentsPickerOpen}
        onOpenChange={setAgentsPickerOpen}
        catalog={callable.catalog}
        loading={callable.loading}
        isError={callable.isError}
        onRetry={callable.refetch}
        busySlug={callable.busySlug}
        onAdd={callable.add}
        onRemove={callable.remove}
      />

      <BrowseMcpsDialog
        open={tools.manage === 'mcp'}
        onOpenChange={open => {
          if (!open) tools.closeManage();
        }}
        catalog={mcp.entries}
        connectedServerIds={mcp.connectedServerIds}
        loading={mcp.loading}
        isError={mcp.isError}
        onRetry={mcp.refetch}
        selection={tools.draft}
        onSelectionChange={next => tools.setDraft(withCallableAgents(next))}
        suggested={[]}
      />

      <BrowseBuiltinToolsDialog
        open={tools.manage === 'builtin'}
        onOpenChange={open => {
          if (!open) tools.closeManage();
        }}
        catalog={builtin.entries}
        loading={builtin.loading}
        isError={builtin.isError}
        onRetry={builtin.refetch}
        selection={tools.draft}
        onSelectionChange={next => tools.setDraft(withCallableAgents(next))}
        suggested={[]}
      />
    </div>
  );
}
