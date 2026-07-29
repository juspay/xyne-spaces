import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Position,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeChange,
  type NodeProps,
  EdgeLabelRenderer,
  getBezierPath,
  MarkerType,
  Panel,
} from 'reactflow';
import 'reactflow/dist/style.css';
import {
  Plus,
  X,
  Pencil,
  ChevronDown,
  Settings2,
  Timer,
  Trash2,
  GitBranch,
  Save,
  LayoutGrid,
  Expand,
  Merge,
  Check,
} from 'lucide-react';
import {
  STATUS_OPTIONS,
  getStatusOption,
  type StageNode,
} from '../BoardStageConfigScreen/BoardStageConfigScreen.types';
import { StatusIndicator } from '../StatusIndicator';
import { ApproverSelector } from '../ApproverSelector';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../ui/dropdown-menu';
import { TransitionFormPicker } from '../TransitionFormPicker/TransitionFormPicker';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TransitionMeta {
  id?: string; // persisted DB id — populated after first save, undefined for new transitions
  formId?: string | null;
  requiresApproval: boolean;
  // When true, the approval request is auto-created (and the approver notified)
  // the moment a ticket enters the source stage — no manual move needed. Only
  // honored at runtime when the source stage has a single outgoing transition.
  requestApprovalOnEntry?: boolean;
  approvers?: Array<{ approverId: string; approverType: 'USER' | 'ROLE' }>;
  visitSlaMode: string;
  fixedEtaHours?: number | null;
  onReenter: string;
}

export interface NonLinearTransitionEditorProps {
  stages: StageNode[];
  transitionsByTempId: Map<number, Set<number>>;
  transitionsMeta: Map<string, TransitionMeta>;
  toggleTransition: (from: number, to: number, enabled: boolean) => void;
  updateTransitionMeta: (from: number, to: number, meta: Partial<TransitionMeta>) => void;
  onUpdateStage: (tempId: number, patch: Partial<StageNode>) => void;
  onDeleteStage: (tempId: number) => void;
  onAddStage: () => void;
  formMap: Map<string, string>;
  onOpenEdgeForm: (
    from: number,
    to: number,
    existingFormId?: string | null,
    allPairs?: Array<{ fromTempId: number; toTempId: number }>,
  ) => void;
  onAttachExistingEdgeForm: (
    from: number,
    to: number,
    formId: string,
    allPairs?: Array<{ fromTempId: number; toTempId: number }>,
  ) => void;
  stageForms: Array<{ id: string; formName: string }>;
  onAddConditionForEdge: (from: number, to: number) => void;
  isTransitionsLoading: boolean;
  editingEtaId: number | null;
  etaValue: string;
  etaInputRef: React.RefObject<HTMLInputElement | null>;
  onStartEditEta: (stage: StageNode) => void;
  onSaveEta: (tempId: number) => void;
  onCancelEta: () => void;
  setEtaValue: (v: string) => void;
}

// ─── Custom Stage Node ────────────────────────────────────────────────────────

type HighlightState = 'selected' | 'connected' | 'dull' | 'normal';

const NODE_HIGHLIGHT_CLASSES: Record<HighlightState, string> = {
  selected: 'border-[#6276be] ring-2 ring-[#6276be]/30 bg-[#6276be]/5',
  connected: 'border-[#6276be]/60 bg-[#6276be]/5',
  dull: 'border-border opacity-40 grayscale-[40%]',
  normal: 'border-border',
};

interface StageNodeData {
  stage: StageNode;
  highlightState?: HighlightState;
}

// Display-only card; all editing lives in StageActionsPanel, opened via onNodeClick.
const StageNodeComponent: React.FC<NodeProps<StageNodeData>> = ({ data }) => {
  const { stage, highlightState = 'normal' } = data;

  return (
    <div
      className={`w-[240px] bg-background rounded-[10px] border-2 shadow-[0px_2px_8px_0px_rgba(5,5,6,0.07)] transition-all cursor-pointer ${NODE_HIGHLIGHT_CLASSES[highlightState]}`}
    >
      {/* Handles */}
      <Handle
        type='target'
        position={Position.Left}
        className='!w-3 !h-3 !bg-[#6276be] !border-2 !border-background !rounded-full'
        style={{ left: -7 }}
      />
      <Handle
        type='source'
        position={Position.Right}
        className='!w-3 !h-3 !bg-[#6276be] !border-2 !border-background !rounded-full'
        style={{ right: -7 }}
      />

      <div className='px-3 py-3 flex items-center gap-2'>
        <StatusIndicator status={stage.defaultTicketStatusV2} size={16} />
        <span className='flex-1 text-[12px] font-semibold text-foreground leading-[18px] truncate'>
          {stage.name || 'Stage name...'}
        </span>
      </div>
    </div>
  );
};

// ─── Custom Edge ──────────────────────────────────────────────────────────────

interface TransitionEdgeData {
  fromTempId: number;
  toTempId: number;
  meta: TransitionMeta;
  onSelectEdge: (edgeId: string) => void;
  selectedEdgeId: string | null;
  isReciprocal?: boolean;
  curveOffset?: number;
  highlightState?: HighlightState;
  isAllEdge?: boolean;
  sourceTempIds?: number[];
}

// ─── Merged "All" Bubble Node ────────────────────────────────────────────────

interface AllBubbleNodeData {
  targetTempId: number;
  formId: string | null;
  highlightState?: HighlightState;
}

