import { logger, Event as LogEvent } from '../../../utils/logger';
import {
  type ReactElement,
  type RefObject,
  useState,
  useCallback,
  useMemo,
  useEffect,
  useRef,
} from 'react';
import { ReactFlowProvider } from 'reactflow';
import {
  NonLinearTransitionEditor,
  type TransitionMeta,
} from '../NonLinearTransitionEditor/NonLinearTransitionEditor';
import { Plus, X, Timer, ChevronDown, GitBranch, ChevronLeft, Clock, Pencil } from 'lucide-react';
import { useZero } from '../../../hooks/useZero';
import { queries } from '../../../zero/queries';
import { mutators } from '../../../zero/mutators';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { v4 as uuidv4 } from 'uuid';
import { Button } from '../../../components/ui/Button';
import { Dialog } from '../../../components/ui/Dialog';
import { useConfirmDialog } from '../../../hooks/useConfirmDialog';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '../../../components/ui/dropdown-menu';
import {
  TicketStatusV2,
  PRStatusEvent,
  FormContextType,
  BoardType,
  ApproverType,
  ReenterMode,
  VisitSlaMode,
} from '@xyne/shared';
import { toast } from 'sonner';
import type { ApproverEntry } from '../ApproverSelector/ApproverSelector.types';
import type { StageNode as Stage, StageCondition } from './BoardStageConfigScreen.types';
import { ConditionBuilder } from '../../../components/Board/ConditionBuilder/ConditionBuilder';
import { CreateFormSlideOut } from '../../../components/Board/CreateFormSlideOut/CreateFormSlideOut';
import type { FormField } from '../../../components/Board/CreateFormSlideOut/CreateFormSlideOut.types';
import { TransitionFormPicker } from '../TransitionFormPicker/TransitionFormPicker';
import { formService } from '../../../services/Form/formService';
import { FormEntityType } from '@xyne/shared';
import {
  mapFormFieldsToApiPayload,
  mapFormDetailsToBuilderFields,
} from '../../../utils/board/formFieldApiMapper';
import { StatusIndicator } from '../../../components/Board/StatusIndicator';
import { STATUS_OPTIONS, getStatusOption } from './BoardStageConfigScreen.types.tsx';
import { SlaSettings } from '../../xyne-desk/SlaSettings/SlaSettings';

interface BoardStageConfigScreenProps {
  boardId: string;
  projectId: string;
  isOpen: boolean;
  onClose: () => void;
  onSave?: () => void;
  onNext?: () => void;
  onBack?: () => void;
  initialBoard?: unknown; // Optional board data to avoid Zero sync delay
}

interface ConditionDeleteDialogState {
  kind: 'confirm' | 'blocked';
  conditionId: string;
  conditionName: string;
  targetStageName?: string;
  openRequestCount: number;
}

const getStatusBgColor = (status: TicketStatusV2): string => {
  switch (status) {
    case TicketStatusV2.TODO:
      return 'bg-stage-todo';
    case TicketStatusV2.STARTED:
      return 'bg-muted/30';
    case TicketStatusV2.PAUSED:
      return 'bg-muted/50';
    case TicketStatusV2.COMPLETED:
      return 'bg-stage-completed';
    case TicketStatusV2.CANCELLED:
      return 'bg-stage-cancelled';
    default:
      return 'bg-muted/30';
  }
};

const getBoardName = (board: unknown): string =>
  board && typeof board === 'object' && 'name' in board
    ? ((board as { name?: string }).name ?? '')
    : '';

const getBoardMetadata = (board: unknown): Record<string, unknown> =>
  board && typeof board === 'object' && 'metadata' in board
    ? ((board as { metadata?: Record<string, unknown> }).metadata ?? {})
    : {};

const PREFILLABLE_NON_LINEAR_UNSUPPORTED_MESSAGE =
  'Non-linear boards do not support prefillable forms. Turn off prefillable forms before enabling non-linear board.';

const ToggleSwitch = ({
  checked,
  onToggle,
  trackName,
  disabled = false,
  disabledReason,
  onDisabledToggle,
}: {
  checked: boolean;
  onToggle: () => void;
  trackName: string;
  disabled?: boolean;
  disabledReason?: string;
  onDisabledToggle?: () => void;
}): ReactElement => (
  <button
    type='button'
    role='switch'
    aria-checked={checked}
    aria-disabled={disabled}
    title={disabled ? disabledReason : undefined}
    onClick={() => {
      if (disabled) {
        onDisabledToggle?.();
        return;
      }
      onToggle();
    }}
    data-track-category='board_config'
    data-track-name={trackName}
    className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${
      disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
    } ${checked ? 'bg-[#6276be]' : 'bg-muted'}`}
  >
    <span
      className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-background shadow-sm transition-transform duration-200 ${
        checked ? 'translate-x-4' : 'translate-x-0'
      }`}
    />
  </button>
);

interface LinearStageCardProps {
  stage: Stage;
  index: number;
  stages: Stage[];
  formMap: Map<string, string>;
  editingEtaId: number | null;
  etaValue: string;
  etaInputRef: RefObject<HTMLInputElement | null>;
  setEtaValue: (value: string) => void;
  setEditingEtaId: (value: number | null) => void;
  handleStartEditEta: (stage: Stage) => void;
  handleSaveEta: (tempId: number) => void;
  handleAddStageAt: (insertIndex: number) => void;
  handleUpdateStage: (tempId: number, updates: Partial<Stage>) => void;
  handleDeleteStage: (tempId: number) => void;
  handleOpenConditionModal: (stageTempId: number, condition?: StageCondition) => void;
  handleOpenEditForm: (stageTempId: number, formId: string) => Promise<void> | void;
  handleRemoveStageForm: (stageTempId: number) => void;
  handleOpenDirectForm: (stageTempId: number) => void;
  handleAttachExistingStageForm: (stageTempId: number, formId: string) => void;
  stageFormsList: Array<{ id: string; formName: string }>;
  isConditionModalOpen: boolean;
  selectedStageForCondition: number | null;
  editingCondition: StageCondition | null;
  handleCloseConditionModal: () => void;
  handleSaveCondition: (condition: StageCondition) => void;
  handleDeleteCondition: (conditionId: string) => void;
  handleOpenCreateForm: (condition?: StageCondition) => void;
}

