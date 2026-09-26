import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Eye, GitBranch, LayoutGrid, Maximize, Minus, Plus, Trash2 } from 'lucide-react';
import ReactFlow, {
  Background,
  BackgroundVariant,
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
import {
  CONDITIONAL_STEP_TYPE,
  makeStepId,
  type ActionStepConfig,
  type AutomationStepConfig,
  type ConditionalStepConfig,
  type SwitchStepConfig,
} from '../../Automation.types';

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
  describeContainer,
  getContainerInfo,
  getEdgeInsertTarget,
  getEdgeLabel,
  getInsertAfterTarget,
  getStepAtPath,
  isStepItem,
  issuesUnderPath,
  moveStepAtPath,
  ownIssuesForItem,
  removeStepAtPath,
  structureKey,
  updateStepAtPath,
} from './FlowAutomationView.utils';

/** Show the minimap only once the flow no longer fits comfortably on screen. */
const MINIMAP_MIN_NODES = 10;
/** Below this canvas width the minimap would cover the nodes it summarises. */
const MINIMAP_MIN_CANVAS_WIDTH = 640;
/** Minimap width as a share of the canvas, clamped; height keeps a 4:3 ratio. */
const MINIMAP_WIDTH_RATIO = 0.2;
const MINIMAP_MIN_WIDTH = 120;
const MINIMAP_MAX_WIDTH = 180;
const FIT_VIEW_OPTIONS = { padding: 0.2, duration: 200 } as const;
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 1.5;

const MINIMAP_COLORS: Record<FlowItem['nodeType'], string> = {
  trigger: 'hsl(38 92% 50%)',
  action: 'hsl(217 91% 60%)',
  conditional: 'hsl(271 81% 56%)',
  switch: 'hsl(199 89% 48%)',
  merge: 'hsl(var(--muted-foreground))',
  placeholder: 'hsl(var(--border))',
};

/* ─────────────────────────────── View ─────────────────────────────── */

interface ContextMenuState {
  itemId: string;
  x: number;
  y: number;
}