const AllBubbleNodeComponent: React.FC<NodeProps<AllBubbleNodeData>> = ({ data }) => {
  const highlightState = data.highlightState ?? 'normal';
  const isDulled = highlightState === 'dull';
  const isHighlighted = highlightState === 'connected' || highlightState === 'selected';

  return (
    <div
      className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium shadow-sm transition-opacity cursor-grab active:cursor-grabbing ${
        isHighlighted
          ? 'border-[#6276be] bg-[#6276be]/10 text-[#6276be]'
          : 'border-[#6276be]/40 bg-[#6276be]/5 text-[#6276be]'
      }`}
      style={{ opacity: isDulled ? 0.35 : 1 }}
    >
      <Handle
        type='source'
        position={Position.Right}
        className='!w-2 !h-2 !bg-[#6276be] !border-2 !border-background !rounded-full'
        style={{ right: -5 }}
      />
      <span className='select-none'>All</span>
    </div>
  );
};

// ─── Graph Layout Helper ─────────────────────────────────────────────────────

const COL_WIDTH = 320;
const ROW_HEIGHT = 180;

function computeGraphLayout(
  stages: StageNode[],
  transitionsByTempId: Map<number, Set<number>>,
): Map<number, { x: number; y: number }> {
  const positions = new Map<number, { x: number; y: number }>();
  if (stages.length === 0) return positions;

  // Build incoming adjacency and in-degree
  const incoming = new Map<number, number[]>();
  const inDegree = new Map<number, number>();
  stages.forEach(s => {
    incoming.set(s.tempId, []);
    inDegree.set(s.tempId, 0);
  });
  transitionsByTempId.forEach((targets, from) => {
    targets.forEach(to => {
      if (incoming.has(to) && incoming.has(from)) {
        incoming.get(to)!.push(from);
        inDegree.set(to, (inDegree.get(to) ?? 0) + 1);
      }
    });
  });

  // BFS topological layering
  const layerOf = new Map<number, number>();
  const queue: number[] = [];
  stages.forEach(s => {
    if ((inDegree.get(s.tempId) ?? 0) === 0) {
      layerOf.set(s.tempId, 0);
      queue.push(s.tempId);
    }
  });

  while (queue.length > 0) {
    const node = queue.shift()!;
    const layer = layerOf.get(node) ?? 0;
    const targets = transitionsByTempId.get(node);
    if (targets) {
      targets.forEach(t => {
        if (!layerOf.has(t)) {
          layerOf.set(t, layer + 1);
          queue.push(t);
        }
      });
    }
  }

  // Any remaining (cyclic or disconnected) go to max layer + 1
  const maxLayer = stages.length > 0 ? Math.max(0, ...Array.from(layerOf.values())) : 0;
  stages.forEach(s => {
    if (!layerOf.has(s.tempId)) {
      layerOf.set(s.tempId, maxLayer + 1);
    }
  });

  // Group stages by layer
  const layers = new Map<number, number[]>();
  layerOf.forEach((layer, tempId) => {
    if (!layers.has(layer)) layers.set(layer, []);
    layers.get(layer)!.push(tempId);
  });

  // Assign positions
  const sortedLayers = Array.from(layers.keys()).sort((a, b) => a - b);
  sortedLayers.forEach(layer => {
    const ids = layers.get(layer)!;
    ids.forEach((tempId, idx) => {
      positions.set(tempId, {
        x: layer * COL_WIDTH + 60,
        y: idx * ROW_HEIGHT + 60,
      });
    });
  });

  return positions;
}

// ─── Merged "All" Incoming Edge Detection ────────────────────────────────────

export interface MergedIncomingTarget {
  targetTempId: number;
  sourceTempIds: number[];
  formId: string | null;
}

/** Whether every other stage on the board already has an edge into `targetTempId`. */
function hasAllIncomingSources(
  targetTempId: number,
  stages: StageNode[],
  transitionsByTempId: Map<number, Set<number>>,
): boolean {
  return stages.every(
    s => s.tempId === targetTempId || transitionsByTempId.get(s.tempId)?.has(targetTempId),
  );
}

/** Serializes a transition's gating fields for equality comparison (approvers sorted). */
function normalizeMetaForComparison(meta: TransitionMeta | undefined): string {
  const approvers = [...(meta?.approvers ?? [])]
    .map(a => `${a.approverType}:${a.approverId}`)
    .sort();
  return JSON.stringify({
    formId: meta?.formId ?? null,
    requiresApproval: meta?.requiresApproval ?? false,
    requestApprovalOnEntry: meta?.requestApprovalOnEntry ?? false,
    approvers,
    visitSlaMode: meta?.visitSlaMode ?? 'STAGE_DEFAULT',
    fixedEtaHours: meta?.fixedEtaHours ?? null,
    onReenter: meta?.onReenter ?? 'RESET',
  });
}

/** Qualifies for the merged "All" bubble when every incoming edge's metadata matches. */
function computeMergedTargets(
  stages: StageNode[],
  transitionsByTempId: Map<number, Set<number>>,
  transitionsMeta: Map<string, TransitionMeta>,
): Map<number, MergedIncomingTarget> {
  const merged = new Map<number, MergedIncomingTarget>();
  // Merging only makes sense with 3+ stages: with just 2 stages, "every
  // other stage connects in" is trivially true for a single edge, which
  // would hide a lone connection behind an "All" bubble for no reason.
  if (stages.length < 3) return merged;

  const incomingSources = new Map<number, number[]>();
  transitionsByTempId.forEach((targets, from) => {
    targets.forEach(to => {
      if (!incomingSources.has(to)) incomingSources.set(to, []);
      incomingSources.get(to)!.push(from);
    });
  });

  const requiredSourceCount = stages.length - 1;

  stages.forEach(target => {
    const sources = (incomingSources.get(target.tempId) ?? []).filter(s => s !== target.tempId);
    // Require at least 2 sources — a single incoming edge is never "clutter"
    // and should always render as a normal, directly-editable edge.
    if (sources.length < 2 || sources.length !== requiredSourceCount) return;

    const otherTempIds = stages.filter(s => s.tempId !== target.tempId).map(s => s.tempId);
    const sourceSet = new Set(sources);
    const hasAllSources = otherTempIds.every(id => sourceSet.has(id));
    if (!hasAllSources) return;

    let sharedFormId: string | null | undefined;
    let sharedMetaKey: string | undefined;
    let allSame = true;
    for (const from of sources) {
      const meta = transitionsMeta.get(`${from}->${target.tempId}`);
      const metaKey = normalizeMetaForComparison(meta);
      if (sharedMetaKey === undefined) {
        sharedFormId = meta?.formId ?? null;
        sharedMetaKey = metaKey;
      } else if (sharedMetaKey !== metaKey) {
        allSame = false;
        break;
      }
    }
    if (!allSame || sharedMetaKey === undefined) return;

    merged.set(target.tempId, {
      targetTempId: target.tempId,
      sourceTempIds: sources,
      formId: sharedFormId ?? null,
    });
  });

  return merged;
}

const TransitionEdge: React.FC<EdgeProps<TransitionEdgeData>> = ({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  markerEnd,
}) => {
  const curveOffset = data?.curveOffset ?? 0;
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY: targetY + curveOffset,
    targetPosition,
  });

  // For reciprocal edges, shift control points to create a distinct arc
  let finalEdgePath = edgePath;
  if (curveOffset !== 0) {
    const dx = Math.abs(targetX - sourceX) * 0.5;
    const cp1x = sourceX + dx;
    const cp1y = sourceY + curveOffset;
    const cp2x = targetX - dx;
    const cp2y = targetY + curveOffset;
    finalEdgePath = `M ${sourceX} ${sourceY} C ${cp1x} ${cp1y} ${cp2x} ${cp2y} ${targetX} ${targetY + curveOffset}`;
  }

  const isSelected = data?.selectedEdgeId === id;
  const meta = data?.meta;
  const hasBadge = !!meta?.formId || meta?.requiresApproval;
  const highlightState = data?.highlightState ?? 'normal';
  const isDulled = highlightState === 'dull';
  const isHighlighted = isSelected || highlightState === 'connected';
  const strokeColor = isDulled ? '#cbd5e1' : isHighlighted ? '#6276be' : '#94a3b8';
  const strokeWidth = isHighlighted ? 2.5 : 1.5;

  return (
    <>
      <path
        id={id}
        className='react-flow__edge-path'
        d={finalEdgePath}
        markerEnd={markerEnd}
        style={{
          stroke: strokeColor,
          strokeWidth,
          fill: 'none',
          opacity: isDulled ? 0.35 : 1,
        }}
      />
      <path
        d={finalEdgePath}
        fill='none'
        stroke='transparent'
        strokeWidth={16}
        style={{ cursor: 'pointer' }}
        onClick={() => data?.onSelectEdge(id)}
        data-track-category='board_stage_config'
        data-track-name='select_transition_edge'
      />
      <EdgeLabelRenderer>
        <div
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            pointerEvents: 'all',
            opacity: isDulled ? 0.35 : 1,
          }}
          className='nodrag nopan'
        >
          <button
            type='button'
            onClick={() => data?.onSelectEdge(id)}
            data-track-category='board_stage_config'
            data-track-name='open_transition_config'
            className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium shadow-sm transition-all ${
              isHighlighted
                ? 'bg-[#6276be] border-[#6276be] text-white'
                : 'bg-background border-border text-muted-foreground hover:border-[#6276be] hover:text-[#6276be]'
            }`}
          >
            {hasBadge ? (
              <>
                {!!meta?.formId && <span>Form</span>}
                {meta?.requiresApproval && <span>Approval</span>}
                <Settings2 size={9} />
              </>
            ) : (
              <>
                <Settings2 size={9} />
                <span>Config</span>
              </>
            )}
          </button>
        </div>
      </EdgeLabelRenderer>
    </>
  );
};

