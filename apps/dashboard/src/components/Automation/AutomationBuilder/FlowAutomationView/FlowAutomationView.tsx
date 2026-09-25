import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import * as LucideIcons from 'lucide-react';
import {
  AlertTriangle,
  Box,
  ChevronDown,
  ChevronRight,
  Copy,
  Eye,
  GitBranch,
  LayoutGrid,
  ListTree,
  Maximize,
  Minus,
  Plus,
  Search,
  Trash2,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import ReactFlow, {
  Background,
  BackgroundVariant,
  BaseEdge,
  EdgeLabelRenderer,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlowProvider,
  getSmoothStepPath,
  useNodesState,
  useReactFlow,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeChange,
  type NodeMouseHandler,
  type NodeProps,
  type Viewport,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { cn } from '../../../../utils/classNames';
import { Button } from '../../../ui/Button/Button';
import { Dialog } from '../../../ui/Dialog/Dialog';
import { AddStepRow } from '../AddStepRow/AddStepRow';
import { ConditionalCard } from '../ConditionalCard/ConditionalCard';
import { ScheduleCard } from '../ScheduleCard/ScheduleCard';
import { StepCard } from '../StepCard/StepCard';
import { SwitchCard } from '../SwitchCard/SwitchCard';
import { TriggerCard } from '../TriggerCard/TriggerCard';
import {
  CONDITIONAL_STEP_TYPE,
  makeStepId,
  type ActionStepConfig,
  type AutomationStepConfig,
  type ConditionalStepConfig,
  type SwitchStepConfig,
} from '../../Automation.types';

import { isConditionUnset, summarizeCondition } from '../ConditionEditor/ConditionEditor.utils';
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
import {
  TRIGGER_NODE_ID,
  isDescendantPath,
  buildFlowItems,
  buildPathPrefix,
  buildVariableSourcesForPath,
  cloneStepWithNewIds,
  countSteps,
  describeContainer,
  findItemForIssuePath,
  getContainerInfo,
  getEdgeInsertTarget,
  getEdgeLabel,
  getInsertAfterTarget,
  getStepAtPath,
  insertStepAtPath,
  isStepItem,
  issuesUnderPath,
  moveStepAtPath,
  ownIssuesForItem,
  removeStepAtPath,
  structureKey,
  summarizeStepConfig,
  updateStepAtPath,
} from './FlowAutomationView.utils';

/** React Flow's measured node size (kept across node rebuilds). */
interface MeasuredSize {
  width?: number;
  height?: number;
}

const TRACK_CATEGORY = 'automation-builder-flow';
/** Show the minimap only once the flow no longer fits comfortably on screen. */
const MINIMAP_MIN_NODES = 10;
/** Below this canvas width the minimap would cover the nodes it summarises. */
const MINIMAP_MIN_CANVAS_WIDTH = 640;
/** Minimap width as a share of the canvas, clamped; height keeps a 4:3 ratio. */
const MINIMAP_WIDTH_RATIO = 0.2;
const MINIMAP_MIN_WIDTH = 120;
const MINIMAP_MAX_WIDTH = 180;
const FIT_VIEW_OPTIONS = { padding: 0.2, duration: 200 } as const;
/** One localStorage entry holding the last viewport per automation, most recent last. */
const VIEWPORT_STORAGE_KEY = 'automation-flow-viewport';
const VIEWPORT_STORAGE_LIMIT = 20;

const MINIMAP_COLORS: Record<FlowItem['nodeType'], string> = {
  trigger: 'hsl(38 92% 50%)',
  action: 'hsl(217 91% 60%)',
  conditional: 'hsl(271 81% 56%)',
  switch: 'hsl(199 89% 48%)',
  merge: 'hsl(var(--muted-foreground))',
  placeholder: 'hsl(var(--border))',
};

function ResolveIcon({
  name,
  className,
  fallback = Box,
}: {
  name: string | undefined;
  className?: string;
  fallback?: LucideIcon;
}): React.ReactElement {
  const Icon = name
    ? (LucideIcons as unknown as Record<string, LucideIcon | undefined>)[name]
    : undefined;
  const IconComponent = Icon ?? fallback;
  return <IconComponent className={className} />;
}

function isViewport(value: unknown): value is Viewport {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<Viewport>;
  return typeof v.x === 'number' && typeof v.y === 'number' && typeof v.zoom === 'number';
}

type StoredViewport = Viewport & { id: string };

/**
 * Reads the stored list (least recent first), dropping malformed entries. An
 * array rather than an object so numeric-looking ids can't reorder the LRU.
 * Throws if storage is blocked or the JSON is corrupt.
 */
function loadStoredViewports(): StoredViewport[] {
  const raw = window.localStorage.getItem(VIEWPORT_STORAGE_KEY);
  const parsed: unknown = raw ? JSON.parse(raw) : [];
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(
    (entry): entry is StoredViewport =>
      isViewport(entry) && typeof (entry as Partial<StoredViewport>).id === 'string',
  );
}

function readStoredViewport(key: string | undefined): Viewport | null {
  if (!key || typeof window === 'undefined') return null;
  try {
    const entry = loadStoredViewports().find(e => e.id === key);
    return entry ? { x: entry.x, y: entry.y, zoom: entry.zoom } : null;
  } catch {
    // Corrupt or blocked storage: fall back to fitView.
    return null;
  }
}

/** Saves `viewport` as the most recent entry, evicting the least recent past the cap. */
function writeStoredViewport(key: string, viewport: Viewport): void {
  try {
    const entries = loadStoredViewports().filter(e => e.id !== key);
    entries.push({ id: key, x: viewport.x, y: viewport.y, zoom: viewport.zoom });
    window.localStorage.setItem(
      VIEWPORT_STORAGE_KEY,
      JSON.stringify(entries.slice(-VIEWPORT_STORAGE_LIMIT)),
    );
  } catch {
    // Storage full, blocked or corrupt: persistence is best-effort.
  }
}

/* ─────────────────────────────── Nodes ─────────────────────────────── */

/**
 * Shared node chrome. Selection comes from the `selected` prop that the view
 * derives from its own `selectedNodeId`; clicks are handled by `onNodeClick`
 * on the canvas, so the node body itself has no click handler.
 */
function NodeShell({
  data,
  selected,
  accent,
  trackingName,
  children,
}: {
  data: FlowNodeData;
  selected: boolean;
  accent: string;
  trackingName: string;
  children: ReactNode;
}): React.ReactElement {
  const issueCount = data.issueMessages.length;
  return (
    <div
      data-track-category={TRACK_CATEGORY}
      data-track-name={trackingName}
      title={issueCount ? data.issueMessages.join('\n') : undefined}
      className={cn(
        'relative flex h-full w-full cursor-pointer flex-col gap-1 overflow-hidden rounded-lg border bg-background px-3 py-2.5 text-left shadow-sm transition-[box-shadow,opacity]',
        'hover:shadow-md',
        accent,
        issueCount > 0 && 'border-destructive/60',
        selected && 'ring-2 ring-ring ring-offset-1 ring-offset-background',
        !selected && issueCount > 0 && 'ring-1 ring-destructive/40',
        data.dimmed && 'opacity-40',
      )}
    >
      <Handle type='target' position={Position.Top} className='!opacity-0' isConnectable={false} />
      {children}
      {issueCount > 0 && (
        <span
          className='absolute right-2 top-2 flex items-center gap-0.5 rounded-full bg-destructive/10 px-1.5 py-0.5 text-[10px] font-medium text-destructive'
          aria-label={`${issueCount} validation ${issueCount === 1 ? 'issue' : 'issues'}`}
        >
          <AlertTriangle className='size-3' aria-hidden='true' />
          {issueCount}
        </span>
      )}
      <Handle
        type='source'
        position={Position.Bottom}
        className='!opacity-0'
        isConnectable={false}
      />
    </div>
  );
}

function NodeHeader({
  icon,
  iconClassName,
  kicker,
  title,
  stepNumber,
}: {
  icon: ReactNode;
  iconClassName: string;
  kicker: string;
  title: string;
  stepNumber?: string | undefined;
}): React.ReactElement {
  return (
    <div className='flex min-w-0 items-center gap-2.5 pr-8'>
      <div
        className={cn(
          'flex size-8 flex-shrink-0 items-center justify-center rounded-md',
          iconClassName,
        )}
      >
        {icon}
      </div>
      <div className='flex min-w-0 flex-col'>
        <span className='truncate text-[10px] font-medium uppercase tracking-wide text-muted-foreground'>
          {stepNumber ? `${stepNumber} · ${kicker}` : kicker}
        </span>
        <span className='truncate text-sm font-semibold text-foreground'>{title}</span>
      </div>
    </div>
  );
}

function NodeSummary({
  text,
  placeholder,
  warn = false,
}: {
  text: string | undefined;
  placeholder: string;
  warn?: boolean;
}): React.ReactElement {
  return (
    <span
      className={cn(
        'truncate text-xs',
        text && !warn ? 'text-muted-foreground' : 'italic',
        warn ? 'text-amber-600 dark:text-amber-400' : !text && 'text-muted-foreground/70',
      )}
      title={text}
    >
      {text ?? placeholder}
    </span>
  );
}

function CollapseToggle({
  data,
  hiddenSteps,
}: {
  data: FlowNodeData;
  hiddenSteps: number;
}): React.ReactElement {
  const Icon = data.collapsed ? ChevronRight : ChevronDown;
  return (
    <button
      type='button'
      className='nodrag nopan mt-auto flex w-fit items-center gap-1 rounded text-[11px] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
      aria-expanded={!data.collapsed}
      data-track-category={TRACK_CATEGORY}
      data-track-name={data.collapsed ? 'expand-branches' : 'collapse-branches'}
      onClick={event => {
        event.stopPropagation();
        data.onToggleCollapse(data.item.id);
      }}
    >
      <Icon className='size-3' aria-hidden='true' />
      {data.collapsed
        ? `Collapsed · ${hiddenSteps} ${hiddenSteps === 1 ? 'step' : 'steps'}`
        : 'Collapse branches'}
    </button>
  );
}

function TriggerNode({ data, selected }: NodeProps<FlowNodeData>): React.ReactElement {
  const name = data.catalogItem?.name;
  return (
    <NodeShell
      data={data}
      selected={selected}
      accent='border-amber-500/40'
      trackingName='select-trigger-node'
    >
      <NodeHeader
        icon={<ResolveIcon name={data.catalogItem?.icon} fallback={Zap} className='size-4' />}
        iconClassName='bg-amber-500/10 text-amber-600 dark:text-amber-400'
        kicker='When this happens'
        title={name ?? 'Choose a trigger'}
      />
      {/* Filters only mean something once a trigger is chosen. */}
      {name ? (
        <NodeSummary text={data.summary} placeholder='No filters' />
      ) : (
        <NodeSummary text={undefined} placeholder='Required to run the automation' warn />
      )}
    </NodeShell>
  );
}

function ActionNode({ data, selected }: NodeProps<FlowNodeData>): React.ReactElement {
  return (
    <NodeShell
      data={data}
      selected={selected}
      accent='border-border'
      trackingName='select-action-node'
    >
      <NodeHeader
        icon={<ResolveIcon name={data.catalogItem?.icon} className='size-4' />}
        iconClassName='bg-primary/10 text-primary'
        kicker={data.catalogItem?.category ?? 'Action'}
        title={data.item.label ?? 'Action'}
        stepNumber={data.item.stepNumber}
      />
      <NodeSummary text={data.summary} placeholder='Not configured yet' />
    </NodeShell>
  );
}

function ConditionalNode({ data, selected }: NodeProps<FlowNodeData>): React.ReactElement {
  const step = data.item.step as ConditionalStepConfig | undefined;
  const unset = isConditionUnset(step?.config.condition);
  return (
    <NodeShell
      data={data}
      selected={selected}
      accent='border-purple-500/40'
      trackingName='select-conditional-node'
    >
      <NodeHeader
        icon={<GitBranch className='size-4' />}
        iconClassName='bg-purple-500/10 text-purple-600 dark:text-purple-400'
        kicker='If / else'
        title='Condition'
        stepNumber={data.item.stepNumber}
      />
      <NodeSummary
        text={unset ? undefined : summarizeCondition(step?.config.condition)}
        placeholder='Set a condition'
        warn={unset}
      />
      <CollapseToggle data={data} hiddenSteps={step ? countSteps(step) - 1 : 0} />
    </NodeShell>
  );
}

function SwitchNode({ data, selected }: NodeProps<FlowNodeData>): React.ReactElement {
  const step = data.item.step as SwitchStepConfig | undefined;
  const caseCount = step?.config.cases.length ?? 0;
  return (
    <NodeShell
      data={data}
      selected={selected}
      accent='border-sky-500/40'
      trackingName='select-switch-node'
    >
      <NodeHeader
        icon={<ListTree className='size-4' />}
        iconClassName='bg-sky-500/10 text-sky-600 dark:text-sky-400'
        kicker='Switch'
        title='Route by case'
        stepNumber={data.item.stepNumber}
      />
      <NodeSummary
        text={
          caseCount ? `${caseCount} ${caseCount === 1 ? 'case' : 'cases'} + default` : undefined
        }
        placeholder='No cases yet'
        warn={caseCount === 0}
      />
      <CollapseToggle data={data} hiddenSteps={step ? countSteps(step) - 1 : 0} />
    </NodeShell>
  );
}

/** Dashed "add step" slot: empty branches and the end of the main flow. */
function PlaceholderNode({ data }: NodeProps<FlowNodeData>): React.ReactElement {
  const insert = data.item.insert;
  const isEnd = data.item.id === 'add:root';
  const text = isEnd ? 'Add step' : `${data.item.label ?? 'Branch'}: add step`;
  const className = cn(
    'nodrag nopan flex h-full w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border bg-background/60 text-xs text-muted-foreground transition-colors',
    'hover:border-foreground/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
  );
  let body: ReactNode;
  if (!insert || (data.readOnly && !data.onRequestEdit)) {
    body = (
      <div
        className={cn(className, 'cursor-default hover:border-border hover:text-muted-foreground')}
      >
        {isEnd ? 'End' : `${data.item.label ?? 'Branch'}: no steps`}
      </div>
    );
  } else if (data.readOnly) {
    body = (
      <button
        type='button'
        className={className}
        data-track-category={TRACK_CATEGORY}
        data-track-name='placeholder-request-edit'
        onClick={() => data.onRequestEdit?.()}
      >
        <Plus className='size-3.5' aria-hidden='true' />
        {text}
      </button>
    );
  } else {
    body = (
      <AddStepRow
        catalog={data.stepCatalog}
        onPick={type => data.onInsert(insert, type)}
        trigger={
          <button
            type='button'
            className={className}
            aria-haspopup='listbox'
            data-track-category={TRACK_CATEGORY}
            data-track-name={isEnd ? 'add-step-end' : 'add-step-empty-branch'}
          >
            <Plus className='size-3.5' aria-hidden='true' />
            {text}
          </button>
        }
      />
    );
  }
  return (
    // Dim on the wrapper so the read-only, request-edit and picker bodies all fade.
    <div
      className={cn('h-full w-full transition-opacity', data.dimmed && 'opacity-40')}
      data-dimmed={data.dimmed ? 'true' : undefined}
    >
      <Handle type='target' position={Position.Top} className='!opacity-0' isConnectable={false} />
      {body}
      <Handle
        type='source'
        position={Position.Bottom}
        className='!opacity-0'
        isConnectable={false}
      />
    </div>
  );
}

/** Where branches rejoin. Purely visual: not selectable, focusable, or announced. */
function MergeNode({ data }: NodeProps<FlowNodeData>): React.ReactElement {
  return (
    <div
      aria-hidden='true'
      className={cn(
        'flex size-3 items-center justify-center rounded-full border border-border bg-muted transition-opacity',
        data.dimmed && 'opacity-40',
      )}
    >
      <Handle type='target' position={Position.Top} className='!opacity-0' isConnectable={false} />
      <Handle
        type='source'
        position={Position.Bottom}
        className='!opacity-0'
        isConnectable={false}
      />
    </div>
  );
}

const nodeTypes = {
  trigger: TriggerNode,
  action: ActionNode,
  conditional: ConditionalNode,
  switch: SwitchNode,
  merge: MergeNode,
  placeholder: PlaceholderNode,
};

/* ─────────────────────────────── Edges ─────────────────────────────── */

/** Smooth-step edge with an optional branch label and an "insert step here" +. */
function InsertEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  style,
  data,
}: EdgeProps<FlowEdgeData>): React.ReactElement {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 8,
  });
  const insert = data?.insert;
  const dimmed = Boolean(data?.dimmed);
  // While a search is active the + buttons are hidden, so the canvas reads as results.
  const canInsert = Boolean(!dimmed && insert && data && (!data.readOnly || data.onRequestEdit));
  const label = data?.label;
  const plusY = label ? labelY + 12 : labelY;
  const labelTop = canInsert ? labelY - 10 : labelY;
  const plusClass = cn(
    'nodrag nopan flex size-5 items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-sm transition-opacity',
    'hover:border-foreground/40 hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
    data?.hovered || pickerOpen ? 'opacity-100' : 'opacity-0 hover:opacity-100',
  );
  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        {...(markerEnd ? { markerEnd } : {})}
        style={{ ...style, ...(dimmed ? { opacity: 0.4, strokeOpacity: 0.4 } : {}) }}
      />
      <EdgeLabelRenderer>
        {label && (
          <span
            className={cn(
              'pointer-events-none absolute rounded-full border border-border bg-background px-1.5 py-px text-[10px] font-medium text-muted-foreground',
              dimmed && 'opacity-40',
            )}
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelTop}px)` }}
          >
            {label}
          </span>
        )}
        {canInsert && insert && data && (
          <div
            className='absolute'
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${plusY}px)`,
              pointerEvents: 'all',
            }}
          >
            {data.readOnly ? (
              <button
                type='button'
                aria-label='Insert step here'
                className={plusClass}
                data-track-category={TRACK_CATEGORY}
                data-track-name='edge-insert-request-edit'
                onClick={() => data.onRequestEdit?.()}
              >
                <Plus className='size-3' aria-hidden='true' />
              </button>
            ) : (
              <AddStepRow
                catalog={data.stepCatalog}
                onPick={type => data.onInsert(insert, type)}
                onOpenChange={setPickerOpen}
                trigger={
                  <button
                    type='button'
                    aria-label='Insert step here'
                    aria-haspopup='listbox'
                    className={plusClass}
                    data-track-category={TRACK_CATEGORY}
                    data-track-name='edge-insert-open'
                  >
                    <Plus className='size-3' aria-hidden='true' />
                  </button>
                }
              />
            )}
          </div>
        )}
      </EdgeLabelRenderer>
    </>
  );
}

