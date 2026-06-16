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
  type NodeProps,
  EdgeLabelRenderer,
  getBezierPath,
  MarkerType,
  Panel,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { Plus, X, Pencil, ChevronDown, Settings2, Timer, Trash2, GitBranch } from 'lucide-react';
import {
  STATUS_OPTIONS,
  getStatusOption,
  type StageNode,
} from '../BoardStageConfigScreen/BoardStageConfigScreen.types';
import { StatusIndicator } from '../StatusIndicator';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../ui/dropdown-menu';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TransitionMeta {
  id?: string; // persisted DB id — populated after first save, undefined for new transitions
  formId?: string | null;
  requiresApproval: boolean;
  approverUserIds?: string[];
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
  allUsers: Array<{ id: string; name: string }>;
  userMap: Map<string, string>;
  onOpenEdgeForm: (from: number, to: number, existingFormId?: string | null) => void;
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

interface StageNodeData {
  stage: StageNode;
  onUpdate: (patch: Partial<StageNode>) => void;
  onDelete: () => void;
  editingEtaId: number | null;
  etaValue: string;
  etaInputRef: React.RefObject<HTMLInputElement | null>;
  onStartEditEta: (stage: StageNode) => void;
  onSaveEta: (tempId: number) => void;
  onCancelEta: () => void;
  setEtaValue: (v: string) => void;
}

