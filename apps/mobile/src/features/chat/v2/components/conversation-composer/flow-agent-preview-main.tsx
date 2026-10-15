import type { ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';
import * as WebBrowser from 'expo-web-browser';
import { Pencil } from 'lucide-react-native';

import { DASHBOARD_ORIGIN } from '@/src/config';
import type { Integration } from '@/src/services/claw/clawToolsTypes';
import {
  connectedProviderCount,
  providerDisplayName,
  selectionHasAnyId,
  withoutCapabilityIds,
  type AgentCapabilityGroup,
} from '@/src/utils/flowAgentEditor';
import {
  AGENT_PREVIEW_TABS,
  AGENT_TOOL_SECTIONS,
  type AgentCardViewModel,
  type AgentPreviewListItem,
  type AgentPreviewTabId,
} from '@/src/utils/flowAgentUtils';
import type { BuiltinBrowseItem } from '@/src/utils/builtinBrowse';
import type { McpBrowseItem } from '@/src/utils/mcpBrowse';

import { BuiltinMainRow } from './flow-agent-builtin-views';
import { McpBrowseRow } from './flow-agent-mcp-views';
import { SubagentBrowseRow, type SubagentListEntry } from './flow-agent-subagent-views';
import type { DraftAgentEditor } from './utils/useDraftAgentEditor';
import type { AgentPreviewPanel } from './flow-agent-preview-parts';
import { DetailCard, EmptyLine, ListCard, Row, Section } from './flow-agent-preview-parts';

type AgentPreviewMainProps = {
  viewModel: AgentCardViewModel;
  editor: DraftAgentEditor;
  tab: AgentPreviewTabId;
  setTab: (tab: AgentPreviewTabId) => void;
  modelLabel: string;
  providersLabel: string;
  primaryProvider: string | undefined;
  showModelPicker: boolean;
  showConnect: boolean;
  modelHint: string | null;
  muted: string;
  integrations: Integration[] | undefined;
  itemsForGroup: (group: AgentCapabilityGroup) => AgentPreviewListItem[];
  toSubagentEntry: (item: {
    id: string;
    name: string;
    description: string;
    ids?: string[];
  }) => SubagentListEntry;
  findBuiltinItem: (id: string) => BuiltinBrowseItem | undefined;
  findMcpItem: (id: string) => McpBrowseItem | undefined;
  openProviders: () => void;
  setPanel: (panel: AgentPreviewPanel) => void;
  openSubagentDetail: (item: SubagentListEntry, from: AgentPreviewPanel) => void;
  openBuiltinDetail: (item: BuiltinBrowseItem, from: AgentPreviewPanel) => void;
  openMcpDetail: (item: McpBrowseItem, from: AgentPreviewPanel) => void;
};

export const AgentPreviewMain = ({
  viewModel,
  editor,
  tab,
  setTab,
  modelLabel,
  providersLabel,
  primaryProvider,
  showModelPicker,
  showConnect,
  modelHint,
  muted,
  integrations,
  itemsForGroup,
  toSubagentEntry,
  findBuiltinItem,
  findMcpItem,
  openProviders,
  setPanel,
  openSubagentDetail,
  openBuiltinDetail,
  openMcpDetail,
}: AgentPreviewMainProps): ReactElement => (
  <>
    <View style={{ gap: 4, minWidth: 0 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <Text className='text-xl font-semibold text-foreground'>{viewModel.name}</Text>
        <View
          className={
            viewModel.statusTone === 'failed'
              ? 'rounded-md bg-flow-card-status-failed-bg px-2 py-0.5'
              : viewModel.statusTone === 'completed'
                ? 'rounded-md bg-flow-card-status-completed-bg px-2 py-0.5'
                : 'rounded-md bg-flow-card-status-pending-bg px-2 py-0.5'
          }
        >
          <Text
            className={
              viewModel.statusTone === 'failed'
                ? 'text-xs font-bold text-flow-card-status-failed-text'
                : viewModel.statusTone === 'completed'
                  ? 'text-xs font-bold text-flow-card-status-completed-text'
                  : 'text-xs font-bold text-flow-card-status-pending-text'
            }
          >
            {viewModel.statusLabel}
          </Text>
        </View>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <Text className='text-sm text-blue-500'>@{viewModel.slug}</Text>
        {editor.modelId ? (
          <Text className='text-sm text-flow-card-header-title'>· {editor.modelId}</Text>
        ) : null}
      </View>
      {viewModel.details.length > 0 ? (
        <DetailCard>
          {viewModel.details.map((detail, index) => (
            <Row
              key={detail.label}
              title={detail.label}
              value={detail.value || '—'}
              last={index === viewModel.details.length - 1}
            />
          ))}
        </DetailCard>
      ) : null}
      {viewModel.connectLinks.length > 0 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {viewModel.connectLinks.map(link => (
            <Pressable
              key={link.serverType}
              accessibilityRole='link'
              onPress={() => {
                void WebBrowser.openBrowserAsync(link.authUrl).catch(() => {});
              }}
            >
              <Text className='text-xs font-semibold text-foreground underline'>
                Connect {link.displayName}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {viewModel.footnote?.trim() ? (
        <Text className='text-xs text-flow-card-header-title'>{viewModel.footnote}</Text>
      ) : null}
    </View>

    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
      {AGENT_PREVIEW_TABS.map(entry => {
        const selected = tab === entry.id;
        return (
          <Pressable
            key={entry.id}
            accessibilityRole='button'
            accessibilityState={{ selected }}
            onPress={() => setTab(entry.id)}
            className={
              selected ? 'rounded-[10px] bg-muted px-3 py-1.5' : 'rounded-[10px] px-3 py-1.5'
            }
          >
            <Text
              className={
                selected
                  ? 'text-sm font-semibold text-foreground'
                  : 'text-sm text-flow-card-header-title'
              }
            >
              {entry.label}
            </Text>
          </Pressable>
        );
      })}
    </View>

    {tab === 'persona' ? (
      <View style={{ gap: 16 }}>
        <Section label='Description'>
          <DetailCard>
            <View style={{ paddingHorizontal: 12, paddingVertical: 10 }}>
              {viewModel.description.trim() ? (
                <Text className='text-sm text-foreground'>{viewModel.description}</Text>
              ) : (
                <EmptyLine label='No description added' />
              )}
            </View>
          </DetailCard>
        </Section>

        <Section label='Model'>
          <DetailCard>
            <Row
              title='Model'
              hint='The model it answers with'
              value={modelLabel}
              {...(showModelPicker ? { onPress: () => setPanel('model') } : {})}
            />
            <Row
              title='Providers'
              hint='Tried in order until one is available'
              value={providersLabel}
              last={viewModel.providers.length === 0}
              accessory={
                editor.editable ? (
                  <Pressable
                    accessibilityRole='button'
                    accessibilityLabel='Edit provider order'
                    hitSlop={8}
                    onPress={openProviders}
                  >
                    <Pencil size={16} color={muted} />
                  </Pressable>
                ) : null
              }
            />
            {viewModel.providers.length > 0 ? (
              <Row
                title='Credentials'
                hint='Keys saved for this agent'
                value={connectedProviderCount(viewModel.providers)}
                last
              />
            ) : null}
          </DetailCard>
          {showConnect && primaryProvider ? (
            <Pressable
              accessibilityRole='link'
              onPress={() => {
                void WebBrowser.openBrowserAsync(`${DASHBOARD_ORIGIN}/ai/settings`).catch(() => {});
              }}
            >
              <Text className='text-xs text-flow-card-header-title'>
                {providerDisplayName(primaryProvider)} isn&apos;t connected, so this agent falls
                back to the platform default.{' '}
                <Text className='font-semibold text-blue-500'>
                  Connect {providerDisplayName(primaryProvider)}
                </Text>
              </Text>
            </Pressable>
          ) : editor.editable && modelHint ? (
            <Text className='text-xs text-flow-card-header-title'>{modelHint}</Text>
          ) : null}
        </Section>

        <Section label='System Prompt'>
          <DetailCard>
            <ScrollView
              nestedScrollEnabled
              style={{ height: 160 }}
              contentContainerStyle={{
                paddingHorizontal: 12,
                paddingVertical: 10,
                flexGrow: 1,
              }}
            >
              {viewModel.systemPrompt?.trim() ? (
                <Text className='text-sm text-foreground'>{viewModel.systemPrompt}</Text>
              ) : (
                <EmptyLine label='No system prompt set' />
              )}
            </ScrollView>
          </DetailCard>
        </Section>
      </View>
    ) : null}

    {tab === 'tools' ? (
      <View style={{ gap: 16 }}>
        {AGENT_TOOL_SECTIONS.map(section => {
          const items = itemsForGroup(section.group);
          const canManage = editor.editable && section.group !== 'agent';
          return (
            <Section
              key={section.group}
              label={section.label}
              trailing={
                canManage ? (
                  <Pressable
                    accessibilityRole='button'
                    accessibilityLabel={`Manage ${section.label}`}
                    onPress={() => setPanel(section.group)}
                    className='rounded-md bg-muted px-1.5 py-0.5'
                  >
                    <Text className='text-sm text-flow-card-header-title'>Manage</Text>
                  </Pressable>
                ) : null
              }
            >
              {section.group === 'subagent' ? (
                items.length === 0 ? (
                  <DetailCard>
                    <View style={{ paddingHorizontal: 12, paddingVertical: 10 }}>
                      <EmptyLine label={section.empty} />
                    </View>
                  </DetailCard>
                ) : (
                  <DetailCard>
                    {items.map((item, index) => (
                      <View
                        key={item.id}
                        {...(index === items.length - 1
                          ? {}
                          : { className: 'border-b border-border' })}
                      >
                        <SubagentBrowseRow
                          item={toSubagentEntry(item)}
                          {...(integrations ? { integrations } : {})}
                          onPress={() => openSubagentDetail(toSubagentEntry(item), 'main')}
                        />
                      </View>
                    ))}
                  </DetailCard>
                )
              ) : section.group === 'builtin' ? (
                items.length === 0 ? (
                  <DetailCard>
                    <View style={{ paddingHorizontal: 12, paddingVertical: 10 }}>
                      <EmptyLine label={section.empty} />
                    </View>
                  </DetailCard>
                ) : (
                  <DetailCard>
                    {items.map((item, index) => {
                      const builtin =
                        findBuiltinItem(item.id) ??
                        findBuiltinItem(item.name) ??
                        ({
                          id: item.id,
                          name: item.name,
                          ids: item.ids ?? [item.id],
                          tools: (item.ids ?? [item.id]).map(id => ({
                            id,
                            name: item.name,
                            description: item.description,
                            risk: 'read' as const,
                          })),
                          risk: 'read' as const,
                        } satisfies BuiltinBrowseItem);
                      const selectedIds = builtin.ids.filter(id =>
                        selectionHasAnyId(editor.selection, [id]),
                      );
                      return (
                        <View
                          key={item.id}
                          {...(index === items.length - 1
                            ? {}
                            : { className: 'border-b border-border' })}
                        >
                          <BuiltinMainRow
                            item={builtin}
                            selectedIds={selectedIds}
                            canEdit={editor.editable}
                            onPress={() => openBuiltinDetail(builtin, 'main')}
                            {...(editor.editable
                              ? {
                                  onRemove: () =>
                                    editor.setToolboxSelection(
                                      withoutCapabilityIds(editor.selection, builtin.ids),
                                    ),
                                }
                              : {})}
                          />
                        </View>
                      );
                    })}
                  </DetailCard>
                )
              ) : section.group === 'mcp' ? (
                items.length === 0 ? (
                  <DetailCard>
                    <View style={{ paddingHorizontal: 12, paddingVertical: 10 }}>
                      <EmptyLine label={section.empty} />
                    </View>
                  </DetailCard>
                ) : (
                  <DetailCard>
                    {items.map((item, index) => {
                      const mcp =
                        findMcpItem(item.id) ??
                        findMcpItem(item.name) ??
                        ({
                          id: item.id,
                          name: item.name,
                          description: item.description,
                          type: item.id,
                          url: '',
                          transport: 'stdio',
                          connected: false,
                          scope: 'Global',
                          author: item.name,
                          usageCount: 0,
                          toolIds: item.ids ?? [item.id],
                          tools: [],
                        } satisfies McpBrowseItem);
                      return (
                        <View
                          key={item.id}
                          {...(index === items.length - 1
                            ? {}
                            : { className: 'border-b border-border' })}
                        >
                          <McpBrowseRow item={mcp} onPress={() => openMcpDetail(mcp, 'main')} />
                        </View>
                      );
                    })}
                  </DetailCard>
                )
              ) : (
                <ListCard
                  items={items}
                  empty={section.empty}
                  canEdit={editor.editable}
                  onRemove={item => editor.removeCapabilities(item.ids ?? [item.id])}
                />
              )}
            </Section>
          );
        })}
      </View>
    ) : null}

    {tab === 'knowledge' ? (
      <View style={{ gap: 16 }}>
        <Section label='Skills'>
          <ListCard items={viewModel.skills} empty='No skills attached yet.' />
        </Section>
        <Section label='Documents'>
          <DetailCard>
            <Row
              title='Applies To'
              hint='Whose access decides what this agent can read'
              value={viewModel.knowledgeAppliesTo}
              last
            />
          </DetailCard>
          <ListCard items={viewModel.knowledgeSources} empty='No collections attached yet.' />
        </Section>
        <Section label='Memory'>
          <DetailCard>
            <Row
              title='Memory enabled'
              value={viewModel.memoryEnabled ? 'On' : 'Off'}
              last={!viewModel.memoryEnabled}
            />
            {viewModel.memoryEnabled ? (
              <Row
                title='Approval'
                hint='Whether new memories need a review'
                value={viewModel.memoryRequiresApproval ? 'Required' : 'Not required'}
                last
              />
            ) : null}
          </DetailCard>
        </Section>
      </View>
    ) : null}
  </>
);