const edgeTypes = { insert: InsertEdge };

/* ─────────────────────────── Side-panel cards ─────────────────────────── */

const renderConditionalCard = (
  step: ConditionalStepConfig,
  props: ControlFlowRenderProps,
): React.ReactElement => (
  <ConditionalCard
    step={step}
    catalog={props.catalog}
    schemaCache={props.schemaCache}
    schemaLoadingFor={props.schemaLoadingFor}
    operators={props.operators}
    variableSources={props.variableSources}
    index={props.index}
    {...(props.displayIndex ? { displayIndex: props.displayIndex } : {})}
    total={props.total}
    onChange={next => props.onChange(next)}
    onMoveUp={props.onMoveUp}
    onMoveDown={props.onMoveDown}
    onDelete={props.onDelete}
    issues={props.issues}
    pathPrefix={props.pathPrefix}
    readOnly={props.readOnly ?? false}
    ensureSchema={props.ensureSchema}
    renderConditionalCard={props.renderConditionalCard}
    renderSwitchCard={props.renderSwitchCard}
  />
);

const renderSwitchCard = (
  step: SwitchStepConfig,
  props: ControlFlowRenderProps,
): React.ReactElement => (
  <SwitchCard
    step={step}
    catalog={props.catalog}
    schemaCache={props.schemaCache}
    schemaLoadingFor={props.schemaLoadingFor}
    operators={props.operators}
    variableSources={props.variableSources}
    index={props.index}
    {...(props.displayIndex ? { displayIndex: props.displayIndex } : {})}
    total={props.total}
    onChange={next => props.onChange(next)}
    onMoveUp={props.onMoveUp}
    onMoveDown={props.onMoveDown}
    onDelete={props.onDelete}
    issues={props.issues}
    pathPrefix={props.pathPrefix}
    readOnly={props.readOnly ?? false}
    ensureSchema={props.ensureSchema}
    renderConditionalCard={props.renderConditionalCard}
    renderSwitchCard={props.renderSwitchCard}
  />
);

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
  const prefix = item.stepNumber ? `Step ${item.stepNumber}: ` : '';
  if (item.nodeType === 'trigger') return `Trigger: ${triggerName ?? 'not chosen'}`;
  if (item.nodeType === 'conditional') return `${prefix}Condition`;
  if (item.nodeType === 'switch') return `${prefix}Switch`;
  return `${prefix}${item.label ?? 'Step'}`;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

