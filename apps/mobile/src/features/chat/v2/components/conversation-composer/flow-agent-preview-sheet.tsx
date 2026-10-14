import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { BackHandler, Pressable, Text, View, useWindowDimensions } from 'react-native';
import { Pressable as GesturePressable, ScrollView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft, X } from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';

import { AppBottomSheet, type AppBottomSheetRef } from '@/src/components/ui/app-bottom-sheet';
import { Button, normalizeButtonVariant } from '@/src/components/ui/button';
import { useClawAvailableTools } from '@/src/hooks/useClawAvailableTools';
import { useClawMcp } from '@/src/hooks/useClawMcp';
import { useClawSubagents } from '@/src/hooks/useClawSubagents';
import {
  defaultModelLabel,
  manageItemsFromCatalog,
  mergeManageItems,
  needsProviderKey,
  providerLine,
  selectionHasAnyId,
  type AgentCapabilityGroup,
  type ManageToolItem,
} from '@/src/utils/flowAgentEditor';
import type { FlowActionButton } from '@/src/utils/flowAction';
import {
  shouldCloseAgentPreviewAfterAction,
  toolItemsForGroup,
  type AgentCardViewModel,
  type AgentPreviewListItem,
  type AgentPreviewTabId,
} from '@/src/utils/flowAgentUtils';

import {
  buildBuiltinBrowseItems,
  type BuiltinBrowseFilter,
  type BuiltinBrowseItem,
} from '@/src/utils/builtinBrowse';
import {
  buildMcpBrowseItems,
  groupMcpBrowseItems,
  type McpBrowseFilter,
  type McpBrowseItem,
} from '@/src/utils/mcpBrowse';

import type { SubagentBrowseFilter, SubagentListEntry } from './flow-agent-subagent-views';
import { AgentPreviewBrowse } from './flow-agent-preview-browse';
import { AgentPreviewMain } from './flow-agent-preview-main';
import type { AgentPreviewPanel } from './flow-agent-preview-parts';
import { AgentPreviewSettings } from './flow-agent-preview-settings';

import type { DraftAgentEditor } from './utils/useDraftAgentEditor';
import { useDraftModelOptions } from './utils/useDraftModelOptions';

type FlowAgentPreviewSheetProps = {
  viewModel: AgentCardViewModel;
  editor: DraftAgentEditor;
  isOpen: boolean;
  isSubmitting: boolean;
  buttons: FlowActionButton[];
  onOpenChange: (open: boolean) => void;
  onAction?: (button: FlowActionButton) => void | Promise<boolean | void>;
  onChat?: () => void;
};

