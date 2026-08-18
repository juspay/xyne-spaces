import { useMemo, type ReactElement } from 'react';
import { Tools, UserBot } from '@xyne/icons';
import { Loader2 } from 'lucide-react';
import type { IntegrationToolEntry } from '@/services/claw/clawToolsTypes';
import { BrowseBuiltinToolsDialog } from '../../../shared/pickers/builtin/BrowseBuiltinToolsDialog';
import {
  selectedTools as selectedBuiltinTools,
  setToolsSelected as setBuiltinToolsSelected,
} from '../../../shared/pickers/builtin/builtinCatalog';
import { useBuiltinCatalog } from '../../../shared/pickers/builtin/useBuiltinCatalog';
import { BrowseMcpsDialog } from '../../../shared/pickers/mcp/BrowseMcpsDialog';
import { McpLogo } from '../../../shared/pickers/mcp/McpLogo';
import {
  disableEntry as disableMcpEntry,
  humanizeToolName,
  isEntryEnabled as isMcpEnabled,
} from '../../../shared/pickers/mcp/mcpCatalog';
import { useMcpCatalog } from '../../../shared/pickers/mcp/useMcpCatalog';
import { BrowseSubagentsDialog } from '../../../shared/pickers/subagent/BrowseSubagentsDialog';
import {
  disableSubagent,
  isSubagentSelected,
} from '../../../shared/pickers/subagent/subagentCatalog';
import { useSubagentCatalog } from '../../../shared/pickers/subagent/useSubagentCatalog';
import {
  CapabilityChip,
  CapabilityChipRow,
  CapabilityRow,
} from '../../../shared/primitives/CapabilityChips';
import { ChipIconTile } from '../../../shared/primitives/TokenChip';
import type { AgentToolSelection } from './useAgentToolSelection';

export function AgentToolChips({
  canEdit,
  tools,
  trackName,
  showAdd = true,
}: {
  canEdit: boolean;
  tools: AgentToolSelection;
  trackName: string;
  showAdd?: boolean;
}): ReactElement {
  const subagents = useSubagentCatalog();
  const mcp = useMcpCatalog();
  const builtin = useBuiltinCatalog();
  const { saved } = tools;

  const selectedMcps = useMemo(
    () => mcp.entries.filter(entry => isMcpEnabled(saved, entry)),
    [mcp.entries, saved],
  );

  const selectedSubagents = useMemo(
    () => subagents.entries.filter(entry => isSubagentSelected(saved, entry)),
    [subagents.entries, saved],
  );

  const pickedBuiltinTools = useMemo(() => {
    const seen = new Set<string>();
    const picked: IntegrationToolEntry[] = [];
    for (const entry of builtin.entries) {
      for (const tool of selectedBuiltinTools(saved, entry)) {
        if (seen.has(tool.slug)) continue;
        seen.add(tool.slug);
        picked.push(tool);
      }
    }
    return picked;
  }, [builtin.entries, saved]);

  return (
    <>
      <CapabilityRow
        label='MCP'
        info='Connect external apps and services your agent can use.'
        addLabel='Add MCP'
        canEdit={canEdit}
        showAdd={showAdd}
        onAdd={(): void => tools.openManage('mcp')}
        addTrackName={`${trackName}: add MCP`}
      >
        {selectedMcps.length > 0 && (
          <CapabilityChipRow>
            {selectedMcps.map(entry => (
              <CapabilityChip
                key={entry.slug}
                icon={<McpLogo type={entry.iconType} name={entry.label} />}
                label={entry.label}
                verified={entry.verified}
                removeTrackName={`${trackName}: remove chip`}
                onRemove={
                  canEdit
                    ? (): void =>
                        tools.commit(
                          disableMcpEntry(mcp.entries, saved, entry),
                          `${entry.label} removed`,
                        )
                    : undefined
                }
              />
            ))}
          </CapabilityChipRow>
        )}
      </CapabilityRow>

      <CapabilityRow
        label='Subagent'
        info='Delegate specialized tasks to focused agents.'
        addLabel='Add subagent'
        canEdit={canEdit}
        showAdd={showAdd}
        onAdd={(): void => tools.openManage('subagents')}
        addTrackName={`${trackName}: add subagent`}
      >
        {selectedSubagents.length > 0 && (
          <CapabilityChipRow>
            {selectedSubagents.map(entry => (
              <CapabilityChip
                key={entry.name}
                icon={
                  <ChipIconTile>
                    <UserBot className='size-4' variant='Solid' />
                  </ChipIconTile>
                }
                label={entry.name}
                removeTrackName={`${trackName}: remove chip`}
                onRemove={
                  canEdit
                    ? (): void =>
                        tools.commit(disableSubagent(saved, entry), `${entry.name} removed`)
                    : undefined
                }
              />
            ))}
          </CapabilityChipRow>
        )}
      </CapabilityRow>

      <CapabilityRow
        label='Built in tools'
        info='Let your agent search, create, and take action.'
        addLabel='Add built-in tools'
        canEdit={canEdit}
        showAdd={showAdd}
        onAdd={(): void => tools.openManage('builtin')}
        addTrackName={`${trackName}: add built-in tools`}
      >
        {pickedBuiltinTools.length > 0 && (
          <CapabilityChipRow gap='tight'>
            {pickedBuiltinTools.map(tool => (
              <CapabilityChip
                key={tool.slug}
                radius='12'
                icon={
                  <ChipIconTile>
                    <Tools className='size-4' variant='Solid' />
                  </ChipIconTile>
                }
                label={humanizeToolName(tool.name)}
                removeTrackName={`${trackName}: remove chip`}
                onRemove={
                  canEdit
                    ? (): void =>
                        tools.commit(
                          setBuiltinToolsSelected(saved, [tool], false),
                          `${humanizeToolName(tool.name)} removed`,
                        )
                    : undefined
                }
              />
            ))}
          </CapabilityChipRow>
        )}
      </CapabilityRow>

      {tools.saving && (
        <span className='flex items-center gap-2 text-xs font-normal leading-4 text-muted-foreground'>
          <Loader2 className='size-3.5 animate-spin' aria-hidden />
          Saving…
        </span>
      )}

      {showAdd && (
        <>
          <BrowseMcpsDialog
            open={tools.manage === 'mcp'}
            onOpenChange={(open): void => {
              if (!open) tools.closeManage();
            }}
            catalog={mcp.entries}
            connectedServerIds={mcp.connectedServerIds}
            loading={mcp.loading}
            isError={mcp.isError}
            onRetry={mcp.refetch}
            selection={tools.draft}
            onSelectionChange={tools.setDraft}
            suggested={[]}
          />

          <BrowseSubagentsDialog
            open={tools.manage === 'subagents'}
            onOpenChange={(open): void => {
              if (!open) tools.closeManage();
            }}
            catalog={subagents.entries}
            loading={subagents.loading}
            isError={subagents.isError}
            onRetry={subagents.refetch}
            selection={tools.draft}
            onSelectionChange={tools.setDraft}
            suggested={[]}
          />

          <BrowseBuiltinToolsDialog
            open={tools.manage === 'builtin'}
            onOpenChange={(open): void => {
              if (!open) tools.closeManage();
            }}
            catalog={builtin.entries}
            loading={builtin.loading}
            isError={builtin.isError}
            onRetry={builtin.refetch}
            selection={tools.draft}
            onSelectionChange={tools.setDraft}
            suggested={[]}
          />
        </>
      )}
    </>
  );
}