/** Panel controls that use arrow/Enter keys themselves (selects, menus, tabs). */
const PANEL_KEY_OWNER =
  'button, a[href], [role="combobox"], [role="listbox"], [role="option"], [role="menu"], [role="menuitem"], [role="tab"], [role="radio"], [role="slider"], [role="switch"], [role="checkbox"]';

function ownsNavigationKeys(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && target.closest(PANEL_KEY_OWNER) !== null;
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
    viewportKey,
    focusRequest,
  } = props;

  const { setCenter, getZoom, getViewport, setViewport, fitView, zoomIn, zoomOut } = useReactFlow();
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [pendingInsert, setPendingInsert] = useState<PendingInsert | null>(null);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const searchCursor = useRef(0);
  const pendingFocusId = useRef<string | null>(null);
  const focusSelectionRequested = useRef(false);
  const [canvasWidth, setCanvasWidth] = useState(0);

  const editable = editMode && !readOnly;

  /* ── Items, layout, lookups ── */

  const items = useMemo(
    () => buildFlowItems(config, stepCatalog, { collapsed }),
    [config, stepCatalog, collapsed],
  );
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

  const summaryById = useMemo(() => {
    const map = new Map<string, string | undefined>();
    map.set(TRIGGER_NODE_ID, summarizeStepConfig(config.trigger.type, config.trigger.config));
    for (const item of items) {
      if (item.nodeType === 'action') {
        const step = item.step as ActionStepConfig;
        map.set(item.id, summarizeStepConfig(step.type, step.config));
      }
    }
    return map;
  }, [items, config.trigger.type, config.trigger.config]);

  const searchMatches = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return null;
    return items.filter(item => {
      if (!isStepItem(item) && item.nodeType !== 'trigger') return false;
      const haystack = [
        item.label,
        item.stepNumber,
        item.nodeType === 'trigger' ? triggerCatalogItem?.name : undefined,
        item.nodeType === 'conditional' ? 'condition if else' : undefined,
        item.nodeType === 'switch' ? 'switch case' : undefined,
        summaryById.get(item.id),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [search, items, summaryById, triggerCatalogItem]);
  const matchIds = useMemo(
    () => (searchMatches ? new Set(searchMatches.map(m => m.id)) : null),
    [searchMatches],
  );

  /* ── Focus / viewport helpers ── */

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

  const selectAndFocus = useCallback(
    (id: string): void => {
      setSelectedNodeId(id);
      setPendingInsert(null);
      centerOn(id);
      focusSelectionRequested.current = true;
    },
    [centerOn],
  );

  // Keep DOM focus on the selected node so the focus ring, screen readers and
  // the selection agree. Keyboard/search moves always take focus; other
  // selection changes (clicks, issue links) only do when focus is already on
  // the canvas or nowhere, so typing in the side panel is never interrupted.
  useEffect(() => {
    if (!selectedNodeId) return undefined;
    const requested = focusSelectionRequested.current;
    focusSelectionRequested.current = false;
    const active = document.activeElement;
    const focusIsFree =
      !active || active === document.body || Boolean(canvasRef.current?.contains(active));
    if (isTypingTarget(active) || (!requested && !focusIsFree)) return undefined;
    // The node may not be focusable yet: just inserted/expanded, or still hidden
    // by React Flow until it is measured. Retry briefly until focus lands.
    let frame = 0;
    let attempts = 0;
    const tryFocus = (): void => {
      const node = canvasRef.current?.querySelector<HTMLElement>(
        `.react-flow__node[data-id="${CSS.escape(selectedNodeId)}"]`,
      );
      if (node && document.activeElement !== node) node.focus({ preventScroll: true });
      if (node && document.activeElement === node) return;
      attempts += 1;
      if (attempts < 10) frame = requestAnimationFrame(tryFocus);
    };
    frame = requestAnimationFrame(tryFocus);
    return (): void => cancelAnimationFrame(frame);
  }, [selectedNodeId]);

  // New steps (and steps revealed by expanding) are laid out on the next render;
  // centre on them once their position exists.
  useEffect(() => {
    const id = pendingFocusId.current;
    if (!id || !positions.has(id)) return;
    pendingFocusId.current = null;
    centerOn(id);
  }, [positions, centerOn]);

  // Validation banner → focus the owning node, expanding collapsed ancestors.
  const lastFocusSeq = useRef<number | null>(null);
  useEffect(() => {
    if (!focusRequest || focusRequest.seq === lastFocusSeq.current) return;
    lastFocusSeq.current = focusRequest.seq;
    const fullItems = buildFlowItems(config, stepCatalog);
    const target = findItemForIssuePath(fullItems, focusRequest.issuePath);
    if (!target) return;
    const ancestors: string[] = [];
    for (let length = 2; length < target.path.length; length += 2) {
      const owner = getStepAtPath(config, target.path.slice(0, length));
      if (owner) ancestors.push(owner.id);
    }
    if (ancestors.some(id => collapsed.has(id))) {
      setCollapsed(prev => {
        const next = new Set(prev);
        ancestors.forEach(id => next.delete(id));
        return next;
      });
    }
    setSelectedNodeId(target.id);
    setPendingInsert(null);
    pendingFocusId.current = target.id;
    if (positions.has(target.id)) {
      pendingFocusId.current = null;
      centerOn(target.id);
    }
  }, [focusRequest, config, stepCatalog, collapsed, positions, centerOn]);

  const handleMoveEnd = useCallback(
    (_event: unknown, viewport: Viewport): void => {
      if (viewportKey) writeStoredViewport(viewportKey, viewport);
    },
    [viewportKey],
  );

  // `viewportKey` can arrive after mount: the builder copies the automation id
  // into state in an effect, and a new automation only gets one on first save.
  // `onInit` can also fire before or after that. Whichever happens last applies
  // the viewport stored for the key, so the order doesn't matter.
  const flowReady = useRef(false);
  const appliedViewportKey = useRef<string | undefined>(undefined);

  const applyViewportForKey = useCallback(
    (key: string | undefined, isInitial: boolean): void => {
      const stored = key ? readStoredViewport(key) : undefined;
      if (stored) setViewport(stored);
      else if (isInitial) void fitView({ padding: 0.2 });
      // No stored view for a newly saved automation: keep what the user sees.
      else if (key) writeStoredViewport(key, getViewport());
      appliedViewportKey.current = key;
    },
    [setViewport, fitView, getViewport],
  );

  const handleInit = useCallback((): void => {
    flowReady.current = true;
    applyViewportForKey(viewportKey, true);
  }, [viewportKey, applyViewportForKey]);

  useEffect(() => {
    if (!flowReady.current || !viewportKey || viewportKey === appliedViewportKey.current) return;
    applyViewportForKey(viewportKey, false);
  }, [viewportKey, applyViewportForKey]);

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

  const handleToggleCollapse = useCallback(
    (id: string): void => {
      const collapsing = !collapsed.has(id);
      setCollapsed(prev => {
        const next = new Set(prev);
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
        return next;
      });
      // Folding a branch that holds the selection would leave the panel empty and
      // the canvas with nothing highlighted; move the selection to the folded step.
      // `itemsById` is still the pre-collapse map here.
      const control = itemsById.get(id);
      const selected = selectedNodeId ? itemsById.get(selectedNodeId) : undefined;
      if (collapsing && control && selected && isDescendantPath(control.path, selected.path)) {
        setSelectedNodeId(id);
      }
      pendingFocusId.current = id;
    },
    [collapsed, itemsById, selectedNodeId],
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
      setDeleteTargetId(id);
    },
    [editable, itemsById],
  );

  const deleteTarget = deleteTargetId ? itemsById.get(deleteTargetId) : undefined;
  const deleteCount = deleteTarget?.step ? countSteps(deleteTarget.step) : 0;

  const confirmDelete = (): void => {
    if (!deleteTarget) return;
    onConfigChange(removeStepAtPath(config, deleteTarget.path));
    if (selectedNodeId === deleteTarget.id) setSelectedNodeId(null);
    setDeleteTargetId(null);
  };

  const handleDuplicate = (item: FlowItem): void => {
    const step = getStepAtPath(config, item.path);
    const target = getInsertAfterTarget(item);
    if (!step || !target) return;
    const copy = cloneStepWithNewIds(step);
    onConfigChange(insertStepAtPath(config, target.container, target.index, copy));
    setSelectedNodeId(copy.id);
    pendingFocusId.current = copy.id;
  };

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
          deletable: editable && isStepItem(item),
          draggable: false,
          connectable: false,
          ...(interactive ? { ariaLabel: describeNode(item, triggerCatalogItem?.name) } : {}),
          style: { width: item.width, height: item.height, padding: 0 },
          data: {
            item,
            readOnly: !editable,
            catalogItem,
            summary: summaryById.get(item.id),
            issueMessages: issuesById.get(item.id) ?? [],
            collapsed: collapsed.has(item.id),
            // Search matches steps only, so every other node (placeholders and
            // merge dots included) fades while a search is active.
            dimmed: Boolean(matchIds && !matchIds.has(item.id)),
            stepCatalog,
            onInsert: handleInsert,
            onToggleCollapse: handleToggleCollapse,
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
      summaryById,
      issuesById,
      collapsed,
      matchIds,
      handleInsert,
      handleToggleCollapse,
      onRequestEdit,
    ],
  );

  const [nodes, setNodes, onNodesChangeBase] = useNodesState<FlowNodeData>([]);
  // Carry React Flow's measured size across rebuilds: a node without `measured`
  // is rendered hidden until re-measured, which flickers the canvas on every
  // selection change and makes the selected node unfocusable for that frame.
  useEffect(() => {
    setNodes(previous => {
      const measuredById = new Map<string, MeasuredSize>();
      for (const node of previous) {
        const { measured } = node as { measured?: MeasuredSize };
        if (measured) measuredById.set(node.id, measured);
      }
      return derivedNodes.map(node => {
        const measured = measuredById.get(node.id);
        return measured ? { ...node, measured } : node;
      });
    });
  }, [derivedNodes, setNodes]);

  // Positions and selection are owned by this view; only let React Flow record
  // measured dimensions. Removals go through `onNodesDelete` → confirm dialog.
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
            // Any active search dims connections; they are structure, not matches.
            dimmed: Boolean(matchIds),
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
    matchIds,
    handleInsert,
    onRequestEdit,
  ]);

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

  const handleNodesDelete = useCallback(
    (deleted: Node[]): void => {
      const first = deleted.find(node => node.type !== 'merge' && node.type !== 'placeholder');
      if (first) requestDelete(first.id);
    },
    [requestDelete],
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

  // Keyboard: Escape clears, arrows walk the graph, Enter selects the focused node.
  // Bound on the root (canvas and side panel) so a click into the panel's
  // non-text controls doesn't disable navigation; text fields keep their keys.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const visible = (id: string): boolean => {
      const item = itemsById.get(id);
      return Boolean(item && item.nodeType !== 'merge' && item.nodeType !== 'placeholder');
    };
    const resolveUp = (id: string): string | undefined => {
      let current = itemsById.get(id)?.parentIds[0];
      while (current && !visible(current)) current = itemsById.get(current)?.parentIds[0];
      return current;
    };
    // Breadth-first so the first branch's step wins; walks through empty-branch
    // placeholders and merge dots so an all-empty branch still reaches the next step.
    const resolveDown = (id: string): string | undefined => {
      const queue = items.filter(i => i.parentIds.includes(id)).map(i => i.id);
      const seen = new Set(queue);
      while (queue.length) {
        const next = queue.shift()!;
        if (visible(next)) return next;
        for (const child of items) {
          if (child.parentIds.includes(next) && !seen.has(child.id)) {
            seen.add(child.id);
            queue.push(child.id);
          }
        }
      }
      return undefined;
    };
    const resolveSideways = (id: string, direction: -1 | 1): string | undefined => {
      const origin = positions.get(id);
      if (!origin) return undefined;
      let best: string | undefined;
      let bestDistance = Infinity;
      for (const item of items) {
        if (!visible(item.id) || item.id === id) continue;
        const position = positions.get(item.id);
        if (!position || Math.abs(position.y - origin.y) > 1) continue;
        const dx = (position.x - origin.x) * direction;
        if (dx > 0 && dx < bestDistance) {
          best = item.id;
          bestDistance = dx;
        }
      }
      return best;
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || isTypingTarget(event.target)) return;
      const inCanvas =
        event.target instanceof Node && Boolean(canvasRef.current?.contains(event.target));
      if (event.key === 'Escape') {
        setContextMenu(null);
        setPendingInsert(null);
        setSelectedNodeId(null);
        return;
      }
      // Outside the canvas, leave keys to panel controls that handle them.
      if (!inCanvas && ownsNavigationKeys(event.target)) return;
      if (event.key === 'Enter' || event.key === ' ') {
        const focusedNode =
          event.target instanceof HTMLElement ? event.target.closest('.react-flow__node') : null;
        const id = focusedNode?.getAttribute('data-id');
        if (id && visible(id) && event.target === focusedNode) {
          event.preventDefault();
          setSelectedNodeId(id);
          setPendingInsert(null);
        }
        return;
      }
      const arrows: Record<string, (id: string) => string | undefined> = {
        ArrowUp: resolveUp,
        ArrowDown: resolveDown,
        ArrowLeft: id => resolveSideways(id, -1),
        ArrowRight: id => resolveSideways(id, 1),
      };
      const move = arrows[event.key];
      if (!move) return;
      event.preventDefault();
      const next = selectedNodeId ? move(selectedNodeId) : TRIGGER_NODE_ID;
      if (next) selectAndFocus(next);
    };
    root.addEventListener('keydown', onKeyDown);
    return (): void => root.removeEventListener('keydown', onKeyDown);
  }, [items, itemsById, positions, selectedNodeId, selectAndFocus]);

  const jumpToNextMatch = (): void => {
    if (!searchMatches?.length) return;
    const match = searchMatches[searchCursor.current % searchMatches.length]!;
    searchCursor.current += 1;
    selectAndFocus(match.id);
  };

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
            right-click a step for more actions. Arrow keys move between steps.
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
    const triggerIssues = (validation?.issues ?? []).filter(i => i.path === 'trigger.config');
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
      ...(item.stepNumber ? { displayIndex: item.stepNumber } : {}),
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
        {...(item.stepNumber ? { displayIndex: item.stepNumber } : {})}
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
        : `${selectedItem.stepNumber ? `Step ${selectedItem.stepNumber}` : 'Step'}`
      : 'Builder';

  const insertAfterSelected =
    editable && selectedItem && !pendingInsert ? getInsertAfterTarget(selectedItem) : undefined;
  const menuItem = contextMenu ? itemsById.get(contextMenu.itemId) : undefined;
  const menuIsStep = Boolean(menuItem && isStepItem(menuItem));
  const menuIsControl = menuItem?.nodeType === 'conditional' || menuItem?.nodeType === 'switch';
  const showMiniMap =
    items.filter(isStepItem).length + 1 >= MINIMAP_MIN_NODES &&
    canvasWidth >= MINIMAP_MIN_CANVAS_WIDTH;
  const miniMapWidth = Math.round(
    Math.min(MINIMAP_MAX_WIDTH, Math.max(MINIMAP_MIN_WIDTH, canvasWidth * MINIMAP_WIDTH_RATIO)),
  );
  const noSearchMatches = Boolean(searchMatches && searchMatches.length === 0);

  const menuButtonClass =
    'flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-foreground hover:bg-accent focus-visible:bg-accent focus-visible:outline-none';

  const zoomButtonClass =
    'flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

  return (
    <div ref={rootRef} className='flex flex-1 overflow-hidden'>
      <div className='flex min-w-0 flex-1 flex-col'>
        {/* Toolbar sits above the canvas so it never covers nodes. */}
        <div className='flex items-center gap-2 border-b border-border bg-background px-3 py-1.5'>
          <div className='flex min-w-0 items-center gap-2 rounded-md border border-border bg-background px-2 py-1'>
            <Search className='size-3.5 text-muted-foreground' aria-hidden='true' />
            <input
              type='search'
              value={search}
              onChange={event => {
                setSearch(event.target.value);
                searchCursor.current = 0;
              }}
              onKeyDown={event => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  jumpToNextMatch();
                }
              }}
              placeholder='Find a step…'
              aria-label='Find a step'
              data-track-category={TRACK_CATEGORY}
              data-track-name='search-steps'
              className='w-40 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground'
            />
            {searchMatches && (
              <span
                className={cn(
                  'whitespace-nowrap text-[11px]',
                  noSearchMatches ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground',
                )}
                aria-live='polite'
              >
                {noSearchMatches
                  ? 'No matches'
                  : `${searchMatches.length} ${searchMatches.length === 1 ? 'match' : 'matches'}`}
              </span>
            )}
          </div>
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
            onNodesDelete={handleNodesDelete}
            onPaneClick={handlePaneClick}
            onEdgeMouseEnter={(_event, edge) => setHoveredEdgeId(edge.id)}
            onEdgeMouseLeave={() => setHoveredEdgeId(null)}
            onMoveEnd={handleMoveEnd}
            onInit={handleInit}
            deleteKeyCode={editable ? ['Backspace', 'Delete'] : null}
            multiSelectionKeyCode={null}
            selectionKeyCode={null}
            minZoom={0.2}
            maxZoom={1.5}
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

          {noSearchMatches && (
            <div
              role='status'
              className='absolute left-1/2 top-4 z-10 flex -translate-x-1/2 items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-xs text-muted-foreground shadow-sm'
            >
              <span>
                No steps match{' '}
                <span className='font-medium text-foreground'>“{search.trim()}”</span>
              </span>
              <button
                type='button'
                className='flex items-center gap-1 rounded px-1.5 py-0.5 text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                onClick={() => setSearch('')}
                data-track-category={TRACK_CATEGORY}
                data-track-name='search-clear'
              >
                <X className='size-3' aria-hidden='true' />
                Clear
              </button>
            </div>
          )}

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
                    data-track-name='context-duplicate'
                    onClick={() => {
                      handleDuplicate(menuItem);
                      setContextMenu(null);
                    }}
                  >
                    <Copy className='size-4 text-muted-foreground' aria-hidden='true' />
                    Duplicate
                  </button>
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
              {menuIsControl && (
                <button
                  type='button'
                  role='menuitem'
                  className={menuButtonClass}
                  data-track-category={TRACK_CATEGORY}
                  data-track-name='context-toggle-collapse'
                  onClick={() => {
                    handleToggleCollapse(menuItem.id);
                    setContextMenu(null);
                  }}
                >
                  {collapsed.has(menuItem.id) ? (
                    <ChevronRight className='size-4 text-muted-foreground' aria-hidden='true' />
                  ) : (
                    <ChevronDown className='size-4 text-muted-foreground' aria-hidden='true' />
                  )}
                  {collapsed.has(menuItem.id) ? 'Expand branches' : 'Collapse branches'}
                </button>
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

      <Dialog
        open={Boolean(deleteTarget)}
        onOpenChange={open => {
          if (!open) setDeleteTargetId(null);
        }}
        title='Delete step?'
        className='sm:max-w-md'
      >
        <div className='flex flex-col gap-4 px-5 py-4 text-sm text-foreground'>
          <p>
            {deleteCount === 2
              ? 'This removes the step and the step inside its branches.'
              : deleteCount > 2
                ? `This removes the step and all ${deleteCount - 1} steps inside its branches.`
                : 'This removes the step from the automation.'}{' '}
            You can still discard changes before saving.
          </p>
          <div className='flex justify-end gap-2 pt-2'>
            <Button
              variant='outline'
              size='sm'
              onClick={() => setDeleteTargetId(null)}
              data-track-category={TRACK_CATEGORY}
              data-track-name='delete-step-cancel'
            >
              Cancel
            </Button>
            <Button
              variant='destructive'
              size='sm'
              onClick={confirmDelete}
              data-track-category={TRACK_CATEGORY}
              data-track-name='delete-step-confirm'
            >
              Delete {deleteCount > 1 ? `${deleteCount} steps` : 'step'}
            </Button>
          </div>
        </div>
      </Dialog>
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