const FlowAgentPreviewSheetComponent = ({
  viewModel,
  editor,
  isOpen,
  isSubmitting,
  buttons,
  onOpenChange,
  onAction,
}: FlowAgentPreviewSheetProps): ReactElement | null => {
  const sheetRef = useRef<AppBottomSheetRef>(null);
  const ignoreNextSheetCloseRef = useRef(false);
  const muted = useCSSVariable('--color-foreground') as string;
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const [tab, setTab] = useState<AgentPreviewTabId>('persona');
  const [panel, setPanel] = useState<AgentPreviewPanel>('main');
  const [detailReturnPanel, setDetailReturnPanel] = useState<AgentPreviewPanel>('main');
  const [detailSubagentId, setDetailSubagentId] = useState<string | null>(null);
  const [detailMcpId, setDetailMcpId] = useState<string | null>(null);
  const [detailBuiltinId, setDetailBuiltinId] = useState<string | null>(null);
  const [mcpSearch, setMcpSearch] = useState('');
  const [mcpFilter, setMcpFilter] = useState<McpBrowseFilter>('all');
  const [builtinSearch, setBuiltinSearch] = useState('');
  const [builtinFilter, setBuiltinFilter] = useState<BuiltinBrowseFilter>('all');
  const [subagentSearch, setSubagentSearch] = useState('');
  const [subagentFilter, setSubagentFilter] = useState<SubagentBrowseFilter>('all');
  const [providerDraft, setProviderDraft] = useState<string[]>([]);
  const sheetHeight = windowHeight - insets.top - insets.bottom;
  const models = useDraftModelOptions({
    userId: viewModel.cardUserId,
    modelId: editor.modelId,
    enabled: isOpen && editor.editable,
    ...(editor.providerOrder[0] ? { provider: editor.providerOrder[0] } : {}),
  });
  const availableTools = useClawAvailableTools(isOpen);
  const subagentsQuery = useClawSubagents(viewModel.cardUserId, isOpen);
  const mcpQuery = useClawMcp(viewModel.cardUserId, isOpen);

  const goBackFromNestedPanel = useCallback((): boolean => {
    if (panel === 'main') return false;
    ignoreNextSheetCloseRef.current = true;
    if (panel === 'subagent-detail' || panel === 'mcp-detail' || panel === 'builtin-detail') {
      setDetailSubagentId(null);
      setDetailMcpId(null);
      setDetailBuiltinId(null);
      setPanel(detailReturnPanel);
    } else {
      setDetailSubagentId(null);
      setDetailMcpId(null);
      setDetailBuiltinId(null);
      setPanel('main');
    }
    return true;
  }, [detailReturnPanel, panel]);

  useEffect(() => {
    if (!isOpen || panel === 'main') return undefined;
    const subscription = BackHandler.addEventListener('hardwareBackPress', (): boolean => {
      goBackFromNestedPanel();
      return true;
    });
    return (): void => subscription.remove();
  }, [goBackFromNestedPanel, isOpen, panel]);

  const catalogByGroup = useMemo(() => {
    const catalog = availableTools.data ?? null;
    return {
      subagent: manageItemsFromCatalog(catalog, 'subagent'),
      mcp: manageItemsFromCatalog(catalog, 'mcp'),
      builtin: manageItemsFromCatalog(catalog, 'builtin'),
    };
  }, [availableTools.data]);

  const itemsForGroup = (group: AgentCapabilityGroup): AgentPreviewListItem[] => {
    const fromCard = toolItemsForGroup(viewModel.capabilities, group);
    if (group === 'agent' || !editor.editable) return fromCard;

    const catalogItems = catalogByGroup[group];
    const merged = mergeManageItems(
      catalogItems,
      fromCard.map(item => ({
        id: item.id,
        name: item.name,
        description: item.description,
        ids: item.ids ?? [item.id],
      })),
    );
    return merged.filter(item => selectionHasAnyId(editor.selection, item.ids));
  };

  const catalogSubagents = availableTools.data?.subagents ?? [];
  const integrations = availableTools.data?.integrations;
  const subagentDefs = subagentsQuery.data ?? [];
  const mcpBrowseItems = useMemo(
    () =>
      buildMcpBrowseItems(
        mcpQuery.data?.servers ?? [],
        mcpQuery.data?.connections ?? [],
        integrations,
      ),
    [integrations, mcpQuery.data],
  );
  const mcpBrowseSections = useMemo(() => {
    const query = mcpSearch.trim().toLowerCase();
    const sections = groupMcpBrowseItems(mcpBrowseItems)
      .filter(section => mcpFilter === 'all' || section.id === mcpFilter)
      .map(section => ({
        ...section,
        items: query
          ? section.items.filter(item =>
              `${item.name} ${item.description} ${item.type}`.toLowerCase().includes(query),
            )
          : section.items,
      }))
      .filter(section => section.items.length > 0);
    return sections;
  }, [mcpBrowseItems, mcpFilter, mcpSearch]);

  const findMcpItem = (id: string): McpBrowseItem | undefined =>
    mcpBrowseItems.find(item => item.id === id || item.type === id || item.name === id);

  const builtinBrowseItems = useMemo(
    () => buildBuiltinBrowseItems(availableTools.data?.customGroups, integrations),
    [availableTools.data?.customGroups, integrations],
  );
  const visibleBuiltinItems = useMemo(() => {
    const query = builtinSearch.trim().toLowerCase();
    return builtinBrowseItems.filter(item => {
      if (builtinFilter !== 'all' && item.risk !== builtinFilter) return false;
      if (!query) return true;
      return `${item.name} ${item.tools.map(tool => tool.name).join(' ')}`
        .toLowerCase()
        .includes(query);
    });
  }, [builtinBrowseItems, builtinFilter, builtinSearch]);

  const findBuiltinItem = (id: string): BuiltinBrowseItem | undefined =>
    builtinBrowseItems.find(item => item.id === id || item.name === id);

  const toSubagentEntry = (item: {
    id: string;
    name: string;
    description: string;
    ids?: string[];
  }): SubagentListEntry => {
    const catalog = catalogSubagents.find(
      entry => entry.name === item.id || entry.name === item.name,
    );
    const def = subagentDefs.find(entry => entry.name === item.id || entry.name === item.name);
    const serverType = catalog?.serverType ?? def?.serverType;
    const source = def?.source;
    return {
      id: item.id,
      name: item.name,
      description: def?.description || catalog?.description || item.description,
      ids: item.ids ?? [item.id],
      ...(serverType ? { serverType } : {}),
      ...(source ? { source } : {}),
    };
  };

  const subagentBrowseItems = useMemo(() => {
    const catalogItems = catalogByGroup.subagent;
    const fromCatalog = catalogItems.map(item => {
      const catalog = catalogSubagents.find(
        entry => entry.name === item.id || entry.name === item.name,
      );
      const def = subagentDefs.find(entry => entry.name === item.id || entry.name === item.name);
      const serverType = catalog?.serverType ?? def?.serverType;
      const source = def?.source;
      return {
        id: item.id,
        name: item.name,
        description: def?.description || catalog?.description || item.description,
        ids: item.ids ?? [item.id],
        ...(serverType ? { serverType } : {}),
        ...(source ? { source } : {}),
      } satisfies SubagentListEntry;
    });
    const seen = new Set(fromCatalog.map(item => item.name));
    const extras = subagentDefs
      .filter(def => !seen.has(def.name))
      .map(
        def =>
          ({
            id: def.name,
            name: def.name,
            description: def.description,
            ids: [def.name],
            ...(def.serverType ? { serverType: def.serverType } : {}),
            source: def.source,
          }) satisfies SubagentListEntry,
      );
    return [...fromCatalog, ...extras];
  }, [catalogByGroup.subagent, catalogSubagents, subagentDefs]);

  const visibleSubagentItems = useMemo(() => {
    const query = subagentSearch.trim().toLowerCase();
    return subagentBrowseItems.filter(item => {
      if (subagentFilter !== 'all' && item.source !== subagentFilter) return false;
      if (!query) return true;
      return `${item.name} ${item.description}`.toLowerCase().includes(query);
    });
  }, [subagentBrowseItems, subagentFilter, subagentSearch]);

  const openSubagentDetail = (item: SubagentListEntry, from: AgentPreviewPanel): void => {
    setDetailSubagentId(item.id);
    setDetailReturnPanel(from);
    setPanel('subagent-detail');
  };

  const openMcpDetail = (item: McpBrowseItem, from: AgentPreviewPanel): void => {
    setDetailMcpId(item.id);
    setDetailReturnPanel(from);
    setPanel('mcp-detail');
  };

  const openBuiltinDetail = (item: BuiltinBrowseItem, from: AgentPreviewPanel): void => {
    setDetailBuiltinId(item.id);
    setDetailReturnPanel(from);
    setPanel('builtin-detail');
  };

  const closeTo = (next: AgentPreviewPanel): void => {
    setDetailSubagentId(null);
    setDetailMcpId(null);
    setDetailBuiltinId(null);
    setPanel(next);
  };

  if (!isOpen) return null;

  const modelLabel = editor.modelId || defaultModelLabel(editor.providerOrder[0]);
  const providersLabel = providerLine(editor.providerOrder);
  const primaryProvider = editor.providerOrder[0];
  const showModelPicker = editor.editable && models.options.length > 1;
  const showConnect = editor.editable && needsProviderKey(primaryProvider);

  const openProviders = (): void => {
    setProviderDraft([...editor.providerOrder]);
    setPanel('providers');
  };

  const panelTitle =
    panel === 'model'
      ? 'Model'
      : panel === 'providers'
        ? 'Providers'
        : panel === 'subagent'
          ? 'Browse Subagent'
          : panel === 'subagent-detail'
            ? 'Back'
            : panel === 'mcp'
              ? 'Browse MCPs'
              : panel === 'mcp-detail'
                ? 'Back'
                : panel === 'builtin'
                  ? 'Browse built in tools'
                  : panel === 'builtin-detail'
                    ? 'Back'
                    : 'Agent';

  const manageGroup = panel === 'subagent' || panel === 'mcp' || panel === 'builtin' ? panel : null;
  const manageItems: ManageToolItem[] = manageGroup
    ? mergeManageItems(
        catalogByGroup[manageGroup],
        toolItemsForGroup(viewModel.capabilities, manageGroup).map(item => ({
          id: item.id,
          name: item.name,
          description: item.description,
          ids: item.ids ?? [item.id],
        })),
      )
    : [];

  return (
    <AppBottomSheet
      ref={sheetRef}
      isOpen={isOpen}
      onOpenChange={open => {
        if (!open && ignoreNextSheetCloseRef.current) {
          ignoreNextSheetCloseRef.current = false;
          sheetRef.current?.snapToIndex(0);
          return;
        }
        if (!open && goBackFromNestedPanel()) {
          sheetRef.current?.snapToIndex(0);
          return;
        }
        if (!open) {
          setPanel('main');
          setDetailSubagentId(null);
          setDetailMcpId(null);
          setDetailBuiltinId(null);
          setMcpSearch('');
          setMcpFilter('all');
          setBuiltinSearch('');
          setBuiltinFilter('all');
          setSubagentSearch('');
          setSubagentFilter('all');
        }
        onOpenChange(open);
      }}
      mode='fullscreen'
      backdropOpacity={0.45}
      showHandleIndicator={false}
      handleComponent={null}
      enablePanDownToClose={false}
      enableContentPanningGesture={false}
      enableHandlePanningGesture={false}
    >
      <View style={{ height: sheetHeight, overflow: 'hidden' }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingHorizontal: 16,
            paddingVertical: 12,
          }}
        >
          {panel === 'main' ? (
            <Text className='text-sm font-semibold text-flow-card-header-title'>Agent</Text>
          ) : (
            <GesturePressable
              accessibilityRole='button'
              accessibilityLabel='Back'
              hitSlop={8}
              onPress={() => {
                goBackFromNestedPanel();
              }}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
            >
              <ChevronLeft size={18} color={muted} />
              <Text className='text-sm font-semibold text-foreground'>{panelTitle}</Text>
            </GesturePressable>
          )}
          <Pressable
            accessibilityRole='button'
            accessibilityLabel='Close'
            hitSlop={8}
            onPress={() => onOpenChange(false)}
          >
            <X size={18} color={muted} />
          </Pressable>
        </View>

        <ScrollView
          style={{ flex: 1, minHeight: 0 }}
          keyboardShouldPersistTaps='handled'
          nestedScrollEnabled
          showsVerticalScrollIndicator
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 20, gap: 16 }}
        >
          <AgentPreviewSettings
            panel={panel}
            models={models}
            editor={editor}
            setPanel={setPanel}
            providerDraft={providerDraft}
            setProviderDraft={setProviderDraft}
            muted={muted}
          />
          <AgentPreviewBrowse
            panel={panel}
            manageGroup={manageGroup}
            editor={editor}
            availableTools={availableTools}
            subagentsQuery={subagentsQuery}
            mcpQuery={mcpQuery}
            subagentSearch={subagentSearch}
            setSubagentSearch={setSubagentSearch}
            subagentFilter={subagentFilter}
            setSubagentFilter={setSubagentFilter}
            subagentBrowseItems={subagentBrowseItems}
            visibleSubagentItems={visibleSubagentItems}
            integrations={integrations}
            openSubagentDetail={openSubagentDetail}
            builtinSearch={builtinSearch}
            setBuiltinSearch={setBuiltinSearch}
            builtinFilter={builtinFilter}
            setBuiltinFilter={setBuiltinFilter}
            builtinBrowseItems={builtinBrowseItems}
            visibleBuiltinItems={visibleBuiltinItems}
            findBuiltinItem={findBuiltinItem}
            openBuiltinDetail={openBuiltinDetail}
            mcpSearch={mcpSearch}
            setMcpSearch={setMcpSearch}
            mcpFilter={mcpFilter}
            setMcpFilter={setMcpFilter}
            mcpBrowseItems={mcpBrowseItems}
            mcpBrowseSections={mcpBrowseSections}
            openMcpDetail={openMcpDetail}
            manageItems={manageItems}
            detailBuiltinId={detailBuiltinId}
            detailMcpId={detailMcpId}
            detailSubagentId={detailSubagentId}
            findMcpItem={findMcpItem}
            catalogByGroup={catalogByGroup}
            itemsForGroup={itemsForGroup}
            toSubagentEntry={toSubagentEntry}
            subagentDefs={subagentDefs}
            closeTo={closeTo}
            detailReturnPanel={detailReturnPanel}
          />
          {panel === 'main' ? (
            <AgentPreviewMain
              viewModel={viewModel}
              editor={editor}
              tab={tab}
              setTab={setTab}
              modelLabel={modelLabel}
              providersLabel={providersLabel}
              primaryProvider={primaryProvider}
              showModelPicker={showModelPicker}
              showConnect={showConnect}
              modelHint={models.hint}
              muted={muted}
              integrations={integrations}
              itemsForGroup={itemsForGroup}
              toSubagentEntry={toSubagentEntry}
              findBuiltinItem={findBuiltinItem}
              findMcpItem={findMcpItem}
              openProviders={openProviders}
              setPanel={setPanel}
              openSubagentDetail={openSubagentDetail}
              openBuiltinDetail={openBuiltinDetail}
              openMcpDetail={openMcpDetail}
            />
          ) : null}
        </ScrollView>

        {panel === 'main' && buttons.length > 0 ? (
          <View
            className='border-t border-border'
            style={{
              flexDirection: 'row',
              flexWrap: 'wrap',
              justifyContent: 'flex-end',
              gap: 8,
              paddingHorizontal: 16,
              paddingTop: 12,
              paddingBottom: 16,
            }}
          >
            {buttons.map(button => {
              const actionId = button.action.type === 'submit' ? button.action.actionId : undefined;
              const label =
                isSubmitting && actionId === 'agent-draft-approve'
                  ? 'Creating…'
                  : isSubmitting && actionId === 'agent-draft-decline'
                    ? 'Declining…'
                    : button.label;
              return (
                <Button
                  key={`preview-${button.key}`}
                  size='xs'
                  label={label}
                  variant={normalizeButtonVariant(button.variant)}
                  loading={isSubmitting}
                  disabled={isSubmitting}
                  onPress={() => {
                    void (async (): Promise<void> => {
                      const succeeded = await onAction?.(button);
                      // Dashboard DraftAgentCard closes after executeAction resolves.
                      // Keep the sheet open on failure so the error toast is visible.
                      if (shouldCloseAgentPreviewAfterAction(succeeded)) onOpenChange(false);
                    })();
                  }}
                />
              );
            })}
            {/* Chat with agent — restore when a mobile destination exists.
            {viewModel.showChatAction ? (
              <Button
                size='xs'
                label='Chat with agent'
                variant='secondary'
                onPress={() => {
                  onOpenChange(false);
                  onChat?.();
                }}
              />
            ) : null}
            */}
          </View>
        ) : null}
      </View>
    </AppBottomSheet>
  );
};

const FlowAgentPreviewSheet = memo(FlowAgentPreviewSheetComponent);
FlowAgentPreviewSheet.displayName = 'FlowAgentPreviewSheet';

export { FlowAgentPreviewSheet };