const StageNodeComponent: React.FC<NodeProps<StageNodeData>> = ({ data, selected }) => {
  const {
    stage,
    onUpdate,
    onDelete,
    editingEtaId,
    etaValue,
    etaInputRef,
    onStartEditEta,
    onSaveEta,
    onCancelEta,
    setEtaValue,
  } = data;
  const statusOption = getStatusOption(stage.defaultTicketStatusV2);
  const isEditingEta = editingEtaId === stage.tempId;

  return (
    <div
      className={`w-[240px] bg-background rounded-[10px] border-2 shadow-[0px_2px_8px_0px_rgba(5,5,6,0.07)] transition-all ${
        selected ? 'border-[#6276be]' : 'border-border'
      }`}
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
      <Handle
        type='source'
        position={Position.Bottom}
        id='bottom'
        className='!w-2.5 !h-2.5 !bg-[#6276be]/60 !border-2 !border-background !rounded-full'
        style={{ bottom: -6 }}
      />
      <Handle
        type='target'
        position={Position.Top}
        id='top'
        className='!w-2.5 !h-2.5 !bg-[#6276be]/60 !border-2 !border-background !rounded-full'
        style={{ top: -6 }}
      />

      {/* Card Header */}
      <div className='flex items-center justify-between px-3 py-2 border-b border-border'>
        {/* Status dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger
            className='flex items-center gap-[6px] outline-none nodrag'
            onPointerDown={e => e.stopPropagation()}
          >
            <span className='text-[13px] font-medium text-muted-foreground'>
              {statusOption.label}
            </span>
            <ChevronDown size={14} className='text-muted-foreground' />
          </DropdownMenuTrigger>
          <DropdownMenuContent align='start' className='z-[9999]'>
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

        {/* ETA + Delete */}
        <div
          className='flex items-center gap-1 relative nodrag'
          onPointerDown={e => e.stopPropagation()}
        >
          <button
            type='button'
            onClick={() => onStartEditEta(stage)}
            data-track-category='board_stage_config'
            data-track-name='edit_stage_eta'
            className='flex items-center gap-[4px] text-[12px] text-foreground hover:text-foreground/80 p-[4px] rounded-[6px] hover:bg-muted transition-colors'
          >
            <Timer size={12} />
            <span className='font-[450]'>{stage.eta > 0 ? `${stage.eta}h` : 'ETA'}</span>
          </button>
          {isEditingEta && (
            <div className='absolute top-full right-0 mt-1 z-50 bg-background border border-border rounded-[6px] shadow-md px-2.5 py-2 flex items-center gap-2 min-w-[80px]'>
              <input
                ref={etaInputRef}
                type='text'
                inputMode='numeric'
                pattern='[0-9]*'
                value={etaValue}
                onChange={e => setEtaValue(e.target.value)}
                onBlur={() => onSaveEta(stage.tempId)}
                onKeyDown={e => {
                  if (e.key === 'Enter') onSaveEta(stage.tempId);
                  if (e.key === 'Escape') onCancelEta();
                }}
                placeholder='hrs'
                data-track-category='board_stage_config'
                data-track-name='input_stage_eta'
                className='w-10 text-[13px] text-foreground bg-transparent border-none focus:outline-none p-0'
              />
              <span className='text-[13px] text-foreground'>h</span>
            </div>
          )}
          <button
            type='button'
            onClick={onDelete}
            data-track-category='board_stage_config'
            data-track-name='delete_stage'
            className='p-1 rounded-md hover:bg-red-50 text-muted-foreground hover:text-red-500 transition-colors'
            title='Delete stage'
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      {/* Card Body */}
      <div className='px-3 py-3'>
        <div className='flex items-center gap-2'>
          <StatusIndicator status={stage.defaultTicketStatusV2} size={16} />
          <input
            type='text'
            value={stage.name}
            onChange={e => onUpdate({ name: e.target.value })}
            placeholder='Stage name...'
            data-track-category='board_stage_config'
            data-track-name='input_stage_name'
            className='nodrag flex-1 text-[12px] font-semibold text-foreground bg-transparent border-none focus:outline-none uppercase tracking-[0.72px] leading-[18px]'
            onPointerDown={e => e.stopPropagation()}
          />
        </div>
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
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const isSelected = data?.selectedEdgeId === id;
  const meta = data?.meta;
  const hasBadge = !!meta?.formId || meta?.requiresApproval;

  return (
    <>
      <path
        id={id}
        className='react-flow__edge-path'
        d={edgePath}
        markerEnd={markerEnd}
        style={{
          stroke: isSelected ? '#6276be' : '#94a3b8',
          strokeWidth: isSelected ? 2.5 : 1.5,
          fill: 'none',
        }}
      />
      <path
        d={edgePath}
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
          }}
          className='nodrag nopan'
        >
          <button
            type='button'
            onClick={() => data?.onSelectEdge(id)}
            data-track-category='board_stage_config'
            data-track-name='open_transition_config'
            className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium shadow-sm transition-all ${
              isSelected
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

// ─── Edge Settings Panel ──────────────────────────────────────────────────────

const SLA_OPTIONS = [
  { value: 'STAGE_DEFAULT', label: 'Stage default' },
  { value: 'FIXED_HOURS', label: 'Fixed hours' },
  { value: 'NONE', label: 'None' },
];

interface EdgeSettingsPanelProps {
  fromStage: StageNode;
  toStage: StageNode;
  meta: TransitionMeta;
  formMap: Map<string, string>;
  allUsers: Array<{ id: string; name: string }>;
  userMap: Map<string, string>;
  onUpdateMeta: (patch: Partial<TransitionMeta>) => void;
  onRemoveEdge: () => void;
  onClose: () => void;
  onOpenEdgeForm: () => void;
  onAddCondition: () => void;
}

const EdgeSettingsPanel: React.FC<EdgeSettingsPanelProps> = ({
  fromStage,
  toStage,
  meta,
  formMap,
  allUsers,
  userMap,
  onUpdateMeta,
  onRemoveEdge,
  onClose,
  onOpenEdgeForm,
  onAddCondition,
}) => (
  <div className='w-[280px] bg-background border border-border rounded-xl shadow-2xl overflow-hidden flex flex-col'>
    <div className='flex items-center justify-between px-4 py-3 border-b border-border bg-muted/30'>
      <div className='flex items-center gap-1.5 min-w-0'>
        <span className='text-[11px] font-semibold text-foreground uppercase tracking-wide truncate max-w-[85px]'>
          {fromStage.name}
        </span>
        <span className='text-muted-foreground text-[10px] shrink-0'>→</span>
        <span className='text-[11px] font-semibold text-[#6276be] uppercase tracking-wide truncate max-w-[85px]'>
          {toStage.name}
        </span>
      </div>
      <div className='flex items-center gap-1 shrink-0'>
        <button
          type='button'
          onClick={onRemoveEdge}
          data-track-category='board_stage_config'
          data-track-name='remove_transition'
          className='p-1.5 rounded-md hover:bg-red-50 text-muted-foreground hover:text-red-500 transition-colors'
          title='Remove'
        >
          <X size={13} />
        </button>
        <button
          type='button'
          onClick={onClose}
          data-track-category='board_stage_config'
          data-track-name='close_transition_config'
          className='p-1.5 rounded-md hover:bg-muted text-muted-foreground transition-colors'
        >
          <ChevronDown size={13} />
        </button>
      </div>
    </div>

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
          <button
            type='button'
            onClick={onOpenEdgeForm}
            data-track-category='board_stage_config'
            data-track-name='attach_transition_form'
            className='flex items-center gap-2 w-full rounded-lg border border-dashed border-border px-3 py-2 text-[12px] text-muted-foreground hover:border-[#6276be] hover:text-[#6276be] transition-colors'
          >
            <Plus size={12} />
            Attach form
          </button>
        )}
      </div>

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
                approverUserIds: !meta.requiresApproval ? (meta.approverUserIds ?? []) : [],
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
            <div className='flex flex-wrap gap-1 mb-2'>
              {(meta.approverUserIds ?? []).map(uid => (
                <span
                  key={uid}
                  className='inline-flex items-center gap-1 text-[11px] bg-[#6276be]/10 text-[#6276be] border border-[#6276be]/20 px-2 py-0.5 rounded-full'
                >
                  {userMap.get(uid) || uid}
                  <button
                    type='button'
                    onClick={() =>
                      onUpdateMeta({
                        approverUserIds: (meta.approverUserIds ?? []).filter(id => id !== uid),
                      })
                    }
                    data-track-category='transition_config'
                    data-track-name='remove_approver'
                    className='hover:text-red-500 transition-colors'
                  >
                    <X size={9} />
                  </button>
                </span>
              ))}
            </div>
            <select
              className='w-full text-[12px] bg-background border border-border rounded-lg px-2.5 py-1.5 text-foreground focus:outline-none focus:ring-1 focus:ring-[#6276be]'
              data-track-category='transition_config'
              data-track-name='select_approver'
              value=''
              onChange={e => {
                const uid = e.target.value;
                if (!uid) return;
                const cur = meta.approverUserIds ?? [];
                if (!cur.includes(uid)) onUpdateMeta({ approverUserIds: [...cur, uid] });
              }}
            >
              <option value=''>+ Add approver</option>
              {allUsers
                .filter(u => !(meta.approverUserIds ?? []).includes(u.id))
                .map(u => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
            </select>
          </div>
        )}
      </div>

      {/* Add Condition */}
      <button
        type='button'
        onClick={onAddCondition}
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
              onUpdateMeta({ fixedEtaHours: e.target.value ? Number(e.target.value) : null })
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
    </div>
  </div>
);

