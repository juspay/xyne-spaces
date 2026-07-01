import { ReactElement, useState, useEffect, useRef, useMemo } from 'react';
import { X } from 'lucide-react';
import { TextInput, SingleSelect } from '@juspay/blend-design-system';
import type { ReadonlyJSONValue } from '@rocicorp/zero';
import { queries } from '../../../zero/queries';
import { Button } from '../../../components/ui/Button';
import { MultiSelect } from '../../../components/ui/MultiSelect';
import { ApproverSelector } from '../ApproverSelector';
import type { ApproverEntry } from '../ApproverSelector/ApproverSelector.types';
import { type BoardFormProps } from './types';
import BoardFormSelector from '../BoardFormSelector/BoardFormSelector';
import {
  FormContextType,
  TicketStatusV2,
  PRStatusEvent,
  BoardType,
  type BoardMetadata,
  type TicketFormConfig,
} from '@xyne/shared';
import { DEFAULT_STAGES_TEMPLATE } from './templates/defaultStagesTemplate';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { BoardTicketFormConfig, DEFAULT_CONFIG } from '../BoardTicketFormConfig';

interface Stage {
  id?: string;
  tempId: number;
  name: string;
  eta: string | undefined;
  etaEnabled: boolean;
  sequenceNumber: string;
  defaultTicketStatusV2: TicketStatusV2;
  prStatuses?: PRStatusEvent[];
  approvers: ApproverEntry[];
  formId?: string | undefined;
}

type StageTemplateType = 'none' | 'default';

// PR status options for MultiSelect
const PR_STATUS_OPTIONS = Object.values(PRStatusEvent).map(status => ({
  value: status,
  label: status
    .replace(/_/g, ' ')
    .toLowerCase()
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' '),
}));

// Helper function to create an empty stage
const createEmptyStage = (sequenceNumber: number): Stage => ({
  tempId: Date.now() + sequenceNumber,
  name: '',
  eta: undefined,
  etaEnabled: false,
  sequenceNumber: String(sequenceNumber),
  defaultTicketStatusV2: TicketStatusV2.STARTED,
  prStatuses: [],
  approvers: [],
});

