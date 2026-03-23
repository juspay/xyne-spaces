import { ReactElement, useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { Plus, X, Timer, ChevronDown, GitBranch, MoreVertical, ChevronLeft } from 'lucide-react';
import { useZero } from '../../../hooks/useZero';
import { queries } from '../../../zero/queries';
import { mutators } from '../../../zero/mutators';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { v4 as uuidv4 } from 'uuid';
import { Button } from '../../../components/ui/Button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '../../../components/ui/dropdown-menu';
import {
  TicketStatusV2,
  type User,
  PRStatusEvent,
  FormContextType,
  FormFieldType,
} from '@xyne/shared';
import { toast } from 'sonner';
import { useUsers } from '../../../hooks/useUsers';
import type { StageNode as Stage, StageCondition } from './BoardStageConfigScreen.types';
import { ConditionBuilder } from '../../../components/Board/ConditionBuilder/ConditionBuilder';
import { CreateFormSlideOut } from '../../../components/Board/CreateFormSlideOut/CreateFormSlideOut';
import { formService } from '../../../services/Form/formService';
import { FormEntityType } from '@xyne/shared';
import { StatusIndicator } from '../../../components/Board/StatusIndicator';
import { STATUS_OPTIONS, getStatusOption } from './BoardStageConfigScreen.types.tsx';

interface BoardStageConfigScreenProps {
  boardId: string;
  projectId: string;
  isOpen: boolean;
  onClose: () => void;
  onSave?: () => void;
  onBack?: () => void;
  initialBoard?: unknown; // Optional board data to avoid Zero sync delay
}

// ─── Main component ───────────────────────────────────────────────────────────
const BoardStageConfigScreen = ({
  boardId,
  projectId,
  isOpen,
  onClose,
  onSave,
  onBack,
  initialBoard,
}: BoardStageConfigScreenProps): ReactElement | null => {
  const zero = useZero();

  // ── Data fetching ──────────────────────────────────────────────────────────
  // Fetch only the specific board with full details (stages, prStatusMappings, etc.)
  const [boardFromQuery] = useCachedQuery(queries.boardFullDetailById({ boardId: boardId || '' }), {
    enabled: !!boardId && !initialBoard,
  });

  // Use initialBoard if provided (for newly created boards), otherwise use query result
  const board = useMemo(() => {
    if (initialBoard) return initialBoard;
    return boardFromQuery;
  }, [initialBoard, boardFromQuery]);

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
      readonly prStatusMappings?: readonly {
        readonly id: string;
        readonly stageId: string;
        readonly prStatus: PRStatusEvent;
        readonly createdAt: number;
      }[];
      readonly approvers?: readonly {
        readonly id: string;
        readonly userId: string;
        readonly stageId: string;
      }[];
      readonly formContextMappings?: readonly {
        readonly id: string;
        readonly formId: string;
        readonly contextId: string;
        readonly contextType: string;
      }[];
    }[];
  }, [board]);

  const allUsers = useUsers();
  const userMap = useMemo(() => new Map(allUsers.map(u => [u.id, u.name])), [allUsers]);

  // Fetch forms list (lightweight - only scalar fields for name lookup)
  const [allForms] = useCachedQuery(queries.getAllFormsList());
  const formMap = useMemo(() => new Map(allForms?.map(f => [f.id, f.formName]) || []), [allForms]);

  // Track if we've initialized stages to prevent re-syncing
  const hasInitializedStages = useRef(false);

  // ── Condition Modal State ────────────────────────────────────────────────────
  const [isConditionModalOpen, setIsConditionModalOpen] = useState(false);
  const [selectedStageForCondition, setSelectedStageForCondition] = useState<number | null>(null);
  const [editingCondition, setEditingCondition] = useState<StageCondition | null>(null);

  // ── Create Form Panel State ──────────────────────────────────────────────────
  const [isCreateFormOpen, setIsCreateFormOpen] = useState(false);
  const [pendingFormCondition, setPendingFormCondition] = useState<StageCondition | null>(null);

  // ── Transfer Toggle State ────────────────────────────────────────────────────
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [isAllowedToTransfer, setIsAllowedToTransfer] = useState(false);

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
      approverIds: [],
      selectedApprovers: [],
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
      approverIds: [],
      selectedApprovers: [],
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
      approverIds: [],
      selectedApprovers: [],
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
      approverIds: [],
      selectedApprovers: [],
      conditions: [],
      position: { x: 0, y: 0 },
    },
  ];

  const [stages, setStages] = useState<Stage[]>(defaultStages);

  const [nextTempId, setNextTempId] = useState(5);
  const [editingEtaId, setEditingEtaId] = useState<number | null>(null);
  const [etaValue, setEtaValue] = useState('');
  const etaInputRef = useRef<HTMLInputElement>(null);

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
      if (metadata?.['isAllowedToTransfer'] !== undefined) {
        setIsAllowedToTransfer(Boolean(metadata['isAllowedToTransfer']));
      }
    }
  }, [board]);

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
        approverIds: s.approvers?.map(a => a.userId) || [],
        selectedApprovers:
          s.approvers?.map(a => ({ id: a.userId, name: userMap.get(a.userId) || '' }) as User) ||
          [],
        formId: s.formContextMappings?.[0]?.formId || '',
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
      if (stage.approverIds.length > 0 && idx > 0) {
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
            approverIds: stage.approverIds,
          });
        }
      }
    });
    setStages(loadedStages);
    setNextTempId(loadedStages.length + 1);
  }, [board, boardStages, userMap, formMap]);

  // ── Handlers ───────────────────────────────────────────────────────────────
  const handleAddStageAt = useCallback(
    (insertIndex: number) => {
      // Get the previous stage's status, or default to TODO if adding at the beginning
      const previousStage = stages[insertIndex - 1];
      const defaultStatus = previousStage?.defaultTicketStatusV2 ?? TicketStatusV2.TODO;

      const newStage: Stage = {
        tempId: nextTempId,
        name: '',
        eta: 0,
        sequenceNumber: insertIndex + 1,
        defaultTicketStatusV2: defaultStatus,
        prStatuses: [],
        approverIds: [],
        selectedApprovers: [],
        conditions: [],
        position: { x: 0, y: 0 },
      };

      setStages(prev => {
        const newStages = [...prev];
        newStages.splice(insertIndex, 0, newStage);
        // Update sequence numbers
        return newStages.map((s, idx) => ({ ...s, sequenceNumber: idx + 1 }));
      });
      setNextTempId(id => id + 1);
    },
    [nextTempId, stages],
  );

  const handleDeleteStage = useCallback((tempId: number) => {
    setStages(prev => {
      const filtered = prev.filter(s => s.tempId !== tempId);
      // Update sequence numbers
      return filtered.map((s, idx) => ({ ...s, sequenceNumber: idx + 1 }));
    });
  }, []);

  const handleUpdateStage = useCallback((tempId: number, updates: Partial<Stage>) => {
    setStages(prev => prev.map(s => (s.tempId === tempId ? { ...s, ...updates } : s)));
  }, []);

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

          // Case 3: Approver - store approverIds on the NEXT stage
          // Handles both status-based and form-based approvers
          if (condition.thenField === 'approver' && condition.approverIds) {
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

            // If this stage is the next stage, store the approverIds
            if (nextStageName && stage.name === nextStageName) {
              return { ...stage, approverIds: condition.approverIds || [], selectedApprovers: [] };
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

  const handleDeleteCondition = useCallback(
    (conditionId: string) => {
      if (selectedStageForCondition === null) return;

      setStages(prev => {
        // Find the condition being deleted to determine what to clean up
        const stageWithCondition = prev.find(s => s.tempId === selectedStageForCondition);
        const conditionToDelete = stageWithCondition?.conditions.find(c => c.id === conditionId);

        return prev.map(stage => {
          // Remove condition from the current stage
          if (stage.tempId === selectedStageForCondition) {
            stage = {
              ...stage,
              conditions: (stage.conditions || []).filter(c => c.id !== conditionId),
            };
          }

          // If deleting a form condition, remove formId from the target stage
          if (
            conditionToDelete?.whenField === 'status' &&
            conditionToDelete?.thenField === 'form'
          ) {
            const nextStageName = conditionToDelete.whenValue;
            if (stage.name === nextStageName) {
              const { formId: _, ...restStage } = stage;
              stage = restStage;
            }
          }

          // If deleting a PR status condition, remove prStatus from the target stage
          if (
            conditionToDelete?.whenField === 'pr_status' &&
            conditionToDelete?.thenField === 'status'
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

          return stage;
        });
      });
    },
    [selectedStageForCondition],
  );

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
    async (formData: {
      formName: string;
      formDescription: string;
      fields: Array<{
        id: string;
        fieldName: string;
        fieldType: string;
        isOptional: boolean;
        fieldEnum?: string[];
      }>;
    }) => {
      if (!projectId) return;

      try {
        // Create the form via API
        const createdForm = await formService.createForm({
          formName: formData.formName,
          formDescription: formData.formDescription,
          contextType: FormContextType.STAGE,
          entityType: FormEntityType.TICKET,
          fields: formData.fields.map(f => ({
            fieldName: f.fieldName,
            fieldType: f.fieldType as FormFieldType,
            ...(f.fieldEnum && { fieldEnum: f.fieldEnum }),
            isOptional: f.isOptional,
          })),
        });

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
    [pendingFormCondition, projectId, selectedStageForCondition],
  );

  // ── Save ───────────────────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    if (!boardId) return;

    const invalidStages = stages.filter(s => !s.name.trim());
    if (invalidStages.length > 0) {
      toast.error('Please fill in all stage names');
      return;
    }

    try {
      const existingMetadata =
        board && typeof board === 'object' && 'metadata' in board
          ? (board.metadata as Record<string, unknown>)
          : {};

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
          approverIds: stage.approverIds,
          formId: stage.formId,
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

      // Build stage approvers - extract from stages that have approverIds
      const stageApprovers = stages
        .filter(stage => stage.approverIds && stage.approverIds.length > 0)
        .map(stage => ({
          stageId: stageIds[stage.sequenceNumber],
          approverIds: stage.approverIds,
        }));

      const mutatorArgs = {
        boardId,
        name:
          board && typeof board === 'object' && 'name' in board
            ? (board as { name?: string }).name || ''
            : '',
        metadata: {
          ...existingMetadata,
          isAllowedToTransfer,
        },
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
        toast.success('Board stages updated successfully');
        onSave?.();
        onClose();
      }
    } catch (error) {
      toast.error('Failed to update board stages', {
        description: error instanceof Error ? error.message : 'An unexpected error occurred.',
        duration: 5000,
      });
    }
  }, [boardId, board, stages, onSave, onClose, zero, isAllowedToTransfer]);

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
          <Button onClick={onClose}>Close</Button>
        </div>
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/50'>
      <div className='bg-background flex flex-col w-[90vw] h-[85vh] rounded-lg shadow-xl overflow-hidden border border-border'>
        {/* ── Header ── */}
        <div className='flex items-center justify-between px-[18px] py-4'>
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
              Configure Stages -{' '}
              {(board && typeof board === 'object' && 'name' in board
                ? (board as { name?: string }).name
                : null) || 'Board'}
            </span>
          </div>

          <div className='flex items-center gap-3'>
            <Button variant='secondary' onClick={onClose}>
              Cancel
            </Button>
            <Button
              className='bg-[#6276BE] hover:bg-[#5060A0] text-white'
              onClick={() => void handleSave()}
            >
              Finish
            </Button>
          </div>
        </div>

        {/* ── Title Section ── */}
        <div className='px-6 py-3 flex-shrink-0 flex items-start justify-between'>
          <div>
            <h1 className='text-[18px] font-semibold text-foreground'>Configure Board</h1>
            <p className='text-[14px] text-muted-foreground mt-1 leading-[20px]'>
              Configure the workflow stages for your board. Each card represents a stage in your
              workflow.
            </p>
          </div>
          {/* Three Dot Menu Button with Dropdown */}
          <div className='relative'>
            <Button
              onClick={() => setIsTransferModalOpen(v => !v)}
              variant='ghost'
              size='iconSm'
              className='p-2 hover:bg-muted rounded-lg transition-colors'
              data-track-category='board_config'
              data-track-name='open_transfer_settings'
            >
              <MoreVertical size={20} className='text-muted-foreground' />
            </Button>

            {/* Dropdown Menu */}
            {isTransferModalOpen && (
              <div className='absolute right-0 top-full mt-2 w-[280px] bg-background rounded-lg shadow-lg border border-border z-50 py-2'>
                <div className='px-4 py-3'>
                  <div className='flex items-start justify-between gap-3'>
                    <div>
                      <label
                        htmlFor='allow-transfer-toggle'
                        className='text-[13px] font-medium text-foreground block'
                      >
                        Allow Ticket Transfer
                      </label>
                      <p className='text-[11px] text-muted-foreground mt-0.5 leading-[14px]'>
                        Only Manager and Team Lead can transfer tickets
                      </p>
                    </div>
                    <button
                      id='allow-transfer-toggle'
                      onClick={() => setIsAllowedToTransfer(v => !v)}
                      className={`w-[36px] h-[20px] rounded-full relative transition-colors flex-shrink-0 ${
                        isAllowedToTransfer ? 'bg-[#6276be]' : 'bg-muted'
                      }`}
                      data-track-category='board_config'
                      data-track-name='toggle_allow_transfer'
                      type='button'
                    >
                      <span
                        className={`absolute top-[2px] w-[16px] h-[16px] bg-background rounded-full transition-transform ${
                          isAllowedToTransfer ? 'left-[18px]' : 'left-[2px]'
                        }`}
                      />
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Stages Area with Rounded Column Background ── */}
        <div className='flex-1 overflow-hidden px-6 pt-3 pb-6'>
          {/* Rounded container with columns background */}
          <div className='h-full w-full rounded-[16px] bg-muted/50 overflow-x-auto overflow-y-hidden'>
            {/* Stage Cards Row - centered when few, scrollable when many */}
            <div className='h-full flex items-stretch justify-center min-w-max relative'>
              {/* Dotted grid pattern background - at top level */}
              <div
                className='absolute inset-0 pointer-events-none z-[20]'
                style={{
                  backgroundImage:
                    'radial-gradient(circle, hsl(var(--border)) 1px, transparent 1px)',
                  backgroundSize: '24px 24px',
                }}
              />
              {stages.map((stage, index) => {
                const statusOption = getStatusOption(stage.defaultTicketStatusV2);
                const isLast = index === stages.length - 1;

                // Calculate active stages for progress indicator (exclude TODO and CANCELLED from position calc)
                const activeStages = stages.filter(
                  s =>
                    s.defaultTicketStatusV2 !== TicketStatusV2.TODO &&
                    s.defaultTicketStatusV2 !== TicketStatusV2.CANCELLED,
                );
                const totalActiveStages = activeStages.length;
                const stageIndexInActive = activeStages.findIndex(s => s.tempId === stage.tempId);

                // Get background color based on status - uses semantic theme-aware colors
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

                return (
                  <div key={stage.tempId} className='flex items-stretch h-full relative'>
                    {/* Colored Background Column - full width touching adjacent boxes */}
                    <div
                      className={`${getStatusBgColor(stage.defaultTicketStatusV2)} self-stretch flex items-start justify-center px-10 pt-20 relative`}
                    >
                      {/* Stage Card - narrower than colored background */}
                      <div className='w-[260px] bg-background rounded-[10px] border border-border shadow-[0px_2px_8px_0px_rgba(5,5,6,0.07)] overflow-hidden pb-[10px] shrink-0 z-40'>
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
                            {/* Set ETA button - always visible */}
                            <Button
                              onClick={() => handleStartEditEta(stage)}
                              variant='ghost'
                              size='sm'
                              className='flex items-center gap-[4px] text-[12px] text-foreground hover:text-foreground/80 p-[4px] rounded-[6px] h-auto'
                              data-track-category='board_config'
                              data-track-name='start_edit_eta'
                            >
                              <Timer size={12} />
                              <span className='font-[450]'>
                                {stage.eta > 0 ? `${stage.eta}h` : 'Set ETA'}
                              </span>
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
                                stageIndex={
                                  stageIndexInActive >= 0 ? stageIndexInActive : undefined
                                }
                                totalNonCancelledStages={
                                  totalActiveStages > 0 ? totalActiveStages : undefined
                                }
                              />
                            </div>
                            <input
                              type='text'
                              value={stage.name}
                              onChange={e =>
                                handleUpdateStage(stage.tempId, { name: e.target.value })
                              }
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
                                  <GitBranch
                                    size={14}
                                    className='text-muted-foreground flex-shrink-0'
                                  />
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

                    {/* Create Form Slide Out - fixed panel matching grey background height */}
                    {isCreateFormOpen && selectedStageForCondition === stage.tempId && (
                      <div className='fixed right-16 top-[250px] bottom-20 z-[60]'>
                        <CreateFormSlideOut
                          isOpen={true}
                          onClose={handleCloseCreateForm}
                          onSave={formData => void handleCreateFormSave(formData)}
                        />
                      </div>
                    )}

                    {/* Black line on top of where colored backgrounds meet */}
                    {!isLast && (
                      <div className='absolute right-0 top-[150px] -translate-y-1/2 translate-x-1/2 z-10 w-[80px] h-[2px] bg-muted-foreground' />
                    )}

                    {/* Plus button on top of the line - matches Figma design */}
                    {!isLast && (
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
                    )}
                  </div>
                );
              })}

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
        </div>
      </div>
    </div>
  );
};

export default BoardStageConfigScreen;
