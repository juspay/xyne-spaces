import type { ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';

import { DASHBOARD_ORIGIN } from '@/src/config';
import type { SubagentDef } from '@/src/services/claw/clawSubagentsTypes';
import type { Integration } from '@/src/services/claw/clawToolsTypes';
import {
  selectionHasAnyId,
  toggleCapabilityIds,
  withCapabilityIds,
  withoutCapabilityIds,
  type AgentCapabilityGroup,
  type ManageToolItem,
} from '@/src/utils/flowAgentEditor';
import type { AgentPreviewListItem } from '@/src/utils/flowAgentUtils';
import type { BuiltinBrowseItem } from '@/src/utils/builtinBrowse';
import type { McpBrowseItem, McpBrowseSection } from '@/src/utils/mcpBrowse';

import {
  BuiltinBrowseSkeleton,
  McpBrowseSkeleton,
  SubagentBrowseSkeleton,
} from './flow-agent-browse-skeleton';
import {
  BuiltinBrowseGrid,
  BuiltinBrowseToolbar,
  BuiltinDetailView,
  BuiltinSelectedChips,
} from './flow-agent-builtin-views';
import { McpBrowseSections, McpBrowseToolbar, McpDetailView } from './flow-agent-mcp-views';
import {
  SubagentBrowseGrid,
  SubagentBrowseToolbar,
  SubagentDetailView,
  type SubagentBrowseFilter,
  type SubagentListEntry,
} from './flow-agent-subagent-views';
import type { BuiltinBrowseFilter } from '@/src/utils/builtinBrowse';
import type { McpBrowseFilter } from '@/src/utils/mcpBrowse';
import type { DraftAgentEditor } from './utils/useDraftAgentEditor';
import type { AgentPreviewPanel } from './flow-agent-preview-parts';
import { DetailCard, EmptyLine } from './flow-agent-preview-parts';

type LoadState = { isLoading: boolean; isError: boolean };

type AgentPreviewBrowseProps = {
  panel: AgentPreviewPanel;
  manageGroup: 'subagent' | 'mcp' | 'builtin' | null;
  editor: DraftAgentEditor;
  availableTools: LoadState;
  subagentsQuery: LoadState;
  mcpQuery: LoadState;
  subagentSearch: string;
  setSubagentSearch: (value: string) => void;
  subagentFilter: SubagentBrowseFilter;
  setSubagentFilter: (value: SubagentBrowseFilter) => void;
  subagentBrowseItems: SubagentListEntry[];
  visibleSubagentItems: SubagentListEntry[];
  integrations: Integration[] | undefined;
  openSubagentDetail: (item: SubagentListEntry, from: AgentPreviewPanel) => void;
  builtinSearch: string;
  setBuiltinSearch: (value: string) => void;
  builtinFilter: BuiltinBrowseFilter;
  setBuiltinFilter: (value: BuiltinBrowseFilter) => void;
  builtinBrowseItems: BuiltinBrowseItem[];
  visibleBuiltinItems: BuiltinBrowseItem[];
  findBuiltinItem: (id: string) => BuiltinBrowseItem | undefined;
  openBuiltinDetail: (item: BuiltinBrowseItem, from: AgentPreviewPanel) => void;
  mcpSearch: string;
  setMcpSearch: (value: string) => void;
  mcpFilter: McpBrowseFilter;
  setMcpFilter: (value: McpBrowseFilter) => void;
  mcpBrowseItems: McpBrowseItem[];
  mcpBrowseSections: McpBrowseSection[];
  openMcpDetail: (item: McpBrowseItem, from: AgentPreviewPanel) => void;
  manageItems: ManageToolItem[];
  detailBuiltinId: string | null;
  detailMcpId: string | null;
  detailSubagentId: string | null;
  findMcpItem: (id: string) => McpBrowseItem | undefined;
  catalogByGroup: { subagent: ManageToolItem[] };
  itemsForGroup: (group: AgentCapabilityGroup) => AgentPreviewListItem[];
  toSubagentEntry: (item: {
    id: string;
    name: string;
    description: string;
    ids?: string[];
  }) => SubagentListEntry;
  subagentDefs: SubagentDef[];
  closeTo: (next: AgentPreviewPanel) => void;
  detailReturnPanel: AgentPreviewPanel;
};

export const AgentPreviewBrowse = ({
  panel,
  manageGroup,
  editor,
  availableTools,
  subagentsQuery,
  mcpQuery,
  subagentSearch,
  setSubagentSearch,
  subagentFilter,
  setSubagentFilter,
  subagentBrowseItems,
  visibleSubagentItems,
  integrations,
  openSubagentDetail,
  builtinSearch,
  setBuiltinSearch,
  builtinFilter,
  setBuiltinFilter,
  builtinBrowseItems,
  visibleBuiltinItems,
  findBuiltinItem,
  openBuiltinDetail,
  mcpSearch,
  setMcpSearch,
  mcpFilter,
  setMcpFilter,
  mcpBrowseItems,
  mcpBrowseSections,
  openMcpDetail,
  manageItems,
  detailBuiltinId,
  detailMcpId,
  detailSubagentId,
  findMcpItem,
  catalogByGroup,
  itemsForGroup,
  toSubagentEntry,
  subagentDefs,
  closeTo,
  detailReturnPanel,
}: AgentPreviewBrowseProps): ReactElement => (
  <>
    {manageGroup === 'subagent' ? (
      <View style={{ gap: 16 }}>
        <SubagentBrowseToolbar
          search={subagentSearch}
          onSearchChange={setSubagentSearch}
          filter={subagentFilter}
          onFilterChange={setSubagentFilter}
        />
        {(availableTools.isLoading || subagentsQuery.isLoading) &&
        subagentBrowseItems.length === 0 ? (
          <SubagentBrowseSkeleton />
        ) : visibleSubagentItems.length === 0 ? (
          <EmptyLine
            label={
              availableTools.isError || subagentsQuery.isError
                ? 'Could not load subagents. Try again.'
                : subagentSearch.trim() || subagentFilter !== 'all'
                  ? 'No matching subagents.'
                  : 'No subagents in this workspace yet.'
            }
          />
        ) : (
          <SubagentBrowseGrid
            items={visibleSubagentItems}
            {...(integrations ? { integrations } : {})}
            isHighlighted={item => selectionHasAnyId(editor.selection, item.ids)}
            onOpen={item => openSubagentDetail(item, 'subagent')}
          />
        )}
      </View>
    ) : manageGroup === 'builtin' ? (
      <View style={{ gap: 16 }}>
        <BuiltinBrowseToolbar
          search={builtinSearch}
          onSearchChange={setBuiltinSearch}
          filter={builtinFilter}
          onFilterChange={setBuiltinFilter}
        />
        <BuiltinSelectedChips
          items={builtinBrowseItems
            .filter(item => selectionHasAnyId(editor.selection, item.ids))
            .map(item => ({ id: item.id, name: item.name }))}
          onRemove={id => {
            const item = findBuiltinItem(id);
            if (!item) return;
            editor.setToolboxSelection(withoutCapabilityIds(editor.selection, item.ids));
          }}
        />
        {availableTools.isLoading && builtinBrowseItems.length === 0 ? (
          <BuiltinBrowseSkeleton />
        ) : visibleBuiltinItems.length === 0 ? (
          <EmptyLine
            label={
              availableTools.isError
                ? 'Could not load built-in tools. Try again.'
                : builtinSearch.trim() || builtinFilter !== 'all'
                  ? 'No matching built-in tools.'
                  : 'No built-in tools in this workspace yet.'
            }
          />
        ) : (
          <BuiltinBrowseGrid
            items={visibleBuiltinItems}
            selectedCountFor={item =>
              item.ids.filter(id => selectionHasAnyId(editor.selection, [id])).length
            }
            onOpen={item => openBuiltinDetail(item, 'builtin')}
          />
        )}
      </View>
    ) : manageGroup === 'mcp' ? (
      <View style={{ gap: 16 }}>
        <McpBrowseToolbar
          search={mcpSearch}
          onSearchChange={setMcpSearch}
          filter={mcpFilter}
          onFilterChange={setMcpFilter}
        />
        {mcpQuery.isLoading && mcpBrowseItems.length === 0 ? (
          <McpBrowseSkeleton />
        ) : mcpBrowseSections.length === 0 ? (
          <EmptyLine
            label={
              mcpQuery.isError || availableTools.isError
                ? 'Could not load MCPs. Try again.'
                : mcpSearch.trim() || mcpFilter !== 'all'
                  ? 'No matching MCPs.'
                  : 'No MCPs in this workspace yet.'
            }
          />
        ) : (
          <McpBrowseSections
            sections={mcpBrowseSections}
            onOpen={item => openMcpDetail(item, 'mcp')}
          />
        )}
      </View>
    ) : manageGroup ? (
      <DetailCard>
        {availableTools.isLoading && manageItems.length === 0 ? (
          <View style={{ paddingHorizontal: 12, paddingVertical: 10 }}>
            <EmptyLine label='Loading tools…' />
          </View>
        ) : manageItems.length === 0 ? (
          <View style={{ paddingHorizontal: 12, paddingVertical: 10 }}>
            <EmptyLine
              label={
                availableTools.isError
                  ? 'Could not load workspace tools. Try again.'
                  : 'No tools in this workspace yet.'
              }
            />
          </View>
        ) : (
          manageItems.map((item, index) => {
            const ids = item.ids ?? [item.id];
            const selected = selectionHasAnyId(editor.selection, ids);
            return (
              <Pressable
                key={item.id}
                accessibilityRole='button'
                accessibilityState={{ selected }}
                onPress={() =>
                  editor.setToolboxSelection(
                    toggleCapabilityIds(editor.selection, manageGroup, ids, selected),
                  )
                }
                {...(index === manageItems.length - 1
                  ? {}
                  : { className: 'border-b border-border' })}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  paddingHorizontal: 12,
                  paddingVertical: 12,
                  gap: 8,
                }}
              >
                <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                  <Text className='text-sm font-semibold text-foreground'>{item.name}</Text>
                  {item.description ? (
                    <Text className='text-sm text-flow-card-header-title'>{item.description}</Text>
                  ) : null}
                </View>
                <Text className='text-sm text-flow-card-header-title'>
                  {selected ? 'Added' : 'Add'}
                </Text>
              </Pressable>
            );
          })
        )}
      </DetailCard>
    ) : null}

    {panel === 'builtin-detail' && detailBuiltinId
      ? ((): ReactElement => {
          const item = findBuiltinItem(detailBuiltinId);
          if (!item) {
            return <EmptyLine label='Built-in tool not found.' />;
          }
          const selectedIds = item.ids.filter(id => selectionHasAnyId(editor.selection, [id]));
          return (
            <BuiltinDetailView
              item={item}
              selectedIds={selectedIds}
              canEdit={editor.editable}
              onToggleTool={id => {
                const selected = selectionHasAnyId(editor.selection, [id]);
                editor.setToolboxSelection(
                  toggleCapabilityIds(editor.selection, 'builtin', [id], selected),
                );
              }}
              onToggleAll={selectAll => {
                editor.setToolboxSelection(
                  selectAll
                    ? withCapabilityIds(editor.selection, 'builtin', item.ids)
                    : withoutCapabilityIds(editor.selection, item.ids),
                );
              }}
              onEnable={() => {
                editor.setToolboxSelection(
                  withCapabilityIds(editor.selection, 'builtin', item.ids),
                );
              }}
              onDisable={() => {
                editor.setToolboxSelection(withoutCapabilityIds(editor.selection, item.ids));
              }}
            />
          );
        })()
      : null}

    {panel === 'mcp-detail' && detailMcpId
      ? ((): ReactElement => {
          const item = findMcpItem(detailMcpId);
          if (!item) {
            return <EmptyLine label='MCP not found.' />;
          }
          const selectedIds = item.tools
            .map(tool => tool.id)
            .filter(id => selectionHasAnyId(editor.selection, [id]));
          return (
            <McpDetailView
              item={item}
              selectedIds={selectedIds}
              canEdit={editor.editable}
              onToggleTool={id => {
                const selected = selectionHasAnyId(editor.selection, [id]);
                editor.setToolboxSelection(
                  toggleCapabilityIds(editor.selection, 'mcp', [id], selected),
                );
              }}
              onToggleAll={selectAll => {
                editor.setToolboxSelection(
                  selectAll
                    ? withCapabilityIds(editor.selection, 'mcp', item.toolIds)
                    : withoutCapabilityIds(editor.selection, item.toolIds),
                );
              }}
              {...(item.connected
                ? {}
                : {
                    onConnect: (): void => {
                      void WebBrowser.openBrowserAsync(
                        `${DASHBOARD_ORIGIN}/claw-agents/mcp/${item.id}`,
                      ).catch(() => {});
                    },
                  })}
            />
          );
        })()
      : null}

    {panel === 'subagent-detail' && detailSubagentId
      ? ((): ReactElement => {
          const fromManage = catalogByGroup.subagent.find(
            item => item.id === detailSubagentId || item.name === detailSubagentId,
          );
          const fromSelected = itemsForGroup('subagent').find(
            item => item.id === detailSubagentId || item.name === detailSubagentId,
          );
          const base =
            fromManage ??
            (fromSelected
              ? {
                  id: fromSelected.id,
                  name: fromSelected.name,
                  description: fromSelected.description,
                  ids: fromSelected.ids ?? [fromSelected.id],
                }
              : {
                  id: detailSubagentId,
                  name: detailSubagentId,
                  description: '',
                  ids: [detailSubagentId],
                });
          const entry = toSubagentEntry(base);
          const def = subagentDefs.find(item => item.name === entry.id || item.name === entry.name);
          const added = selectionHasAnyId(editor.selection, entry.ids);
          return (
            <SubagentDetailView
              item={entry}
              {...(def ? { detail: def } : {})}
              {...(integrations ? { integrations } : {})}
              canAdd={editor.editable}
              isAdded={added}
              {...(editor.editable && !added
                ? {
                    onAdd: (): void => {
                      editor.setToolboxSelection(
                        withCapabilityIds(editor.selection, 'subagent', entry.ids),
                      );
                      closeTo(detailReturnPanel);
                    },
                  }
                : {})}
            />
          );
        })()
      : null}
  </>
);
