import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Eye, GitBranch, Trash2, Workflow } from 'lucide-react';
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
  type Edge,
  type Node,
  type NodeChange,
  type NodeMouseHandler,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { cn } from '../../../../utils/classNames';
import { Button } from '../../../ui/Button/Button';
import { AddStepRow } from '../AddStepRow/AddStepRow';
import { ScheduleCard } from '../ScheduleCard/ScheduleCard';
import { StepCard } from '../StepCard/StepCard';
import { TriggerCard } from '../TriggerCard/TriggerCard';
import type {
  ActionStepConfig,
  AutomationStepConfig,
  ConditionalStepConfig,
  SwitchStepConfig,
} from '../../Automation.types';
import { issuesUnder, makeConditionalStep } from '../AutomationBuilder.utils';
import type { ControlFlowRenderProps } from '../BranchSteps/BranchSteps';
import {
  computeFlowLayout,
  VIRTUAL_ROOT_ID,
} from '../../../Board/FlowPlanEditor/FlowPlanEditor.utils';
import type {
  FlowAutomationViewProps,
  FlowEdgeData,
  FlowInsertTarget,
  FlowItem,
  FlowNodeData,
  ViewStepPath,
} from './FlowAutomationView.types';
import { edgeTypes } from './FlowInsertEdge';
import { nodeTypes } from './FlowNodes';
import {
  TRACK_CATEGORY,
  buildFlowItems,
  buildPathPrefix,
  buildVariableSourcesForPath,
  collectReachedIds,
  getContainerSteps,
  getEdgeInsertTarget,
  getEdgeLabel,
  getInsertAfterTarget,
  getStepAtPath,
  isStepItem,
  issuesUnderPath,
  moveStepAtPath,
  ownIssuesForItem,
  removeStepAtPath,
  stepNameForPath,
  stepNumberForPrefix,
  structureKey,
  updateStepAtPath,
} from './FlowAutomationView.utils';

/** Show the minimap only once the flow no longer fits comfortably on screen. */
const MINIMAP_MIN_STEPS = 9;
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 1.5;
/** Small flows fit at 100%, not zoomed in; shared by the initial fit and the fit button. */
const FIT_VIEW_OPTIONS = { padding: 0.2, maxZoom: 1 };
/** Context menu footprint, to keep it inside the canvas. */
const MENU_WIDTH = 200;
const MENU_HEIGHT = 80;

/* ─────────────────────────────── View ─────────────────────────────── */

interface ContextMenuState {
  itemId: string;
  x: number;
  y: number;
}

function describeNode(item: FlowItem, triggerName: string | undefined): string {
  if (item.nodeType === 'trigger') return `Trigger: ${triggerName ?? 'not chosen'}`;
  if (item.nodeType === 'conditional') return 'Condition';
  if (item.nodeType === 'switch') return 'Switch';
  return item.label ?? 'Step';
}