export const BoardForm = ({
  board,
  onSubmit,
  onCancel,
  loading = false,
  projectId: providedProjectId,
}: BoardFormProps): ReactElement => {
  const isEdit = !!board;
  const [name, setName] = useState(board?.name || '');
  const [projectId, setProjectId] = useState(board?.projectId || providedProjectId || '');
  const [boardType, setBoardType] = useState<BoardType>(board?.boardType || BoardType.DEFAULT);
  const [selectedFormIds, setSelectedFormIds] = useState<Set<string>>(new Set());

  // Initialize description from board
  const [description, setDescription] = useState<string>(board?.description || '');

  // Initialize ticket form config from board metadata
  const boardMetadata = board?.metadata as BoardMetadata | null;
  const initialConfig: Required<TicketFormConfig> = {
    userGroupsOnly:
      boardMetadata?.ticketFormConfig?.userGroupsOnly || DEFAULT_CONFIG.userGroupsOnly,
    dueDate: boardMetadata?.ticketFormConfig?.dueDate || DEFAULT_CONFIG.dueDate,
    assignedTo: boardMetadata?.ticketFormConfig?.assignedTo || DEFAULT_CONFIG.assignedTo,
    todo: boardMetadata?.ticketFormConfig?.todo || DEFAULT_CONFIG.todo,
    workflows: boardMetadata?.ticketFormConfig?.workflows || DEFAULT_CONFIG.workflows,
    labels: boardMetadata?.ticketFormConfig?.labels || DEFAULT_CONFIG.labels,
    merchantId: boardMetadata?.ticketFormConfig?.merchantId || DEFAULT_CONFIG.merchantId,
    ticketType: boardMetadata?.ticketFormConfig?.ticketType || DEFAULT_CONFIG.ticketType,
  };
  const [ticketFormConfig, setTicketFormConfig] =
    useState<Required<TicketFormConfig>>(initialConfig);

  // Initialize transfer flag from board metadata
  const [isAllowedToTransfer, setIsAllowedToTransfer] = useState<boolean>(
    boardMetadata?.isAllowedToTransfer ?? false,
  );

  const [allForms] = useCachedQuery(queries.getAllForms());

  // Memoize forms to prevent infinite re-render loops
  const forms = useMemo(
    () => allForms?.filter(f => f.contextType === FormContextType.BOARD) || [],
    [allForms],
  );
  const stageForms = useMemo(
    () => allForms?.filter(f => f.contextType === FormContextType.STAGE) || [],
    [allForms],
  );

  // Set initial form IDs from mappings
  useEffect(() => {
    if (board && forms) {
      const selectedIds = new Set<string>();
      forms.forEach(form => {
        // Check if this form is mapped to the board
        const isMapped = form.formContextMappings?.some(
          mapping =>
            mapping.contextId === board.id && mapping.contextType === FormContextType.BOARD,
        );
        if (isMapped) {
          selectedIds.add(form.id);
        }
      });
      setSelectedFormIds(selectedIds);
    }
  }, [board, forms]);

  // Handle form selection with auto-deselect of conflicting entity type
  const handleFormSelect = (formId: string): void => {
    if (!forms) return;

    const form = forms.find(f => f.id === formId);
    if (!form) return;

    setSelectedFormIds(prev => {
      const newSet = new Set(prev);

      // Check if another form with same entityType is selected
      const conflictingFormId = Array.from(prev).find(id => {
        const f = forms.find(form => form.id === id);
        return f?.entityType === form.entityType;
      });

      // Remove conflicting form if exists
      if (conflictingFormId) {
        newSet.delete(conflictingFormId);
      }

      // Add the new form
      newSet.add(formId);

      return newSet;
    });
  };

  const handleFormDeselect = (formId: string): void => {
    setSelectedFormIds(prev => {
      const newSet = new Set(prev);
      newSet.delete(formId);
      return newSet;
    });
  };

  // Extract stages from board, handling readonly array and Error type
  const boardStages =
    board?.stages && Array.isArray(board.stages)
      ? (board.stages as readonly {
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
            readonly userId: string | null;
            readonly roleId: string | null;
            readonly approverType: 'USER' | 'ROLE' | null;
            readonly stageId: string;
          }[];
        }[])
      : [];

  // Stage template selection: 'none', 'ai', or 'default'
  const [selectedTemplate, setSelectedTemplate] = useState<StageTemplateType>(
    !isEdit ? 'none' : 'none',
  );

  // Initialize stages state - empty initially
  const [stages, setStages] = useState<Stage[]>([
    {
      tempId: Date.now(),
      name: '',
      eta: undefined,
      etaEnabled: false,
      sequenceNumber: '1',
      defaultTicketStatusV2: TicketStatusV2.STARTED,
      prStatuses: [],
      approvers: [],
    },
  ]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch projects using Zero
  const [projects] = useCachedQuery(queries.getAllProjects());
  const loadingProjects = projects === undefined;

  // Track if we've initialized stages from board data to prevent re-syncing
  const hasInitializedStages = useRef(false);

  // Reset initialization flag when board ID changes (when opening modal for different board)
  useEffect(() => {
    if (board?.id) {
      hasInitializedStages.current = false;
    }
  }, [board?.id]);

  // Sync stages with board data ONLY on initial mount (when editing)
  useEffect(() => {
    if (isEdit && boardStages.length > 0 && !hasInitializedStages.current) {
      hasInitializedStages.current = true;

      const loadedStages = boardStages.map((s, idx) => {
        const mappedForm = stageForms?.find(form =>
          form.formContextMappings?.some(
            mapping => mapping.contextId === s.id && mapping.contextType === FormContextType.STAGE,
          ),
        );

        // Build mixed approvers array from s.approvers (USER rows -> userId, ROLE rows -> roleId)
        const approvers: ApproverEntry[] = (s.approvers ?? [])
          .map(a => {
            const type = a.approverType ?? 'USER';
            if (type === 'ROLE') {
              return a.roleId ? { approverId: a.roleId, approverType: 'ROLE' as const } : null;
            }
            return a.userId ? { approverId: a.userId, approverType: 'USER' as const } : null;
          })
          .filter((x): x is ApproverEntry => x !== null);

        return {
          id: s.id,
          tempId: Date.now() + idx,
          name: s.name,
          eta: s.eta !== null ? String(s.eta) : undefined,
          etaEnabled: s.eta !== null,
          sequenceNumber: String(s.sequenceNumber),
          defaultTicketStatusV2: s.defaultTicketStatusV2 || TicketStatusV2.STARTED,
          prStatuses: s.prStatusMappings
            ? s.prStatusMappings.map((m: { prStatus: PRStatusEvent }) => m.prStatus)
            : [],
          approvers,
          formId: mappedForm?.id,
        };
      });
      setStages(loadedStages);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardStages, stageForms]); // Run when board data is available, but ref prevents re-runs

  // Sync stages with template selection
  useEffect(() => {
    if (!isEdit) {
      // Only auto-manage stages in create mode
      setStages(() => {
        if (selectedTemplate === 'default') {
          // Use default stages template + one empty stage for user to add
          const templateStages = DEFAULT_STAGES_TEMPLATE.definitions.map((stage, idx) => ({
            tempId: Date.now() + idx,
            name: stage.name,
            eta: stage.eta,
            etaEnabled: !!stage.eta,
            sequenceNumber: stage.sequenceNumber,
            defaultTicketStatusV2: stage.defaultTicketStatusV2,
            approvers: [],
          }));
          const nextSequenceNumber = templateStages.length + 1;
          return [...templateStages, createEmptyStage(nextSequenceNumber)];
        }
        // No template - return empty stage
        return [createEmptyStage(1)];
      });
    }
  }, [selectedTemplate, isEdit]);

  const addStage = (): void => {
    const nextSequenceNumber = stages.length + 1;

    setStages([
      ...stages,
      {
        tempId: Date.now(),
        name: '',
        eta: undefined,
        etaEnabled: false,
        sequenceNumber: String(nextSequenceNumber),
        defaultTicketStatusV2: TicketStatusV2.STARTED,
        approvers: [],
      },
    ]);
  };

  const removeStage = (index: number): void => {
    if (stages.length === 1) return;
    const newStages = stages.filter((_, i) => i !== index);
    setStages(newStages);
  };

  const updateStage = (
    index: number,
    field: keyof Stage,
    value: string | TicketStatusV2 | boolean | PRStatusEvent[] | ApproverEntry[] | undefined,
  ): void => {
    const newStages = [...stages];
    const currentStage = newStages[index];
    if (currentStage) {
      newStages[index] = { ...currentStage, [field]: value } as Stage;
    }
    setStages(newStages);
  };

  const handleSubmit = (): void => {
    if (!name.trim()) {
      setError('Board name is required');
      return;
    }

    if (!projectId) {
      setError('Please select a project');
      return;
    }

    // Validate stages
    for (const stage of stages) {
      if (!stage.name.trim()) {
        setError('All stages must have a name');
        return;
      }

      // Validate ETA only if eta is provided
      if (stage.eta) {
        const etaValue = parseInt(stage.eta);
        if (isNaN(etaValue) || etaValue <= 0) {
          setError('All stages with ETA must have a valid ETA (hours)');
          return;
        }
      }

      const sequenceValue = parseInt(stage.sequenceNumber);
      if (isNaN(sequenceValue) || sequenceValue <= 0) {
        setError('All stages must have a valid sequence number');
        return;
      }
    }

    // Validate that at least one stage has each required status
    const hasTodo = stages.some(s => s.defaultTicketStatusV2 === TicketStatusV2.TODO);
    const hasStarted = stages.some(s => s.defaultTicketStatusV2 === TicketStatusV2.STARTED);
    const hasCompleted = stages.some(s => s.defaultTicketStatusV2 === TicketStatusV2.COMPLETED);

    if (!hasTodo && !hasStarted && !hasCompleted) {
      setError('At least one stage must have TODO, STARTED, and COMPLETED status');
      return;
    }

    // Validate PR status uniqueness across stages
    const prStatusUsage = new Map<PRStatusEvent, string>();
    for (const stage of stages) {
      if (stage.prStatuses) {
        for (const status of stage.prStatuses) {
          if (prStatusUsage.has(status)) {
            setError(
              `PR status "${status}" cannot be used in multiple stages. ` +
                `Already used in "${prStatusUsage.get(status)}", cannot use in "${stage.name}".`,
            );
            return;
          }
          prStatusUsage.set(status, stage.name);
        }
      }
    }
    if (stages.length < 3) {
      setError('Board must have at least 3 stages');
      return;
    }

    void (async (): Promise<void> => {
      try {
        setIsSubmitting(true);
        setError(null);

        if (isEdit) {
          // Edit mode - only send changed fields
          const updateData: {
            name?: string;
            description?: string;
            projectId?: string;
            boardType?: BoardType;
            metadata?: ReadonlyJSONValue;
            stages?: Array<{
              id?: string;
              name: string;
              eta?: number;
              sequenceNumber: number;
              defaultTicketStatusV2: TicketStatusV2;
              prStatuses?: PRStatusEvent[];
              requiresApproval?: boolean;
              approvers?: ApproverEntry[];
              formId?: string;
            }>;
            formIds?: string[] | null;
            stageFormMappings?: Array<{
              stageId: string;
              formId: string;
              mappingId: string;
            }>;
            stageApprovers?: Array<{
              stageId: string;
              approvers: ApproverEntry[];
            }>;
          } = {};

          if (name.trim() !== board.name) {
            updateData.name = name.trim();
          }
          if (projectId !== board.projectId) {
            updateData.projectId = projectId;
          }
          if (boardType !== board.boardType) {
            updateData.boardType = boardType;
          }

          // Always include metadata with ticket form config and transfer flag
          updateData.metadata = {
            ...boardMetadata,
            ticketFormConfig: ticketFormConfig,
            isAllowedToTransfer: isAllowedToTransfer,
            hasStagesWithApproval: stages.some(s => s.approvers.length > 0),
          } as unknown as ReadonlyJSONValue;

          // Include description if changed
          const trimmedDescription = description.trim();
          const currentDescription = (board.description || '').trim();
          if (trimmedDescription !== currentDescription) {
            updateData.description = trimmedDescription;
          }

          // Always include stages for update
          updateData.stages = stages.map(stage => ({
            ...(stage.id && { id: stage.id }),
            name: stage.name.trim(),
            ...(stage.eta && { eta: parseInt(stage.eta) }),
            sequenceNumber: parseInt(stage.sequenceNumber),
            defaultTicketStatusV2: stage.defaultTicketStatusV2,
            prStatuses: stage.prStatuses || [],
            approvers: stage.approvers,
            ...(stage.formId && { formId: stage.formId }),
          }));

          // Collect stageApprovers for stages that require approval
          // Include stages with empty approvers to allow deletion of all approvers
          const stageApprovers = stages.map(stage => ({
            // For existing stages use id, for new stages use sequenceNumber as key
            // Backend will look up stageIds[sequenceNumber] to get the generated UUID
            stageId: stage.id || stage.sequenceNumber,
            approvers: stage.approvers,
          }));

          if (stageApprovers.length > 0) {
            updateData.stageApprovers = stageApprovers;
          }

          // Include form IDs if they changed
          const currentFormIds =
            forms
              ?.filter(form =>
                form.formContextMappings?.some(
                  mapping =>
                    mapping.contextId === board.id && mapping.contextType === FormContextType.BOARD,
                ),
              )
              .map(form => form.id) || [];

          if (selectedFormIds.size > 0 || currentFormIds.length > 0) {
            const newFormIds = Array.from(selectedFormIds).sort();
            const currentSorted = currentFormIds.sort();

            if (JSON.stringify(newFormIds) !== JSON.stringify(currentSorted)) {
              if (newFormIds.length > 0) {
                updateData.formIds = newFormIds;
              }
            }
          }

          await onSubmit(updateData);
        } else {
          // Create mode - send all fields
          // Collect stageApprovers for stages that have approvers
          const stageApprovers = stages
            .filter(stage => stage.approvers.length > 0)
            .map(stage => ({
              stageId: stage.tempId.toString(), // Use tempId as placeholder, will be resolved by backend
              approvers: stage.approvers,
            }));

          await onSubmit({
            name: name.trim(),
            description: description.trim(),
            projectId,
            boardType,
            stages: stages.map(stage => ({
              name: stage.name.trim(),
              ...(stage.eta && { eta: parseInt(stage.eta) }),
              sequenceNumber: parseInt(stage.sequenceNumber),
              defaultTicketStatusV2: stage.defaultTicketStatusV2,
              prStatuses: stage.prStatuses || [],
              approvers: stage.approvers,
              ...(stage.formId && { formId: stage.formId }),
            })),
            ...(stageApprovers.length > 0 && { stageApprovers }),
          });
        }
      } catch (err) {
        setError(
          err instanceof Error ? err.message : `Failed to ${isEdit ? 'update' : 'create'} board`,
        );
      } finally {
        setIsSubmitting(false);
      }
    })();
  };

  const isLoading = loading || isSubmitting;

  return (
    <div className='space-y-4 max-h-[60vh] overflow-y-auto'>
      {error && (
        <div className='bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded'>
          {error}
        </div>
      )}

      <div>
        <TextInput
          label='Board Name'
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder='Enter board name'
          required
          disabled={isLoading}
        />
      </div>

      <div>
        <SingleSelect
          label='Board Type'
          placeholder='Select board type'
          items={[
            {
              items: Object.values(BoardType).map(type => ({
                label: type.charAt(0) + type.slice(1).toLowerCase(),
                value: type,
              })),
            },
          ]}
          selected={boardType}
          onSelect={selected => setBoardType(selected as BoardType)}
          disabled={isLoading}
        />
      </div>

      <div>
        <label
          htmlFor='board-description'
          className='block text-sm font-medium text-foreground mb-1'
        >
          Description
        </label>
        <textarea
          id='board-description'
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder='Enter board description (optional)'
          disabled={isLoading}
          rows={3}
          className='w-full px-3 py-2 border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-muted disabled:cursor-not-allowed resize-none'
          data-track-category='Board_Form'
          data-track-name='Enter_Description'
        />
      </div>

      {!providedProjectId && (
        <div>
          <label
            htmlFor='project-select'
            className='block text-sm font-medium text-foreground mb-1'
          >
            Project <span className='text-red-500'>*</span>
          </label>
          <select
            id='project-select'
            value={projectId}
            onChange={e => setProjectId(e.target.value)}
            disabled={isLoading || loadingProjects || isEdit}
            className='w-full px-3 py-2 border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring disabled:bg-muted disabled:cursor-not-allowed'
            data-track-event='change'
            data-track-category='Board_Form'
            data-track-name='Select_Project'
          >
            <option value=''>{loadingProjects ? 'Loading projects...' : 'Select a project'}</option>
            {projects?.map(project => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
          {isEdit && (
            <p className='mt-1 text-xs text-muted-foreground'>
              Project cannot be changed when editing a board
            </p>
          )}
        </div>
      )}

      <div>
        <div className='flex items-center justify-between mb-2'>
          <div className='text-sm font-medium text-foreground'>
            Stages <span className='text-red-500'>*</span>
          </div>
          <div className='flex items-center gap-2'>
            {!isEdit && (
              <select
                value={selectedTemplate}
                onChange={e => setSelectedTemplate(e.target.value as StageTemplateType)}
                disabled={isLoading}
                className='px-3 py-1.5 text-sm border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring disabled:bg-muted disabled:cursor-not-allowed'
                data-track-event='change'
                data-track-category='Board_Form'
                data-track-name='Select_Stage_Template'
              >
                <option value='none'>No Template</option>
                <option value='default'>Default stages</option>
              </select>
            )}
            <Button
              variant='secondary'
              onClick={addStage}
              disabled={isLoading}
              data-track-category='Board_Form'
              data-track-name='Add_Stage'
            >
              Add Stage
            </Button>
          </div>
        </div>

        <div className='space-y-3'>
          {stages.map((stage, index) => {
            return (
              <div key={stage.tempId} className='border rounded-md p-3 border-border bg-muted'>
                <div className='flex items-start gap-2'>
                  <div className='flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold bg-blue-100 text-blue-700'>
                    {stage.sequenceNumber}
                  </div>
                  <div className='flex-1 space-y-2'>
                    <TextInput
                      label=''
                      value={stage.name}
                      onChange={e => updateStage(index, 'name', e.target.value)}
                      placeholder='Stage name'
                      disabled={isLoading}
                    />
                    <div className='grid grid-cols-12 gap-2'>
                      <div className={`col-span-5 ${!stage.etaEnabled ? 'opacity-50' : ''}`}>
                        <TextInput
                          label=''
                          value={stage.eta || ''}
                          onChange={e => updateStage(index, 'eta', e.target.value)}
                          placeholder='ETA (hrs)'
                          type='number'
                          disabled={isLoading || !stage.etaEnabled}
                        />
                      </div>
                      <div className='col-span-1 flex items-center justify-center pt-2'>
                        <input
                          type='checkbox'
                          checked={stage.etaEnabled}
                          onChange={e => {
                            const isChecked = e.target.checked;
                            const newStages = [...stages];
                            const currentStage = newStages[index];
                            if (currentStage) {
                              newStages[index] = {
                                ...currentStage,
                                etaEnabled: isChecked,
                                eta: isChecked ? '1' : undefined,
                              };
                            }
                            setStages(newStages);
                          }}
                          disabled={isLoading}
                          className='w-4 h-4 rounded border-input text-blue-600 focus:ring-ring cursor-pointer'
                          title='Toggle ETA'
                          data-testid={`stage-eta-toggle-${index}`}
                          data-track-category='Board_Form'
                          data-track-name='Toggle_Stage_ETA'
                          data-track-metadata={JSON.stringify({
                            stageIndex: index,
                            stageName: stage.name,
                            etaEnabled: !stage.etaEnabled,
                          })}
                        />
                      </div>
                      <div className='col-span-6'>
                        <TextInput
                          label=''
                          value={stage.sequenceNumber}
                          onChange={e => updateStage(index, 'sequenceNumber', e.target.value)}
                          placeholder='Seq #'
                          type='number'
                          disabled={isLoading}
                        />
                      </div>
                    </div>
                    {/* Default Ticket Status Dropdown */}
                    <div className='mt-2'>
                      <label
                        htmlFor={`stage-status-${index}`}
                        className='block text-xs text-muted-foreground mb-1'
                      >
                        Default Ticket Status
                      </label>
                      <select
                        id={`stage-status-${index}`}
                        value={stage.defaultTicketStatusV2}
                        onChange={e =>
                          updateStage(
                            index,
                            'defaultTicketStatusV2',
                            e.target.value as TicketStatusV2,
                          )
                        }
                        disabled={isLoading}
                        className='w-full px-2 py-1.5 text-sm border border-input rounded-md focus:outline-none focus:ring-1 focus:ring-ring disabled:bg-muted disabled:cursor-not-allowed'
                        data-track-event='change'
                        data-track-category='Board_Form'
                        data-track-name='Select_Stage_Status'
                        data-track-metadata={JSON.stringify({
                          stageIndex: index,
                          stageName: stage.name,
                        })}
                      >
                        <option value={TicketStatusV2.TODO}>TODO</option>
                        <option value={TicketStatusV2.STARTED}>STARTED</option>
                        <option value={TicketStatusV2.PAUSED}>PAUSED</option>
                        <option value={TicketStatusV2.CANCELLED}>CANCELLED</option>
                        <option value={TicketStatusV2.COMPLETED}>COMPLETED</option>
                      </select>
                    </div>
                    {/* PR Status Triggers */}
                    <div className='mt-2'>
                      <MultiSelect
                        label='PR Status Triggers'
                        placeholder='Select PR statuses...'
                        options={PR_STATUS_OPTIONS}
                        selectedValues={stage.prStatuses || []}
                        onChange={values =>
                          updateStage(index, 'prStatuses', values as PRStatusEvent[])
                        }
                        disabled={isLoading}
                        helperText='Tickets will move to this stage when these PR events occur'
                        className='text-xs'
                      />
                    </div>

                    {/* Approvers Selector */}
                    <div className='mt-2'>
                      <p className='block text-xs text-muted-foreground mb-1'>Stage Approvers</p>
                      <ApproverSelector
                        selectedApprovers={stage.approvers}
                        onApproversChange={approvers => updateStage(index, 'approvers', approvers)}
                      />
                    </div>

                    {/* Optional Form Selector */}
                    <div className='mt-2'>
                      <label
                        htmlFor={`stage-form-${index}`}
                        className='block text-xs text-muted-foreground mb-1'
                      >
                        Optional Form (leave empty for approval only)
                      </label>
                      <select
                        id={`stage-form-${index}`}
                        value={stage.formId || ''}
                        onChange={e => {
                          updateStage(index, 'formId', e.target.value);
                        }}
                        disabled={isLoading || !stageForms}
                        className='w-full px-2 py-1.5 text-sm border border-input rounded-md focus:outline-none focus:ring-1 focus:ring-ring disabled:bg-muted disabled:cursor-not-allowed'
                        data-track-event='change'
                        data-track-category='Board_Form'
                        data-track-name='Select_Stage_Form'
                        data-track-metadata={JSON.stringify({
                          stageIndex: index,
                          stageName: stage.name,
                        })}
                      >
                        <option value=''>No form required</option>
                        {stageForms?.map(form => (
                          <option key={form.id} value={form.id}>
                            {form.formName}
                            {form.formDescription ? ` - ${form.formDescription}` : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  {stages.length > 1 && (
                    <button
                      onClick={() => removeStage(index)}
                      disabled={isLoading}
                      className='flex-shrink-0 text-red-500 hover:text-red-700 p-1'
                      type='button'
                      data-track-category='Board_Form'
                      data-track-name='Remove_Stage'
                      data-track-metadata={JSON.stringify({
                        stageName: stage.name,
                        stageIndex: index,
                      })}
                    >
                      <X size={20} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Form Selector - Only in edit mode */}
      {isEdit && (
        <div>
          <hr className='border-border my-6' />
          <BoardFormSelector
            selectedFormIds={selectedFormIds}
            onFormSelect={handleFormSelect}
            onFormDeselect={handleFormDeselect}
            disabled={isLoading}
          />
        </div>
      )}

      {/* Ticket Form Configuration - Only in edit mode */}
      {isEdit && board && (
        <div>
          <hr className='border-border my-6' />
          <BoardTicketFormConfig
            config={ticketFormConfig}
            onChange={setTicketFormConfig}
            isAllowedToTransfer={isAllowedToTransfer}
            onTransferToggle={setIsAllowedToTransfer}
            disabled={isLoading}
          />
        </div>
      )}

      <div className='flex gap-2 justify-end'>
        <Button
          variant='secondary'
          onClick={onCancel}
          disabled={isLoading}
          data-track-category='Board_Form'
          data-track-name='Cancel_Board_Form'
          data-track-metadata={JSON.stringify({ isEdit })}
        >
          Cancel
        </Button>
        <Button
          variant='default'
          onClick={handleSubmit}
          disabled={isLoading || !name.trim() || loadingProjects}
          loading={isLoading}
          data-track-category='Board_Form'
          data-track-name='Submit_Board_Form'
          data-track-metadata={JSON.stringify({ isEdit, boardName: name })}
        >
          {isLoading
            ? isEdit
              ? 'Updating...'
              : 'Creating...'
            : isEdit
              ? 'Update Board'
              : 'Create Board'}
        </Button>
      </div>
    </div>
  );
};