interface PendingInsert extends FlowInsertTarget {
  description: string;
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
    triggerCatalog,
    triggerSchema,
    stepCatalog,
    stepSchemaCache,
    schemaLoadingFor,
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
  } = props;

  const { setCenter, getZoom, fitView, zoomIn, zoomOut } = useReactFlow();
  const canvasRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [pendingInsert, setPendingInsert] = useState<PendingInsert | null>(null);
  const pendingFocusId = useRef<string | null>(null);
  const [canvasWidth, setCanvasWidth] = useState(0);

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
    let minX = Infinity;
    let minY = Infinity;
    for (const position of layout.values()) {
      minX = Math.min(minX, position.x);
      minY = Math.min(minY, position.y);
    }
    const offsetX = Number.isFinite(minX) ? minX - 24 : 0;
    const offsetY = Number.isFinite(minY) ? minY - 24 : 0;
    const shifted = new Map<string, { x: number; y: number }>();
    for (const [id, position] of layout) {
      shifted.set(id, { x: position.x - offsetX, y: position.y - offsetY });
    }
    return shifted;
  }, [layoutKey]);

  const triggerCatalogItem = useMemo(
    () => triggerCatalog.find(c => c.type === config.trigger.type),
    [triggerCatalog, config.trigger.type],
  );

  const issuesById = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const item of items) {
      const own = ownIssuesForItem(validation?.issues, item);
      if (own.length)
        map.set(
          item.id,
          own.map(i => i.message),
        );
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

  // The minimap is sized from, and hidden below, the canvas width.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(entries => {
      const width = entries[0]?.contentRect.width;
      if (width !== undefined) setCanvasWidth(width);
    });
    observer.observe(canvas);
    return (): void => observer.disconnect();
  }, []);

  /* ── Mutations ── */

  const handleInsert = useCallback(
    (target: FlowInsertTarget, type: string): void => {
      if (!editable) return;
      const id = onAddStep(type, target.index, target.container);
      setSelectedNodeId(id);
      setPendingInsert(null);
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

  const requestDelete = useCallback(
    (id: string): void => {
      const item = itemsById.get(id);
      if (!editable || !item || !isStepItem(item)) return;
      setContextMenu(null);
      onConfigChange(removeStepAtPath(config, item.path));
      if (selectedNodeId === id) setSelectedNodeId(null);
    },
    [editable, itemsById, config, onConfigChange, selectedNodeId],
  );

  const handleWrapInCondition = (item: FlowItem): void => {
    const step = getStepAtPath(config, item.path);
    if (!step) return;
    const wrapper: ConditionalStepConfig = {
      id: makeStepId(),
      type: CONDITIONAL_STEP_TYPE,
      config: {
        condition: { variable: '', operator: 'eq', value: '' },
        if_true: [step],
        if_false: [],
      },
    };
    onConfigChange(updateStepAtPath(config, item.path, wrapper));
    setSelectedNodeId(wrapper.id);
    pendingFocusId.current = wrapper.id;
  };

  const openPendingInsert = (item: FlowItem): void => {
    const target = getInsertAfterTarget(item);
    if (!target) return;
    setPendingInsert({ ...target, description: describeContainer(config, target.container) });
  };

  /* ── React Flow nodes & edges ── */

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
          style: { width: item.width, height: item.height, padding: 0 },
          data: {
            item,
            readOnly: !editable,
            catalogItem,
            issueMessages: issuesById.get(item.id) ?? [],
            stepCatalog,
            onInsert: handleInsert,
            onRequestEdit,
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
  // measured dimensions.
  const onNodesChange = useCallback(
    (changes: NodeChange[]): void => {
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
        next.push({
          id,
          source: parentId,
          target: item.id,
          type: 'insert',
          focusable: false,
          ...(toPlaceholder
            ? {}
            : { markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12 } }),
          style: {
            stroke: 'hsl(var(--border))',
            strokeWidth: 1.5,
            ...(toPlaceholder ? { strokeDasharray: '4 4' } : {}),
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
  }, [items, itemsById, editable, hoveredEdgeId, stepCatalog, handleInsert, onRequestEdit]);

  /* ── Canvas interaction ── */

  const handleNodeClick: NodeMouseHandler = useCallback((_event, node) => {
    if (node.type === 'merge' || node.type === 'placeholder') return;
    setSelectedNodeId(node.id);
    setPendingInsert(null);
    setContextMenu(null);
  }, []);

  const handleNodeContextMenu: NodeMouseHandler = useCallback(
    (event, node) => {
      if (!editable || node.type === 'merge' || node.type === 'placeholder') return;
      event.preventDefault();
      const bounds = canvasRef.current?.getBoundingClientRect();
      setSelectedNodeId(node.id);
      setContextMenu({
        itemId: node.id,
        x: event.clientX - (bounds?.left ?? 0),
        y: event.clientY - (bounds?.top ?? 0),
      });
    },
    [editable],
  );

  // View mode: clicking empty canvas with nothing selected asks to start editing,
  // matching the list view. With a selection, the first click just clears it.
  const handlePaneClick = useCallback((): void => {
    if (!editable && !selectedNodeId && onRequestEdit) onRequestEdit();
    setSelectedNodeId(null);
    setPendingInsert(null);
    setContextMenu(null);
  }, [editable, selectedNodeId, onRequestEdit]);

  const handleNodeDoubleClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      if (editable || node.type === 'merge' || node.type === 'placeholder') return;
      onRequestEdit?.();
    },
    [editable, onRequestEdit],
  );

  // Close the context menu on any outside pointer-down.
  useEffect(() => {
    if (!contextMenu) return undefined;
    const onPointerDown = (event: PointerEvent): void => {
      if (menuRef.current && event.target instanceof globalThis.Node) {
        if (menuRef.current.contains(event.target)) return;
      }
      setContextMenu(null);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return (): void => document.removeEventListener('pointerdown', onPointerDown);
  }, [contextMenu]);

  /* ── Side panel ── */

  const selectedItem = selectedNodeId ? (itemsById.get(selectedNodeId) ?? null) : null;

  const renderEmptyPanel = (): React.ReactElement => {
    const hasTrigger = Boolean(config.trigger.type);
    return (
      <div className='flex flex-col gap-4'>
        <div className='rounded-md border border-border bg-background p-4'>
          <div className='mb-2 flex items-center gap-2 text-sm font-semibold text-foreground'>
            <LayoutGrid className='size-4 text-muted-foreground' />
            Flow view
          </div>
          <p className='text-xs text-muted-foreground'>
            Select a node to see its settings. Hover a connection and press + to insert a step, or
            right-click a step for more actions.
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

  const renderPendingInsertPanel = (target: PendingInsert): React.ReactElement => (
    <div className='flex flex-col gap-3'>
      <p className='text-sm text-foreground'>Add a step to {target.description}.</p>
      <AddStepRow
        catalog={stepCatalog}
        onPick={type => handleInsert(target, type)}
        variant='full'
      />
      <Button
        variant='ghost'
        size='sm'
        className='self-start text-xs'
        onClick={() => setPendingInsert(null)}
        data-track-category={TRACK_CATEGORY}
        data-track-name='pending-insert-cancel'
      >
        Cancel
      </Button>
    </div>
  );

  const renderTriggerPanel = (): React.ReactElement => {
    const triggerIssues = issuesUnderPath(validation?.issues, ['trigger'], 'trigger');
    return (
      <div className='flex flex-col gap-4'>
        <TriggerCard
          view='event'
          trigger={config.trigger}
          catalog={triggerCatalog}
          schema={triggerSchema}
          schemaLoading={false}
          onChangeType={type => onConfigChange({ ...config, trigger: { type, config: {} } })}
          onConfigChange={next =>
            onConfigChange({ ...config, trigger: { ...config.trigger, config: next } })
          }
          issues={triggerIssues}
        />
        {triggerExtras}
        <TriggerCard
          view='condition'
          trigger={config.trigger}
          catalog={triggerCatalog}
          schema={triggerSchema}
          schemaLoading={false}
          onChangeType={type => onConfigChange({ ...config, trigger: { type, config: {} } })}
          onConfigChange={next =>
            onConfigChange({ ...config, trigger: { ...config.trigger, config: next } })
          }
          issues={triggerIssues}
          onFormFieldNamesResolved={map => onFormFieldNamesResolved?.(map)}
        />
        <ScheduleCard
          schedule={config.schedule ?? { type: 'IMMEDIATE' }}
          triggerSchema={triggerSchema}
          onChange={next => onConfigChange({ ...config, schedule: next ?? { type: 'IMMEDIATE' } })}
        />
      </div>
    );
  };

  const buildControlProps = (
    item: FlowItem,
    nodeType: 'conditional' | 'switch',
  ): ControlFlowRenderProps => {
    const containerInfo = getContainerInfo(config, item.path) ?? {
      steps: config.steps,
      index: item.path[1] as number,
    };
    return {
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
      index: containerInfo.index + 1,
      total: containerInfo.steps.length,
      onChange: next => handleUpdateStep(item.path, next),
      onMoveUp: () => handleMoveStep(item.path, -1),
      onMoveDown: () => handleMoveStep(item.path, 1),
      onDelete: () => requestDelete(item.id),
      issues: issuesUnderPath(validation?.issues, item.path, nodeType),
      pathPrefix: buildPathPrefix(item.path),
      readOnly: !editable,
      ensureSchema,
      renderConditionalCard,
      renderSwitchCard,
    };
  };

  const renderActionPanel = (item: FlowItem): React.ReactElement | null => {
    const step = getStepAtPath(config, item.path) as ActionStepConfig | undefined;
    if (!step) return null;
    const containerInfo = getContainerInfo(config, item.path) ?? {
      steps: config.steps,
      index: item.path[1] as number,
    };
    return (
      <StepCard
        step={step}
        catalogItem={stepCatalog.find(c => c.type === step.type) ?? null}
        schema={stepSchemaCache[step.type] ?? null}
        schemaLoading={schemaLoadingFor(step.type)}
        index={containerInfo.index + 1}
        total={containerInfo.steps.length}
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
        issues={issuesUnderPath(validation?.issues, item.path, 'action')}
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
      return renderConditionalCard(
        step as ConditionalStepConfig,
        buildControlProps(item, 'conditional'),
      );
    }
    if (item.nodeType === 'switch') {
      return renderSwitchCard(step as SwitchStepConfig, buildControlProps(item, 'switch'));
    }
    return null;
  };

  const renderSidePanelBody = (): React.ReactElement => {
    if (pendingInsert && editable) return renderPendingInsertPanel(pendingInsert);
    if (!selectedItem) return renderEmptyPanel();
    return renderSelectedPanel(selectedItem) ?? renderEmptyPanel();
  };

  const panelTitle = pendingInsert
    ? 'Add step'
    : selectedItem
      ? selectedItem.nodeType === 'trigger'
        ? 'Trigger'
        : 'Step'
      : 'Builder';

  const insertAfterSelected =
    editable && selectedItem && !pendingInsert ? getInsertAfterTarget(selectedItem) : undefined;
  const menuItem = contextMenu ? itemsById.get(contextMenu.itemId) : undefined;
  const menuIsStep = Boolean(menuItem && isStepItem(menuItem));
  const showMiniMap =
    items.filter(isStepItem).length + 1 >= MINIMAP_MIN_NODES &&
    canvasWidth >= MINIMAP_MIN_CANVAS_WIDTH;
  const miniMapWidth = Math.round(
    Math.min(MINIMAP_MAX_WIDTH, Math.max(MINIMAP_MIN_WIDTH, canvasWidth * MINIMAP_WIDTH_RATIO)),
  );

  const menuButtonClass =
    'flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-foreground hover:bg-accent focus-visible:bg-accent focus-visible:outline-none';

  const zoomButtonClass =
    'flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

  return (
    <div className='flex flex-1 overflow-hidden'>
      <div className='flex min-w-0 flex-1 flex-col'>
        {/* Toolbar sits above the canvas so it never covers nodes. */}
        <div className='flex items-center gap-2 border-b border-border bg-background px-3 py-1.5'>
          <div className='ml-auto flex items-center gap-0.5' role='group' aria-label='Zoom'>
            <button
              type='button'
              className={zoomButtonClass}
              onClick={() => void zoomOut({ duration: 200 })}
              aria-label='Zoom out'
              title='Zoom out'
              data-track-category={TRACK_CATEGORY}
              data-track-name='zoom-out'
            >
              <Minus className='size-3.5' aria-hidden='true' />
            </button>
            <button
              type='button'
              className={zoomButtonClass}
              onClick={() => void zoomIn({ duration: 200 })}
              aria-label='Zoom in'
              title='Zoom in'
              data-track-category={TRACK_CATEGORY}
              data-track-name='zoom-in'
            >
              <Plus className='size-3.5' aria-hidden='true' />
            </button>
            <button
              type='button'
              className={zoomButtonClass}
              onClick={() => void fitView(FIT_VIEW_OPTIONS)}
              aria-label='Fit flow to view'
              title='Fit to view'
              data-track-category={TRACK_CATEGORY}
              data-track-name='fit-view'
            >
              <Maximize className='size-3.5' aria-hidden='true' />
            </button>
          </div>
        </div>
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
            onEdgeMouseEnter={(_event, edge) => setHoveredEdgeId(edge.id)}
            onEdgeMouseLeave={() => setHoveredEdgeId(null)}
            onInit={() => void fitView({ padding: 0.2 })}
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
            {showMiniMap && (
              <MiniMap
                style={{ width: miniMapWidth, height: Math.round(miniMapWidth * 0.75) }}
                nodeStrokeWidth={3}
                zoomable
                pannable
                nodeColor={node => MINIMAP_COLORS[node.type as FlowItem['nodeType']] ?? 'gray'}
                maskColor='hsl(var(--background) / 0.72)'
                className='!border-border !bg-background/80'
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
                data-track-name='context-add-after'
                onClick={() => {
                  openPendingInsert(menuItem);
                  setContextMenu(null);
                }}
              >
                <Plus className='size-4 text-muted-foreground' aria-hidden='true' />
                {menuItem.nodeType === 'trigger' ? 'Add first step' : 'Add step after'}
              </button>
              {menuIsStep && (
                <>
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
                </>
              )}
              {menuIsStep && (
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
              )}
            </div>
          )}
        </div>
      </div>

      <div className='flex w-96 flex-col overflow-hidden border-l border-border bg-background'>
        <div className='flex items-center justify-between border-b border-border px-4 py-3'>
          <span className='text-sm font-semibold text-foreground'>{panelTitle}</span>
          {(selectedItem || pendingInsert) && (
            <Button
              variant='ghost'
              size='sm'
              onClick={() => {
                setSelectedNodeId(null);
                setPendingInsert(null);
              }}
              data-track-category={TRACK_CATEGORY}
              data-track-name='panel-clear-selection'
              className='h-7 text-xs'
            >
              Clear
            </Button>
          )}
        </div>
        {!editable && selectedItem && (
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
        <div className='flex-1 overflow-y-auto p-4'>
          <div inert={!editable && Boolean(selectedItem)}>{renderSidePanelBody()}</div>
        </div>
        {insertAfterSelected && selectedItem && (
          <div className='flex items-center justify-between gap-2 border-t border-border p-3'>
            <div className='flex items-center gap-2 text-xs text-muted-foreground'>
              <AddStepRow
                catalog={stepCatalog}
                variant='compact'
                onPick={type => handleInsert(insertAfterSelected, type)}
              />
              {selectedItem.nodeType === 'trigger' ? 'Add first step' : 'Add step after'}
            </div>
            {isStepItem(selectedItem) && (
              <Button
                variant='outline'
                size='sm'
                className='gap-1 text-destructive'
                onClick={() => requestDelete(selectedItem.id)}
                data-track-category={TRACK_CATEGORY}
                data-track-name='panel-delete-step'
              >
                <Trash2 className='size-3.5' aria-hidden='true' />
                Delete
              </Button>
            )}
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