function FlowAutomationViewInner(props: FlowAutomationViewProps): React.ReactElement {
  const {
    config,
    onConfigChange,
    onTriggerTypeChange,
    onTriggerConfigChange,
    onScheduleChange,
    triggerCatalog,
    triggerSchema,
    stepCatalog,
    stepSchemaCache,
    schemaLoadingFor,
    triggerSchemaLoading,
    ensureSchema,
    operators,
    validation,
    readOnly,
    editMode,
    onAddStep,
    formFieldNameMap,
    onFormFieldNamesResolved,
    onRequestEdit,
    triggerExtras,
    renderConditionalCard,
    renderSwitchCard,
    runOverlay,
    focusRequest,
  } = props;

  const { setCenter, getZoom } = useReactFlow();
  const canvasRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const pendingFocusId = useRef<string | null>(null);

  const editable = editMode && !readOnly;

  /* ── Items, layout, lookups ── */

  const items = useMemo(() => buildFlowItems(config, stepCatalog), [config, stepCatalog]);
  const itemsById = useMemo(() => new Map(items.map(item => [item.id, item])), [items]);

  // Layout depends only on structure (ids, edges, sizes). Editing a field in
  // the panel must not re-run layout or reset the viewport: `positions` keys on
  // the structure string, so a new `items` array with the same shape reuses it.
  const layoutKey = useMemo(() => structureKey(items), [items]);
  const positions = useMemo(() => {
    const structure = JSON.parse(layoutKey) as [string, string[], number, number][];
    const layout = computeFlowLayout(
      structure.map(([id, parentIds, width, height], order) => ({
        id,
        parentIds,
        order,
        width,
        height,
      })),
      0,
    );
    layout.delete(VIRTUAL_ROOT_ID);
    return layout;
  }, [layoutKey]);

  const triggerCatalogItem = useMemo(
    () => triggerCatalog.find(c => c.type === config.trigger.type),
    [triggerCatalog, config.trigger.type],
  );

  const issuesById = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const item of items) {
      const own = ownIssuesForItem(validation?.issues, item);
      if (own.length) {
        map.set(
          item.id,
          own.map(i => i.message),
        );
      }
    }
    return map;
  }, [items, validation]);

  /* ── Focus helpers ── */

  const centerOn = useCallback(
    (id: string): void => {
      const item = itemsById.get(id);
      const position = positions.get(id);
      if (!item || !position) return;
      setCenter(position.x + item.width / 2, position.y + item.height / 2, {
        zoom: Math.max(getZoom(), 0.8),
        duration: 250,
      });
    },
    [itemsById, positions, setCenter, getZoom],
  );

  // A new step is laid out on the next render; centre on it once it has a position.
  useEffect(() => {
    const id = pendingFocusId.current;
    if (!id || !positions.has(id)) return;
    pendingFocusId.current = null;
    centerOn(id);
  }, [positions, centerOn]);

  // A validation-banner click from the builder: select the node and bring it into view.
  const appliedFocus = useRef(focusRequest);
  useEffect(() => {
    if (!focusRequest || focusRequest === appliedFocus.current) return;
    appliedFocus.current = focusRequest;
    if (!itemsById.has(focusRequest.id)) return;
    setSelectedNodeId(focusRequest.id);
    setContextMenu(null);
    centerOn(focusRequest.id);
  }, [focusRequest, itemsById, centerOn]);

  /* ── Mutations ── */

  const handleInsert = useCallback(
    (target: FlowInsertTarget, type: string): void => {
      if (!editable) return;
      const id = onAddStep(type, target.index, target.container);
      setSelectedNodeId(id);
      pendingFocusId.current = id;
    },
    [editable, onAddStep],
  );

  const handleUpdateStep = (path: ViewStepPath, next: AutomationStepConfig): void => {
    onConfigChange(updateStepAtPath(config, path, next));
  };

  // Selection is keyed by step id, so it survives the move.
  const handleMoveStep = (path: ViewStepPath, direction: -1 | 1): void => {
    onConfigChange(moveStepAtPath(config, path, direction));
  };

  const requestDelete = (id: string): void => {
    const item = itemsById.get(id);
    if (!editable || !item || !isStepItem(item)) return;
    setContextMenu(null);
    onConfigChange(removeStepAtPath(config, item.path));
    if (selectedNodeId === id) setSelectedNodeId(null);
  };

  const handleWrapInCondition = (item: FlowItem): void => {
    if (!editable) return;
    const step = getStepAtPath(config, item.path);
    if (!step) return;
    const wrapper = makeConditionalStep([step]);
    onConfigChange(updateStepAtPath(config, item.path, wrapper));
    setSelectedNodeId(wrapper.id);
    pendingFocusId.current = wrapper.id;
  };

  /* ── React Flow nodes & edges ── */

  // Run view only: what the run reached, to draw its path and fade the rest.
  const reachedIds = useMemo(
    () => (runOverlay ? collectReachedIds(items, runOverlay) : null),
    [items, runOverlay],
  );

  const derivedNodes = useMemo<Node<FlowNodeData>[]>(
    () =>
      items.map(item => {
        const catalogItem =
          item.nodeType === 'trigger'
            ? triggerCatalogItem
            : stepCatalog.find(c => c.type === item.step?.type);
        const interactive = item.nodeType !== 'merge' && item.nodeType !== 'placeholder';
        const position = positions.get(item.id) ?? { x: 0, y: 0 };
        return {
          id: item.id,
          type: item.nodeType,
          position,
          selected: interactive && item.id === selectedNodeId,
          selectable: interactive,
          focusable: interactive,
          draggable: false,
          connectable: false,
          ...(interactive ? { ariaLabel: describeNode(item, triggerCatalogItem?.name) } : {}),
          style: {
            width: item.width,
            height: item.height,
            padding: 0,
            // Steps fade themselves via runStatus; merge dots and placeholders here.
            ...(reachedIds && !isStepItem(item) && !reachedIds.has(item.id)
              ? { opacity: 0.5 }
              : {}),
          },
          data: {
            item,
            readOnly: !editable,
            catalogItem,
            issueMessages: issuesById.get(item.id) ?? [],
            stepNumber: isStepItem(item)
              ? stepNumberForPrefix(buildPathPrefix(item.path))
              : undefined,
            stepCatalog,
            onInsert: handleInsert,
            onRequestEdit,
            runStatus:
              runOverlay && isStepItem(item)
                ? (runOverlay.statusByStepName[stepNameForPath(item.path)] ?? null)
                : undefined,
          },
        };
      }),
    [
      items,
      positions,
      selectedNodeId,
      editable,
      triggerCatalogItem,
      stepCatalog,
      issuesById,
      handleInsert,
      onRequestEdit,
      runOverlay,
      reachedIds,
    ],
  );

  const [nodes, setNodes, onNodesChangeBase] = useNodesState<FlowNodeData>([]);
  // Carry the size React Flow measured (v11 keeps it on the node as width/height)
  // across rebuilds, so rebuilding on a selection change doesn't re-measure.
  useEffect(() => {
    setNodes(previous => {
      const sizeById = new Map(previous.map(node => [node.id, node]));
      return derivedNodes.map(node => {
        const measured = sizeById.get(node.id);
        return typeof measured?.width === 'number' && typeof measured.height === 'number'
          ? { ...node, width: measured.width, height: measured.height }
          : node;
      });
    });
  }, [derivedNodes, setNodes]);

  // Positions and selection are owned by this view; only let React Flow record
  // measured dimensions. Enter/Space on a focused node arrives only as a select
  // change (no click event), so take the selection from it.
  const onNodesChange = useCallback(
    (changes: NodeChange[]): void => {
      for (const change of changes) {
        if (change.type === 'select' && change.selected) {
          setSelectedNodeId(change.id);
          setContextMenu(null);
        }
      }
      onNodesChangeBase(changes.filter(change => change.type === 'dimensions'));
    },
    [onNodesChangeBase],
  );

  const edges = useMemo<Edge<FlowEdgeData>[]>(() => {
    const next: Edge<FlowEdgeData>[] = [];
    for (const item of items) {
      for (const parentId of item.parentIds) {
        const source = itemsById.get(parentId);
        if (!source) continue;
        const id = `${parentId}->${item.id}`;
        const toPlaceholder = item.nodeType === 'placeholder';
        // Run view: an edge was taken when the run reached both of its ends.
        const taken = reachedIds?.has(parentId) && reachedIds.has(item.id);
        const stroke = taken ? 'hsl(var(--foreground))' : 'hsl(var(--border))';
        next.push({
          id,
          source: parentId,
          target: item.id,
          type: 'insert',
          focusable: false,
          ...(toPlaceholder
            ? {}
            : {
                markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12, color: stroke },
              }),
          style: {
            stroke,
            strokeWidth: taken ? 2 : 1.5,
            ...(toPlaceholder ? { strokeDasharray: '4 4' } : {}),
            ...(reachedIds && !taken ? { opacity: 0.4 } : {}),
          },
          data: {
            label: getEdgeLabel(source, item),
            insert: getEdgeInsertTarget(source, item),
            readOnly: !editable,
            hovered: hoveredEdgeId === id,
            stepCatalog,
            onInsert: handleInsert,
            onRequestEdit,
          },
        });
      }
    }
    return next;
  }, [
    items,
    itemsById,
    editable,
    hoveredEdgeId,
    stepCatalog,
    handleInsert,
    onRequestEdit,
    reachedIds,
  ]);

  /* ── Canvas interaction ── */

  const handleNodeClick: NodeMouseHandler = useCallback((_event, node) => {
    if (node.type === 'merge' || node.type === 'placeholder') return;
    setSelectedNodeId(node.id);
    setContextMenu(null);
  }, []);

  // Steps only: the menu wraps or deletes a step. Kept inside the canvas bounds.
  const handleNodeContextMenu: NodeMouseHandler = useCallback(
    (event, node) => {
      if (!editable || !['action', 'conditional', 'switch'].includes(node.type ?? '')) return;
      event.preventDefault();
      const bounds = canvasRef.current?.getBoundingClientRect();
      if (!bounds) return;
      setSelectedNodeId(node.id);
      setContextMenu({
        itemId: node.id,
        x: Math.max(0, Math.min(event.clientX - bounds.left, bounds.width - MENU_WIDTH)),
        y: Math.max(0, Math.min(event.clientY - bounds.top, bounds.height - MENU_HEIGHT)),
      });
    },
    [editable],
  );

  // View mode: clicking empty canvas with nothing selected asks to start editing,
  // matching the list view. With a selection, the first click just clears it.
  const handlePaneClick = useCallback((): void => {
    if (!editable && !selectedNodeId && onRequestEdit) onRequestEdit();
    setSelectedNodeId(null);
    setContextMenu(null);
  }, [editable, selectedNodeId, onRequestEdit]);

  // Escape on a focused node clears the selection. React Flow reports it only as an
  // unselect change, which an edge click also sends, so read the key instead.
  const handleCanvasKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (
      event.key === 'Escape' &&
      event.target instanceof HTMLElement &&
      event.target.closest('.react-flow__node')
    ) {
      setSelectedNodeId(null);
      setContextMenu(null);
    }
  }, []);

  const handleNodeDoubleClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      if (editable || node.type === 'merge' || node.type === 'placeholder') return;
      onRequestEdit?.();
    },
    [editable, onRequestEdit],
  );

  // Close the context menu on any outside pointer-down, or on Escape.
  useEffect(() => {
    if (!contextMenu) return undefined;
    const onPointerDown = (event: PointerEvent): void => {
      if (menuRef.current && event.target instanceof globalThis.Node) {
        if (menuRef.current.contains(event.target)) return;
      }
      setContextMenu(null);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setContextMenu(null);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return (): void => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [contextMenu]);

  /* ── Side panel ── */

  const selectedItem = selectedNodeId ? (itemsById.get(selectedNodeId) ?? null) : null;

  const renderEmptyPanel = (): React.ReactElement => {
    const hasTrigger = Boolean(config.trigger.type);
    return (
      <div className='flex flex-col gap-4'>
        <div className='rounded-md border border-border bg-background p-4'>
          <div className='mb-2 flex items-center gap-2 text-sm font-semibold text-foreground'>
            <Workflow className='size-4 text-muted-foreground' />
            Flow view
          </div>
          <p className='text-xs text-muted-foreground'>
            Select a node to see its settings. Hover a connection and press + to insert a step, or
            right-click a step to wrap it in a condition or delete it.
          </p>
        </div>
        {!hasTrigger && (
          <div className='rounded-md border border-dashed border-border p-4 text-xs text-muted-foreground'>
            Choose a trigger first to start building the automation.
          </div>
        )}
      </div>
    );
  };

  // View mode: the trigger forms have no read-only mode, so they are inert.
  // `triggerExtras` (the webhook URL, shown once) stays copyable.
  const renderTriggerPanel = (): React.ReactElement => {
    const triggerIssues = issuesUnder(validation?.issues, 'trigger');
    return (
      <div className='flex flex-col gap-4'>
        <div inert={!editable}>
          <TriggerCard
            view='event'
            trigger={config.trigger}
            catalog={triggerCatalog}
            schema={triggerSchema}
            schemaLoading={triggerSchemaLoading}
            onChangeType={onTriggerTypeChange}
            onConfigChange={onTriggerConfigChange}
            issues={triggerIssues}
          />
        </div>
        {triggerExtras}
        <div className='flex flex-col gap-4' inert={!editable}>
          <TriggerCard
            view='condition'
            trigger={config.trigger}
            catalog={triggerCatalog}
            schema={triggerSchema}
            schemaLoading={triggerSchemaLoading}
            onChangeType={onTriggerTypeChange}
            onConfigChange={onTriggerConfigChange}
            issues={triggerIssues}
            onFormFieldNamesResolved={map => onFormFieldNamesResolved?.(map)}
          />
          <ScheduleCard
            schedule={config.schedule}
            triggerSchema={triggerSchema}
            onChange={onScheduleChange}
          />
        </div>
      </div>
    );
  };

  // 1-based position within the step's own container, as the List view's cards show it.
  const positionOf = (item: FlowItem): { index: number; total: number } => ({
    index: (item.path[item.path.length - 1] as number) + 1,
    total: getContainerSteps(config, item.path.slice(0, -1)).length,
  });

  const buildControlProps = (item: FlowItem): ControlFlowRenderProps => ({
    catalog: stepCatalog,
    schemaCache: stepSchemaCache,
    schemaLoadingFor,
    operators,
    variableSources: buildVariableSourcesForPath(
      config,
      triggerSchema,
      stepSchemaCache,
      item.path,
      formFieldNameMap,
    ),
    ...positionOf(item),
    onChange: next => handleUpdateStep(item.path, next),
    onMoveUp: () => handleMoveStep(item.path, -1),
    onMoveDown: () => handleMoveStep(item.path, 1),
    onDelete: () => requestDelete(item.id),
    issues: issuesUnderPath(validation?.issues, item.path),
    pathPrefix: buildPathPrefix(item.path),
    readOnly: !editable,
    ensureSchema,
    renderConditionalCard,
    renderSwitchCard,
  });

  const renderActionPanel = (item: FlowItem): React.ReactElement | null => {
    const step = getStepAtPath(config, item.path) as ActionStepConfig | undefined;
    if (!step) return null;
    const { index, total } = positionOf(item);
    return (
      <StepCard
        step={step}
        catalogItem={stepCatalog.find(c => c.type === step.type) ?? null}
        schema={stepSchemaCache[step.type] ?? null}
        schemaLoading={schemaLoadingFor(step.type)}
        index={index}
        total={total}
        variableSources={buildVariableSourcesForPath(
          config,
          triggerSchema,
          stepSchemaCache,
          item.path,
          formFieldNameMap,
        )}
        onConfigChange={next => handleUpdateStep(item.path, { ...step, config: next })}
        onMoveUp={() => handleMoveStep(item.path, -1)}
        onMoveDown={() => handleMoveStep(item.path, 1)}
        onDelete={() => requestDelete(item.id)}
        issues={issuesUnderPath(validation?.issues, item.path)}
        pathPrefix={`${buildPathPrefix(item.path)}.config.`}
        readOnly={!editable}
      />
    );
  };

  const renderSelectedPanel = (item: FlowItem): React.ReactElement | null => {
    if (item.nodeType === 'trigger') return renderTriggerPanel();
    if (item.nodeType === 'action') return renderActionPanel(item);
    const step = getStepAtPath(config, item.path);
    if (!step) return null;
    if (item.nodeType === 'conditional') {
      return renderConditionalCard(step as ConditionalStepConfig, buildControlProps(item));
    }
    if (item.nodeType === 'switch') {
      return renderSwitchCard(step as SwitchStepConfig, buildControlProps(item));
    }
    return null;
  };

  const renderSidePanelBody = (): React.ReactNode => {
    if (runOverlay) return runOverlay.renderPanel(selectedItem);
    if (!selectedItem) return renderEmptyPanel();
    return renderSelectedPanel(selectedItem) ?? renderEmptyPanel();
  };

  const panelTitle = selectedItem
    ? describeNode(selectedItem, triggerCatalogItem?.name)
    : runOverlay
      ? 'Run'
      : 'Builder';

  const insertAfterSelected =
    editable && selectedItem ? getInsertAfterTarget(selectedItem) : undefined;
  const menuItem = contextMenu ? itemsById.get(contextMenu.itemId) : undefined;
  const showMiniMap = items.filter(isStepItem).length >= MINIMAP_MIN_STEPS;

  const menuButtonClass =
    'flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-foreground hover:bg-accent focus-visible:bg-accent focus-visible:outline-none';

  return (
    <div className='flex flex-1 overflow-hidden'>
      <div className='flex min-w-0 flex-1 flex-col'>
        <div
          ref={canvasRef}
          role='region'
          aria-label='Automation flow canvas'
          className='relative flex-1 bg-muted/30'
        >
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodesChange={onNodesChange}
            onNodeClick={handleNodeClick}
            onNodeContextMenu={handleNodeContextMenu}
            onNodeDoubleClick={handleNodeDoubleClick}
            zoomOnDoubleClick={false}
            onPaneClick={handlePaneClick}
            onKeyDown={handleCanvasKeyDown}
            onEdgeMouseEnter={(_event, edge) => setHoveredEdgeId(edge.id)}
            onEdgeMouseLeave={() => setHoveredEdgeId(null)}
            fitView
            fitViewOptions={FIT_VIEW_OPTIONS}
            deleteKeyCode={null}
            multiSelectionKeyCode={null}
            selectionKeyCode={null}
            minZoom={MIN_ZOOM}
            maxZoom={MAX_ZOOM}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable
            selectNodesOnDrag={false}
            panOnScroll
            proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
            <Controls
              showInteractive={false}
              fitViewOptions={FIT_VIEW_OPTIONS}
              className='!bg-background !border-border !shadow-md [&_button]:!bg-background [&_button]:!border-border [&_button]:!fill-foreground'
            />
            {showMiniMap && (
              <MiniMap
                pannable
                zoomable
                nodeColor='hsl(var(--muted-foreground))'
                maskColor='hsl(var(--background) / 0.72)'
                style={{
                  backgroundColor: 'hsl(var(--card))',
                  border: '1px solid hsl(var(--border))',
                }}
              />
            )}
          </ReactFlow>

          {contextMenu && menuItem && (
            <div
              ref={menuRef}
              role='menu'
              aria-label='Step actions'
              className='absolute z-20 min-w-[200px] overflow-hidden rounded-md border border-border bg-popover py-1 shadow-lg'
              style={{ left: contextMenu.x, top: contextMenu.y }}
            >
              <button
                type='button'
                role='menuitem'
                className={menuButtonClass}
                data-track-category={TRACK_CATEGORY}
                data-track-name='context-wrap-condition'
                onClick={() => {
                  handleWrapInCondition(menuItem);
                  setContextMenu(null);
                }}
              >
                <GitBranch className='size-4 text-muted-foreground' aria-hidden='true' />
                Wrap in condition
              </button>
              <button
                type='button'
                role='menuitem'
                className={cn(menuButtonClass, 'text-destructive')}
                data-track-category={TRACK_CATEGORY}
                data-track-name='context-delete'
                onClick={() => requestDelete(menuItem.id)}
              >
                <Trash2 className='size-4' aria-hidden='true' />
                Delete
              </button>
            </div>
          )}
        </div>
      </div>

      <div className='flex w-96 flex-col overflow-hidden border-l border-border bg-background'>
        <div className='flex items-center justify-between border-b border-border px-4 py-3'>
          <span className='text-sm font-semibold text-foreground'>{panelTitle}</span>
          {selectedItem && (
            <Button
              variant='ghost'
              size='sm'
              onClick={() => setSelectedNodeId(null)}
              data-track-category={TRACK_CATEGORY}
              data-track-name='panel-clear-selection'
              className='h-7 text-xs'
            >
              Clear
            </Button>
          )}
        </div>
        {!editable && !runOverlay && selectedItem && (
          <div className='flex items-center justify-between gap-2 border-b border-border bg-muted/40 px-4 py-2 text-xs text-muted-foreground'>
            <span className='flex items-center gap-1.5'>
              <Eye className='size-3.5' aria-hidden='true' />
              View only
            </span>
            {onRequestEdit && (
              <Button
                variant='outline'
                size='sm'
                className='h-7 text-xs'
                onClick={onRequestEdit}
                data-track-category={TRACK_CATEGORY}
                data-track-name='panel-request-edit'
              >
                Edit
              </Button>
            )}
          </div>
        )}
        <div className='flex-1 overflow-y-auto p-4'>{renderSidePanelBody()}</div>
        {insertAfterSelected && selectedItem && (
          <div className='flex items-center gap-2 border-t border-border p-3 text-xs text-muted-foreground'>
            <AddStepRow
              catalog={stepCatalog}
              variant='compact'
              onPick={type => handleInsert(insertAfterSelected, type)}
            />
            {selectedItem.nodeType === 'trigger' ? 'Add first step' : 'Add step after'}
          </div>
        )}
      </div>
    </div>
  );
}

export function FlowAutomationView(props: FlowAutomationViewProps): React.ReactElement {
  return (
    <ReactFlowProvider>
      <FlowAutomationViewInner {...props} />
    </ReactFlowProvider>
  );
}
