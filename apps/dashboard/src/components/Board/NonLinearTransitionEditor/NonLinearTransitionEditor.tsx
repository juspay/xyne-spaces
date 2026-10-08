import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Position,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeChange,
  type NodeProps,
  EdgeLabelRenderer,
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
  type StageCondition,
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
import { VisitSlaMode, ApproverType, ReenterMode } from '@xyne/shared';
import {
  bubbleNextTo,
  layoutTransitionGraph,
  ROW_PITCH,
  type GraphPosition,
  type TransitionGraphLayout,
} from './transitionGraphLayout';

export type { GraphPosition, TransitionGraphLayout } from './transitionGraphLayout';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TransitionMeta {
  id?: string; // persisted DB id — populated after first save, undefined for new transitions
  formId?: string | null;
  requiresApproval: boolean;
  // When true, the approval request is auto-created (and the approver notified)
  // the moment a ticket enters the source stage — no manual move needed. Only
  // honored at runtime when the source stage has a single outgoing transition.
  requestApprovalOnEntry?: boolean;
  approvers?: Array<{ approverId: string; approverType: ApproverType }>;
  visitSlaMode: VisitSlaMode;
  fixedEtaHours?: number | null;
  onReenter: string;
}

export interface NonLinearTransitionEditorProps {
  stages: StageNode[];
  savedLayout: TransitionGraphLayout | null;
  onLayoutChange: (layout: TransitionGraphLayout | null) => void;
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
  onAddConditionForEdge: (from: number, to: number, condition?: StageCondition) => void;
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
  highlightState?: HighlightState;
  isRework?: boolean;
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

function nextFreeSlot(placed: GraphPosition[]): GraphPosition {
  if (placed.length === 0) return { x: 60, y: 60 };
  return {
    x: Math.min(...placed.map(p => p.x)),
    y: Math.max(...placed.map(p => p.y)) + ROW_PITCH,
  };
}

function applyGraphLayout<T extends Node>(nodes: T[], layout: TransitionGraphLayout): T[] {
  const placed: GraphPosition[] = [];
  const stagePositions = new Map<string, GraphPosition>();
  nodes.forEach(n => {
    const saved = n.type === 'stage' ? layout.stages.get(Number(n.id)) : undefined;
    if (saved) {
      stagePositions.set(n.id, saved);
      placed.push(saved);
    }
  });
  nodes.forEach(n => {
    if (n.type !== 'stage' || stagePositions.has(n.id)) return;
    const slot = nextFreeSlot(placed);
    stagePositions.set(n.id, slot);
    placed.push(slot);
  });
  return nodes.map(n => {
    if (n.type === 'stage') return { ...n, position: stagePositions.get(n.id) ?? n.position };
    if (n.type !== 'allBubble') return n;
    const targetTempId = (n.data as AllBubbleNodeData).targetTempId;
    const target = stagePositions.get(String(targetTempId));
    const position =
      layout.bubbles.get(targetTempId) ?? (target ? bubbleNextTo(target) : n.position);
    return { ...n, position };
  });
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

const NODE_HALF_HEIGHT = 23;
const EDGE_CLEARANCE = 18;
const EDGE_CHANNEL_GAP = 40;
const EDGE_SPREAD_STEP = 10;
const EDGE_CORNER_RADIUS = 12;
const UPWARD_CHANNEL_SHIFT = 24;
const LOCAL_EDGE_SPAN = 110;
const SKIP_SPAN = 200;

type Point = [number, number];

const toward = (from: Point, to: Point, distance: number): Point => {
  const length = Math.hypot(to[0] - from[0], to[1] - from[1]) || 1;
  return [
    from[0] + ((to[0] - from[0]) * distance) / length,
    from[1] + ((to[1] - from[1]) * distance) / length,
  ];
};

function roundedPath(points: Point[]): string {
  return points.reduce((d, point, i) => {
    const previous = points[i - 1];
    const next = points[i + 1];
    if (!previous) return `M ${point[0]} ${point[1]}`;
    if (!next) return `${d} L ${point[0]} ${point[1]}`;
    const radius = Math.min(
      EDGE_CORNER_RADIUS,
      Math.hypot(point[0] - previous[0], point[1] - previous[1]) / 2,
      Math.hypot(next[0] - point[0], next[1] - point[1]) / 2,
    );
    const [bx, by] = toward(point, previous, radius);
    const [ax, ay] = toward(point, next, radius);
    return `${d} L ${bx} ${by} Q ${point[0]} ${point[1]} ${ax} ${ay}`;
  }, '');
}

function edgeSpread(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return ((Math.abs(hash) % 5) - 2) * EDGE_SPREAD_STEP;
}

function routeEdge(
  id: string,
  sx: number,
  sy: number,
  tx: number,
  ty: number,
): { path: string; labelX: number; labelY: number } {
  const dx = tx - sx;
  const dy = ty - sy;
  if (dx >= 2 * EDGE_CLEARANCE && Math.abs(dy) <= LOCAL_EDGE_SPAN) {
    const bow =
      Math.abs(dy) < NODE_HALF_HEIGHT && dx > SKIP_SPAN ? -Math.min(110, 30 + dx * 0.06) : 0;
    const c1: Point = [sx + dx / 2, sy + bow];
    const c2: Point = [tx - dx / 2, ty + bow];
    return {
      path: `M ${sx} ${sy} C ${c1[0]} ${c1[1]} ${c2[0]} ${c2[1]} ${tx} ${ty}`,
      labelX: (sx + 3 * c1[0] + 3 * c2[0] + tx) / 8,
      labelY: (sy + 3 * c1[1] + 3 * c2[1] + ty) / 8,
    };
  }
  const up = dy < -NODE_HALF_HEIGHT;
  const down = dy > NODE_HALF_HEIGHT;
  const clearance = EDGE_CLEARANCE + (up ? UPWARD_CHANNEL_SHIFT / 2 : 0);
  const spread = edgeSpread(id);
  const offset = spread + 2 * EDGE_SPREAD_STEP;
  const exitX = sx + clearance + offset;
  const entryX = tx - clearance - offset;
  const channelY = down
    ? ty - NODE_HALF_HEIGHT - EDGE_CHANNEL_GAP + spread
    : up
      ? sy - NODE_HALF_HEIGHT - EDGE_CHANNEL_GAP - UPWARD_CHANNEL_SHIFT + spread
      : Math.max(sy, ty) + NODE_HALF_HEIGHT + EDGE_CHANNEL_GAP + spread;
  return {
    path: roundedPath([
      [sx, sy],
      [exitX, sy],
      [exitX, channelY],
      [entryX, channelY],
      [entryX, ty],
      [tx, ty],
    ]),
    labelX: exitX + (entryX - exitX) * ((up ? 0.7 : 0.3) + spread / 100),
    labelY: channelY,
  };
}

const TransitionEdge: React.FC<EdgeProps<TransitionEdgeData>> = ({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  data,
  markerEnd,
}) => {
  const { path: finalEdgePath, labelX, labelY } = routeEdge(id, sourceX, sourceY, targetX, targetY);

  const meta = data?.meta;
  const hasBadge = !!meta?.formId || meta?.requiresApproval;
  const highlightState = data?.highlightState ?? 'normal';
  const isDulled = highlightState === 'dull';
  const isHighlighted = highlightState === 'selected' || highlightState === 'connected';
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
          strokeDasharray: data?.isRework ? '5 4' : undefined,
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
            className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium shadow-sm transition-colors ${
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

const SLA_OPTIONS: Array<{ value: VisitSlaMode; label: string }> = [
  { value: VisitSlaMode.STAGE_DEFAULT, label: 'Stage default' },
  { value: VisitSlaMode.FIXED_HOURS, label: 'Fixed hours' },
  { value: VisitSlaMode.NONE, label: 'None' },
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
      onAddCondition: (condition?: StageCondition) => void;
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
              {props.toStage.prStatuses.map(ps => (
                <button
                  key={ps}
                  type='button'
                  onClick={() =>
                    props.onAddCondition({
                      id: `pr-${props.toStage.tempId}-${ps}`,
                      name: `PR Status - ${ps}`,
                      whenField: 'pr_status',
                      whenCondition: 'is',
                      whenValue: ps,
                      thenField: 'status',
                      thenCondition: 'set_to',
                      thenValue: props.toStage.name,
                    })
                  }
                  className='w-full bg-background border border-border rounded-[12px] min-h-[40px] px-2 py-2 flex items-center gap-[6px] hover:bg-muted transition-colors text-left'
                >
                  <GitBranch size={14} className='text-muted-foreground flex-shrink-0' />
                  <span className='text-[14px] font-medium text-foreground'>PR Status - {ps}</span>
                </button>
              ))}
              <button
                type='button'
                onClick={() => props.onAddCondition()}
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
                  onChange={e => {
                    const next = SLA_OPTIONS.find(o => String(o.value) === e.target.value);
                    if (next) onUpdateMeta({ visitSlaMode: next.value });
                  }}
                >
                  {SLA_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                {meta.visitSlaMode === VisitSlaMode.FIXED_HOURS && (
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

interface DisplayNodeCacheEntry {
  source: Node<StageNodeData | AllBubbleNodeData>;
  state: HighlightState;
  out: Node<StageNodeData | AllBubbleNodeData>;
}

interface DisplayEdgeCacheEntry {
  source: Edge<TransitionEdgeData>;
  state: HighlightState;
  rework: boolean;
  out: Edge<TransitionEdgeData>;
}
const EDGE_TYPES = { transition: TransitionEdge };

// ─── Main Editor ──────────────────────────────────────────────────────────────

export const NonLinearTransitionEditor: React.FC<NonLinearTransitionEditorProps> = ({
  stages,
  savedLayout,
  onLayoutChange,
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
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);
  const [expandedTargets, setExpandedTargets] = useState<Set<number>>(new Set());
  const { fitView } = useReactFlow();
  const fitAfterLayout = useCallback(() => {
    requestAnimationFrame(() =>
      requestAnimationFrame(() => fitView({ padding: 0.35, duration: 300 })),
    );
  }, [fitView]);
  const savedLayoutRef = useRef(savedLayout);
  savedLayoutRef.current = savedLayout;

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

  const handleNodeMouseEnter = useCallback((_event: React.MouseEvent, node: Node) => {
    if (node.id.startsWith('all-')) setHoveredEdgeId(`eAll-${node.id.slice(4)}`);
    else setHoveredNodeId(node.id);
  }, []);

  const handleNodeMouseLeave = useCallback(() => {
    setHoveredNodeId(null);
    setHoveredEdgeId(null);
  }, []);

  const handleEdgeMouseEnter = useCallback((_event: React.MouseEvent, edge: Edge) => {
    setHoveredEdgeId(edge.id);
  }, []);

  const handleEdgeMouseLeave = useCallback(() => setHoveredEdgeId(null), []);

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

  // Track whether the graph is hand-arranged — a node was moved, or a saved
  // arrangement was restored. If so, we preserve positions and don't
  // auto-relayout on transition changes.
  const hasUserDraggedRef = useRef(false);

  const layoutFor = useCallback(
    (stageList: StageNode[]): TransitionGraphLayout =>
      layoutTransitionGraph(
        stageList,
        transitionsByTempId,
        computeMergedTargets(stageList, transitionsByTempId, transitionsMeta).keys(),
      ),
    [transitionsByTempId, transitionsMeta],
  );

  // Build initial nodes using graph-aware layout
  const makeNodes = useCallback(
    (stageList: StageNode[]): Node<StageNodeData>[] => {
      const layout = layoutFor(stageList);
      return stageList.map(s => ({
        id: String(s.tempId),
        type: 'stage',
        position: layout.stages.get(s.tempId) ?? { x: 60, y: 60 },
        data: { stage: s },
      }));
    },
    [layoutFor],
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

  const lastAutoLayoutRef = useRef<TransitionGraphLayout | null>(null);
  const applyAutoLayout = useCallback(
    (layout: TransitionGraphLayout) => {
      if (layout === lastAutoLayoutRef.current) return;
      lastAutoLayoutRef.current = layout;
      setNodes(prev => applyGraphLayout(prev, layout));
      fitAfterLayout();
    },
    [setNodes, fitAfterLayout],
  );

  // Detect user-initiated node moves (drag or arrow keys) so we can preserve
  // custom positions. Only a position change that carries a position means a
  // node moved; a plain click emits a position-less `dragging: false` change.
  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      if (changes.some(c => c.type === 'position' && c.position !== undefined)) {
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
    applyAutoLayout(layoutFor(stagesRef.current));
  }, [layoutFor, isTransitionsLoading, applyAutoLayout]);

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

    const layout = layoutFor(stages);
    setNodes(prev => {
      // Remove deleted stages
      let updated = prev.filter(n => !removed.includes(Number(n.id)));
      // Add new stages with positions from graph layout
      added.forEach((tempId, _i) => {
        const s = stages.find(s => s.tempId === tempId)!;
        updated = [
          ...updated,
          {
            id: String(tempId),
            type: 'stage',
            position: hasUserDraggedRef.current
              ? nextFreeSlot(updated.filter(n => n.type === 'stage').map(n => n.position))
              : (layout.stages.get(tempId) ?? { x: 60, y: 60 }),
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
    if (!hasUserDraggedRef.current) applyAutoLayout(layout);
  }, [stages, layoutFor, setNodes, applyAutoLayout]);

  // Sync edges from transition state
  useEffect(() => {
    const newEdges: Edge<TransitionEdgeData>[] = [];
    transitionsByTempId.forEach((targets, fromTempId) => {
      targets.forEach(toTempId => {
        const edgeId = `e${fromTempId}-${toTempId}`;
        const metaKey = `${fromTempId}->${toTempId}`;
        const meta: TransitionMeta = transitionsMeta.get(metaKey) ?? {
          requiresApproval: false,
          approvers: [],
          visitSlaMode: VisitSlaMode.STAGE_DEFAULT,
          onReenter: ReenterMode.RESET,
        };

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
          },
        });
      });
    });
    setEdges(newEdges);
  }, [transitionsByTempId, transitionsMeta, setEdges, handleSelectEdge]);

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

    const layout = layoutFor(stages);

    const bubbleNodes: Node<AllBubbleNodeData>[] = [];
    const bubbleEdges: Edge<TransitionEdgeData>[] = [];

    active.forEach(m => {
      // Use the deterministic graph-layout position for the target (matches
      // what the stage-position-sync effect places the stage at), so a
      // newly-created bubble aligns with where its target lands — not a
      // pre-layout position that may still be in `nodes` at effect-run time.
      const arrangedTarget = hasUserDraggedRef.current
        ? nodesRef.current.find(n => n.id === String(m.targetTempId))?.position
        : undefined;
      const targetPosition = arrangedTarget ??
        layout.stages.get(m.targetTempId) ?? { x: 60, y: 60 };
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
        position:
          existingBubble?.position ??
          (hasUserDraggedRef.current
            ? savedLayoutRef.current?.bubbles.get(m.targetTempId)
            : layout.bubbles.get(m.targetTempId)) ??
          bubbleNextTo(targetPosition),
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
            visitSlaMode: VisitSlaMode.STAGE_DEFAULT,
            onReenter: ReenterMode.RESET,
          },
          onSelectEdge: handleSelectEdge,
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
    handleSelectEdge,
    layoutFor,
    setNodes,
    setEdges,
  ]);

  const hasAppliedSavedLayoutRef = useRef(false);
  useEffect(() => {
    if (!savedLayout || hasAppliedSavedLayoutRef.current || hasUserDraggedRef.current) return;
    hasAppliedSavedLayoutRef.current = true;
    hasUserDraggedRef.current = true;
    setNodes(prev => applyGraphLayout(prev, savedLayout));
    fitAfterLayout();
  }, [savedLayout, setNodes, fitAfterLayout]);

  useEffect(() => {
    if (!hasUserDraggedRef.current) {
      onLayoutChange(null);
      return;
    }
    const layout: TransitionGraphLayout = { stages: new Map(), bubbles: new Map() };
    nodes.forEach(n => {
      if (n.type === 'stage') layout.stages.set(Number(n.id), n.position);
      if (n.type === 'allBubble') {
        layout.bubbles.set((n.data as AllBubbleNodeData).targetTempId, n.position);
      }
    });
    onLayoutChange(layout);
  }, [nodes, onLayoutChange]);

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
        visitSlaMode: VisitSlaMode.STAGE_DEFAULT,
        onReenter: ReenterMode.RESET,
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
      visitSlaMode: VisitSlaMode.STAGE_DEFAULT,
      onReenter: ReenterMode.RESET,
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

  const sequenceByTempId = useMemo(
    () => new Map(stages.map(s => [s.tempId, s.sequenceNumber])),
    [stages],
  );

  const displayCacheRef = useRef({
    nodes: new Map<string, DisplayNodeCacheEntry>(),
    edges: new Map<string, DisplayEdgeCacheEntry>(),
  });

  // Highlight the selected (or hovered) node/edge and its direct connections; dull the rest.
  const { displayNodes, displayEdges } = useMemo(() => {
    const nodeState = new Map<string, HighlightState>();
    const edgeState = new Map<string, HighlightState>();

    const bubbleNodeId = (targetTempId: number) => `all-${targetTempId}`;
    const bubbleEdgeId = (targetTempId: number) => `eAll-${targetTempId}`;

    const hiddenEdgeIds = new Set<string>();
    const hiddenEdgeTarget = new Map<string, number>();
    activeMergedTargets.forEach(merged => {
      merged.sourceTempIds.forEach(from => {
        hiddenEdgeIds.add(`e${from}-${merged.targetTempId}`);
        hiddenEdgeTarget.set(`e${from}-${merged.targetTempId}`, merged.targetTempId);
      });
    });

    const isSelecting = !!selectedNodeId || !!selectedEdgeId;
    const focusNodeId = isSelecting ? selectedNodeId : hoveredNodeId;
    const focusEdgeId = isSelecting ? selectedEdgeId : hoveredNodeId ? null : hoveredEdgeId;
    const focusState: HighlightState = isSelecting ? 'selected' : 'connected';

    if (focusNodeId && nodes.some(n => n.id === focusNodeId)) {
      nodeState.set(focusNodeId, focusState);
      edges.forEach(e => {
        if (hiddenEdgeIds.has(e.id)) return;
        if (e.source === focusNodeId || e.target === focusNodeId) {
          edgeState.set(e.id, 'connected');
          const other = e.source === focusNodeId ? e.target : e.source;
          if (!nodeState.has(other)) nodeState.set(other, 'connected');
        }
      });
      const mergedForFocus = activeMergedTargets.get(Number(focusNodeId));
      if (mergedForFocus) {
        nodeState.set(bubbleNodeId(mergedForFocus.targetTempId), 'connected');
        edgeState.set(bubbleEdgeId(mergedForFocus.targetTempId), 'connected');
      }
    } else if (focusEdgeId) {
      if (focusEdgeId.startsWith('eAll-')) {
        const targetTempId = Number(focusEdgeId.slice('eAll-'.length));
        if (activeMergedTargets.has(targetTempId)) {
          nodeState.set(bubbleNodeId(targetTempId), 'connected');
          nodeState.set(String(targetTempId), 'connected');
          edgeState.set(focusEdgeId, focusState);
        }
      } else {
        const edge = edges.find(e => e.id === focusEdgeId);
        if (edge) {
          nodeState.set(edge.source, 'connected');
          nodeState.set(edge.target, 'connected');
          edgeState.set(edge.id, focusState);
          const bubbleTarget = hiddenEdgeTarget.get(edge.id);
          if (bubbleTarget !== undefined) {
            nodeState.set(bubbleNodeId(bubbleTarget), 'connected');
            edgeState.set(bubbleEdgeId(bubbleTarget), 'connected');
          }
        }
      }
    }

    const hasFocus = nodeState.size > 0;
    if (hasFocus) {
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
    const cache = displayCacheRef.current;
    const nextNodes = new Map<string, DisplayNodeCacheEntry>();
    const displayNodesOut = nodes.map(n => {
      const state = nodeState.get(n.id) ?? 'normal';
      const hit = cache.nodes.get(n.id);
      const out =
        hit && hit.source === n && hit.state === state
          ? hit.out
          : { ...n, data: { ...n.data, highlightState: state } };
      nextNodes.set(n.id, { source: n, state, out });
      return out;
    });

    const nextEdges = new Map<string, DisplayEdgeCacheEntry>();
    const displayEdgesOut = edges
      .filter(e => !hiddenEdgeIds.has(e.id))
      .map(e => {
        const state = edgeState.get(e.id) ?? 'normal';
        const rework =
          !e.data?.isAllEdge &&
          (sequenceByTempId.get(e.data?.fromTempId ?? 0) ?? 0) >
            (sequenceByTempId.get(e.data?.toTempId ?? 0) ?? 0);
        const hit = cache.edges.get(e.id);
        const out =
          hit && hit.source === e && hit.state === state && hit.rework === rework
            ? hit.out
            : {
                ...e,
                data: {
                  ...(e.data as TransitionEdgeData),
                  highlightState: state,
                  isRework: rework,
                },
              };
        nextEdges.set(e.id, { source: e, state, rework, out });
        return out;
      });
    displayCacheRef.current = { nodes: nextNodes, edges: nextEdges };

    return { displayNodes: displayNodesOut, displayEdges: displayEdgesOut };
  }, [
    selectedNodeId,
    selectedEdgeId,
    hoveredNodeId,
    hoveredEdgeId,
    nodes,
    edges,
    activeMergedTargets,
    sequenceByTempId,
  ]);

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
        onNodeMouseEnter={handleNodeMouseEnter}
        onNodeMouseLeave={handleNodeMouseLeave}
        onEdgeMouseEnter={handleEdgeMouseEnter}
        onEdgeMouseLeave={handleEdgeMouseLeave}
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
                const layout = layoutFor(stages);
                setNodes(prev => applyGraphLayout(prev, layout));
                lastAutoLayoutRef.current = layout;
                fitAfterLayout();
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
              <span>Hover a stage to trace it</span>
              <span className='opacity-40'>·</span>
              <span>Dashed = moves back</span>
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
                onAddCondition={condition =>
                  onAddConditionForEdge(selectedEdge.fromTempId, selectedEdge.toTempId, condition)
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
