import { useMemo, useState, type ReactElement } from 'react';
import type { AgentIdentity } from '@xyne/shared';
import { DetailSection } from '../../../../../routes/AIScreen/library/shared/primitives/DetailPrimitives';
import {
  DetailListCard,
  type DetailListItem,
} from '../../../../../routes/AIScreen/library/shared/primitives/DetailListCard';
import { BrowseSubagentsDialog } from '../../../../../routes/AIScreen/library/shared/pickers/subagent/BrowseSubagentsDialog';
import { useSubagentCatalog } from '../../../../../routes/AIScreen/library/shared/pickers/subagent/useSubagentCatalog';
import {
  disableSubagent,
  isSubagentSelected,
} from '../../../../../routes/AIScreen/library/shared/pickers/subagent/subagentCatalog';
import { BrowseMcpsDialog } from '../../../../../routes/AIScreen/library/shared/pickers/mcp/BrowseMcpsDialog';
import { useMcpCatalog } from '../../../../../routes/AIScreen/library/shared/pickers/mcp/useMcpCatalog';
import {
  disableEntry as disableMcpEntry,
  humanizeToolName,
  isEntryEnabled as isMcpEnabled,
  selectedTools as selectedMcpTools,
} from '../../../../../routes/AIScreen/library/shared/pickers/mcp/mcpCatalog';
import { BrowseBuiltinToolsDialog } from '../../../../../routes/AIScreen/library/shared/pickers/builtin/BrowseBuiltinToolsDialog';
import { useBuiltinCatalog } from '../../../../../routes/AIScreen/library/shared/pickers/builtin/useBuiltinCatalog';
import {
  disableEntry as disableBuiltinEntry,
  isEntryEnabled as isBuiltinEnabled,
  selectedTools as selectedBuiltinTools,
} from '../../../../../routes/AIScreen/library/shared/pickers/builtin/builtinCatalog';
import type { DraftAgentEditor } from '../useDraftAgentEditor';
import { toolItemsForGroup } from './AgentPreviewTabs.utils';

type ManageSection = 'subagents' | 'mcp' | 'builtin';

function toolCountLabel(count: number): string {
  return `${count} ${count === 1 ? 'tool' : 'tools'}`;
}

function ManageButton({ label, onClick }: { label: string; onClick: () => void }): ReactElement {
  return (
    <button
      type='button'
      onClick={onClick}
      aria-label={label}
      data-track-category='AGENT_ARTIFACT'
      data-track-name='MANAGE_DRAFT_TOOLS'
      className='flex h-6 shrink-0 items-center rounded-md bg-muted px-1.5 text-sm leading-5 text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground'
    >
      Manage
    </button>
  );
}