const LinearStageCard = ({
  stage,
  index,
  stages,
  formMap,
  editingEtaId,
  etaValue,
  etaInputRef,
  setEtaValue,
  setEditingEtaId,
  handleStartEditEta,
  handleSaveEta,
  handleAddStageAt,
  handleUpdateStage,
  handleDeleteStage,
  handleOpenConditionModal,
  handleOpenEditForm,
  handleRemoveStageForm,
  handleOpenDirectForm,
  handleAttachExistingStageForm,
  stageFormsList,
  isConditionModalOpen,
  selectedStageForCondition,
  editingCondition,
  handleCloseConditionModal,
  handleSaveCondition,
  handleDeleteCondition,
  handleOpenCreateForm,
}: LinearStageCardProps): ReactElement => {
  const statusOption = getStatusOption(stage.defaultTicketStatusV2);

  // Calculate active stages for progress indicator (exclude TODO and CANCELLED from position calc)
  const activeStages = stages.filter(
    s =>
      s.defaultTicketStatusV2 !== TicketStatusV2.TODO &&
      s.defaultTicketStatusV2 !== TicketStatusV2.CANCELLED,
  );
  const totalActiveStages = activeStages.length;
  const stageIndexInActive = activeStages.findIndex(s => s.tempId === stage.tempId);

  return (
    <div className='flex items-stretch h-full relative'>
      {/* Plus button before the first card */}
      {index === 0 && (
        <div className='absolute left-0 top-[150px] -translate-y-1/2 -translate-x-1/2 z-20'>
          <Button
            onClick={() => handleAddStageAt(0)}
            data-track-category='board_config'
            data-track-name='add_stage_before_first'
            variant='ghost'
            size='iconSm'
            className='bg-background border border-border rounded-[6px] p-[4px] flex items-center justify-center hover:bg-muted transition-colors shadow-sm h-auto w-auto'
          >
            <Plus size={12} className='text-foreground' />
          </Button>
        </div>
      )}
      {/* Colored Background Column - full width touching adjacent boxes */}
      <div
        className={`${getStatusBgColor(stage.defaultTicketStatusV2)} self-stretch flex items-start justify-center px-10 pt-20 relative`}
      >
        {/* Stage Card - narrower than colored background */}
        <div className='w-[260px] bg-background rounded-[10px] border border-border shadow-[0px_2px_8px_0px_rgba(5,5,6,0.07)] pb-[10px] shrink-0 z-40'>
          {/* Card Header */}
          <div className='flex items-center justify-between px-3 py-2 border-b border-border'>
            {/* Status Dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger
                className='flex items-center gap-[6px] outline-none'
                data-track-category='board_config'
                data-track-name='change_stage_status'
              >
                <span className='text-[13px] font-medium text-muted-foreground'>
                  {statusOption.label}
                </span>
                <ChevronDown size={14} className='text-muted-foreground' />
              </DropdownMenuTrigger>
              <DropdownMenuContent align='start'>
                {STATUS_OPTIONS.map(opt => (
                  <DropdownMenuItem
                    key={opt.status}
                    onSelect={() =>
                      handleUpdateStage(stage.tempId, {
                        defaultTicketStatusV2: opt.status,
                      })
                    }
                    className='flex items-center gap-2'
                  >
                    {opt.icon}
                    <span>{opt.label}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* ETA & Close */}
            <div className='flex items-center gap-2 relative'>
              {/* Set ETA button - always visible here (outer block already guards slaPolicyType !== 'priority') */}
              <Button
                onClick={() => handleStartEditEta(stage)}
                variant='ghost'
                size='sm'
                className='flex items-center gap-[4px] text-[12px] text-foreground hover:text-foreground/80 p-[4px] rounded-[6px] h-auto'
                data-track-category='board_config'
                data-track-name='start_edit_eta'
              >
                <Timer size={12} />
                <span className='font-[450]'>{stage.eta > 0 ? `${stage.eta}h` : 'Set ETA'}</span>
              </Button>

              {/* ETA Input dropdown - appears below when editing */}
              {editingEtaId === stage.tempId && (
                <div className='absolute top-full right-0 mt-2 z-50 bg-background border border-border rounded-[6px] shadow-[0px_2px_6px_0px_rgba(5,5,6,0.07)] pl-[10px] pr-[6px] py-[8px] flex items-center gap-2 min-w-[80px]'>
                  <input
                    ref={etaInputRef}
                    type='text'
                    inputMode='numeric'
                    pattern='[0-9]*'
                    value={etaValue}
                    onChange={e => setEtaValue(e.target.value)}
                    onBlur={() => handleSaveEta(stage.tempId)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') handleSaveEta(stage.tempId);
                      if (e.key === 'Escape') setEditingEtaId(null);
                    }}
                    data-track-category='board_config'
                    data-track-name='edit_eta_input'
                    placeholder='ETA'
                    className='w-10 text-[14px] font-[450] text-foreground bg-transparent border-none focus:outline-none focus:ring-0 p-0 placeholder:text-muted-foreground/50'
                  />
                  <span className='text-[14px] font-[450] text-foreground'>hrs</span>
                </div>
              )}
              <Button
                onClick={() => handleDeleteStage(stage.tempId)}
                variant='ghost'
                size='iconSm'
                className='text-muted-foreground hover:text-muted-foreground/80 shrink-0'
                data-track-category='board_config'
                data-track-name='delete_stage'
              >
                <X size={14} />
              </Button>
            </div>
          </div>

          {/* Card Body */}
          <div className='px-3 py-3'>
            {/* Status Icon + Stage Name */}
            <div className='flex items-center gap-[4px] mb-3'>
              <div className='bg-background h-[26px] flex items-center justify-center px-[6px] py-[4px] rounded-[6px]'>
                <StatusIndicator
                  status={stage.defaultTicketStatusV2}
                  size={16}
                  stageIndex={stageIndexInActive >= 0 ? stageIndexInActive : undefined}
                  totalNonCancelledStages={totalActiveStages > 0 ? totalActiveStages : undefined}
                />
              </div>
              <input
                type='text'
                value={stage.name}
                onChange={e => handleUpdateStage(stage.tempId, { name: e.target.value })}
                data-track-category='board_config'
                data-track-name='edit_stage_name'
                placeholder='Stage name...'
                className='flex-1 text-[12px] font-semibold text-foreground bg-transparent border-none focus:outline-none focus:ring-0 placeholder:text-muted-foreground/50 uppercase tracking-[0.72px] leading-[18px] text-left'
              />
            </div>

            {/* Condition Boxes */}
            {stage.conditions && stage.conditions.length > 0 && (
              <div className='flex flex-col gap-2 mb-3'>
                {stage.conditions.map((condition, condIdx) => (
                  <Button
                    key={condition.id}
                    onClick={() => handleOpenConditionModal(stage.tempId, condition)}
                    variant='ghost'
                    className='w-full bg-background border border-border rounded-[12px] h-auto min-h-[40px] px-2 py-2 flex items-center gap-[6px] hover:bg-muted transition-colors justify-start'
                    data-track-category='board_config'
                    data-track-name='edit_condition'
                  >
                    <GitBranch size={14} className='text-muted-foreground flex-shrink-0' />
                    <span className='text-[14px] font-medium text-foreground break-words whitespace-normal text-left leading-[18px]'>
                      {condition.name || `Condition ${condIdx + 1}`}
                    </span>
                  </Button>
                ))}
              </div>
            )}

            {/* Add Condition Link */}
            <Button
              onClick={() => handleOpenConditionModal(stage.tempId)}
              variant='ghost'
              size='sm'
              className='flex items-center gap-[6px] text-[14px] font-medium text-[#6276be] hover:text-[#5060a0] p-[4px] rounded-[6px] h-auto'
              data-track-category='board_config'
              data-track-name='add_condition'
            >
              <GitBranch size={14} className='text-[#6276be]' />
              <span>Add Condition</span>
            </Button>

            {/* ── Transition Form Section (linear boards only; NON_LINEAR uses per-edge forms) ── */}
            {index > 0 && (
              <div className='mt-2 pt-2 border-t border-border'>
                <p className='text-[10px] font-medium text-muted-foreground uppercase tracking-[0.5px] mb-1.5'>
                  Transition Form
                </p>
                {stage.formId ? (
                  <div className='flex items-center justify-between bg-muted/60 rounded-[8px] px-2 py-1.5'>
                    <span
                      className='text-[12px] text-foreground truncate max-w-[140px]'
                      title={formMap.get(stage.formId) || 'Form'}
                    >
                      {formMap.get(stage.formId) || 'Transition Form'}
                    </span>
                    <div className='flex items-center gap-0.5'>
                      <Button
                        onClick={() => void handleOpenEditForm(stage.tempId, stage.formId!)}
                        variant='ghost'
                        size='iconSm'
                        className='text-muted-foreground hover:text-foreground flex-shrink-0 h-5 w-5 p-0.5'
                        data-track-category='board_config'
                        data-track-name='edit_stage_form'
                      >
                        <Pencil size={10} />
                      </Button>
                      <Button
                        onClick={() => handleRemoveStageForm(stage.tempId)}
                        variant='ghost'
                        size='iconSm'
                        className='text-muted-foreground hover:text-red-500 flex-shrink-0'
                        data-track-category='board_config'
                        data-track-name='remove_stage_form'
                      >
                        <X size={12} />
                      </Button>
                    </div>
                  </div>
                ) : (
                  <TransitionFormPicker
                    allForms={stageFormsList}
                    onCreateForm={() => handleOpenDirectForm(stage.tempId)}
                    onSelectForm={formId => handleAttachExistingStageForm(stage.tempId, formId)}
                    variant='dashed-button'
                    triggerLabel='Configure Transition Form'
                  />
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Condition Builder - positioned absolutely to the right */}
      {isConditionModalOpen && selectedStageForCondition === stage.tempId && (
        <div className='absolute left-1/4 top-1/4 -translate-y-[250px] ml-[16px] z-50'>
          <ConditionBuilder
            isOpen={true}
            onClose={handleCloseConditionModal}
            onSave={handleSaveCondition}
            onDelete={editingCondition ? handleDeleteCondition : undefined}
            condition={editingCondition}
            onOpenCreateForm={handleOpenCreateForm}
            nextStageName={stages[index + 1]?.name}
            allStages={stages.map(s => ({
              name: s.name,
              sequenceNumber: s.sequenceNumber,
              ...(s.formId && { formId: s.formId }),
            }))}
          />
        </div>
      )}

      {/* Connector line before the first card — stops at the leading + */}
      {index === 0 && (
        <div className='absolute left-0 top-[150px] -translate-y-1/2 z-10 w-[40px] h-[2px] bg-muted-foreground' />
      )}

      {/* Connector line after the card — 40px stub on the last, full 80px between */}
      {index === stages.length - 1 ? (
        <div className='absolute right-0 top-[150px] -translate-y-1/2 z-10 w-[40px] h-[2px] bg-muted-foreground' />
      ) : (
        <div className='absolute right-0 top-[150px] -translate-y-1/2 translate-x-1/2 z-10 w-[80px] h-[2px] bg-muted-foreground' />
      )}

      {/* Add-stage button, after every card */}
      <div className='absolute right-0 top-[150px] -translate-y-1/2 translate-x-1/2 z-20'>
        <Button
          onClick={() => handleAddStageAt(index + 1)}
          data-track-category='board_config'
          data-track-name='add_stage_between'
          variant='ghost'
          size='iconSm'
          className='bg-background border border-border rounded-[6px] p-[4px] flex items-center justify-center hover:bg-muted transition-colors shadow-sm h-auto w-auto'
        >
          <Plus size={12} className='text-foreground' />
        </Button>
      </div>
    </div>
  );
};

// ─── Main component ───────────────────────────────────────────────────────────
const BoardStageConfigScreen = ({
  boardId,
  projectId,
  isOpen,
  onClose,
  onSave,
  onNext,
  onBack,
  initialBoard,
}: BoardStageConfigScreenProps): ReactElement | null => {
  const zero = useZero();
  const { confirm, ConfirmDialog } = useConfirmDialog();

  // ── Data fetching ──────────────────────────────────────────────────────────
  // initialBoard may only replace the query when it actually carries stage
  // data. A partial object (e.g. { id, name }) must not suppress the fetch:
  // boards can already have stages here (release boards are created with
  // seeded stages), and rendering the default template over them destroys the
  // real stages on the next save.
  const initialBoardHasStages =
    !!initialBoard && typeof initialBoard === 'object' && 'stages' in initialBoard;

  // Fetch only the specific board with full details (stages, prStatusMappings, etc.)
  const [boardFromQuery] = useCachedQuery(queries.boardFullDetailById({ boardId: boardId || '' }), {
    enabled: !!boardId && !initialBoardHasStages,
  });

  // Use initialBoard if it has full data (for newly created boards), otherwise use query result
  const board = useMemo(() => {
    if (initialBoardHasStages) return initialBoard;
    return boardFromQuery;
  }, [initialBoardHasStages, initialBoard, boardFromQuery]);

  const [project] = useCachedQuery(queries.projectById({ projectId: projectId || '' }), {
    enabled: !!projectId,
  });

  // Extract stages from board (same approach as BoardForm)
  const boardStages = useMemo(() => {
    if (!board || typeof board !== 'object') return [];
    const boardObj = board as { stages?: unknown };
    if (!boardObj.stages || !Array.isArray(boardObj.stages)) return [];
    return boardObj.stages as readonly {
      readonly id: string;
      readonly name: string;
      readonly eta: number;
      readonly sequenceNumber: number;
      readonly defaultTicketStatusV2: TicketStatusV2;
      readonly requestApprovalOnEntry?: boolean | null;
      readonly prStatusMappings?: readonly {
        readonly id: string;
        readonly stageId: string;
        readonly prStatus: PRStatusEvent;
        readonly createdAt: number;
      }[];
      readonly approvers?: readonly {
        readonly id: string;
        readonly userId: string | null;
        readonly roleId: string | null;
        readonly approverType: ApproverType | null;
        readonly stageId: string;
      }[];
      readonly formContextMappings?: readonly {
        readonly id: string;
        readonly formId: string;
        readonly contextId: string;
        readonly contextType: string;
        readonly form?: {
          readonly id: string;
          readonly formName?: string | null;
        } | null;
      }[];
    }[];
  }, [board]);

  // Fetch forms list (lightweight - only scalar fields for name lookup)
  const [allForms] = useCachedQuery(queries.getAllFormsList());
  const formMap = useMemo(() => {
    const map = new Map(allForms?.map(f => [f.id, f.formName]) || []);
    boardStages.forEach(stage => {
      stage.formContextMappings?.forEach(mapping => {
        if (mapping.formId && mapping.form?.formName) {
          map.set(mapping.formId, mapping.form.formName);
        }
      });
    });
    return map;
  }, [allForms, boardStages]);
  const stageFormsList = useMemo(
    () =>
      (allForms ?? [])
        .filter(f => f.contextType === FormContextType.STAGE)
        .map(f => ({ id: f.id, formName: f.formName })),
    [allForms],
  );

  const buildStageFormRequest = useCallback(
    (formData: { formName: string; formDescription: string; fields: FormField[] }) => ({
      formName: formData.formName,
      formDescription: formData.formDescription,
      contextType: FormContextType.STAGE,
      entityType: FormEntityType.TICKET,
      projectId,
      boardId,
      fields: mapFormFieldsToApiPayload(formData.fields),
    }),
    [boardId, projectId],
  );

  // Track if we've initialized stages to prevent re-syncing
  const hasInitializedStages = useRef(false);

  // ── Condition Modal State ────────────────────────────────────────────────────
  const [isConditionModalOpen, setIsConditionModalOpen] = useState(false);
  const [selectedStageForCondition, setSelectedStageForCondition] = useState<number | null>(null);
  const [editingCondition, setEditingCondition] = useState<StageCondition | null>(null);
  const [conditionDeleteDialog, setConditionDeleteDialog] =
    useState<ConditionDeleteDialogState | null>(null);
  const [isCheckingConditionDelete, setIsCheckingConditionDelete] = useState(false);

  // ── Create Form Panel State ──────────────────────────────────────────────────
  const [isCreateFormOpen, setIsCreateFormOpen] = useState(false);
  const [pendingFormCondition, setPendingFormCondition] = useState<StageCondition | null>(null);

  // ── Edge Condition State (NON_LINEAR boards only) ────────────────────────────
  const [isEdgeConditionModalOpen, setIsEdgeConditionModalOpen] = useState(false);
  const [selectedEdgeForCondition, setSelectedEdgeForCondition] = useState<{
    fromTempId: number;
    toTempId: number;
  } | null>(null);
  const [isEdgeCreateFormOpen, setIsEdgeCreateFormOpen] = useState(false);
  const [_pendingEdgeFormCondition, setPendingEdgeFormCondition] = useState<StageCondition | null>(
    null,
  );

  // ── Direct Transition Form State (per-stage, no ConditionBuilder needed) ────
  const [isDirectFormOpen, setIsDirectFormOpen] = useState(false);
  const [selectedStageForDirectForm, setSelectedStageForDirectForm] = useState<number | null>(null);

  // ── Edit Form State ──────────────────────────────────────────────────────────
  const [isEditFormOpen, setIsEditFormOpen] = useState(false);
  const [editingFormId, setEditingFormId] = useState<string | null>(null);
  const [editingFormData, setEditingFormData] = useState<{
    formName: string;
    formDescription: string;
    fields: FormField[];
  } | null>(null);
  const [selectedStageForEditForm, setSelectedStageForEditForm] = useState<number | null>(null);

  // ── Board Config Dropdown State ─────────────────────────────────────────────
  const [fullRoleAssignment, setFullRoleAssignment] = useState(false);

  // ── SLA Policy Type Toggle ───────────────────────────────────────────────────
  // 'stages' (default): SLA deadlines derive from per-stage ETAs.
  // 'priority': SLA deadlines derive from board_sla_policies (per-priority config).
  // Typed as the non-nullable union so comparisons against 'priority' are unambiguous.
  const [slaPolicyType, setSlaPolicyType] = useState<'stages' | 'priority'>('stages');

  const [showNextStageFormInTicketDetails, setShowNextStageFormInTicketDetails] = useState(false);

  // ── Board Type Toggle ────────────────────────────────────────────────────────
  const [boardType, setBoardType] = useState<BoardType>(BoardType.DEFAULT);
  const isNonLinearToggleBlocked =
    boardType !== BoardType.NON_LINEAR && showNextStageFormInTicketDetails;

  const showNonLinearPrefillableUnsupportedToast = useCallback(() => {
    toast.error('Non-linear boards do not support prefillable forms', {
      description: 'Turn off prefillable forms before enabling non-linear board.',
      duration: 5000,
    });
  }, []);

  const handleBoardTypeToggle = useCallback(() => {
    if (isNonLinearToggleBlocked) {
      showNonLinearPrefillableUnsupportedToast();
      return;
    }

    setBoardType(current =>
      current === BoardType.NON_LINEAR ? BoardType.DEFAULT : BoardType.NON_LINEAR,
    );
  }, [isNonLinearToggleBlocked, showNonLinearPrefillableUnsupportedToast]);

  // ── Edge form state (non-linear boards) ─────────────────────────────────────
  // Which edge has a form being created/edited
  const [edgeFormTarget, setEdgeFormTarget] = useState<{
    fromTempId: number;
    toTempId: number;
  } | null>(null);
  const [edgeFormAllPairs, setEdgeFormAllPairs] = useState<Array<{
    fromTempId: number;
    toTempId: number;
  }> | null>(null);
  const [isEdgeFormOpen, setIsEdgeFormOpen] = useState(false);
  const [edgeEditFormId, setEdgeEditFormId] = useState<string | null>(null);
  const [edgeEditFormData, setEdgeEditFormData] = useState<{
    formName: string;
    formDescription: string;
    fields: FormField[];
  } | null>(null);

  // ── Stage Transitions (non-linear boards) ────────────────────────────────────
  // Map from source stage tempId → Set of target stage tempIds
  const [transitionsByTempId, setTransitionsByTempId] = useState<Map<number, Set<number>>>(
    new Map(),
  );
  const [isTransitionsLoading, setIsTransitionsLoading] = useState(false);
  const [showTransitionsLoadingNotice, setShowTransitionsLoadingNotice] = useState(false);
  const hasLoadedTransitions = useRef(false);

  // ── Transition Metadata (non-linear boards) ─────────────────────────────────
  // Per-edge metadata keyed by "fromTempId->toTempId"
  const [transitionsMeta, setTransitionsMeta] = useState<Map<string, TransitionMeta>>(new Map());

  // ── Local state ─────────────────────────────────────────────────────────────
  // Default stages for new boards (when no stages exist)
  const defaultStages: Stage[] = [
    {
      tempId: 1,
      name: 'BACKLOG',
      eta: 0,
      sequenceNumber: 1,
      defaultTicketStatusV2: TicketStatusV2.TODO,
      prStatuses: [],
      approvers: [],
      conditions: [],
      position: { x: 0, y: 0 },
    },
    {
      tempId: 2,
      name: 'IN PROGRESS',
      eta: 0,
      sequenceNumber: 2,
      defaultTicketStatusV2: TicketStatusV2.STARTED,
      prStatuses: [],
      approvers: [],
      conditions: [],
      position: { x: 0, y: 0 },
    },
    {
      tempId: 3,
      name: 'COMPLETED',
      eta: 0,
      sequenceNumber: 3,
      defaultTicketStatusV2: TicketStatusV2.COMPLETED,
      prStatuses: [],
      approvers: [],
      conditions: [],
      position: { x: 0, y: 0 },
    },
    {
      tempId: 4,
      name: 'NOT REQUIRED',
      eta: 0,
      sequenceNumber: 4,
      defaultTicketStatusV2: TicketStatusV2.CANCELLED,
      prStatuses: [],
      approvers: [],
      conditions: [],
      position: { x: 0, y: 0 },
    },
  ];

  const [stages, setStages] = useState<Stage[]>(defaultStages);

  const [nextTempId, setNextTempId] = useState(5);
  const [editingEtaId, setEditingEtaId] = useState<number | null>(null);
  const [etaValue, setEtaValue] = useState('');
  const etaInputRef = useRef<HTMLInputElement>(null);

  const getConditionTargetStage = useCallback(
    (condition: StageCondition): Stage | undefined => {
      if (condition.thenField === 'form') {
        const targetStageName = condition.whenValue;
        const formId = condition.thenValue;
        return stages.find(stage => stage.name === targetStageName || stage.formId === formId);
      }

      if (condition.whenField === 'pr_status' && condition.thenField === 'status') {
        return stages.find(stage => stage.name === condition.thenValue);
      }

      if (condition.thenField === 'approver') {
        if (condition.whenField === 'status') {
          return stages.find(stage => stage.name === condition.whenValue);
        }
        if (condition.whenField === 'form') {
          return stages.find(stage => stage.formId === condition.whenValue);
        }
      }

      return undefined;
    },
    [stages],
  );

  // Reset initialization flag when board ID changes
  useEffect(() => {
    if (boardId) {
      hasInitializedStages.current = false;
    }
  }, [boardId]);

  // ── Load transfer setting from board metadata ───────────────────────────────
  useEffect(() => {
    if (board && typeof board === 'object' && 'metadata' in board) {
      const metadata = board.metadata as Record<string, unknown>;
      const loadedBoardType =
        'boardType' in board
          ? ((board as { boardType?: BoardType }).boardType ?? BoardType.DEFAULT)
          : BoardType.DEFAULT;
      if (metadata?.['fullRoleAssignment'] !== undefined) {
        setFullRoleAssignment(Boolean(metadata['fullRoleAssignment']));
      }
      if (metadata?.['slaPolicyType'] === 'priority') {
        setSlaPolicyType('priority');
      } else {
        setSlaPolicyType('stages');
      }
      setShowNextStageFormInTicketDetails(
        loadedBoardType !== BoardType.NON_LINEAR &&
          Boolean(metadata?.['showNextStageFormInTicketDetails']),
      );
      setBoardType(loadedBoardType);
    }
  }, [board]);

  // Reset initialization flags when modal closes so the next open reloads from DB.
  useEffect(() => {
    if (!isOpen) {
      hasInitializedStages.current = false;
      hasLoadedTransitions.current = false;
    }
  }, [isOpen]);

  // ── Load stage transitions for all board types ─────────────────────────────
  const applyLoadedTransitions = useCallback(
    (
      transitions: Array<{
        id: string;
        fromStageId: string | null;
        toStageId: string;
        formId: string | null;
        requiresApproval: boolean | null;
        requestApprovalOnEntry?: boolean | null;
        visitSlaMode: VisitSlaMode | null;
        fixedEtaHours: number | null;
        onReenter: ReenterMode | null;
        transitionApprovers?: readonly {
          approverType?: ApproverType | null;
          userId: string | null;
          roleId: string | null;
        }[];
      }>,
      stageSnapshot: Stage[],
    ) => {
      const map = new Map<number, Set<number>>();
      const metaMap = new Map<string, TransitionMeta>();
      for (const t of transitions) {
        const fromStage = stageSnapshot.find(s => s.id === t.fromStageId);
        const toStage = stageSnapshot.find(s => s.id === t.toStageId);
        if (fromStage && toStage) {
          if (!map.has(fromStage.tempId)) {
            map.set(fromStage.tempId, new Set());
          }
          map.get(fromStage.tempId)!.add(toStage.tempId);

          metaMap.set(`${fromStage.tempId}->${toStage.tempId}`, {
            id: t.id,
            formId: t.formId,
            requiresApproval: t.requiresApproval ?? false,
            requestApprovalOnEntry: t.requestApprovalOnEntry ?? false,
            approvers: (t.transitionApprovers ?? [])
              .map(
                (a: {
                  approverType?: string | null;
                  userId: string | null;
                  roleId: string | null;
                }) => {
                  const type = a.approverType ?? ApproverType.USER;
                  if (type === 'ROLE') {
                    return a.roleId
                      ? { approverId: a.roleId, approverType: ApproverType.ROLE as const }
                      : null;
                  }
                  return a.userId
                    ? { approverId: a.userId, approverType: ApproverType.USER as const }
                    : null;
                },
              )
              .filter((x): x is { approverId: string; approverType: ApproverType } => x !== null),
            visitSlaMode: t.visitSlaMode ?? VisitSlaMode.STAGE_DEFAULT,
            fixedEtaHours: t.fixedEtaHours,
            onReenter: t.onReenter ?? ReenterMode.RESET,
          });
        }
      }
      setTransitionsByTempId(map);
      setTransitionsMeta(metaMap);
    },
    [],
  );

  const reloadTransitionsFromServer = useCallback(async (): Promise<boolean> => {
    if (!boardId || !stages.some(s => s.id)) {
      return false;
    }

    setIsTransitionsLoading(true);
    try {
      const transitions = await zero.run(queries.getStageTransitionsByBoardId({ boardId }), {
        type: 'complete',
      });
      applyLoadedTransitions(transitions, stages);
      return true;
    } catch (err) {
      logger.error(LogEvent.FRONTEND_ERROR, {
        type: 'migrated_console_error',
        message: String('Failed to load stage transitions:'),
        error: err,
      });
      return false;
    } finally {
      setIsTransitionsLoading(false);
    }
  }, [applyLoadedTransitions, boardId, stages, zero]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    if (hasLoadedTransitions.current) return;
    if (!boardId) return;
    if (!stages.some(s => s.id)) return;

    hasLoadedTransitions.current = true;
    void reloadTransitionsFromServer();
  }, [isOpen, boardId, stages, reloadTransitionsFromServer]);

  // ── Load stages from board (same approach as BoardForm) ─────────────────────
  useEffect(() => {
    // Only load once, and only when boardStages data is available
    if (hasInitializedStages.current) {
      return;
    }
    if (boardStages === undefined || boardStages.length === 0) {
      // Still loading or no stages yet - check if board is loaded but has no stages
      const boardStagesArr =
        board && typeof board === 'object' && 'stages' in board
          ? (board as { stages?: unknown }).stages
          : undefined;
      if (
        board &&
        (!boardStagesArr || (Array.isArray(boardStagesArr) && boardStagesArr.length === 0))
      ) {
        // Board is loaded but has no stages - use defaults
        hasInitializedStages.current = true;
      }
      return;
    }

    // If we have stages from the database, use them
    hasInitializedStages.current = true;

    const loadedStages: Stage[] = boardStages.map((s, idx) => {
      // Extract PR statuses from prStatusMappings
      const prStatuses = s.prStatusMappings?.map(m => m.prStatus) || [];

      // Convert prStatuses and formId into conditions for display
      const conditions: StageCondition[] = [];

      // Create conditions for PR Status mappings
      // Each PR status on this stage means: "When PR status is X, move ticket to this stage"
      prStatuses.forEach(prStatus => {
        conditions.push({
          id: `pr-${s.id}-${prStatus}`,
          name: `PR Status - ${prStatus}`,
          whenField: 'pr_status',
          whenCondition: 'is',
          whenValue: prStatus,
          thenField: 'status',
          thenCondition: 'set_to',
          thenValue: s.name,
        });
      });

      // Note: Form conditions will be added to PREVIOUS stage below

      return {
        id: s.id,
        tempId: idx + 1,
        name: s.name,
        eta: s.eta || 0,
        sequenceNumber: s.sequenceNumber,
        defaultTicketStatusV2: s.defaultTicketStatusV2 || TicketStatusV2.TODO,
        prStatuses,
        approvers: (s.approvers ?? [])
          .map(a => {
            const type = a.approverType ?? ApproverType.USER;
            if (type === ApproverType.ROLE) {
              return a.roleId
                ? { approverId: a.roleId, approverType: ApproverType.ROLE as const }
                : null;
            }
            return a.userId
              ? { approverId: a.userId, approverType: ApproverType.USER as const }
              : null;
          })
          .filter((x): x is ApproverEntry => x !== null),
        formId: s.formContextMappings?.[0]?.formId || '',
        requestApprovalOnEntry: s.requestApprovalOnEntry ?? false,
        conditions,
        position: { x: 0, y: 0 },
      };
    });

    // Add form conditions to PREVIOUS stage (for UI display)
    loadedStages.forEach((stage, idx) => {
      if (stage.formId && idx > 0) {
        const prevStage = loadedStages[idx - 1];
        if (prevStage) {
          const formName = formMap.get(stage.formId) || 'Form';
          prevStage.conditions.push({
            id: `form-${stage.id}`,
            name: `Form - ${formName}`,
            whenField: 'status',
            whenCondition: 'changes_to',
            whenValue: stage.name, // Next stage name
            thenField: 'form',
            thenCondition: 'is_triggered',
            thenValue: stage.formId,
          });
        }
      }

      // Add approver conditions to PREVIOUS stage (for UI display)
      // If this stage has approvers, show condition on previous stage
      if (stage.approvers.length > 0 && idx > 0) {
        const prevStage = loadedStages[idx - 1];
        if (prevStage) {
          prevStage.conditions.push({
            id: `approver-${stage.id}`,
            name: `Approvers on ${stage.name}`,
            whenField: 'status',
            whenCondition: 'changes_to',
            whenValue: stage.name, // Next stage name
            thenField: 'approver',
            thenCondition: 'is_needed',
            thenValue: '',
            approvers: stage.approvers,
            requestApprovalOnEntry: stage.requestApprovalOnEntry ?? false,
          });
        }
      }
    });
    setStages(loadedStages);
    setNextTempId(loadedStages.length + 1);
  }, [board, boardStages, formMap]);

  // ── Handlers ───────────────────────────────────────────────────────────────
  const handleAddStageAt = useCallback(
    (insertIndex: number) => {
      // Get the previous stage's status, or default to TODO if adding at the beginning
      const previousStage = stages[insertIndex - 1];
      const defaultStatus = previousStage?.defaultTicketStatusV2 ?? TicketStatusV2.TODO;
      // The server replaces this provisional tail value with an allocation
      // from the common sequence. Keeping it above the current table maximum
      // avoids filling a deleted sequence gap in the optimistic state.
      const provisionalSequenceNumber =
        stages.reduce((max, stage) => Math.max(max, stage.sequenceNumber), 0) + 1;

      const newStage: Stage = {
        tempId: nextTempId,
        name: '',
        eta: 0,
        sequenceNumber: provisionalSequenceNumber,
        defaultTicketStatusV2: defaultStatus,
        prStatuses: [],
        approvers: [],
        conditions: [],
        position: { x: 0, y: 0 },
      };

      setStages(prev => {
        const newStages = [...prev];
        newStages.splice(insertIndex, 0, newStage);
        // Reuse only the existing sequence slots and the provisional new tail
        // slot. This shifts stages into the requested order without compacting
        // gaps; the server performs the same shift with the common allocation.
        const sequencePool = newStages
          .map(stage => stage.sequenceNumber)
          .sort((left, right) => left - right);
        return newStages.map((stage, index) => ({
          ...stage,
          sequenceNumber: sequencePool[index]!,
        }));
      });
      setNextTempId(id => id + 1);
    },
    [nextTempId, stages],
  );

  const handleDeleteStage = useCallback((tempId: number) => {
    // Preserve every remaining sequence number. Deleted values stay as gaps,
    // and the common counter is not changed.
    setStages(prev => prev.filter(stage => stage.tempId !== tempId));
  }, []);

  const handleUpdateStage = useCallback((tempId: number, updates: Partial<Stage>) => {
    setStages(prev => prev.map(s => (s.tempId === tempId ? { ...s, ...updates } : s)));
  }, []);

  // ── Transition Helpers (non-linear boards) ───────────────────────────────────
  const toggleTransition = useCallback((fromTempId: number, toTempId: number, enabled: boolean) => {
    setTransitionsByTempId(prev => {
      const newMap = new Map(prev);
      const targets = new Set(newMap.get(fromTempId) || []);
      if (enabled) {
        targets.add(toTempId);
      } else {
        targets.delete(toTempId);
      }
      if (targets.size === 0) {
        newMap.delete(fromTempId);
      } else {
        newMap.set(fromTempId, targets);
      }
      return newMap;
    });

    // When removing an edge, also remove its metadata
    if (!enabled) {
      setTransitionsMeta(prev => {
        const next = new Map(prev);
        next.delete(`${fromTempId}->${toTempId}`);
        return next;
      });
    }
  }, []);

  const updateTransitionMeta = useCallback(
    (fromTempId: number, toTempId: number, meta: Partial<TransitionMeta>) => {
      setTransitionsMeta(prev => {
        const key = `${fromTempId}->${toTempId}`;
        const existing = prev.get(key);
        const newMeta: TransitionMeta = {
          requiresApproval: false,
          approvers: [],
          visitSlaMode: VisitSlaMode.STAGE_DEFAULT,
          onReenter: ReenterMode.RESET,
          ...existing,
          ...meta,
        };
        const next = new Map(prev);
        next.set(key, newMeta);
        return next;
      });
    },
    [],
  );

  const handleStartEditEta = useCallback((stage: Stage) => {
    setEditingEtaId(stage.tempId);
    setEtaValue(stage.eta > 0 ? String(stage.eta) : '');
  }, []);

  // Auto-focus ETA input when editing starts
  useEffect(() => {
    if (editingEtaId !== null && etaInputRef.current) {
      etaInputRef.current.focus();
      etaInputRef.current.select();
    }
  }, [editingEtaId]);

  const handleSaveEta = useCallback(
    (tempId: number) => {
      const eta = parseInt(etaValue) || 0;
      handleUpdateStage(tempId, { eta });
      setEditingEtaId(null);
      setEtaValue('');
    },
    [etaValue, handleUpdateStage],
  );

  // ── Condition Modal Handlers ───────────────────────────────────────────────
  const handleOpenConditionModal = useCallback(
    (stageTempId: number, condition?: StageCondition) => {
      setSelectedStageForCondition(stageTempId);
      setEditingCondition(condition || null);
      setIsConditionModalOpen(true);
    },
    [],
  );

  const handleCloseConditionModal = useCallback(() => {
    setIsConditionModalOpen(false);
    setSelectedStageForCondition(null);
    setEditingCondition(null);
  }, []);

  const handleSaveCondition = useCallback(
    (condition: StageCondition) => {
      if (selectedStageForCondition === null) return;

      setStages(prev => {
        return prev.map(stage => {
          // Add/update the condition on the current stage where modal was opened
          if (stage.tempId === selectedStageForCondition) {
            const existingConditions = stage.conditions || [];
            const conditionIndex = existingConditions.findIndex(c => c.id === condition.id);

            let newConditions: StageCondition[];
            if (conditionIndex >= 0) {
              // Update existing condition
              newConditions = existingConditions.map((c, idx) =>
                idx === conditionIndex ? condition : c,
              );
            } else {
              // Add new condition
              newConditions = [...existingConditions, condition];
            }

            // Update the stage with new conditions
            let updatedStage = { ...stage, conditions: newConditions };

            // Case 1: PR Status → Stage (WHEN pr_status IS xxx THEN status SET TO stageName)
            // Store prStatus on the target stage
            if (condition.whenField === 'pr_status' && condition.thenField === 'status') {
              const prStatus = condition.whenValue as PRStatusEvent;
              const targetStageName = condition.thenValue;

              // If this stage is the target, add the prStatus
              if (stage.name === targetStageName) {
                const currentPrStatuses = stage.prStatuses || [];
                if (!currentPrStatuses.includes(prStatus)) {
                  updatedStage = { ...updatedStage, prStatuses: [...currentPrStatuses, prStatus] };
                }
              }
            }

            return updatedStage;
          }

          // Case 2: Form trigger - store formId on the NEXT stage
          if (condition.whenField === 'status' && condition.thenField === 'form') {
            const nextStageName = condition.whenValue; // This is the next stage
            const formIdToStore = condition.thenValue;

            // If this stage is the next stage, store the formId
            if (stage.name === nextStageName) {
              return { ...stage, formId: formIdToStore };
            }
          }

          // Case 3: Approver - store approvers on the NEXT stage
          // Handles both status-based and form-based approvers
          if (condition.thenField === 'approver' && condition.approvers) {
            let nextStageName: string | undefined;

            if (condition.whenField === 'status') {
              // Status → Approver: whenValue is next stage name
              nextStageName = condition.whenValue;
            } else if (condition.whenField === 'form') {
              // Form → Approver: whenValue is formId, need to find stage with this formId
              const formId = condition.whenValue;
              // Find the stage that has this form assigned
              const targetStage = prev.find(s => s.formId === formId);
              nextStageName = targetStage?.name;
            }

            // If this stage is the next stage, store the full mixed approvers
            if (nextStageName && stage.name === nextStageName) {
              return {
                ...stage,
                approvers: condition.approvers,
                requestApprovalOnEntry: condition.requestApprovalOnEntry ?? false,
              };
            }
          }

          // For PR Status case, update the target stage if needed
          if (condition.whenField === 'pr_status' && condition.thenField === 'status') {
            const prStatus = condition.whenValue as PRStatusEvent;
            const targetStageName = condition.thenValue;

            if (stage.name === targetStageName) {
              const currentPrStatuses = stage.prStatuses || [];
              if (!currentPrStatuses.includes(prStatus)) {
                return { ...stage, prStatuses: [...currentPrStatuses, prStatus] };
              }
            }
          }

          return stage;
        });
      });
    },
    [selectedStageForCondition],
  );

  const deleteConditionFromStages = useCallback((conditionId: string) => {
    setStages(prev => {
      let conditionToDelete: StageCondition | undefined;

      for (const stage of prev) {
        conditionToDelete = stage.conditions.find(c => c.id === conditionId);
        if (conditionToDelete) break;
      }

      if (!conditionToDelete) return prev;

      return prev.map(stage => {
        if (stage.conditions.some(c => c.id === conditionId)) {
          stage = {
            ...stage,
            conditions: stage.conditions.filter(c => c.id !== conditionId),
          };
        }

        if (conditionToDelete.whenField === 'status' && conditionToDelete.thenField === 'form') {
          const nextStageName = conditionToDelete.whenValue;
          const formId = conditionToDelete.thenValue;
          if (stage.name === nextStageName || stage.formId === formId) {
            const { formId: _, ...restStage } = stage;
            stage = restStage;
          }
        }

        if (
          conditionToDelete.whenField === 'pr_status' &&
          conditionToDelete.thenField === 'status'
        ) {
          const targetStageName = conditionToDelete.thenValue;
          const prStatus = conditionToDelete.whenValue;
          if (stage.name === targetStageName && stage.prStatuses) {
            stage = {
              ...stage,
              prStatuses: stage.prStatuses.filter(ps => ps !== prStatus),
            };
          }
        }

        if (conditionToDelete.thenField === 'approver') {
          const nextStageName =
            conditionToDelete.whenField === 'status' ? conditionToDelete.whenValue : undefined;
          const formId =
            conditionToDelete.whenField === 'form' ? conditionToDelete.whenValue : undefined;
          if (
            (nextStageName && stage.name === nextStageName) ||
            (formId && stage.formId === formId)
          ) {
            stage = {
              ...stage,
              approvers: [],
            };
          }
        }

        return stage;
      });
    });
  }, []);

  const handleDeleteCondition = useCallback(
    (conditionId: string) => {
      const conditionToDelete = stages
        .flatMap(stage => stage.conditions)
        .find(condition => condition.id === conditionId);

      if (!conditionToDelete) return;

      const targetStage = getConditionTargetStage(conditionToDelete);
      setConditionDeleteDialog({
        kind: 'confirm',
        conditionId,
        conditionName: conditionToDelete.name || 'this condition',
        openRequestCount: 0,
        ...(targetStage?.name && { targetStageName: targetStage.name }),
      });
    },
    [getConditionTargetStage, stages],
  );

  const handleConfirmDeleteCondition = useCallback(() => {
    if (!conditionDeleteDialog || conditionDeleteDialog.kind !== 'confirm') return;

    const conditionToDelete = stages
      .flatMap(stage => stage.conditions)
      .find(condition => condition.id === conditionDeleteDialog.conditionId);

    if (!conditionToDelete) {
      setConditionDeleteDialog(null);
      return;
    }

    const targetStage = getConditionTargetStage(conditionToDelete);
    if (!targetStage?.id) {
      deleteConditionFromStages(conditionDeleteDialog.conditionId);
      setConditionDeleteDialog(null);
      return;
    }

    setIsCheckingConditionDelete(true);
    void zero
      .run(queries.getOpenTicketStageRequestsByStageId({ stageId: targetStage.id }), {
        type: 'complete',
      })
      .then(openRequests => {
        const openRequestCount = Array.isArray(openRequests) ? openRequests.length : 0;
        if (openRequestCount > 0) {
          setConditionDeleteDialog({
            kind: 'blocked',
            conditionId: conditionDeleteDialog.conditionId,
            conditionName: conditionDeleteDialog.conditionName,
            openRequestCount,
            ...(targetStage.name && { targetStageName: targetStage.name }),
          });
          return;
        }

        deleteConditionFromStages(conditionDeleteDialog.conditionId);
        setConditionDeleteDialog(null);
      })
      .catch(error => {
        logger.error(LogEvent.FRONTEND_ERROR, {
          type: 'migrated_console_error',
          message: String('Failed to check pending stage requests:'),
          error: error,
        });
        toast.error('Could not check pending approvals', {
          description: 'Please try again before deleting this condition.',
        });
      })
      .finally(() => setIsCheckingConditionDelete(false));
  }, [conditionDeleteDialog, deleteConditionFromStages, getConditionTargetStage, stages, zero]);

  // ── Create Form Panel Handlers ───────────────────────────────────────────────
  const handleOpenCreateForm = useCallback((condition?: StageCondition) => {
    setIsConditionModalOpen(false);
    setIsCreateFormOpen(true);
    setPendingFormCondition(condition || null);
  }, []);

  const handleCloseCreateForm = useCallback(() => {
    setIsCreateFormOpen(false);
    setPendingFormCondition(null);
  }, []);

  const handleCreateFormSave = useCallback(
    async (formData: { formName: string; formDescription: string; fields: FormField[] }) => {
      if (!boardId) return;

      try {
        const createdForm = await formService.createForm(buildStageFormRequest(formData));

        // Show success message
        toast.success(`Form "${formData.formName}" created successfully`);

        // Close the create form panel
        setIsCreateFormOpen(false);

        // If we were creating this form for a condition, automatically save it
        if (pendingFormCondition && selectedStageForCondition !== null) {
          // Find current stage and next stage
          const currentStageIndex = stages.findIndex(s => s.tempId === selectedStageForCondition);
          const nextStage = currentStageIndex >= 0 ? stages[currentStageIndex + 1] : null;

          if (!nextStage) {
            toast.error('Cannot create form condition - no next stage available');
            setIsCreateFormOpen(false);
            setPendingFormCondition(null);
            return;
          }

          // Ensure all required fields are filled
          const completedCondition: StageCondition = {
            id: pendingFormCondition.id || uuidv4(),
            name: `Form - ${formData.formName}`,
            whenField: pendingFormCondition.whenField || 'status',
            whenCondition: pendingFormCondition.whenCondition || 'changes_to',
            whenValue: pendingFormCondition.whenValue || nextStage.name, // Next stage name
            thenField: 'form',
            thenCondition: 'is_triggered',
            thenValue: createdForm.id,
          };

          // Automatically save the condition
          handleSaveCondition(completedCondition);
          setPendingFormCondition(null);

          // Close the condition modal
          setIsConditionModalOpen(false);
        } else if (selectedStageForCondition !== null) {
          // Otherwise, set formId on the NEXT stage and create condition on current stage
          const currentStageIndex = stages.findIndex(s => s.tempId === selectedStageForCondition);
          const nextStage = currentStageIndex >= 0 ? stages[currentStageIndex + 1] : null;

          if (nextStage) {
            // Set formId on next stage and add condition to current stage for instant UI update
            setStages(prev =>
              prev.map(stage => {
                // Add condition to current stage
                if (stage.tempId === selectedStageForCondition) {
                  const newCondition: StageCondition = {
                    id: `form-${nextStage.tempId}-${createdForm.id}`,
                    name: `Form - ${formData.formName}`,
                    whenField: 'status',
                    whenCondition: 'changes_to',
                    whenValue: nextStage.name,
                    thenField: 'form',
                    thenCondition: 'is_triggered',
                    thenValue: createdForm.id,
                  };
                  return { ...stage, conditions: [...(stage.conditions || []), newCondition] };
                }
                // Set formId on next stage
                if (stage.tempId === nextStage.tempId) {
                  return { ...stage, formId: createdForm.id };
                }
                return stage;
              }),
            );
          } else {
            toast.error('Cannot link form - no next stage available');
          }
          setPendingFormCondition(null);
        }
      } catch (error) {
        toast.error('Failed to create form', {
          description: error instanceof Error ? error.message : 'An unexpected error occurred',
        });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      pendingFormCondition,
      boardId,
      selectedStageForCondition,
      buildStageFormRequest,
      stages,
      handleSaveCondition,
    ],
  );

  // ── Direct Transition Form Handlers ─────────────────────────────────────────

  /** Open the form builder directly for a stage (no ConditionBuilder detour). */
  const handleOpenDirectForm = useCallback((stageTempId: number) => {
    setSelectedStageForDirectForm(stageTempId);
    setIsDirectFormOpen(true);
  }, []);

  const handleCloseDirectForm = useCallback(() => {
    setIsDirectFormOpen(false);
    setSelectedStageForDirectForm(null);
  }, []);

  const handleAttachExistingStageForm = useCallback(
    (stageTempId: number, formId: string) => {
      setStages(prev =>
        prev.map(stage => (stage.tempId === stageTempId ? { ...stage, formId } : stage)),
      );
      toast.success(`Form "${formMap.get(formId) ?? 'Form'}" attached`);
    },
    [formMap],
  );

  // ── Edge Condition Handlers (NON_LINEAR boards) ─────────────────────────────

  const handleAddConditionForEdge = useCallback((from: number, to: number) => {
    setSelectedEdgeForCondition({ fromTempId: from, toTempId: to });
    setIsEdgeConditionModalOpen(true);
  }, []);

  const handleCloseEdgeConditionModal = useCallback(() => {
    setIsEdgeConditionModalOpen(false);
    setSelectedEdgeForCondition(null);
  }, []);

  const handleSaveEdgeCondition = useCallback(
    (condition: StageCondition) => {
      if (!selectedEdgeForCondition) return;
      const { fromTempId, toTempId } = selectedEdgeForCondition;
      if (condition.thenField === 'form') {
        updateTransitionMeta(fromTempId, toTempId, {
          formId: condition.thenValue,
        });
      } else if (condition.thenField === 'approver' && condition.approvers) {
        updateTransitionMeta(fromTempId, toTempId, {
          requiresApproval: true,
          approvers: condition.approvers,
        });
      }
      handleCloseEdgeConditionModal();
    },
    [selectedEdgeForCondition, updateTransitionMeta, handleCloseEdgeConditionModal],
  );

  const handleOpenEdgeCreateForm = useCallback((condition?: StageCondition) => {
    setIsEdgeConditionModalOpen(false);
    setIsEdgeCreateFormOpen(true);
    setPendingEdgeFormCondition(condition || null);
  }, []);

  const handleCloseEdgeCreateForm = useCallback(() => {
    setIsEdgeCreateFormOpen(false);
    setPendingEdgeFormCondition(null);
  }, []);

  const syncStageTransitions = useCallback(
    async (
      stageIdLookup: Record<string, string> = {},
      metaOverrides: Map<string, Partial<TransitionMeta>> = new Map(),
      transitionOverrides?: Map<number, Set<number>>,
    ): Promise<void> => {
      if (!boardId) return;

      const resolvedStageIds: Record<string, string> = { ...stageIdLookup };
      for (const stage of stages) {
        if (stage.id) {
          resolvedStageIds[String(stage.sequenceNumber)] = stage.id;
        }
      }

      const transitionMap = transitionOverrides ?? transitionsByTempId;

      const desiredTransitions: Array<{
        transitionId?: string;
        fromStageId: string | null;
        toStageId: string;
        formId?: string | null;
        requiresApproval?: boolean;
        requestApprovalOnEntry?: boolean;
        approvers?: Array<{ approverId: string; approverType: ApproverType }>;
        visitSlaMode?: string;
        fixedEtaHours?: number | null;
        onReenter?: string;
      }> = [];

      for (const [fromTempId, targetTempIds] of transitionMap.entries()) {
        const fromStage = stages.find(s => s.tempId === fromTempId);
        const fromStageId = fromStage?.id || resolvedStageIds[String(fromStage?.sequenceNumber)];
        if (!fromStageId) continue;

        for (const toTempId of targetTempIds) {
          const toStage = stages.find(s => s.tempId === toTempId);
          const toStageId = toStage?.id || resolvedStageIds[String(toStage?.sequenceNumber)];
          if (!toStageId || toStageId === fromStageId) continue;

          const edgeKey = `${fromTempId}->${toTempId}`;
          const meta = {
            ...transitionsMeta.get(edgeKey),
            ...metaOverrides.get(edgeKey),
          };
          desiredTransitions.push({
            ...(meta.id !== undefined && { transitionId: meta.id }),
            fromStageId,
            toStageId,
            ...(meta.formId !== undefined && { formId: meta.formId }),
            ...(meta.requiresApproval !== undefined && {
              requiresApproval: meta.requiresApproval,
            }),
            ...(meta.requestApprovalOnEntry !== undefined && {
              requestApprovalOnEntry: meta.requestApprovalOnEntry,
            }),
            ...(meta.approvers !== undefined && { approvers: meta.approvers }),
            ...(meta.visitSlaMode !== undefined && { visitSlaMode: meta.visitSlaMode }),
            ...(meta.fixedEtaHours !== undefined && { fixedEtaHours: meta.fixedEtaHours }),
            ...(meta.onReenter !== undefined && { onReenter: meta.onReenter }),
          });
        }
      }

      const invalidApprovalTransitions = desiredTransitions.filter(
        t => t.requiresApproval && !t.approvers?.length,
      );
      if (invalidApprovalTransitions.length > 0) {
        throw new Error(
          'Some transitions require approval but have no approvers assigned. Add approvers before saving.',
        );
      }

      const transitionsWithIds = desiredTransitions.map(t => ({
        id: t.transitionId ?? uuidv4(),
        fromStageId: t.fromStageId ?? null,
        toStageId: t.toStageId,
        ...(t.formId !== undefined && { formId: t.formId }),
        requiresApproval: t.requiresApproval ?? false,
        requestApprovalOnEntry: t.requestApprovalOnEntry ?? false,
        ...(t.visitSlaMode !== undefined && { visitSlaMode: t.visitSlaMode }),
        ...(t.fixedEtaHours !== undefined && { fixedEtaHours: t.fixedEtaHours }),
        ...(t.onReenter !== undefined && { onReenter: t.onReenter }),
        approvers: (t.approvers ?? []).map(entry => ({
          id: uuidv4(),
          approverId: entry.approverId,
          approverType: entry.approverType,
        })),
      }));

      const syncResult = zero.mutate(
        mutators.nonLinear.syncTransitions({
          boardId,
          transitions: transitionsWithIds,
          now: Date.now(),
        }),
      );
      const syncRes = await (
        syncResult as {
          server: Promise<{ type: string; error?: { message: string } } | undefined>;
        }
      ).server;
      if (syncRes?.type === 'error') {
        throw new Error(syncRes.error?.message ?? 'Failed to sync stage transitions');
      }
    },
    [boardId, stages, transitionsByTempId, transitionsMeta, zero],
  );

  const persistEdgeTransitionForm = useCallback(
    async (fromTempId: number, toTempId: number, formId: string): Promise<void> => {
      const edgeKey = `${fromTempId}->${toTempId}`;
      const metaOverride = new Map<string, Partial<TransitionMeta>>([
        [edgeKey, { formId, ...transitionsMeta.get(edgeKey) }],
      ]);

      updateTransitionMeta(fromTempId, toTempId, { formId });
      setTransitionsByTempId(prev => {
        const next = new Map(prev);
        const targets = new Set(next.get(fromTempId) ?? []);
        targets.add(toTempId);
        next.set(fromTempId, targets);
        return next;
      });

      const fromStage = stages.find(s => s.tempId === fromTempId);
      const toStage = stages.find(s => s.tempId === toTempId);
      if (!fromStage?.id || !toStage?.id) {
        toast.info(
          'Form saved. Click Save on the board configuration to link it to this transition.',
        );
        return;
      }

      const edgeTransitions = new Map(transitionsByTempId);
      const targets = new Set(edgeTransitions.get(fromTempId) ?? []);
      targets.add(toTempId);
      edgeTransitions.set(fromTempId, targets);

      await syncStageTransitions({}, metaOverride, edgeTransitions);
      hasLoadedTransitions.current = false;
      await reloadTransitionsFromServer();
    },
    [
      reloadTransitionsFromServer,
      stages,
      syncStageTransitions,
      transitionsByTempId,
      transitionsMeta,
      updateTransitionMeta,
    ],
  );

  const handleEdgeCreateFormSave = useCallback(
    async (formData: { formName: string; formDescription: string; fields: FormField[] }) => {
      if (!boardId || !selectedEdgeForCondition) return;
      try {
        const createdForm = await formService.createForm(buildStageFormRequest(formData));
        toast.success(`Form "${formData.formName}" created successfully`);
        setIsEdgeCreateFormOpen(false);
        setPendingEdgeFormCondition(null);
        const { fromTempId, toTempId } = selectedEdgeForCondition;
        await persistEdgeTransitionForm(fromTempId, toTempId, createdForm.id);
        handleCloseEdgeConditionModal();
      } catch (error) {
        toast.error('Failed to create form', {
          description: error instanceof Error ? error.message : 'An unexpected error occurred',
        });
      }
    },
    [
      boardId,
      selectedEdgeForCondition,
      handleCloseEdgeConditionModal,
      buildStageFormRequest,
      persistEdgeTransitionForm,
    ],
  );

  // ── Edit Form Handlers ───────────────────────────────────────────────────────

  /**
   * Open form editor for an existing form.
   */
  const handleOpenEditForm = useCallback(async (stageTempId: number, formId: string) => {
    try {
      const formDetails = await formService.getFormById(formId);

      setEditingFormId(formId);
      setEditingFormData({
        formName: formDetails.formName,
        formDescription: formDetails.formDescription || '',
        fields: mapFormDetailsToBuilderFields(formDetails),
      });
      setSelectedStageForEditForm(stageTempId);
      setIsEditFormOpen(true);
    } catch (error) {
      toast.error('Failed to load form details', {
        description: error instanceof Error ? error.message : 'An unexpected error occurred',
      });
    }
  }, []);

  const handleCloseEditForm = useCallback(() => {
    setIsEditFormOpen(false);
    setEditingFormId(null);
    setEditingFormData(null);
    setSelectedStageForEditForm(null);
  }, []);

  /**
   * Save updated form and refresh local state.
   */
  const handleEditFormSave = useCallback(
    async (formData: {
      formId: string;
      formName: string;
      formDescription: string;
      fields: FormField[];
    }) => {
      if (!boardId) return;

      try {
        await formService.updateForm({
          formId: formData.formId,
          ...buildStageFormRequest(formData),
        });

        toast.success(`Form "${formData.formName}" updated successfully`);

        setEditingFormId(null);
        setEditingFormData(null);
        setSelectedStageForEditForm(null);
        setIsEditFormOpen(false);
      } catch (error) {
        toast.error('Failed to update form', {
          description: error instanceof Error ? error.message : 'An unexpected error occurred',
        });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [boardId, buildStageFormRequest],
  );

  /**
   * Create a new form and attach it directly to the target stage.
   * The form will appear when a ticket is moved INTO that stage.
   */
  const handleDirectFormSave = useCallback(
    async (formData: { formName: string; formDescription: string; fields: FormField[] }) => {
      if (!boardId || selectedStageForDirectForm === null) return;

      try {
        const createdForm = await formService.createForm(buildStageFormRequest(formData));

        toast.success(`Transition form "${formData.formName}" added`);

        // Attach the form directly to the stage
        setStages(prev =>
          prev.map(stage =>
            stage.tempId === selectedStageForDirectForm
              ? { ...stage, formId: createdForm.id }
              : stage,
          ),
        );

        setIsDirectFormOpen(false);
        setSelectedStageForDirectForm(null);
      } catch (error) {
        toast.error('Failed to create transition form', {
          description: error instanceof Error ? error.message : 'An unexpected error occurred',
        });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [boardId, selectedStageForDirectForm, buildStageFormRequest],
  );

  /** Remove the transition form from a stage. */
  const handleRemoveStageForm = useCallback((stageTempId: number) => {
    setStages(prev =>
      prev.map(stage => {
        if (stage.tempId !== stageTempId) return stage;
        // Remove formId and any form-trigger conditions referencing this stage
        const { formId: _removed, ...rest } = stage;
        return {
          ...rest,
          conditions: (stage.conditions || []).filter(c => c.thenField !== 'form'),
        };
      }),
    );
    // Also clean up any form conditions on OTHER stages that pointed to this stage
    setStages(prev => {
      const targetStage = prev.find(s => s.tempId === stageTempId);
      if (!targetStage) return prev;
      return prev.map(stage => ({
        ...stage,
        conditions: (stage.conditions || []).filter(
          c => !(c.thenField === 'form' && c.whenValue === targetStage.name),
        ),
      }));
    });
  }, []);

  // ── Edge Form Handlers (NON_LINEAR per-edge forms) ───────────────────────────
  const handleOpenEdgeForm = useCallback(
    (
      fromTempId: number,
      toTempId: number,
      existingFormId?: string | null,
      allPairs?: Array<{ fromTempId: number; toTempId: number }>,
    ) => {
      setEdgeFormTarget({ fromTempId, toTempId });
      setEdgeFormAllPairs(allPairs && allPairs.length > 1 ? allPairs : null);
      if (existingFormId) {
        void formService
          .getFormById(existingFormId)
          .then(formDetails => {
            setEdgeEditFormId(existingFormId);
            setEdgeEditFormData({
              formName: formDetails.formName,
              formDescription: formDetails.formDescription || '',
              fields: mapFormDetailsToBuilderFields(formDetails),
            });
            setIsEdgeFormOpen(true);
          })
          .catch(() => toast.error('Failed to load form details'));
      } else {
        setEdgeEditFormId(null);
        setEdgeEditFormData(null);
        setIsEdgeFormOpen(true);
      }
    },
    [],
  );

  const handleAttachExistingEdgeForm = useCallback(
    (
      fromTempId: number,
      toTempId: number,
      formId: string,
      allPairs?: Array<{ fromTempId: number; toTempId: number }>,
    ) => {
      const pairs = allPairs && allPairs.length > 0 ? allPairs : [{ fromTempId, toTempId }];
      const metaOverrides = new Map<string, Partial<TransitionMeta>>();
      pairs.forEach(pair => {
        updateTransitionMeta(pair.fromTempId, pair.toTempId, { formId });
        metaOverrides.set(`${pair.fromTempId}->${pair.toTempId}`, { formId });
      });
      const allSaved = pairs.every(pair => {
        const fromStage = stages.find(s => s.tempId === pair.fromTempId);
        const toStage = stages.find(s => s.tempId === pair.toTempId);
        return !!fromStage?.id && !!toStage?.id;
      });
      if (!allSaved) {
        toast.info(
          'Form saved. Click Save on the board configuration to link it to this transition.',
        );
        return;
      }

      const allEdgeTransitions = new Map(transitionsByTempId);
      pairs.forEach(pair => {
        const targets = new Set(allEdgeTransitions.get(pair.fromTempId) ?? []);
        targets.add(pair.toTempId);
        allEdgeTransitions.set(pair.fromTempId, targets);
      });
      void syncStageTransitions({}, metaOverrides, allEdgeTransitions)
        .then(async () => {
          hasLoadedTransitions.current = false;
          await reloadTransitionsFromServer();
          toast.success(`Form "${formMap.get(formId) ?? 'Form'}" attached`);
        })
        .catch(() => toast.error('Failed to attach form'));
    },
    [
      updateTransitionMeta,
      formMap,
      syncStageTransitions,
      transitionsByTempId,
      reloadTransitionsFromServer,
      stages,
    ],
  );

  const handleCloseEdgeForm = useCallback(() => {
    setIsEdgeFormOpen(false);
    setEdgeFormTarget(null);
    setEdgeFormAllPairs(null);
    setEdgeEditFormId(null);
    setEdgeEditFormData(null);
  }, []);

  const handleEdgeFormSave = useCallback(
    async (formData: { formName: string; formDescription: string; fields: FormField[] }) => {
      if (!boardId || !edgeFormTarget) return;
      try {
        const { fromTempId, toTempId } = edgeFormTarget;
        let formId: string;
        if (edgeEditFormId) {
          await formService.updateForm({
            formId: edgeEditFormId,
            ...buildStageFormRequest(formData),
          });
          formId = edgeEditFormId;
          toast.success(`Form "${formData.formName}" updated`);
        } else {
          const created = await formService.createForm(buildStageFormRequest(formData));
          formId = created.id;
          toast.success(`Form "${formData.formName}" added`);
        }
        const pairs = edgeFormAllPairs ?? [{ fromTempId, toTempId }];
        // One sync for ALL pairs: a per-pair syncStageTransitions loop wipes
        // earlier pairs' formIds (each full-replace reload leaves only the last).
        const metaOverrides = new Map<string, Partial<TransitionMeta>>();
        pairs.forEach(pair => {
          updateTransitionMeta(pair.fromTempId, pair.toTempId, { formId });
          metaOverrides.set(`${pair.fromTempId}->${pair.toTempId}`, { formId });
        });
        const allSaved = pairs.every(pair => {
          const fromStage = stages.find(s => s.tempId === pair.fromTempId);
          const toStage = stages.find(s => s.tempId === pair.toTempId);
          return !!fromStage?.id && !!toStage?.id;
        });
        if (!allSaved) {
          toast.info(
            'Form saved. Click Save on the board configuration to link it to this transition.',
          );
          setIsEdgeFormOpen(false);
          setEdgeFormTarget(null);
          setEdgeFormAllPairs(null);
          setEdgeEditFormId(null);
          setEdgeEditFormData(null);
          return;
        }

        const allEdgeTransitions = new Map(transitionsByTempId);
        pairs.forEach(pair => {
          const targets = new Set(allEdgeTransitions.get(pair.fromTempId) ?? []);
          targets.add(pair.toTempId);
          allEdgeTransitions.set(pair.fromTempId, targets);
        });
        await syncStageTransitions({}, metaOverrides, allEdgeTransitions);
        hasLoadedTransitions.current = false;
        await reloadTransitionsFromServer();
        setIsEdgeFormOpen(false);
        setEdgeFormTarget(null);
        setEdgeFormAllPairs(null);
        setEdgeEditFormId(null);
        setEdgeEditFormData(null);
      } catch (error) {
        toast.error('Failed to save form', {
          description: error instanceof Error ? error.message : undefined,
        });
      }
    },
    [
      boardId,
      edgeFormTarget,
      edgeFormAllPairs,
      edgeEditFormId,
      buildStageFormRequest,
      updateTransitionMeta,
      syncStageTransitions,
      transitionsByTempId,
      reloadTransitionsFromServer,
      stages,
    ],
  );

  // ── Save ───────────────────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    if (!boardId) return;

    if (isTransitionsLoading || (stages.some(s => s.id) && !hasLoadedTransitions.current)) {
      setShowTransitionsLoadingNotice(true);
      return;
    }

    if (
      boardType === BoardType.NON_LINEAR &&
      !Array.from(transitionsByTempId.values()).some(targets => targets.size > 0)
    ) {
      const proceed = await confirm({
        title: 'No transitions configured',
        description:
          'Tickets will not be able to move between stages. Save without any transitions?',
        confirmLabel: 'Save anyway',
        cancelLabel: 'Cancel',
      });
      if (!proceed) return;
    }

    const invalidStages = stages.filter(s => !s.name.trim());
    if (invalidStages.length > 0) {
      toast.error('Please fill in all stage names');
      return;
    }

    try {
      const existingMetadata = getBoardMetadata(board);

      const stageIds: Record<string, string> = {};
      const stagesData = stages.map(stage => {
        const stageId = stage.id || uuidv4();
        stageIds[stage.sequenceNumber] = stageId;
        return {
          id: stageId,
          name: stage.name,
          eta: stage.eta,
          sequenceNumber: stage.sequenceNumber,
          defaultTicketStatusV2: stage.defaultTicketStatusV2,
          prStatuses: (stage.prStatuses || []) as PRStatusEvent[],
          approvers: stage.approvers,
          formId: stage.formId,
          requestApprovalOnEntry: stage.requestApprovalOnEntry ?? false,
        };
      });

      // Generate IDs for PR status mappings
      const prStatusMappingIds = stages.reduce(
        (acc, stage) => {
          stage.prStatuses?.forEach(prStatus => {
            acc[`${stage.sequenceNumber}-${prStatus}`] = uuidv4();
          });
          return acc;
        },
        {} as Record<string, string>,
      );

      // Build stage form mappings
      const stageFormMappings = stages
        .filter(stage => stage.formId)
        .map(stage => ({
          stageId: stageIds[stage.sequenceNumber],
          formId: stage.formId!,
          mappingId: uuidv4(),
        }));

      // Build stage approvers - extract from stages that have approvers
      const stageApprovers = stages
        .filter(stage => stage.approvers && stage.approvers.length > 0)
        .map(stage => ({
          stageId: stageIds[stage.sequenceNumber],
          approvers: stage.approvers,
        }));

      const mutatorArgs = {
        boardId,
        name: getBoardName(board),
        metadata: {
          ...existingMetadata,
          fullRoleAssignment,
          slaPolicyType,
          ...(boardType !== BoardType.NON_LINEAR && { showNextStageFormInTicketDetails }),
        },
        boardType,
        timestamp: Date.now(),
        stageIds,
        stages: stagesData,
        prStatusMappingIds,
        ...(stageFormMappings.length > 0 && { stageFormMappings }),
        ...(stageApprovers.length > 0 && { stageApprovers }),
      };

      const result = zero.mutate(mutators.board.update(mutatorArgs));
      const res = await result.server;

      if (res.type === 'error') {
        toast.error('Failed to update board stages', {
          description: res.error.message || 'You do not have permission to modify this board.',
          duration: 5000,
        });
      } else {
        // Sync stage transitions for all board types
        try {
          await syncStageTransitions(stageIds);
          hasLoadedTransitions.current = false;
          await reloadTransitionsFromServer();
          toast.success('Board stages updated successfully');
          hasInitializedStages.current = false;
          if (onNext) {
            onNext();
          } else {
            onSave?.();
            onClose();
          }
        } catch (transitionErr) {
          logger.error(LogEvent.FRONTEND_ERROR, {
            type: 'migrated_console_error',
            message: String('Stage transition sync failed:'),
            error: transitionErr,
          });
          const errMsg =
            transitionErr instanceof Error ? transitionErr.message : String(transitionErr);
          toast.warning('Board saved, but stage transitions could not be synced', {
            description: `${errMsg}. Please save again to retry transition sync.`,
            duration: 8000,
          });
          return;
        }
      }
    } catch (error) {
      toast.error('Failed to update board stages', {
        description: error instanceof Error ? error.message : 'An unexpected error occurred.',
        duration: 5000,
      });
    }
  }, [
    boardId,
    board,
    stages,
    onSave,
    onNext,
    onClose,
    zero,
    fullRoleAssignment,
    slaPolicyType,
    showNextStageFormInTicketDetails,
    boardType,
    syncStageTransitions,
    reloadTransitionsFromServer,
    isTransitionsLoading,
    transitionsByTempId,
    confirm,
  ]);

  if (!isOpen) return null;

  // ── Loading / error states ─────────────────────────────────────────────────
  const loading = board === undefined || project === undefined;

  if (loading) {
    return (
      <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/50'>
        <div className='bg-background rounded-lg p-8 flex flex-col items-center gap-3'>
          <div className='w-8 h-8 rounded-full border-2 border-xyne-primary-200 border-t-xyne-primary-500 animate-spin' />
          <p className='text-sm text-xyne-gray-500'>Loading board...</p>
        </div>
      </div>
    );
  }

  if (!board || !projectId) {
    return (
      <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/50'>
        <div className='bg-background rounded-lg p-8 text-center'>
          <p className='text-xyne-gray-600 mb-4'>Board not found</p>
          <Button
            onClick={onClose}
            data-track-category='board_config'
            data-track-name='CLOSE_STAGE_CONFIG'
          >
            Close
          </Button>
        </div>
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/50'>
      <div className='bg-background flex flex-col w-[90vw] h-[85vh] rounded-lg shadow-xl overflow-hidden border border-border'>
        {/* ── Header ── */}
        <div className='flex items-center justify-between px-[18px] py-4 flex-shrink-0 border-b border-border'>
          <div className='flex items-center gap-2'>
            <Button
              onClick={() => (onBack ? onBack() : onClose())}
              variant='ghost'
              size='iconSm'
              className='w-[16px] h-[16px] text-foreground hover:opacity-70'
              data-track-category='BOARD_CONFIG'
              data-track-name='NAVIGATE_BACK'
            >
              <ChevronLeft size={16} />
            </Button>
            <span className='text-[16px] font-semibold text-xyne-grey-900'>
              Configure Stages - {getBoardName(board) || 'Board'}
            </span>
          </div>

          <div className='flex items-center gap-3'>
            <Button
              variant='secondary'
              onClick={onClose}
              data-track-category='board_config'
              data-track-name='CANCEL_STAGE_CONFIG'
            >
              Cancel
            </Button>
            <Button
              className='bg-[#6276BE] hover:bg-[#5060A0] text-white'
              onClick={() => void handleSave()}
              data-track-category='board_config'
              data-track-name='SAVE_STAGE_CONFIG'
            >
              {onNext ? 'Next' : 'Finish'}
            </Button>
          </div>
        </div>

        {/* ── Scrollable Content Area ── */}
        <div className='flex-1 overflow-y-auto overflow-x-hidden'>
          {/* ── Title Section ── */}
          <div className='px-6 py-3 flex items-start justify-between'>
            <div>
              <h1 className='text-[18px] font-semibold text-foreground'>Configure Board</h1>
              <p className='text-[14px] text-muted-foreground mt-1 leading-[20px]'>
                Configure the workflow stages for your board. Each card represents a stage in your
                workflow.
              </p>
            </div>
          </div>

          {/* ── Priority-based SLA Toggle ── */}
          <div className='px-6 py-3 border-t border-border'>
            <div className='flex items-center justify-between gap-4'>
              {/* Left: label + context */}
              <div className='flex items-center gap-2 min-w-0'>
                <Clock size={14} className='text-muted-foreground flex-shrink-0' />
                <span className='text-[13px] font-medium text-foreground whitespace-nowrap'>
                  Enable Priority-based SLA
                </span>
                <span className='text-[12px] text-muted-foreground truncate hidden sm:block'>
                  When enabled, ticket deadlines are based on priority policies (Stage ETAs are
                  ignored)
                </span>
              </div>

              {/* Right: toggle switch */}
              <ToggleSwitch
                checked={slaPolicyType === 'priority'}
                onToggle={() =>
                  setSlaPolicyType(slaPolicyType === 'priority' ? 'stages' : 'priority')
                }
                trackName='toggle_priority_sla'
              />
            </div>

            {/* Priority SLA settings panel — appears above stages when enabled */}
            {slaPolicyType === 'priority' && (
              <div className='mt-3 rounded-[10px] border border-border bg-muted/30 px-4 py-3'>
                <SlaSettings boardId={boardId} />
              </div>
            )}
          </div>

          {boardType !== BoardType.NON_LINEAR && (
            <div className='px-6 py-3 border-t border-border'>
              <div className='flex items-center justify-between gap-4'>
                <div className='flex items-center gap-2 min-w-0'>
                  <Pencil size={14} className='text-muted-foreground flex-shrink-0' />
                  <span className='text-[13px] font-medium text-foreground whitespace-nowrap'>
                    Prefillable forms
                  </span>
                  <span className='text-[12px] text-muted-foreground truncate hidden sm:block'>
                    When enabled, tickets can fill the next stage form before moving stages (This
                    will be showed in ticket details page)
                  </span>
                </div>
                <ToggleSwitch
                  checked={showNextStageFormInTicketDetails}
                  onToggle={() => setShowNextStageFormInTicketDetails(value => !value)}
                  trackName='toggle_next_stage_form_ticket_details'
                />
              </div>
            </div>
          )}

          {/* ── Board Type Toggle ── */}
          <div className='px-6 py-3 border-t border-border'>
            <div className='flex items-center justify-between gap-4'>
              <div className='flex items-center gap-2 min-w-0'>
                <GitBranch size={14} className='text-muted-foreground flex-shrink-0' />
                <span className='text-[13px] font-medium text-foreground whitespace-nowrap'>
                  Non-Linear Board
                </span>
                <span className='text-[12px] text-muted-foreground truncate hidden sm:block'>
                  When enabled, ticket stage movements are controlled by explicit transitions
                </span>
              </div>
              <span
                className='inline-flex'
                title={
                  isNonLinearToggleBlocked ? PREFILLABLE_NON_LINEAR_UNSUPPORTED_MESSAGE : undefined
                }
              >
                <ToggleSwitch
                  checked={boardType === BoardType.NON_LINEAR}
                  onToggle={handleBoardTypeToggle}
                  disabled={isNonLinearToggleBlocked}
                  disabledReason={PREFILLABLE_NON_LINEAR_UNSUPPORTED_MESSAGE}
                  onDisabledToggle={showNonLinearPrefillableUnsupportedToast}
                  trackName='toggle_non_linear_board'
                />
              </span>
            </div>
          </div>

          {/* ── Stages Area ── */}
          <div className='px-6 pt-3 pb-6'>
            {/* Transition Editor header */}
            <div className='flex items-center gap-2 mb-2'>
              <span className='text-xs text-muted-foreground font-medium'>
                {boardType === BoardType.NON_LINEAR ? 'Transition Graph' : 'Stage Pipeline'}
              </span>
              {boardType !== BoardType.NON_LINEAR && (
                <span className='text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded border border-border'>
                  Optional — add form requirements to stages
                </span>
              )}
            </div>
            {/* NON_LINEAR: ReactFlow graph editor */}
            {boardType === BoardType.NON_LINEAR && (
              <div className='h-[520px] w-full rounded-[16px] border border-border overflow-hidden'>
                <ReactFlowProvider>
                  <NonLinearTransitionEditor
                    stages={stages}
                    transitionsByTempId={transitionsByTempId}
                    transitionsMeta={transitionsMeta}
                    toggleTransition={toggleTransition}
                    updateTransitionMeta={updateTransitionMeta}
                    onUpdateStage={handleUpdateStage}
                    onDeleteStage={handleDeleteStage}
                    onAddStage={() => handleAddStageAt(stages.length)}
                    formMap={formMap}
                    onOpenEdgeForm={handleOpenEdgeForm}
                    onAttachExistingEdgeForm={handleAttachExistingEdgeForm}
                    stageForms={stageFormsList}
                    onAddConditionForEdge={handleAddConditionForEdge}
                    isTransitionsLoading={isTransitionsLoading}
                    editingEtaId={editingEtaId}
                    etaValue={etaValue}
                    etaInputRef={etaInputRef}
                    onStartEditEta={handleStartEditEta}
                    onSaveEta={handleSaveEta}
                    onCancelEta={() => setEditingEtaId(null)}
                    setEtaValue={setEtaValue}
                  />
                </ReactFlowProvider>
              </div>
            )}
            {/* NON_LINEAR: Edge Condition Builder */}
            {boardType === BoardType.NON_LINEAR && isEdgeConditionModalOpen && (
              <div className='absolute left-1/4 top-1/4 -translate-y-[250px] ml-[16px] z-50'>
                <ConditionBuilder
                  isOpen={true}
                  onClose={handleCloseEdgeConditionModal}
                  onSave={handleSaveEdgeCondition}
                  onOpenCreateForm={handleOpenEdgeCreateForm}
                  nextStageName={
                    selectedEdgeForCondition
                      ? (stages.find(s => s.tempId === selectedEdgeForCondition.toTempId)?.name ??
                        undefined)
                      : undefined
                  }
                  allStages={stages.map(s => ({
                    name: s.name,
                    sequenceNumber: s.sequenceNumber,
                    ...(s.formId && { formId: s.formId }),
                  }))}
                />
              </div>
            )}
            {/* NON_LINEAR: Create Form Slide Out (from edge condition) */}
            {boardType === BoardType.NON_LINEAR && isEdgeCreateFormOpen && (
              <div className='fixed right-16 top-[250px] bottom-20 z-[60]'>
                <CreateFormSlideOut
                  isOpen={true}
                  onClose={handleCloseEdgeCreateForm}
                  onSave={handleEdgeCreateFormSave}
                  projectId={projectId}
                />
              </div>
            )}
            {/* LINEAR: existing pipeline view */}
            {boardType !== BoardType.NON_LINEAR && (
              <div className='h-[500px] min-h-[500px] w-full rounded-[16px] bg-muted/50 overflow-x-auto overflow-y-auto'>
                {/* Stage Cards Row - centered when few, scrollable when many */}
                <div className='h-full flex items-stretch justify-center min-w-max px-8 relative'>
                  {/* Dotted grid pattern background - at top level */}
                  <div
                    className='absolute inset-0 pointer-events-none z-[20]'
                    style={{
                      backgroundImage:
                        'radial-gradient(circle, hsl(var(--border)) 1px, transparent 1px)',
                      backgroundSize: '24px 24px',
                    }}
                  />
                  {stages.map((stage, index) => (
                    <LinearStageCard
                      key={stage.tempId}
                      stage={stage}
                      index={index}
                      stages={stages}
                      formMap={formMap}
                      editingEtaId={editingEtaId}
                      etaValue={etaValue}
                      etaInputRef={etaInputRef}
                      setEtaValue={setEtaValue}
                      setEditingEtaId={setEditingEtaId}
                      handleStartEditEta={handleStartEditEta}
                      handleSaveEta={handleSaveEta}
                      handleAddStageAt={handleAddStageAt}
                      handleUpdateStage={handleUpdateStage}
                      handleDeleteStage={handleDeleteStage}
                      handleOpenConditionModal={handleOpenConditionModal}
                      handleOpenEditForm={handleOpenEditForm}
                      handleRemoveStageForm={handleRemoveStageForm}
                      handleOpenDirectForm={handleOpenDirectForm}
                      handleAttachExistingStageForm={handleAttachExistingStageForm}
                      stageFormsList={stageFormsList}
                      isConditionModalOpen={isConditionModalOpen}
                      selectedStageForCondition={selectedStageForCondition}
                      editingCondition={editingCondition}
                      handleCloseConditionModal={handleCloseConditionModal}
                      handleSaveCondition={handleSaveCondition}
                      handleDeleteCondition={handleDeleteCondition}
                      handleOpenCreateForm={handleOpenCreateForm}
                    />
                  ))}

                  {/* Final Add Stage Card (when no stages or as last option) */}
                  {stages.length === 0 && (
                    <Button
                      onClick={() => handleAddStageAt(0)}
                      data-track-category='board_config'
                      data-track-name='add_first_stage'
                      variant='ghost'
                      className='w-[280px] h-[120px] rounded-lg border-2 border-dashed border-muted-foreground flex flex-col items-center justify-center gap-2 text-muted-foreground hover:text-muted-foreground/80 hover:border-muted-foreground/60 hover:bg-background/50 transition-colors'
                    >
                      <Plus size={20} />
                      <span className='text-sm font-medium'>Add Stage</span>
                    </Button>
                  )}
                </div>
              </div>
            )}{' '}
            {/* end boardType !== 'NON_LINEAR' */}
            {/* Stage form slide-outs (linear flows) */}
            {boardType !== BoardType.NON_LINEAR &&
              isCreateFormOpen &&
              selectedStageForCondition !== null && (
                <div className='fixed right-16 top-[250px] bottom-20 z-[60]'>
                  <CreateFormSlideOut
                    isOpen={true}
                    onClose={handleCloseCreateForm}
                    onSave={handleCreateFormSave}
                    projectId={projectId}
                  />
                </div>
              )}
            {boardType !== BoardType.NON_LINEAR &&
              isDirectFormOpen &&
              selectedStageForDirectForm !== null && (
                <div className='fixed right-16 top-[250px] bottom-20 z-[60]'>
                  <CreateFormSlideOut
                    isOpen={true}
                    onClose={handleCloseDirectForm}
                    onSave={handleDirectFormSave}
                    title='Configure Transition Form'
                    projectId={projectId}
                  />
                </div>
              )}
            {boardType !== BoardType.NON_LINEAR &&
              isEditFormOpen &&
              selectedStageForEditForm !== null &&
              editingFormData && (
                <div className='fixed right-16 top-[250px] bottom-20 z-[60]'>
                  <CreateFormSlideOut
                    isOpen={true}
                    onClose={handleCloseEditForm}
                    onSave={() => undefined}
                    onUpdate={formData => void handleEditFormSave(formData)}
                    {...(editingFormId ? { formId: editingFormId } : {})}
                    initialData={editingFormData}
                    title='Edit Transition Form'
                    projectId={projectId}
                  />
                </div>
              )}
            {/* Edge form slide-out for NON_LINEAR per-edge forms */}
            {isEdgeFormOpen && edgeFormTarget && (
              <div className='fixed right-16 top-[250px] bottom-20 z-[60]'>
                <CreateFormSlideOut
                  isOpen={true}
                  onClose={handleCloseEdgeForm}
                  onSave={handleEdgeFormSave}
                  projectId={projectId}
                  {...(edgeEditFormId ? { formId: edgeEditFormId } : {})}
                  {...(edgeEditFormData
                    ? {
                        onUpdate: formData => void handleEdgeFormSave(formData),
                        initialData: edgeEditFormData,
                      }
                    : {})}
                  title={edgeEditFormId ? 'Edit Transition Form' : 'Configure Transition Form'}
                />
              </div>
            )}
            {conditionDeleteDialog && (
              <div className='fixed inset-0 z-[90] flex items-center justify-center bg-black/50 px-4'>
                <div className='w-full max-w-[420px] rounded-lg border border-border bg-background p-5 shadow-xl'>
                  <h2 className='text-base font-semibold text-foreground'>
                    {conditionDeleteDialog.kind === 'blocked'
                      ? 'Cannot delete condition'
                      : 'Delete condition?'}
                  </h2>
                  <p className='mt-2 text-sm leading-5 text-muted-foreground'>
                    {conditionDeleteDialog.kind === 'blocked'
                      ? `There ${
                          conditionDeleteDialog.openRequestCount === 1 ? 'is' : 'are'
                        } ${conditionDeleteDialog.openRequestCount} pending approval ${
                          conditionDeleteDialog.openRequestCount === 1 ? 'request' : 'requests'
                        }${
                          conditionDeleteDialog.targetStageName
                            ? ` for ${conditionDeleteDialog.targetStageName}`
                            : ''
                        }. Close all pending approvals before deleting this condition.`
                      : `Are you sure you want to delete "${conditionDeleteDialog.conditionName}"?`}
                  </p>
                  <div className='mt-5 flex justify-end gap-2'>
                    <Button
                      variant='secondary'
                      onClick={() => setConditionDeleteDialog(null)}
                      data-track-category='board_config'
                      data-track-name={
                        conditionDeleteDialog.kind === 'blocked'
                          ? 'close_condition_delete_blocked'
                          : 'cancel_condition_delete_confirm'
                      }
                    >
                      {conditionDeleteDialog.kind === 'blocked' ? 'Close' : 'Cancel'}
                    </Button>
                    {conditionDeleteDialog.kind === 'confirm' && (
                      <Button
                        variant='default'
                        onClick={handleConfirmDeleteCondition}
                        disabled={isCheckingConditionDelete}
                        className='bg-red-600 text-white hover:bg-red-700'
                        data-track-category='board_config'
                        data-track-name='confirm_condition_delete'
                      >
                        {isCheckingConditionDelete ? 'Checking...' : 'Delete'}
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      <Dialog
        open={showTransitionsLoadingNotice}
        onOpenChange={setShowTransitionsLoadingNotice}
        title='Please wait'
        description='Loading transitions, please wait...'
      >
        <div className='p-6'>
          <p className='text-[14px] text-muted-foreground mb-6'>
            Loading transitions, please wait...
          </p>
          <div className='flex justify-end'>
            <Button
              type='button'
              onClick={() => setShowTransitionsLoadingNotice(false)}
              data-track-category='board_config'
              data-track-name='transitions_loading_notice_ok'
            >
              OK
            </Button>
          </div>
        </div>
      </Dialog>
      <ConfirmDialog />
    </div>
  );
};

export default BoardStageConfigScreen;