// ─── Stable node/edge type maps (outside component to avoid re-registration) ─

const NODE_TYPES = { stage: StageNodeComponent };
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
  allUsers,
  userMap,
  onOpenEdgeForm,
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

  // Build initial nodes in a grid layout
  const makeNodes = useCallback(
    (stageList: StageNode[]): Node<StageNodeData>[] => {
      const cols = Math.max(1, Math.ceil(Math.sqrt(stageList.length)));
      return stageList.map((s, i) => ({
        id: String(s.tempId),
        type: 'stage',
        position: { x: (i % cols) * 280 + 60, y: Math.floor(i / cols) * 160 + 60 },
        data: {
          stage: s,
          onUpdate: (patch: Partial<StageNode>) => onUpdateStage(s.tempId, patch),
          onDelete: () => onDeleteStage(s.tempId),
          editingEtaId,
          etaValue,
          etaInputRef,
          onStartEditEta,
          onSaveEta,
          onCancelEta,
          setEtaValue,
        },
      }));
    },
    [
      onUpdateStage,
      onDeleteStage,
      editingEtaId,
      etaValue,
      etaInputRef,
      onStartEditEta,
      onSaveEta,
      onCancelEta,
      setEtaValue,
    ],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState<StageNodeData>(makeNodes(stages));
  const [edges, setEdges, onEdgesChange] = useEdgesState<TransitionEdgeData>([]);

  // Sync node count when stages added/removed; update data when stages change
  const prevStageTempIds = useRef<number[]>([]);
  useEffect(() => {
    const prevIds = prevStageTempIds.current;
    const currIds = stages.map(s => s.tempId);
    const added = currIds.filter(id => !prevIds.includes(id));
    const removed = prevIds.filter(id => !currIds.includes(id));
    prevStageTempIds.current = currIds;

    setNodes(prev => {
      // Remove deleted stages
      let updated = prev.filter(n => !removed.includes(Number(n.id)));
      // Add new stages with a position offset
      added.forEach((tempId, _i) => {
        const s = stages.find(s => s.tempId === tempId)!;
        updated = [
          ...updated,
          {
            id: String(tempId),
            type: 'stage',
            position: { x: updated.length * 280 + 60, y: 60 },
            data: {
              stage: s,
              onUpdate: (patch: Partial<StageNode>) => onUpdateStage(s.tempId, patch),
              onDelete: () => onDeleteStage(s.tempId),
              editingEtaId,
              etaValue,
              etaInputRef,
              onStartEditEta,
              onSaveEta,
              onCancelEta,
              setEtaValue,
            },
          },
        ];
      });
      // Update data for existing nodes (name, status, eta changes)
      return updated.map(n => {
        const s = stages.find(s => s.tempId === Number(n.id));
        if (!s) return n;
        return {
          ...n,
          data: {
            ...n.data,
            stage: s,
            onUpdate: (patch: Partial<StageNode>) => onUpdateStage(s.tempId, patch),
            onDelete: () => onDeleteStage(s.tempId),
            editingEtaId,
            etaValue,
            etaInputRef,
            onStartEditEta,
            onSaveEta,
            onCancelEta,
            setEtaValue,
          },
        };
      });
    });
  }, [
    stages,
    onUpdateStage,
    onDeleteStage,
    editingEtaId,
    etaValue,
    etaInputRef,
    onStartEditEta,
    onSaveEta,
    onCancelEta,
    setEtaValue,
    setNodes,
  ]);

  // Sync edges from transition state
  useEffect(() => {
    const newEdges: Edge<TransitionEdgeData>[] = [];
    transitionsByTempId.forEach((targets, fromTempId) => {
      targets.forEach(toTempId => {
        const edgeId = `e${fromTempId}-${toTempId}`;
        const metaKey = `${fromTempId}->${toTempId}`;
        const meta: TransitionMeta = transitionsMeta.get(metaKey) ?? {
          requiresApproval: false,
          approverUserIds: [],
          visitSlaMode: 'STAGE_DEFAULT',
          onReenter: 'RESET',
        };
        newEdges.push({
          id: edgeId,
          source: String(fromTempId),
          target: String(toTempId),
          type: 'transition',
          markerEnd: { type: MarkerType.ArrowClosed, color: '#6276be', width: 18, height: 18 },
          data: { fromTempId, toTempId, meta, onSelectEdge: setSelectedEdgeId, selectedEdgeId },
        });
      });
    });
    setEdges(newEdges);
  }, [transitionsByTempId, transitionsMeta, selectedEdgeId, setEdges]);

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      const from = Number(connection.source);
      const to = Number(connection.target);
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

  // Selected edge info for the settings panel
  const selectedEdge = useMemo(() => {
    if (!selectedEdgeId) return null;
    const edge = edges.find(e => e.id === selectedEdgeId);
    if (!edge?.data) return null;
    const { fromTempId, toTempId } = edge.data;
    const fromStage = stages.find(s => s.tempId === fromTempId);
    const toStage = stages.find(s => s.tempId === toTempId);
    if (!fromStage || !toStage) return null;
    const meta: TransitionMeta = transitionsMeta.get(`${fromTempId}->${toTempId}`) ?? {
      requiresApproval: false,
      approverUserIds: [],
      visitSlaMode: 'STAGE_DEFAULT',
      onReenter: 'RESET',
    };
    return { edgeId: selectedEdgeId, fromStage, toStage, fromTempId, toTempId, meta };
  }, [selectedEdgeId, edges, stages, transitionsMeta]);

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
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onEdgesDelete={onEdgesDelete}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        onPaneClick={() => setSelectedEdgeId(null)}
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

        {/* Hint + Add Stage */}
        <Panel position='bottom-center'>
          <div className='flex items-center gap-3'>
            <div className='flex items-center gap-1.5 bg-background/90 border border-border rounded-lg px-2.5 py-1.5 shadow text-[11px] text-muted-foreground'>
              <span>Drag handle → to connect</span>
              <span className='opacity-40'>·</span>
              <span>Click edge to configure</span>
              <span className='opacity-40'>·</span>
              <span>Del to remove</span>
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
        {selectedEdge && (
          <Panel position='top-right'>
            <EdgeSettingsPanel
              fromStage={selectedEdge.fromStage}
              toStage={selectedEdge.toStage}
              meta={selectedEdge.meta}
              formMap={formMap}
              allUsers={allUsers}
              userMap={userMap}
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
              onAddCondition={() =>
                onAddConditionForEdge(selectedEdge.fromTempId, selectedEdge.toTempId)
              }
            />
          </Panel>
        )}
      </ReactFlow>
    </div>
  );
};