export function AgentPreviewToolsEditor({
  agent,
  editor,
}: {
  agent: AgentIdentity;
  editor: DraftAgentEditor;
}): ReactElement {
  const subagents = useSubagentCatalog();
  const mcp = useMcpCatalog();
  const builtin = useBuiltinCatalog();
  const [manage, setManage] = useState<ManageSection | null>(null);

  const { selection } = editor;

  const subagentItems = useMemo<DetailListItem[]>(
    () =>
      subagents.entries
        .filter(entry => isSubagentSelected(selection, entry))
        .map(entry => ({
          key: entry.name,
          iconType: entry.serverType,
          name: entry.name,
          description: entry.description,
        })),
    [subagents.entries, selection],
  );

  const mcpItems = useMemo<DetailListItem[]>(
    () =>
      mcp.entries
        .filter(entry => isMcpEnabled(selection, entry))
        .map(entry => {
          const picked = selectedMcpTools(selection, entry);
          return {
            key: entry.slug,
            iconType: entry.iconType,
            name: entry.label,
            description:
              entry.description || picked.map(tool => humanizeToolName(tool.name)).join(', '),
            meta: toolCountLabel(picked.length),
          };
        }),
    [mcp.entries, selection],
  );

  const builtinItems = useMemo<DetailListItem[]>(
    () =>
      builtin.entries
        .filter(entry => isBuiltinEnabled(selection, entry))
        .map(entry => {
          const picked = selectedBuiltinTools(selection, entry);
          return {
            key: entry.source,
            iconType: '',
            name: entry.label,
            description: picked.map(tool => humanizeToolName(tool.name)).join(', '),
            meta: toolCountLabel(picked.length),
          };
        }),
    [builtin.entries, selection],
  );

  const agentItems = useMemo(
    () => toolItemsForGroup(agent.capabilities ?? [], 'agent'),
    [agent.capabilities],
  );
  const agentIdsByKey = useMemo(
    () => new Map(agentItems.map(item => [item.key, item.ids])),
    [agentItems],
  );

  const manageTrailing = (label: string, section: ManageSection): ReactElement => (
    <ManageButton label={`Manage ${label}`} onClick={(): void => setManage(section)} />
  );

  return (
    <div className='flex flex-col gap-6'>
      <DetailSection
        label='Subagents'
        info='Specialist agents this agent can hand work to'
        trailing={manageTrailing('subagents', 'subagents')}
        trailingAlign='end'
      >
        <DetailListCard
          items={subagentItems}
          loading={subagents.loading}
          emptyLabel='No subagents added yet.'
          canEdit
          removeLabel={item => `Remove ${item.name}`}
          onRemove={item => {
            const entry = subagents.entries.find(candidate => candidate.name === item.key);
            if (!entry) {
              return;
            }
            editor.setToolboxSelection(disableSubagent(selection, entry));
          }}
        />
      </DetailSection>

      <DetailSection label='Agents' info='Other agents this one can call directly'>
        <DetailListCard
          items={agentItems}
          loading={false}
          emptyLabel='No agents added yet.'
          canEdit
          removeLabel={item => `Remove ${item.name}`}
          onRemove={item => editor.removeCapabilities(agentIdsByKey.get(item.key) ?? [item.key])}
        />
      </DetailSection>

      <DetailSection
        label='MCP Tools'
        info='Connected integrations it can act through'
        trailing={manageTrailing('MCP tools', 'mcp')}
        trailingAlign='end'
      >
        <DetailListCard
          items={mcpItems}
          loading={mcp.loading}
          emptyLabel='No MCPs added yet.'
          canEdit
          removeLabel={item => `Remove ${item.name}`}
          onRemove={item => {
            const entry = mcp.entries.find(candidate => candidate.slug === item.key);
            if (!entry) {
              return;
            }
            editor.setToolboxSelection(disableMcpEntry(mcp.entries, selection, entry));
          }}
        />
      </DetailSection>

      <DetailSection
        label='Built-In tools'
        info='Capabilities that ship with the platform'
        trailing={manageTrailing('built-in tools', 'builtin')}
        trailingAlign='end'
      >
        <DetailListCard
          items={builtinItems}
          loading={builtin.loading}
          emptyLabel='No built-in tools added yet.'
          canEdit
          removeLabel={item => `Remove ${item.name}`}
          onRemove={item => {
            const entry = builtin.entries.find(candidate => candidate.source === item.key);
            if (!entry) {
              return;
            }
            editor.setToolboxSelection(disableBuiltinEntry(selection, entry));
          }}
        />
      </DetailSection>

      <BrowseSubagentsDialog
        open={manage === 'subagents'}
        onOpenChange={open => {
          if (!open) {
            setManage(null);
          }
        }}
        catalog={subagents.entries}
        loading={subagents.loading}
        isError={subagents.isError}
        onRetry={subagents.refetch}
        selection={selection}
        onSelectionChange={next => editor.setToolboxSelection(next)}
        suggested={[]}
      />

      <BrowseMcpsDialog
        open={manage === 'mcp'}
        onOpenChange={open => {
          if (!open) {
            setManage(null);
          }
        }}
        catalog={mcp.entries}
        connectedServerIds={mcp.connectedServerIds}
        orgCoveredServerIds={mcp.orgCoveredServerIds}
        loading={mcp.loading}
        isError={mcp.isError}
        onRetry={mcp.refetch}
        selection={selection}
        onSelectionChange={next => editor.setToolboxSelection(next)}
        suggested={[]}
      />

      <BrowseBuiltinToolsDialog
        open={manage === 'builtin'}
        onOpenChange={open => {
          if (!open) {
            setManage(null);
          }
        }}
        catalog={builtin.entries}
        loading={builtin.loading}
        isError={builtin.isError}
        onRetry={builtin.refetch}
        selection={selection}
        onSelectionChange={next => editor.setToolboxSelection(next)}
        suggested={[]}
      />
    </div>
  );
}