// ─── Stage Actions Panel ─────────────────────────────────────────────────────
interface StageActionsPanelProps {
  stage: StageNode;
  hasAllIncoming: boolean;
  onAllowAllIncoming: () => void;
  onDisallowAllIncoming: () => void;
  onUpdate: (patch: Partial<StageNode>) => void;
  onDelete: () => void;
  isEditingEta: boolean;
  etaValue: string;
  etaInputRef: React.RefObject<HTMLInputElement | null>;
  onStartEditEta: () => void;
  onSaveEta: () => void;
  onCancelEta: () => void;
  setEtaValue: (v: string) => void;
  onClose: () => void;
}

const StageActionsPanel: React.FC<StageActionsPanelProps> = ({
  stage,
  hasAllIncoming,
  onAllowAllIncoming,
  onDisallowAllIncoming,
  onUpdate,
  onDelete,
  isEditingEta,
  etaValue,
  etaInputRef,
  onStartEditEta,
  onSaveEta,
  onCancelEta,
  setEtaValue,
  onClose,
}) => {
  const statusOption = getStatusOption(stage.defaultTicketStatusV2);

  return (
    <div className='w-[300px] bg-background border border-border rounded-xl shadow-2xl overflow-hidden flex flex-col'>
      <div className='flex items-center justify-between px-4 py-3 border-b border-border bg-muted/30'>
        <div className='flex items-center gap-2 min-w-0'>
          <StatusIndicator status={stage.defaultTicketStatusV2} size={14} />
          <span className='text-[12px] font-semibold text-foreground truncate max-w-[190px]'>
            {stage.name || 'Stage'}
          </span>
        </div>
        <button
          type='button'
          onClick={onClose}
          data-track-category='board_stage_config'
          data-track-name='close_stage_actions'
          className='p-1.5 rounded-md hover:bg-muted text-muted-foreground transition-colors shrink-0'
        >
          <X size={13} />
        </button>
      </div>

      <div className='flex flex-col gap-4 px-4 py-4'>
        {/* Name */}
        <div>
          <p className='text-[10px] font-semibold text-muted-foreground uppercase tracking-[0.5px] mb-2'>
            Name
          </p>
          <input
            type='text'
            value={stage.name}
            onChange={e => onUpdate({ name: e.target.value })}
            placeholder='Stage name...'
            data-track-category='board_stage_config'
            data-track-name='input_stage_name'
            className='w-full text-[12px] font-medium text-foreground bg-background border border-border rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-[#6276be]'
          />
        </div>

        {/* Status */}
        <div>
          <p className='text-[10px] font-semibold text-muted-foreground uppercase tracking-[0.5px] mb-2'>
            Status
          </p>
          <DropdownMenu>
            <DropdownMenuTrigger className='w-full flex items-center justify-between gap-2 text-[12px] bg-background border border-border rounded-lg px-2.5 py-1.5 text-foreground hover:border-[#6276be] transition-colors outline-none'>
              <span className='flex items-center gap-2'>
                {statusOption.icon}
                {statusOption.label}
              </span>
              <ChevronDown size={14} className='text-muted-foreground' />
            </DropdownMenuTrigger>
            <DropdownMenuContent align='start' className='w-[240px] z-[9999]'>
              {STATUS_OPTIONS.map(opt => (
                <DropdownMenuItem
                  key={opt.status}
                  onSelect={() => onUpdate({ defaultTicketStatusV2: opt.status })}
                  className='flex items-center gap-2'
                >
                  {opt.icon}
                  <span>{opt.label}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* ETA */}
        <div>
          <p className='text-[10px] font-semibold text-muted-foreground uppercase tracking-[0.5px] mb-2'>
            ETA
          </p>
          {isEditingEta ? (
            <div className='flex items-center gap-2 bg-background border border-[#6276be] rounded-lg px-2.5 py-1.5'>
              <Timer size={13} className='text-muted-foreground shrink-0' />
              <input
                ref={etaInputRef}
                type='text'
                inputMode='numeric'
                pattern='[0-9]*'
                value={etaValue}
                onChange={e => setEtaValue(e.target.value)}
                onBlur={onSaveEta}
                onKeyDown={e => {
                  if (e.key === 'Enter') onSaveEta();
                  if (e.key === 'Escape') onCancelEta();
                }}
                placeholder='Hours'
                data-track-category='board_stage_config'
                data-track-name='input_stage_eta'
                className='flex-1 text-[12px] text-foreground bg-transparent border-none focus:outline-none p-0'
              />
              <span className='text-[12px] text-muted-foreground'>hrs</span>
            </div>
          ) : (
            <button
              type='button'
              onClick={onStartEditEta}
              data-track-category='board_stage_config'
              data-track-name='edit_stage_eta'
              className='w-full flex items-center gap-2 text-[12px] bg-background border border-border rounded-lg px-2.5 py-1.5 text-foreground hover:border-[#6276be] transition-colors text-left'
            >
              <Timer size={13} className='text-muted-foreground shrink-0' />
              <span>{stage.eta > 0 ? `${stage.eta} hours` : 'Set ETA'}</span>
            </button>
          )}
        </div>

        {/* Incoming transitions */}
        <div>
          <p className='text-[10px] font-semibold text-muted-foreground uppercase tracking-[0.5px] mb-2'>
            Incoming transitions
          </p>
          <button
            type='button'
            role='checkbox'
            aria-checked={hasAllIncoming}
            onClick={() => (hasAllIncoming ? onDisallowAllIncoming() : onAllowAllIncoming())}
            data-track-category='board_stage_config'
            data-track-name='toggle_allow_all_incoming'
            className='flex items-start gap-2.5 cursor-pointer select-none group text-left w-full'
          >
            <span
              className={`mt-0.5 flex items-center justify-center w-[16px] h-[16px] rounded-[4px] border transition-colors shrink-0 ${
                hasAllIncoming
                  ? 'bg-[#6276be] border-[#6276be]'
                  : 'bg-background border-border group-hover:border-[#6276be]'
              }`}
            >
              {hasAllIncoming && <Check size={11} strokeWidth={3} className='text-white' />}
            </span>
            <span className='text-[12px] text-foreground leading-[16px]'>
              Allow all stages to transition to this one
            </span>
          </button>
        </div>
      </div>

      <div className='px-4 py-3 border-t border-border'>
        <button
          type='button'
          onClick={onDelete}
          data-track-category='board_stage_config'
          data-track-name='delete_stage'
          className='w-full flex items-center justify-center gap-[6px] text-[12px] font-medium text-red-500 hover:bg-red-50 rounded-lg py-1.5 transition-colors'
        >
          <Trash2 size={13} />
          <span>Delete stage</span>
        </button>
      </div>
    </div>
  );
};

// ─── Edge Settings Panel ──────────────────────────────────────────────────────

const SLA_OPTIONS = [
  { value: 'STAGE_DEFAULT', label: 'Stage default' },
  { value: 'FIXED_HOURS', label: 'Fixed hours' },
  { value: 'NONE', label: 'None' },
];

type EdgeSettingsPanelProps = {
  toStage: StageNode;
  meta: TransitionMeta;
  formMap: Map<string, string>;
  onUpdateMeta: (patch: Partial<TransitionMeta>) => void;
  onClose: () => void;
  onOpenEdgeForm: () => void;
  onAttachExistingForm: (formId: string) => void;
  stageForms: Array<{ id: string; formName: string }>;
} & (
  | {
      isAllEdge: false;
      fromStage: StageNode;
      onRemoveEdge: () => void;
      onAddCondition: () => void;
    }
  | {
      isAllEdge: true;
      sourceStages: StageNode[];
      onRemoveSources: (tempIds: number[]) => void;
    }
);

const EdgeSettingsPanel: React.FC<EdgeSettingsPanelProps> = props => {
  const {
    toStage,
    meta,
    formMap,
    onUpdateMeta,
    onClose,
    onOpenEdgeForm,
    onAttachExistingForm,
    stageForms,
  } = props;
  const [showDeleteChecklist, setShowDeleteChecklist] = useState(false);
  const [checkedSources, setCheckedSources] = useState<Set<number>>(
    () => new Set(props.isAllEdge ? props.sourceStages.map(s => s.tempId) : []),
  );

  const headerLabel = props.isAllEdge ? (
    <>
      <span className='text-[11px] font-semibold text-[#6276be] uppercase tracking-wide shrink-0'>
        All
      </span>
      <span className='text-muted-foreground text-[10px] shrink-0'>→</span>
      <span className='text-[11px] font-semibold text-foreground uppercase tracking-wide truncate max-w-[120px]'>
        {toStage.name}
      </span>
    </>
  ) : (
    <>
      <span className='text-[11px] font-semibold text-foreground uppercase tracking-wide truncate max-w-[85px]'>
        {props.fromStage.name}
      </span>
      <span className='text-muted-foreground text-[10px] shrink-0'>→</span>
      <span className='text-[11px] font-semibold text-[#6276be] uppercase tracking-wide truncate max-w-[85px]'>
        {toStage.name}
      </span>
    </>
  );

  return (
    <div className='w-[280px] bg-background border border-border rounded-xl shadow-2xl overflow-hidden flex flex-col'>
      <div className='flex items-center justify-between px-4 py-3 border-b border-border bg-muted/30'>
        <div className='flex items-center gap-1.5 min-w-0'>{headerLabel}</div>
        <div className='flex items-center gap-1 shrink-0'>
          <button
            type='button'
            onClick={() => (props.isAllEdge ? setShowDeleteChecklist(true) : props.onRemoveEdge())}
            data-track-category='board_stage_config'
            data-track-name='remove_transition'
            className='p-1.5 rounded-md hover:bg-red-50 text-muted-foreground hover:text-red-500 transition-colors'
            title='Remove'
          >
            <Trash2 size={13} />
          </button>
          <button
            type='button'
            onClick={onClose}
            data-track-category='board_stage_config'
            data-track-name='close_transition_config'
            className='p-1.5 rounded-md hover:bg-muted text-muted-foreground transition-colors'
          >
            <Save size={13} />
          </button>
        </div>
      </div>

      {props.isAllEdge && showDeleteChecklist ? (
        <div className='flex flex-col gap-3 px-4 py-4'>
          <p className='text-[11px] text-muted-foreground'>Remove the incoming transition from:</p>
          <div className='flex flex-col gap-1.5 max-h-[220px] overflow-y-auto'>
            {props.sourceStages.map(source => (
              <label
                key={source.tempId}
                className='flex items-center gap-2 text-[12px] text-foreground'
              >
                <input
                  type='checkbox'
                  checked={checkedSources.has(source.tempId)}
                  onChange={e => {
                    setCheckedSources(prev => {
                      const next = new Set(prev);
                      if (e.target.checked) next.add(source.tempId);
                      else next.delete(source.tempId);
                      return next;
                    });
                  }}
                  data-track-category='board_stage_config'
                  data-track-name='toggle_all_edge_delete_source'
                />
                {source.name}
              </label>
            ))}
          </div>
          <div className='flex items-center gap-2'>
            <button
              type='button'
              onClick={() => setShowDeleteChecklist(false)}
              data-track-category='board_stage_config'
              data-track-name='cancel_all_edge_delete'
              className='flex-1 py-1.5 rounded-lg border border-border text-[12px] text-muted-foreground hover:bg-muted transition-colors'
            >
              Cancel
            </button>
            <button
              type='button'
              onClick={() => {
                if (props.isAllEdge) props.onRemoveSources(Array.from(checkedSources));
              }}
              disabled={checkedSources.size === 0}
              data-track-category='board_stage_config'
              data-track-name='confirm_all_edge_delete'
              className='flex-1 py-1.5 rounded-lg bg-red-500 text-white text-[12px] font-medium hover:bg-red-600 disabled:opacity-50 transition-colors'
            >
              Remove selected
            </button>
          </div>
        </div>
      ) : (
        <div className='flex flex-col gap-4 px-4 py-4 overflow-y-auto max-h-[420px]'>
          {/* Form */}
          <div>
            <p className='text-[10px] font-semibold text-muted-foreground uppercase tracking-[0.5px] mb-2'>
              Transition Form
            </p>
            {meta.formId ? (
              <div className='flex items-center justify-between bg-muted/50 rounded-lg border border-border px-3 py-2'>
                <span className='text-[12px] text-foreground truncate'>
                  {formMap.get(meta.formId) || 'Form'}
                </span>
                <div className='flex items-center gap-1'>
                  <button
                    type='button'
                    onClick={onOpenEdgeForm}
                    data-track-category='board_stage_config'
                    data-track-name='edit_transition_form'
                    className='p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors'
                  >
                    <Pencil size={11} />
                  </button>
                  <button
                    type='button'
                    onClick={() => onUpdateMeta({ formId: null })}
                    data-track-category='board_stage_config'
                    data-track-name='remove_transition_form'
                    className='p-1 rounded hover:bg-red-50 text-muted-foreground hover:text-red-500 transition-colors'
                  >
                    <X size={11} />
                  </button>
                </div>
              </div>
            ) : (
              <TransitionFormPicker
                allForms={stageForms}
                onCreateForm={onOpenEdgeForm}
                onSelectForm={onAttachExistingForm}
                variant='dashed-button'
                triggerLabel='Attach form'
              />
            )}
          </div>

          {!props.isAllEdge && (
            <>
              {/* Approval */}
              <div>
                <p className='text-[10px] font-semibold text-muted-foreground uppercase tracking-[0.5px] mb-2'>
                  Approval
                </p>
                <div className='flex items-center gap-2.5 select-none'>
                  <button
                    type='button'
                    role='switch'
                    aria-checked={meta.requiresApproval}
                    onClick={() =>
                      onUpdateMeta({
                        requiresApproval: !meta.requiresApproval,
                        approvers: !meta.requiresApproval ? (meta.approvers ?? []) : [],
                        // Turning approval off hides (and must clear) the on-entry flag —
                        // it's only meaningful for an approval-gated transition.
                        ...(meta.requiresApproval && { requestApprovalOnEntry: false }),
                      })
                    }
                    data-track-category='transition_config'
                    data-track-name='toggle_requires_approval'
                    className={`relative w-8 h-4 rounded-full transition-colors cursor-pointer border-none p-0 ${meta.requiresApproval ? 'bg-[#6276be]' : 'bg-muted-foreground/30'}`}
                  >
                    <div
                      className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform ${meta.requiresApproval ? 'translate-x-4' : 'translate-x-0.5'}`}
                    />
                  </button>
                  <span className='text-[12px] text-foreground'>Requires approval</span>
                </div>
                {meta.requiresApproval && (
                  <div className='mt-2'>
                    <ApproverSelector
                      selectedApprovers={meta.approvers ?? []}
                      onApproversChange={approvers => onUpdateMeta({ approvers })}
                    />
                    {(() => {
                      // A form must be filled manually, so on-entry auto-approval never
                      // fires for an edge with a form attached (see stageEntryApproval.ts).
                      // Disable the toggle and show it as off rather than let users enable
                      // a setting that will silently never run.
                      const formAttached = !!meta.formId;
                      const entryOn = !formAttached && !!meta.requestApprovalOnEntry;
                      return (
                        <div className='flex items-start gap-2.5 select-none mt-3'>
                          <button
                            type='button'
                            role='switch'
                            aria-checked={entryOn}
                            disabled={formAttached}
                            onClick={() =>
                              onUpdateMeta({
                                requestApprovalOnEntry: !meta.requestApprovalOnEntry,
                              })
                            }
                            data-track-category='transition_config'
                            data-track-name='toggle_request_approval_on_entry'
                            title={
                              formAttached
                                ? 'Not available when a form is attached — the form must be filled manually.'
                                : undefined
                            }
                            className={`relative w-8 h-4 rounded-full transition-colors border-none p-0 shrink-0 mt-0.5 ${formAttached ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'} ${entryOn ? 'bg-[#6276be]' : 'bg-muted-foreground/30'}`}
                          >
                            <div
                              className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform ${entryOn ? 'translate-x-4' : 'translate-x-0.5'}`}
                            />
                          </button>
                          <div>
                            <span
                              className={`text-[12px] ${formAttached ? 'text-muted-foreground' : 'text-foreground'}`}
                            >
                              Request approval on stage entry
                            </span>
                            <p className='text-[10px] text-muted-foreground mt-0.5 leading-snug'>
                              {formAttached
                                ? 'Unavailable while a form is attached — the form must be filled manually.'
                                : 'Notify the approver as soon as a ticket enters this stage. Only applies when this stage has a single outgoing transition.'}
                            </p>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>

              {/* Add Condition */}
              <button
                type='button'
                onClick={props.onAddCondition}
                data-track-category='board_stage_config'
                data-track-name='add_condition_for_edge'
                className='flex items-center gap-[6px] text-[13px] font-medium text-[#6276be] hover:text-[#5060a0] p-[4px] rounded-[6px] w-full'
              >
                <GitBranch size={13} className='text-[#6276be]' />
                <span>Add Condition</span>
              </button>

              {/* SLA */}
              <div>
                <p className='text-[10px] font-semibold text-muted-foreground uppercase tracking-[0.5px] mb-2'>
                  Visit SLA
                </p>
                <select
                  className='w-full text-[12px] bg-background border border-border rounded-lg px-2.5 py-1.5 text-foreground focus:outline-none focus:ring-1 focus:ring-[#6276be]'
                  data-track-category='transition_config'
                  data-track-name='select_visit_sla'
                  value={meta.visitSlaMode}
                  onChange={e => onUpdateMeta({ visitSlaMode: e.target.value })}
                >
                  {SLA_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                {meta.visitSlaMode === 'FIXED_HOURS' && (
                  <input
                    type='number'
                    min='1'
                    placeholder='Hours'
                    data-track-category='transition_config'
                    data-track-name='input_fixed_eta_hours'
                    className='mt-2 w-full text-[12px] bg-background border border-border rounded-lg px-2.5 py-1.5 text-foreground focus:outline-none focus:ring-1 focus:ring-[#6276be]'
                    value={meta.fixedEtaHours ?? ''}
                    onChange={e =>
                      onUpdateMeta({
                        fixedEtaHours: e.target.value ? Number(e.target.value) : null,
                      })
                    }
                  />
                )}
              </div>

              {/* On Revisit */}
              <div>
                <p className='text-[10px] font-semibold text-muted-foreground uppercase tracking-[0.5px] mb-2'>
                  On Revisit
                </p>
                <div className='grid grid-cols-2 gap-1.5'>
                  {[
                    { value: 'RESET', label: 'New visit' },
                    { value: 'CONTINUE', label: 'Continue' },
                  ].map(opt => (
                    <button
                      key={opt.value}
                      type='button'
                      onClick={() => onUpdateMeta({ onReenter: opt.value })}
                      data-track-category='transition_config'
                      data-track-name={`select_on_reenter_${opt.value.toLowerCase()}`}
                      className={`py-1.5 rounded-lg border text-[11px] font-medium transition-colors ${meta.onReenter === opt.value ? 'bg-[#6276be] border-[#6276be] text-white' : 'bg-background border-border text-muted-foreground hover:bg-muted'}`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};

// ─── Stable node/edge type maps (outside component to avoid re-registration) ─

const NODE_TYPES = { stage: StageNodeComponent, allBubble: AllBubbleNodeComponent };
const EDGE_TYPES = { transition: TransitionEdge };

// ─── Main Editor ──────────────────────────────────────────────────────────────

export const NonLinearTransitionEditor: React.FC<NonLinearTransitionEditorProps> = ({
  stages,
  transitionsByTempId,
  transitionsMeta,
  toggleTransition,
  updateTransitionMeta,
  onUpdateStage,
  onDeleteStage,
  onAddStage,
  formMap,
  onOpenEdgeForm,
  onAttachExistingEdgeForm,
  stageForms,
  onAddConditionForEdge,
  isTransitionsLoading,
  editingEtaId,
  etaValue,
  etaInputRef,
  onStartEditEta,
  onSaveEta,
  onCancelEta,
  setEtaValue,
}) => {
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [expandedTargets, setExpandedTargets] = useState<Set<number>>(new Set());

  const handleSelectEdge = useCallback((edgeId: string) => {
    setSelectedEdgeId(edgeId);
    setSelectedNodeId(null);
  }, []);

  const handleNodeClick = (_event: React.MouseEvent, node: Node) => {
    if (node.id.startsWith('all-')) {
      handleSelectEdge(`eAll-${node.id.slice(4)}`);
      return;
    }
    setSelectedNodeId(node.id);
    setSelectedEdgeId(null);
  };

  const handlePaneClick = () => {
    setSelectedEdgeId(null);
    setSelectedNodeId(null);
  };

  // Wires up an incoming edge from every other stage not already connected to targetTempId.
  const handleAllowAllIncoming = useCallback(
    (targetTempId: number) => {
      stages.forEach(s => {
        if (s.tempId === targetTempId) return;
        if (!transitionsByTempId.get(s.tempId)?.has(targetTempId)) {
          toggleTransition(s.tempId, targetTempId, true);
        }
      });
    },
    [stages, transitionsByTempId, toggleTransition],
  );

  // Inverse of handleAllowAllIncoming — removes every incoming edge from this stage.
  const handleDisallowAllIncoming = useCallback(
    (targetTempId: number) => {
      stages.forEach(s => {
        if (s.tempId === targetTempId) return;
        if (transitionsByTempId.get(s.tempId)?.has(targetTempId)) {
          toggleTransition(s.tempId, targetTempId, false);
        }
      });
    },
    [stages, transitionsByTempId, toggleTransition],
  );

  // Track whether the user has manually dragged any node — if so, we
  // preserve their custom positions and don't auto-relayout on transition changes.
  const hasUserDraggedRef = useRef(false);

  // Build initial nodes using graph-aware layout
  const makeNodes = useCallback(
    (stageList: StageNode[]): Node<StageNodeData>[] => {
      const layout = computeGraphLayout(stageList, transitionsByTempId);
      return stageList.map(s => ({
        id: String(s.tempId),
        type: 'stage',
        position: layout.get(s.tempId) ?? { x: 60, y: 60 },
        data: { stage: s },
      }));
    },
    [transitionsByTempId],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState<StageNodeData | AllBubbleNodeData>(
    makeNodes(stages),
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState<TransitionEdgeData>([]);

  // Mirror `nodes` into a ref so the bubble-sync effect below can read the
  // latest node positions (for anchoring bubbles) without adding `nodes` to
  // its dependency array (which would re-run on every dimension change and
  // fight ReactFlow's own node-state updates).
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;

  // Detect user-initiated node drags so we can preserve custom positions.
  // A position change with `dragging === false` indicates the drag just ended.
  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      if (changes.some(c => c.type === 'position' && c.dragging === false)) {
        hasUserDraggedRef.current = true;
      }
      onNodesChange(changes);
    },
    [onNodesChange],
  );

  // Reposition all nodes when transitions change (handles async load).
  // Only applies auto-layout if the user hasn't manually dragged any node —
  // once the user customises positions, only the explicit "Rearrange" button
  // triggers a full re-layout, preventing unexpected position resets.
  // Uses ref for stages so it only fires on transition changes, not stage-name edits
  const stagesRef = useRef(stages);
  stagesRef.current = stages;
  useEffect(() => {
    if (isTransitionsLoading) return;
    if (hasUserDraggedRef.current) return; // preserve user-dragged positions
    const layout = computeGraphLayout(stagesRef.current, transitionsByTempId);
    setNodes(prev =>
      prev.map(n => {
        const pos = layout.get(Number(n.id));
        return pos ? { ...n, position: pos } : n;
      }),
    );
  }, [transitionsByTempId, isTransitionsLoading, setNodes]);

  // Sync node count when stages added/removed; update data when stages change.
  // Seeded with the SAME stages used by useNodesState(makeNodes(stages)) above
  // — otherwise this ref starts empty while `nodes` already has every stage,
  // so the first run of this effect treats all of them as "added" and
  // appends a duplicate copy of every stage node on top of the real ones.
  const prevStageTempIds = useRef<number[]>(stages.map(s => s.tempId));
  useEffect(() => {
    const prevIds = prevStageTempIds.current;
    const currIds = stages.map(s => s.tempId);
    const added = currIds.filter(id => !prevIds.includes(id));
    const removed = prevIds.filter(id => !currIds.includes(id));
    prevStageTempIds.current = currIds;

    setNodes(prev => {
      // Remove deleted stages
      let updated = prev.filter(n => !removed.includes(Number(n.id)));
      // Add new stages with positions from graph layout
      const layout = computeGraphLayout(stages, transitionsByTempId);
      added.forEach((tempId, _i) => {
        const s = stages.find(s => s.tempId === tempId)!;
        updated = [
          ...updated,
          {
            id: String(tempId),
            type: 'stage',
            position: layout.get(tempId) ?? { x: 60, y: 60 },
            data: { stage: s },
          },
        ];
      });
      // Update data for existing nodes (name, status, eta changes)
      return updated.map(n => {
        const s = stages.find(s => s.tempId === Number(n.id));
        if (!s) return n;
        return {
          ...n,
          data: { ...n.data, stage: s },
        };
      });
    });
  }, [stages, transitionsByTempId, setNodes]);

  // Sync edges from transition state
  useEffect(() => {
    // Build set of all transition keys for reciprocal detection
    const allKeys = new Set<string>();
    transitionsByTempId.forEach((targets, from) => {
      targets.forEach(to => allKeys.add(`${from}->${to}`));
    });

    const newEdges: Edge<TransitionEdgeData>[] = [];
    transitionsByTempId.forEach((targets, fromTempId) => {
      targets.forEach(toTempId => {
        const edgeId = `e${fromTempId}-${toTempId}`;
        const metaKey = `${fromTempId}->${toTempId}`;
        const reverseKey = `${toTempId}->${fromTempId}`;
        const meta: TransitionMeta = transitionsMeta.get(metaKey) ?? {
          requiresApproval: false,
          approvers: [],
          visitSlaMode: 'STAGE_DEFAULT',
          onReenter: 'RESET',
        };

        // Detect reciprocal edge and assign alternating curve offset
        const isReciprocal = allKeys.has(reverseKey);
        // First edge in pair gets -28, second gets +28 (based on tempId comparison)
        const curveOffset = isReciprocal ? (fromTempId < toTempId ? -28 : 28) : 0;

        newEdges.push({
          id: edgeId,
          source: String(fromTempId),
          target: String(toTempId),
          type: 'transition',
          markerEnd: { type: MarkerType.ArrowClosed, color: '#6276be', width: 18, height: 18 },
          data: {
            fromTempId,
            toTempId,
            meta,
            onSelectEdge: handleSelectEdge,
            selectedEdgeId,
            isReciprocal,
            curveOffset,
          },
        });
      });
    });
    setEdges(newEdges);
  }, [transitionsByTempId, transitionsMeta, selectedEdgeId, setEdges, handleSelectEdge]);

  // Commit merged "All" bubble nodes/edges into the real ReactFlow
  // node/edge state (mirroring the edge-sync effect above), so ReactFlow's
  // internal store actually owns them. When they were only injected into the
  // derived `displayNodes`/`displayEdges` memo, ReactFlow received a node/edge
  // whose source node ('all-<id>') had no backing in its tracked store — so it
  // silently dropped the edge and never painted the bubble, even though the
  // id appeared in the logged `displayNodes` array.
  useEffect(() => {
    const merged = computeMergedTargets(stages, transitionsByTempId, transitionsMeta);
    const active = new Map(merged);
    expandedTargets.forEach(tempId => active.delete(tempId));

    const layout = computeGraphLayout(stages, transitionsByTempId);

    const bubbleNodes: Node<AllBubbleNodeData>[] = [];
    const bubbleEdges: Edge<TransitionEdgeData>[] = [];

    active.forEach(m => {
      // Use the deterministic graph-layout position for the target (matches
      // what the stage-position-sync effect places the stage at), so a
      // newly-created bubble aligns with where its target lands — not a
      // pre-layout position that may still be in `nodes` at effect-run time.
      const targetPosition = layout.get(m.targetTempId) ?? { x: 60, y: 60 };
      const bId = `all-${m.targetTempId}`;
      const eId = `eAll-${m.targetTempId}`;
      // Preserve a bubble's existing position across re-runs (e.g. when the
      // user selects an edge and this effect re-runs) — otherwise it snaps
      // back to the computed spot every time. Only newly-created bubbles use
      // the computed position next to their target.
      const existingBubble = nodesRef.current.find(n => n.id === bId);

      bubbleNodes.push({
        id: bId,
        type: 'allBubble',
        position: existingBubble?.position ?? {
          x: targetPosition.x - 70,
          y: targetPosition.y + 35,
        },
        draggable: true,
        selectable: false,
        data: {
          targetTempId: m.targetTempId,
          formId: m.formId,
        },
      });

      bubbleEdges.push({
        id: eId,
        source: bId,
        target: String(m.targetTempId),
        type: 'transition',
        deletable: false,
        markerEnd: { type: MarkerType.ArrowClosed, color: '#6276be', width: 18, height: 18 },
        data: {
          fromTempId: m.sourceTempIds[0] ?? m.targetTempId,
          toTempId: m.targetTempId,
          meta: {
            formId: m.formId,
            requiresApproval: false,
            approvers: [],
            visitSlaMode: 'STAGE_DEFAULT',
            onReenter: 'RESET',
          },
          onSelectEdge: handleSelectEdge,
          selectedEdgeId,
          isAllEdge: true,
          sourceTempIds: m.sourceTempIds,
        },
      });
    });

    // Merge bubble nodes/edges into state alongside the real stage nodes/edges.
    // Stage nodes are kept as-is (preserving user-dragged positions); bubble
    // nodes keep their existing position via the existingBubble lookup above.
    setNodes(prev => [...prev.filter(n => !n.id.startsWith('all-')), ...bubbleNodes]);
    setEdges(prev => [...prev.filter(e => !e.id.startsWith('eAll-')), ...bubbleEdges]);
  }, [
    stages,
    transitionsByTempId,
    transitionsMeta,
    expandedTargets,
    selectedEdgeId,
    handleSelectEdge,
    setNodes,
    setEdges,
  ]);

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      const from = Number(connection.source);
      const to = Number(connection.target);
      if (Number.isNaN(from) || Number.isNaN(to)) return;
      if (from !== to) toggleTransition(from, to, true);
    },
    [toggleTransition],
  );

  const onEdgesDelete = useCallback(
    (deleted: Edge[]) => {
      deleted.forEach(e => {
        const data = e.data as TransitionEdgeData | undefined;
        if (data?.fromTempId && data?.toTempId) {
          toggleTransition(data.fromTempId, data.toTempId, false);
          if (selectedEdgeId === e.id) setSelectedEdgeId(null);
        }
      });
    },
    [toggleTransition, selectedEdgeId],
  );

  const mergedTargets = useMemo(
    () => computeMergedTargets(stages, transitionsByTempId, transitionsMeta),
    [stages, transitionsByTempId, transitionsMeta],
  );

  const activeMergedTargets = useMemo(() => {
    const active = new Map(mergedTargets);
    expandedTargets.forEach(tempId => active.delete(tempId));
    return active;
  }, [mergedTargets, expandedTargets]);

  // Selected edge info for the settings panel
  const selectedEdge = useMemo(() => {
    if (!selectedEdgeId) return null;

    if (selectedEdgeId.startsWith('eAll-')) {
      const targetTempId = Number(selectedEdgeId.slice('eAll-'.length));
      const merged = activeMergedTargets.get(targetTempId);
      const toStage = stages.find(s => s.tempId === targetTempId);
      if (!merged || !toStage) return null;
      const meta: TransitionMeta = {
        formId: merged.formId,
        requiresApproval: false,
        approvers: [],
        visitSlaMode: 'STAGE_DEFAULT',
        onReenter: 'RESET',
      };
      return {
        edgeId: selectedEdgeId,
        isAllEdge: true as const,
        toStage,
        sourceTempIds: merged.sourceTempIds,
        meta,
      };
    }

    const edge = edges.find(e => e.id === selectedEdgeId);
    if (!edge?.data) return null;
    const { fromTempId, toTempId } = edge.data;
    const fromStage = stages.find(s => s.tempId === fromTempId);
    const toStage = stages.find(s => s.tempId === toTempId);
    if (!fromStage || !toStage) return null;
    const meta: TransitionMeta = transitionsMeta.get(`${fromTempId}->${toTempId}`) ?? {
      requiresApproval: false,
      approvers: [],
      visitSlaMode: 'STAGE_DEFAULT',
      onReenter: 'RESET',
    };
    return {
      edgeId: selectedEdgeId,
      isAllEdge: false as const,
      fromStage,
      toStage,
      fromTempId,
      toTempId,
      meta,
    };
  }, [selectedEdgeId, edges, stages, transitionsMeta, activeMergedTargets]);

  // Selected stage info for the stage actions panel (opened by clicking a stage node).
  const selectedStage = useMemo(() => {
    if (!selectedNodeId) return null;
    const targetTempId = Number(selectedNodeId);
    const stage = stages.find(s => s.tempId === targetTempId);
    if (!stage) return null;
    return {
      stage,
      hasAllIncoming: hasAllIncomingSources(targetTempId, stages, transitionsByTempId),
    };
  }, [selectedNodeId, stages, transitionsByTempId]);

  // Re-merges every manually expanded "All" group back into its bubble. Also
  // clears the selection — a selected individual edge may be one of the ones
  // folding back into a bubble, and its line would disappear while a stale
  // selectedEdgeId kept the (now hidden) edge and its endpoints highlighted.
  const handleCondenseEdges = useCallback(() => {
    setExpandedTargets(new Set());
    setSelectedEdgeId(null);
    setSelectedNodeId(null);
  }, []);

  // Expands the currently-selected "All" edge only. Also clears the
  // selection — the bubble/edge just expanded no longer exists, and leaving
  // a stale selectedEdgeId around dulls everything except the lone target
  // node. Clearing it reproduces a pane click instead.
  const handleExpandSelected = useCallback(() => {
    if (!selectedEdge?.isAllEdge) return;
    const targetTempId = selectedEdge.toStage.tempId;
    setExpandedTargets(prev => {
      const next = new Set(prev);
      next.add(targetTempId);
      return next;
    });
    setSelectedEdgeId(null);
    setSelectedNodeId(null);
  }, [selectedEdge]);

  // Highlight the selected node/edge and its direct connections; dull the rest.
  const { displayNodes, displayEdges } = useMemo(() => {
    const nodeState = new Map<string, HighlightState>();
    const edgeState = new Map<string, HighlightState>();

    const bubbleNodeId = (targetTempId: number) => `all-${targetTempId}`;
    const bubbleEdgeId = (targetTempId: number) => `eAll-${targetTempId}`;

    const hiddenEdgeIds = new Set<string>();
    activeMergedTargets.forEach(merged => {
      merged.sourceTempIds.forEach(from => {
        hiddenEdgeIds.add(`e${from}-${merged.targetTempId}`);
      });
    });

    if (selectedNodeId) {
      nodeState.set(selectedNodeId, 'selected');
      edges.forEach(e => {
        if (hiddenEdgeIds.has(e.id)) return;
        if (e.source === selectedNodeId || e.target === selectedNodeId) {
          edgeState.set(e.id, 'connected');
          const other = e.source === selectedNodeId ? e.target : e.source;
          if (!nodeState.has(other)) nodeState.set(other, 'connected');
        }
      });
      const mergedForSelected = activeMergedTargets.get(Number(selectedNodeId));
      if (mergedForSelected) {
        nodeState.set(bubbleNodeId(mergedForSelected.targetTempId), 'connected');
        edgeState.set(bubbleEdgeId(mergedForSelected.targetTempId), 'connected');
      }
    } else if (selectedEdgeId) {
      if (selectedEdgeId.startsWith('eAll-')) {
        const targetTempId = Number(selectedEdgeId.slice('eAll-'.length));
        nodeState.set(bubbleNodeId(targetTempId), 'connected');
        nodeState.set(String(targetTempId), 'connected');
        edgeState.set(selectedEdgeId, 'connected');
      } else {
        const edge = edges.find(e => e.id === selectedEdgeId);
        if (edge) {
          nodeState.set(edge.source, 'connected');
          nodeState.set(edge.target, 'connected');
          edgeState.set(edge.id, 'connected');
        }
      }
    }

    const hasSelection = nodeState.size > 0;
    if (hasSelection) {
      nodes.forEach(n => {
        if (!nodeState.has(n.id)) nodeState.set(n.id, 'dull');
      });
      edges.forEach(e => {
        if (hiddenEdgeIds.has(e.id)) return;
        if (!edgeState.has(e.id)) edgeState.set(e.id, 'dull');
      });
      activeMergedTargets.forEach(merged => {
        const bId = bubbleNodeId(merged.targetTempId);
        const eId = bubbleEdgeId(merged.targetTempId);
        if (!nodeState.has(bId)) nodeState.set(bId, 'dull');
        if (!edgeState.has(eId)) edgeState.set(eId, 'dull');
      });
    }

    // Bubble nodes/edges now live in the real `nodes`/`edges` state (synced by
    // the bubble-sync effect above), so the memo only needs to layer on
    // highlight state and drop the individually-merged edges.
    const displayNodesOut = nodes.map(n => ({
      ...n,
      data: { ...n.data, highlightState: nodeState.get(n.id) ?? 'normal' },
    }));

    const displayEdgesOut = edges
      .filter(e => !hiddenEdgeIds.has(e.id))
      .map(e => ({
        ...e,
        data: { ...e.data, highlightState: edgeState.get(e.id) ?? 'normal' },
      }));

    return { displayNodes: displayNodesOut, displayEdges: displayEdgesOut };
  }, [selectedNodeId, selectedEdgeId, nodes, edges, activeMergedTargets]);

  return (
    <div className='relative w-full h-full' style={{ minHeight: 480 }}>
      {isTransitionsLoading && (
        <div className='absolute inset-0 flex items-center justify-center bg-background/60 z-50 rounded-xl'>
          <div className='flex items-center gap-2'>
            <div className='w-4 h-4 rounded-full border-2 border-[#6276be] border-t-transparent animate-spin' />
            <span className='text-sm text-muted-foreground'>Loading transitions…</span>
          </div>
        </div>
      )}

      <ReactFlow
        nodes={displayNodes}
        edges={displayEdges}
        onNodesChange={handleNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onEdgesDelete={onEdgesDelete}
        onNodeClick={handleNodeClick}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        onPaneClick={handlePaneClick}
        fitView
        fitViewOptions={{ padding: 0.35 }}
        minZoom={0.3}
        maxZoom={2}
        deleteKeyCode='Delete'
        className='rounded-xl'
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color='hsl(var(--border))' />
        <Controls showInteractive={false} className='!bg-background !border-border !shadow-md' />

        {/* Toolbar: Rearrange + Condense/Expand */}
        <Panel position='top-left'>
          <div className='flex items-center gap-2'>
            <button
              type='button'
              onClick={() => {
                const layout = computeGraphLayout(stages, transitionsByTempId);
                setNodes(prev =>
                  prev.map(n => {
                    const pos = layout.get(Number(n.id));
                    return pos ? { ...n, position: pos } : n;
                  }),
                );
                // Reset the flag so future transition changes can auto-layout again
                // until the user drags once more.
                hasUserDraggedRef.current = false;
              }}
              data-track-category='board_stage_config'
              data-track-name='rearrange_stages'
              className='flex items-center gap-1.5 bg-background border border-border rounded-lg px-2.5 py-1.5 shadow text-[12px] text-muted-foreground hover:text-[#6276be] hover:border-[#6276be] transition-colors'
              title='Auto-arrange stages'
            >
              <LayoutGrid size={13} />
              <span className='font-medium'>Rearrange</span>
            </button>
            <button
              type='button'
              onClick={selectedEdge?.isAllEdge ? handleExpandSelected : handleCondenseEdges}
              data-track-category='board_stage_config'
              data-track-name={selectedEdge?.isAllEdge ? 'expand_all_edge' : 'condense_edges'}
              className='flex items-center gap-1.5 bg-background border border-border rounded-lg px-2.5 py-1.5 shadow text-[12px] text-muted-foreground hover:text-[#6276be] hover:border-[#6276be] transition-colors'
              title={
                selectedEdge?.isAllEdge
                  ? 'Show individual transitions for this "All" group'
                  : 'Re-merge any manually expanded "All" groups'
              }
            >
              {selectedEdge?.isAllEdge ? <Expand size={13} /> : <Merge size={13} />}
              <span className='font-medium'>{selectedEdge?.isAllEdge ? 'Expand' : 'Condense'}</span>
            </button>
          </div>
        </Panel>

        {/* Hint + Add Stage */}
        <Panel position='bottom-center'>
          <div className='flex items-center gap-3'>
            <div className='flex items-center gap-1.5 bg-background/90 border border-border rounded-lg px-2.5 py-1.5 shadow text-[11px] text-muted-foreground'>
              <span>Drag handle → to connect</span>
              <span className='opacity-40'>·</span>
              <span>Click edge to configure</span>
            </div>
            <button
              type='button'
              onClick={onAddStage}
              data-track-category='board_stage_config'
              data-track-name='add_stage'
              className='flex items-center gap-1.5 bg-background border border-dashed border-[#6276be]/50 hover:border-[#6276be] rounded-lg px-3 py-1.5 shadow text-[12px] text-[#6276be] hover:text-[#4f61a8] transition-colors font-medium'
            >
              <Plus size={13} />
              Add Stage
            </button>
          </div>
        </Panel>

        {/* Edge settings panel */}
        {selectedEdge &&
          (selectedEdge.isAllEdge ? (
            <Panel position='top-right'>
              <EdgeSettingsPanel
                key={selectedEdge.edgeId}
                isAllEdge
                toStage={selectedEdge.toStage}
                sourceStages={selectedEdge.sourceTempIds
                  .map(id => stages.find(s => s.tempId === id))
                  .filter((s): s is StageNode => !!s)}
                meta={selectedEdge.meta}
                formMap={formMap}
                onUpdateMeta={patch =>
                  selectedEdge.sourceTempIds.forEach(from =>
                    updateTransitionMeta(from, selectedEdge.toStage.tempId, patch),
                  )
                }
                onRemoveSources={tempIds => {
                  tempIds.forEach(from =>
                    toggleTransition(from, selectedEdge.toStage.tempId, false),
                  );
                  setSelectedEdgeId(null);
                }}
                onClose={() => setSelectedEdgeId(null)}
                onOpenEdgeForm={() =>
                  onOpenEdgeForm(
                    selectedEdge.sourceTempIds[0] ?? selectedEdge.toStage.tempId,
                    selectedEdge.toStage.tempId,
                    selectedEdge.meta.formId,
                    selectedEdge.sourceTempIds.map(from => ({
                      fromTempId: from,
                      toTempId: selectedEdge.toStage.tempId,
                    })),
                  )
                }
                onAttachExistingForm={formId =>
                  onAttachExistingEdgeForm(
                    selectedEdge.sourceTempIds[0] ?? selectedEdge.toStage.tempId,
                    selectedEdge.toStage.tempId,
                    formId,
                    selectedEdge.sourceTempIds.map(from => ({
                      fromTempId: from,
                      toTempId: selectedEdge.toStage.tempId,
                    })),
                  )
                }
                stageForms={stageForms}
              />
            </Panel>
          ) : (
            <Panel position='top-right'>
              <EdgeSettingsPanel
                key={selectedEdge.edgeId}
                isAllEdge={false}
                fromStage={selectedEdge.fromStage}
                toStage={selectedEdge.toStage}
                meta={selectedEdge.meta}
                formMap={formMap}
                onUpdateMeta={patch =>
                  updateTransitionMeta(selectedEdge.fromTempId, selectedEdge.toTempId, patch)
                }
                onRemoveEdge={() => {
                  toggleTransition(selectedEdge.fromTempId, selectedEdge.toTempId, false);
                  setSelectedEdgeId(null);
                }}
                onClose={() => setSelectedEdgeId(null)}
                onOpenEdgeForm={() =>
                  onOpenEdgeForm(
                    selectedEdge.fromTempId,
                    selectedEdge.toTempId,
                    selectedEdge.meta.formId,
                  )
                }
                onAttachExistingForm={formId =>
                  onAttachExistingEdgeForm(selectedEdge.fromTempId, selectedEdge.toTempId, formId)
                }
                stageForms={stageForms}
                onAddCondition={() =>
                  onAddConditionForEdge(selectedEdge.fromTempId, selectedEdge.toTempId)
                }
              />
            </Panel>
          ))}

        {/* Stage actions panel */}
        {!selectedEdge && selectedStage && (
          <Panel position='top-right'>
            <StageActionsPanel
              key={selectedStage.stage.tempId}
              stage={selectedStage.stage}
              hasAllIncoming={selectedStage.hasAllIncoming}
              onAllowAllIncoming={() => handleAllowAllIncoming(selectedStage.stage.tempId)}
              onDisallowAllIncoming={() => handleDisallowAllIncoming(selectedStage.stage.tempId)}
              onUpdate={patch => onUpdateStage(selectedStage.stage.tempId, patch)}
              onDelete={() => {
                onDeleteStage(selectedStage.stage.tempId);
                setSelectedNodeId(null);
              }}
              isEditingEta={editingEtaId === selectedStage.stage.tempId}
              etaValue={etaValue}
              etaInputRef={etaInputRef}
              onStartEditEta={() => onStartEditEta(selectedStage.stage)}
              onSaveEta={() => onSaveEta(selectedStage.stage.tempId)}
              onCancelEta={onCancelEta}
              setEtaValue={setEtaValue}
              onClose={() => setSelectedNodeId(null)}
            />
          </Panel>
        )}
      </ReactFlow>
    </div>
  );
};
