import { ReactElement, useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { GripVertical, Plus, Trash2, Check, ChevronDown, ChevronLeft } from 'lucide-react';
import { useZero } from '../../../hooks/useZero';
import { queries } from '../../../zero/queries';
import { mutators } from '../../../zero/mutators';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { v4 as uuidv4 } from 'uuid';
import { Button } from '../../../components/ui/Button';
import {
  FormContextType,
  FormEntityType,
  type BoardMetadata,
  type FieldOrderItem,
  type TicketFormConfig,
} from '@xyne/shared';
import { toast } from 'sonner';
import { formService } from '../../../services/Form/formService';
import { apiInstance } from '../../../services/clients/apiClient';
import type { TicketField, Stage } from './BoardEditScreen.types';
import {
  DEFAULT_TICKET_FIELDS,
  mapFromFormFieldType,
  mapToFormFieldType,
} from './BoardEditScreen.types';
import { CustomField } from '../../../components/Board/CustomField/CustomField';
import { TicketPreviewPanel } from '../../../components/Board/TicketPreviewPanel/TicketPreviewPanel';
import {
  TicketPreviewContent,
  CreateTicketModal,
} from '../../../components/Board/TicketPreviewViews/TicketPreviewViews';
import { TicketStatusV2, TicketPriority } from '@xyne/shared';
import {
  getTicketFormConfig,
  getFieldOrderFromMetadata,
  filterFieldsForPreview,
  mapToPreviewFields,
  mapToCreateModalFields,
  getFieldConfigKey,
  FIELD_TYPE_OPTIONS,
} from '../../../utils/board';

// Type for board data passed to onNext callback
interface BoardData {
  id: string;
  name?: string;
  [key: string]: unknown;
}

interface BoardEditScreenProps {
  boardId?: string;
  projectId: string;
  isOpen: boolean;
  onClose: () => void;
  onSave?: () => void;
  onNext?: (board?: BoardData) => void;
  onBack?: () => void;
  mode?: 'create' | 'edit';
  initialBoardName?: string | undefined;
  sourceBoardId?: string;
}

const BoardEditScreen = ({
  boardId,
  projectId,
  isOpen,
  onClose,
  onSave,
  onNext,
  onBack,
  mode = 'edit',
  initialBoardName,
  sourceBoardId,
}: BoardEditScreenProps): ReactElement | null => {
  const zero = useZero();

  const [board] = useCachedQuery(queries.getBoardById({ boardId: boardId || '' }), {
    enabled: !!boardId && mode === 'edit',
  });

  // Fetch source board data when duplicating
  const [sourceBoard] = useCachedQuery(queries.getBoardById({ boardId: sourceBoardId || '' }), {
    enabled: !!sourceBoardId && mode === 'create',
  });

  const [project] = useCachedQuery(queries.projectById({ projectId: projectId || '' }), {
    enabled: !!projectId,
  });

  // Fetch custom fields form mapping for this board
  const [formMapping] = useCachedQuery(
    queries.getFormMappingByContextId({
      contextId: boardId || '',
      contextType: FormContextType.BOARD,
      entityType: FormEntityType.TICKET,
    }),
    { enabled: !!boardId },
  );

  // Fetch custom fields form mapping for source board when duplicating
  const [sourceFormMapping] = useCachedQuery(
    queries.getFormMappingByContextId({
      contextId: sourceBoardId || '',
      contextType: FormContextType.BOARD,
      entityType: FormEntityType.TICKET,
    }),
    { enabled: !!sourceBoardId && mode === 'create' },
  );

  const [boardName, setBoardName] = useState('');
  const [fields, setFields] = useState<TicketField[]>(DEFAULT_TICKET_FIELDS);
  const [isDragging, setIsDragging] = useState<string | null>(null);
  const [hoveredFieldId, setHoveredFieldId] = useState<string | null>(null);

  // Inline custom field creation state
  const [isAddingField, setIsAddingField] = useState(false);
  const [editingFieldId, setEditingFieldId] = useState<string | null>(null);
  const [editingFieldLabelId, setEditingFieldLabelId] = useState<string | null>(null);
  const [editLabelValue, setEditLabelValue] = useState('');
  const [newFieldName, setNewFieldName] = useState('');
  const [newFieldType, setNewFieldType] = useState<TicketField['type']>('text');
  const [newFieldRequired, setNewFieldRequired] = useState(false);
  const [newFieldOptions, setNewFieldOptions] = useState<string[]>([]);
  const addFieldBoxRef = useRef<HTMLDivElement>(null);
  const customFieldRef = useRef<HTMLDivElement>(null);

  // Assignee type selection (User or User Group)
  const [assigneeType, setAssigneeType] = useState<'user' | 'userGroup'>('user');

  // Dropdown state management for assignee type and field type selectors
  const [assigneeTypeDropdownOpen, setAssigneeTypeDropdownOpen] = useState(false);
  const assigneeTypeDropdownRef = useRef<HTMLDivElement>(null);

  // Field type options for display (includes mappings for core fields)
  const fieldTypeOptionsDisplay = [
    ...FIELD_TYPE_OPTIONS,
    { value: 'board', label: 'String' },
    { value: 'project', label: 'String' },
    { value: 'status', label: 'String' },
    { value: 'priority', label: 'String' },
  ];

  const boardData = mode === 'create' && sourceBoard ? sourceBoard : board;

  useMemo(() => {
    if (mode === 'create' && initialBoardName) {
      setBoardName(initialBoardName);
    } else if (boardData && typeof boardData === 'object' && 'name' in boardData) {
      setBoardName(boardData.name);
    }
  }, [boardData, mode, initialBoardName]);

  // Get ticket form config from board metadata
  const ticketFormConfig = useMemo(() => getTicketFormConfig(boardData), [boardData]);

  // Get field order from board metadata
  const fieldOrderFromMetadata = useMemo(() => getFieldOrderFromMetadata(boardData), [boardData]);

  // Initialize assignee type from metadata
  useEffect(() => {
    if (ticketFormConfig?.userGroupsOnly) {
      const isUserGroupEnabled = ticketFormConfig.userGroupsOnly.enabled;
      setAssigneeType(isUserGroupEnabled ? 'userGroup' : 'user');
    }
  }, [ticketFormConfig]);

  // Click outside handler for assignee type dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        assigneeTypeDropdownRef.current &&
        !assigneeTypeDropdownRef.current.contains(event.target as Node)
      ) {
        setAssigneeTypeDropdownOpen(false);
      }
    };

    if (assigneeTypeDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [assigneeTypeDropdownOpen]);

  // Load custom fields from form mapping (use source form mapping when duplicating)
  const activeFormMapping =
    mode === 'create' && sourceFormMapping ? sourceFormMapping : formMapping;
  useEffect(() => {
    if (activeFormMapping?.formFields && activeFormMapping.formFields.length > 0) {
      const customFields: TicketField[] = activeFormMapping.formFields.map(field => {
        const ticketField: TicketField = {
          id: field.id,
          name: field.fieldName,
          type: mapFromFormFieldType(field.fieldType),
          label: field.fieldName,
          required: !field.isOptional,
          order: DEFAULT_TICKET_FIELDS.length + 1,
          visibleInCreate: true,
        };

        // Only add options if they exist
        if (field.fieldEnum && Array.isArray(field.fieldEnum)) {
          ticketField.options = field.fieldEnum as string[];
        }

        return ticketField;
      });

      setFields(prev => {
        // Only add if not already present (avoid duplicates)
        const existingIds = new Set(prev.map(f => f.id));
        const newFields = customFields.filter(f => !existingIds.has(f.id));
        return [...prev, ...newFields];
      });
    }
  }, [activeFormMapping]);

  // Apply field order and required from metadata when board loads
  useEffect(() => {
    if (fieldOrderFromMetadata && fieldOrderFromMetadata.length > 0) {
      setFields(prev => {
        // Create map for field order
        const orderMap = new Map(
          fieldOrderFromMetadata.map((item: FieldOrderItem, idx: number) => [
            item.fieldId,
            idx + 1,
          ]),
        );

        return prev.map(field => {
          // For core fields, look up by name; for custom fields, look up by id
          const isCore = DEFAULT_TICKET_FIELDS.some(f => f.id === field.id);
          const lookupKey = isCore ? field.name : field.id;
          const order = orderMap.get(lookupKey);

          // For core fields, get required from ticketFormConfig
          let required = field.required; // Keep default
          if (isCore && ticketFormConfig) {
            const configKey = getFieldConfigKey(field.name);
            const config = ticketFormConfig[configKey as keyof TicketFormConfig];
            if (config && 'mandatory' in config && typeof config.mandatory === 'boolean') {
              required = config.mandatory;
            }
          }
          // For custom fields, required is already set from activeFormMapping (line 173: required: !field.isOptional)

          return {
            ...field,
            ...(order !== undefined && { order }),
            required,
          };
        });
      });
    }
  }, [fieldOrderFromMetadata, ticketFormConfig]);

  const handleDragStart = useCallback((fieldId: string) => {
    setIsDragging(fieldId);
  }, []);

  const handleDragOver = useCallback(
    (e: React.DragEvent, targetFieldId: string) => {
      e.preventDefault();
      if (!isDragging || isDragging === targetFieldId) return;

      setFields(prev => {
        const draggedIndex = prev.findIndex(f => f.id === isDragging);
        const targetIndex = prev.findIndex(f => f.id === targetFieldId);

        if (draggedIndex === -1 || targetIndex === -1) return prev;

        const newFields = [...prev];
        const [removed] = newFields.splice(draggedIndex, 1);
        if (removed) {
          newFields.splice(targetIndex, 0, removed);
        }

        return newFields.map((f, idx) => ({ ...f, order: idx + 1 }));
      });
    },
    [isDragging],
  );

  const handleDragEnd = useCallback(() => {
    setIsDragging(null);
  }, []);

  const startEditField = (field: TicketField): void => {
    setEditingFieldId(field.id);
    setNewFieldName(field.label);
    setNewFieldType(field.type);
    setNewFieldRequired(field.required);
    setNewFieldOptions(field.options || []);
    setIsAddingField(false);
  };

  const editLabelInputRef = useRef<HTMLInputElement>(null);

  const startEditFieldLabel = (field: TicketField): void => {
    setEditingFieldLabelId(field.id);
    setEditLabelValue(field.label);
  };

  // Focus the edit label input when editing starts
  useEffect(() => {
    if (editingFieldLabelId && editLabelInputRef.current) {
      editLabelInputRef.current.focus();
    }
  }, [editingFieldLabelId]);

  // Scroll to custom field form when adding a new field
  useEffect(() => {
    if (isAddingField && customFieldRef.current) {
      customFieldRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [isAddingField]);

  const saveFieldLabel = useCallback(() => {
    if (!editingFieldLabelId) return;
    if (!editLabelValue.trim()) {
      setEditingFieldLabelId(null);
      return;
    }
    setFields(prev =>
      prev.map(f =>
        f.id === editingFieldLabelId
          ? { ...f, label: editLabelValue.trim(), name: editLabelValue.trim() }
          : f,
      ),
    );
    setEditingFieldLabelId(null);
    setEditLabelValue('');
  }, [editingFieldLabelId, editLabelValue]);

  const cancelEditFieldLabel = useCallback(() => {
    setEditingFieldLabelId(null);
    setEditLabelValue('');
  }, []);

  const saveCustomField = useCallback(() => {
    if (!newFieldName.trim()) {
      // If no name entered, just cancel
      setIsAddingField(false);
      setEditingFieldId(null);
      setNewFieldOptions([]);
      return;
    }

    // Don't save select/multiselect if no options added
    if (
      (newFieldType === 'select' || newFieldType === 'multiselect') &&
      newFieldOptions.length === 0
    ) {
      setIsAddingField(false);
      setEditingFieldId(null);
      setNewFieldOptions([]);
      return;
    }

    // If editing existing field
    if (editingFieldId) {
      setFields(prev =>
        prev.map(f => {
          if (f.id !== editingFieldId) return f;

          const updatedField: TicketField = {
            ...f,
            name: newFieldName,
            type: newFieldType,
            label: newFieldName,
            required: newFieldRequired,
          };

          // Only add options for select/multiselect types
          if (
            (newFieldType === 'select' || newFieldType === 'multiselect') &&
            newFieldOptions.length > 0
          ) {
            updatedField.options = newFieldOptions;
          }

          return updatedField;
        }),
      );
    } else {
      // Creating new field
      const newField: TicketField = {
        id: uuidv4(),
        name: newFieldName,
        type: newFieldType,
        label: newFieldName,
        required: newFieldRequired,
        order: fields.length + 1,
        visibleInCreate: true,
      };

      // Only add options for select/multiselect types
      if (
        (newFieldType === 'select' || newFieldType === 'multiselect') &&
        newFieldOptions.length > 0
      ) {
        newField.options = newFieldOptions;
      }

      setFields(prev => [...prev, newField]);
    }

    // Reset inline form state
    setNewFieldName('');
    setNewFieldType('text');
    setNewFieldRequired(false);
    setNewFieldOptions([]);
    setIsAddingField(false);
    setEditingFieldId(null);
  }, [
    fields.length,
    newFieldName,
    newFieldType,
    newFieldRequired,
    newFieldOptions,
    editingFieldId,
  ]);

  // Click outside detection for custom field box
  useEffect(() => {
    if (!isAddingField && !editingFieldId) return;

    const handleClickOutside = (event: MouseEvent): void => {
      if (addFieldBoxRef.current && !addFieldBoxRef.current.contains(event.target as Node)) {
        saveCustomField();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return (): void => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isAddingField, editingFieldId, saveCustomField]);

  const handleSave = useCallback(async () => {
    // Create mode: create board first
    if (!boardId && mode === 'create') {
      try {
        if (!boardName.trim()) {
          toast.error('Board name is required');
          return;
        }

        const response = await apiInstance.post<{
          board: { id: string; name?: string; [key: string]: unknown };
        }>('/boards', {
          name: boardName.trim(),
          projectId: projectId,
        });

        const newBoardId = response.data.board.id;

        // Create custom fields form if there are any custom fields
        const customFields = fields.filter(f => !DEFAULT_TICKET_FIELDS.some(df => df.id === f.id));

        if (customFields.length > 0) {
          // Create new form via API
          const formResponse = await formService.createForm({
            formName: `${boardName.trim()} Custom Fields`,
            formDescription: `Custom fields for ${boardName.trim()}`,
            contextType: FormContextType.BOARD,
            entityType: FormEntityType.TICKET,
            fields: customFields.map(f => ({
              fieldName: f.name,
              fieldType: mapToFormFieldType(f.type),
              ...(f.options && f.options.length > 0 && { fieldEnum: f.options }),
              isOptional: !f.required,
            })),
          });

          const customFieldsFormId = formResponse.id;

          // Create form context mapping
          zero.mutate(
            mutators.formContextMapping.upsert({
              contextId: newBoardId,
              contextType: FormContextType.BOARD,
              entityType: FormEntityType.TICKET,
              formId: customFieldsFormId,
              mappingId: uuidv4(),
            }),
          );

          // Update board metadata with custom fields form ID
          const sortedFields = [...fields].sort((a, b) => a.order - b.order);
          const fieldOrder: FieldOrderItem[] = sortedFields.map(field => {
            const isCore = DEFAULT_TICKET_FIELDS.some(f => f.id === field.id);
            return {
              fieldId: isCore ? field.name : field.id,
              fieldType: isCore ? 'core' : 'custom',
            };
          });

          // Build ticketFormConfig for core fields only
          const coreFields = fields.filter(f => DEFAULT_TICKET_FIELDS.some(df => df.id === f.id));
          const ticketFormConfig: Partial<TicketFormConfig> = {};

          coreFields.forEach(field => {
            // Map field names to config keys (use legacy names for backward compatibility)
            let configKey: keyof TicketFormConfig;
            switch (field.name) {
              case 'assignedTo':
                configKey = 'userGroupsOnly';
                break;
              case 'status':
                configKey = 'todo';
                break;
              case 'workflowType':
                configKey = 'workflows';
                break;
              case 'tags':
                configKey = 'labels';
                break;
              default:
                configKey = field.name as keyof TicketFormConfig;
            }

            ticketFormConfig[configKey] = {
              enabled: configKey === 'userGroupsOnly' ? assigneeType === 'userGroup' : true, // userGroupsOnly based on selection, others always true
              mandatory: field.required,
            };
          });

          const newMetadata: BoardMetadata = {
            fieldOrder,
            ticketFormConfig,
            customFieldsFormId,
          };

          // Update board with metadata using zero mutator
          zero.mutate(
            mutators.board.update({
              boardId: newBoardId,
              name: boardName.trim(),
              metadata: newMetadata,
              timestamp: Date.now(),
              stageIds: {},
            }),
          );
        }

        toast.success('Board created successfully');
        onSave?.();
        onNext?.(response.data.board);
      } catch (error) {
        toast.error('Failed to create board', {
          description: error instanceof Error ? error.message : 'An unexpected error occurred.',
          duration: 5000,
        });
      }
      return;
    }

    // Edit mode: update existing board
    if (!boardId) return;

    try {
      const boardStages =
        boardData && typeof boardData === 'object' && 'stages' in boardData ? boardData.stages : [];

      const stageIds = Array.isArray(boardStages)
        ? (boardStages as Stage[]).reduce(
            (acc, stage) => {
              acc[stage.sequenceNumber] = stage.id || uuidv4();
              return acc;
            },
            {} as Record<string, string>,
          )
        : {};

      // Build field order array - use fieldName for core fields, field.id for custom fields
      const sortedFields = [...fields].sort((a, b) => a.order - b.order);
      const fieldOrder: FieldOrderItem[] = sortedFields.map(field => {
        const isCore = DEFAULT_TICKET_FIELDS.some(f => f.id === field.id);
        return {
          fieldId: isCore ? field.name : field.id,
          fieldType: isCore ? 'core' : 'custom',
        };
      });

      // Build ticketFormConfig for core fields only
      const coreFields = fields.filter(f => DEFAULT_TICKET_FIELDS.some(df => df.id === f.id));
      const ticketFormConfig: Partial<TicketFormConfig> = {};

      coreFields.forEach(field => {
        // Map field names to config keys (use legacy names for backward compatibility)
        let configKey: keyof TicketFormConfig;
        switch (field.name) {
          case 'assignedTo':
            configKey = 'userGroupsOnly';
            break;
          case 'status':
            configKey = 'todo';
            break;
          case 'workflowType':
            configKey = 'workflows';
            break;
          case 'tags':
            configKey = 'labels';
            break;
          default:
            configKey = field.name as keyof TicketFormConfig;
        }

        ticketFormConfig[configKey] = {
          enabled: configKey === 'userGroupsOnly' ? assigneeType === 'userGroup' : true, // userGroupsOnly based on selection, others always true
          mandatory: field.required,
        };
      });

      // Get custom fields
      const customFields = fields.filter(f => !DEFAULT_TICKET_FIELDS.some(df => df.id === f.id));

      // Get existing metadata
      const existingMetadata =
        (boardData && typeof boardData === 'object' && 'metadata' in boardData
          ? (boardData.metadata as BoardMetadata)
          : {}) || {};

      let customFieldsFormId = existingMetadata.customFieldsFormId;

      // Check if form already exists via formMapping
      const existingFormId = formMapping?.formId;

      // Create or update form for custom fields
      // Update if there are custom fields OR if there's an existing form (to handle deletions)
      if (customFields.length > 0 || existingFormId) {
        if (existingFormId) {
          // Update existing form (this will also delete fields not in the array)
          zero.mutate(
            mutators.form.update({
              formId: existingFormId,
              formDescription: `Custom fields for ${boardName || 'board'}`,
              fields: customFields.map(f => ({
                id: f.id, // Include existing field ID for updates
                fieldName: f.name,
                fieldType: mapToFormFieldType(f.type),
                ...(f.options && f.options.length > 0 && { fieldEnum: f.options }),
                isOptional: !f.required,
              })),
              timestamp: Date.now(),
            }),
          );
          customFieldsFormId = existingFormId;
        } else if (customFields.length > 0) {
          // Create new form via API (only if there are fields and no existing form)
          const formResponse = await formService.createForm({
            formName: `${boardName || 'Board'} Custom Fields`,
            formDescription: `Custom fields for ${boardName || 'board'}`,
            contextType: FormContextType.BOARD,
            entityType: FormEntityType.TICKET,
            fields: customFields.map(f => ({
              fieldName: f.name,
              fieldType: mapToFormFieldType(f.type),
              ...(f.options && f.options.length > 0 && { fieldEnum: f.options }),
              isOptional: !f.required,
            })),
          });

          customFieldsFormId = formResponse.id;

          // Create form context mapping
          zero.mutate(
            mutators.formContextMapping.upsert({
              contextId: boardId,
              contextType: FormContextType.BOARD,
              entityType: FormEntityType.TICKET,
              formId: customFieldsFormId,
              mappingId: uuidv4(),
            }),
          );
        }
      }

      // Update board with metadata
      const newMetadata: BoardMetadata = {
        ...existingMetadata,
        fieldOrder,
        ticketFormConfig,
        ...(customFieldsFormId && { customFieldsFormId }),
      };

      const mutatorArgs = {
        boardId,
        name: boardName,
        metadata: newMetadata,
        timestamp: Date.now(),
        stageIds,
      };

      const result = zero.mutate(mutators.board.update(mutatorArgs));
      const res = await result.server;

      if (res.type === 'error') {
        toast.error('Failed to update board', {
          description: res.error.message || 'You do not have permission to modify this board.',
          duration: 5000,
        });
      } else {
        onSave?.();
        onNext?.();
      }
    } catch (error) {
      toast.error('Failed to update board', {
        description: error instanceof Error ? error.message : 'An unexpected error occurred.',
        duration: 5000,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    boardId,
    boardData,
    boardName,
    onSave,
    onNext,
    zero,
    fields,
    formMapping?.formId,
    mode,
    projectId,
  ]);

  if (!isOpen) return null;

  const loading =
    mode === 'edit' ? board === undefined || project === undefined : project === undefined;

  if (loading) {
    return (
      <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/50'>
        <div className='bg-white rounded-lg p-8'>
          <p className='text-xyne-gray-500'>Loading...</p>
        </div>
      </div>
    );
  }

  if (mode === 'edit' && (!board || !projectId)) {
    return (
      <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/50'>
        <div className='bg-white rounded-lg p-8 text-center'>
          <p className='text-xyne-gray-600 mb-4'>Board not found</p>
          <Button onClick={onClose}>Close</Button>
        </div>
      </div>
    );
  }

  if (!projectId) {
    return (
      <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/50'>
        <div className='bg-white rounded-lg p-8 text-center'>
          <p className='text-xyne-gray-600 mb-4'>Project not found</p>
          <Button onClick={onClose}>Close</Button>
        </div>
      </div>
    );
  }

  return (
    <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/50'>
      <div className='bg-white flex flex-col w-[90vw] h-[85vh] rounded-lg shadow-xl overflow-hidden'>
        <header className='flex items-center justify-between px-[18px] py-4'>
          <div className='flex items-center gap-2'>
            <Button
              onClick={() => (onBack ? onBack() : onClose())}
              variant='ghost'
              size='iconSm'
              className='w-[16px] h-[16px] text-[#181b1d] hover:opacity-70'
              data-track-category='BOARD_EDIT'
              data-track-name='NAVIGATE_BACK'
            >
              <ChevronLeft size={16} />
            </Button>
            <span className='text-[16px] font-semibold text-xyne-gray-900'>
              Edit Board - {boardData?.name || 'Board'}
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
              Next
            </Button>
          </div>
        </header>

        <div className='flex-1 flex overflow-hidden'>
          <div className='w-[50%] flex flex-col bg-white overflow-hidden'>
            <div className='p-6 flex-shrink-0'>
              <h2 className='text-[16px] font-semibold text-xyne-gray-900'>Define Fields</h2>
              <p className='text-[14px] text-xyne-gray-600 mt-1'>
                Choose the fields needed in your tickets, arrange their order, and preview how
                they&apos;ll appear.
              </p>
            </div>

            <div className='flex-1 overflow-y-auto p-6 space-y-6'>
              <div className='mt-2 pl-5'>
                <input
                  type='text'
                  value={boardName}
                  onChange={e => setBoardName(e.target.value)}
                  className={`text-[22px] font-semibold bg-transparent border-none focus:outline-none focus:ring-0 p-0 w-full ${
                    boardName ? 'text-xyne-gray-900' : 'text-xyne-gray-300'
                  } placeholder:text-xyne-gray-400 tracking-[-0.44px]`}
                  placeholder='Enter Board Name'
                  data-track-category='form'
                  data-track-name='board-name-input'
                />
              </div>
              <div className='bg-white rounded-lg'>
                <div className='divide'>
                  {fields
                    .sort((a, b) => a.order - b.order)
                    .map(field => (
                      <div key={field.id}>
                        {editingFieldId === field.id ? (
                          // Edit mode - use CustomField component
                          <CustomField
                            mode='edit'
                            field={field}
                            onSave={updatedField => {
                              setFields(prev =>
                                prev.map(f =>
                                  f.id === field.id ? { ...f, ...updatedField, id: field.id } : f,
                                ),
                              );
                              setEditingFieldId(null);
                              setNewFieldName('');
                              setNewFieldType('text');
                              setNewFieldRequired(false);
                              setNewFieldOptions([]);
                            }}
                            onCancel={() => {
                              setEditingFieldId(null);
                              setNewFieldName('');
                              setNewFieldType('text');
                              setNewFieldRequired(false);
                              setNewFieldOptions([]);
                            }}
                          />
                        ) : (
                          // Normal view mode
                          <div
                            draggable
                            onDragStart={() => handleDragStart(field.id)}
                            onDragOver={e => handleDragOver(e, field.id)}
                            onDragEnd={handleDragEnd}
                            onMouseEnter={() => setHoveredFieldId(field.id)}
                            onMouseLeave={() => setHoveredFieldId(null)}
                            onKeyDown={() => {}}
                            role='button'
                            tabIndex={0}
                            onClick={e => {
                              // Make entire row clickable for custom fields
                              if (!DEFAULT_TICKET_FIELDS.some(f => f.id === field.id)) {
                                // Only trigger if clicking on the row background, not on interactive elements
                                const target = e.target as HTMLElement;
                                if (
                                  target.tagName !== 'BUTTON' &&
                                  target.tagName !== 'INPUT' &&
                                  target.tagName !== 'SPAN' &&
                                  !target.closest('button')
                                ) {
                                  e.stopPropagation();
                                  startEditField(field);
                                }
                              }
                            }}
                            className={`flex items-center gap-3 px-4 py-2 transition-colors rounded-[12px] ${
                              isDragging === field.id
                                ? 'bg-xyne-gray-100 opacity-50'
                                : hoveredFieldId === field.id
                                  ? 'bg-xyne-gray-100'
                                  : ''
                            } ${!DEFAULT_TICKET_FIELDS.some(f => f.id === field.id) ? 'cursor-pointer' : 'cursor-move'}`}
                            data-track-category='form'
                            data-track-name='field-row'
                          >
                            {/* Grip icon - visible only on hover, but space is reserved */}
                            <div className='w-4 flex-shrink-0'>
                              {hoveredFieldId === field.id && (
                                <GripVertical size={16} className='text-xyne-gray-300' />
                              )}
                            </div>
                            <div className='flex-1 flex items-center gap-3'>
                              {editingFieldLabelId === field.id ? (
                                <div className='flex items-center min-w-[150px] flex-shrink-0'>
                                  <input
                                    ref={editLabelInputRef}
                                    type='text'
                                    value={editLabelValue}
                                    onChange={e => setEditLabelValue(e.target.value)}
                                    onKeyDown={e => {
                                      if (e.key === 'Enter') {
                                        e.preventDefault();
                                        saveFieldLabel();
                                      } else if (e.key === 'Escape') {
                                        cancelEditFieldLabel();
                                      }
                                    }}
                                    onBlur={saveFieldLabel}
                                    className='font-medium text-xyne-gray-600 text-[14px] leading-[20px] bg-transparent border-0 p-0 focus:outline-none focus:ring-0'
                                    data-track-category='board_edit'
                                    data-track-name='edit_label_input'
                                  />
                                  {field.required && <span className='text-[#ff4f4f] ml-1'>*</span>}
                                </div>
                              ) : (
                                <button
                                  type='button'
                                  onClick={e => {
                                    if (!DEFAULT_TICKET_FIELDS.some(f => f.id === field.id)) {
                                      e.stopPropagation();
                                      startEditFieldLabel(field);
                                    }
                                  }}
                                  className={`font-medium text-xyne-gray-600 text-[14px] leading-[20px] min-w-[150px] flex-shrink-0 text-left bg-transparent border-0 p-0 ${!DEFAULT_TICKET_FIELDS.some(f => f.id === field.id) ? 'cursor-pointer hover:text-xyne-gray-900' : ''}`}
                                  disabled={DEFAULT_TICKET_FIELDS.some(f => f.id === field.id)}
                                  data-track-category='board_edit'
                                  data-track-name='edit_field_label'
                                >
                                  {field.label}
                                  {field.required && <span className='text-[#ff4f4f] ml-1'>*</span>}
                                </button>
                              )}
                              <button
                                type='button'
                                className={`w-[140px] shrink-0 text-left ${
                                  DEFAULT_TICKET_FIELDS.some(f => f.id === field.id) &&
                                  field.name !== 'assignedTo'
                                    ? 'bg-xyne-gray-100 text-xyne-gray-400'
                                    : field.name === 'assignedTo'
                                      ? 'cursor-pointer'
                                      : 'cursor-pointer'
                                }`}
                                onClick={e => {
                                  if (
                                    !DEFAULT_TICKET_FIELDS.some(f => f.id === field.id) ||
                                    field.name === 'assignedTo'
                                  ) {
                                    e.stopPropagation();
                                    if (field.name === 'assignedTo') {
                                      setAssigneeTypeDropdownOpen(!assigneeTypeDropdownOpen);
                                    } else {
                                      startEditField(field);
                                    }
                                  }
                                }}
                                disabled={
                                  DEFAULT_TICKET_FIELDS.some(f => f.id === field.id) &&
                                  field.name !== 'assignedTo'
                                }
                                data-track-category='board_edit'
                                data-track-name='edit_field_type'
                              >
                                {field.name === 'assignedTo' ? (
                                  <div className='relative' ref={assigneeTypeDropdownRef}>
                                    <div className='h-8 w-[140px] rounded-md border border-input bg-background px-3 py-1.5 text-[13px] flex items-center justify-between'>
                                      <span>{assigneeType === 'user' ? 'User' : 'User Group'}</span>
                                      <ChevronDown className='h-4 w-4 text-muted-foreground' />
                                    </div>
                                    {assigneeTypeDropdownOpen && (
                                      <div className='absolute top-full left-0 mt-1 w-[140px] bg-background border border-input rounded-md shadow-lg z-50 overflow-hidden'>
                                        <Button
                                          variant='ghost'
                                          size='sm'
                                          onClick={e => {
                                            e.stopPropagation();
                                            setAssigneeType('user');
                                            setAssigneeTypeDropdownOpen(false);
                                          }}
                                          className='w-full justify-start px-3 py-2 text-[13px] hover:bg-muted'
                                          data-track-category='board_edit'
                                          data-track-name='select_assignee_type_user'
                                        >
                                          <span>User</span>
                                          {assigneeType === 'user' && (
                                            <Check className='h-4 w-4 ml-auto' />
                                          )}
                                        </Button>
                                        <Button
                                          variant='ghost'
                                          size='sm'
                                          onClick={e => {
                                            e.stopPropagation();
                                            setAssigneeType('userGroup');
                                            setAssigneeTypeDropdownOpen(false);
                                          }}
                                          className='w-full justify-start px-3 py-2 text-[13px] hover:bg-muted'
                                          data-track-category='board_edit'
                                          data-track-name='select_assignee_type_user_group'
                                        >
                                          <span>User Group</span>
                                          {assigneeType === 'userGroup' && (
                                            <Check className='h-4 w-4 ml-auto' />
                                          )}
                                        </Button>
                                      </div>
                                    )}
                                  </div>
                                ) : (
                                  <div
                                    className={`h-8 w-[140px] rounded-md border border-input px-3 py-1.5 text-[13px] flex items-center justify-between ${
                                      DEFAULT_TICKET_FIELDS.some(f => f.id === field.id)
                                        ? 'bg-xyne-gray-100 text-xyne-gray-400 cursor-not-allowed'
                                        : 'bg-background text-foreground cursor-pointer hover:bg-muted'
                                    }`}
                                  >
                                    <span>
                                      {fieldTypeOptionsDisplay.find(opt => opt.value === field.type)
                                        ?.label || 'Type'}
                                    </span>
                                    <ChevronDown
                                      className={`h-4 w-4 ${
                                        DEFAULT_TICKET_FIELDS.some(f => f.id === field.id)
                                          ? 'text-xyne-gray-400'
                                          : 'text-muted-foreground'
                                      }`}
                                    />
                                  </div>
                                )}
                              </button>
                            </div>

                            {/* Hover controls - Required toggle and Delete button - space always reserved */}
                            {/* Hide Required toggle for mandatory fields: board, project, channel, status, priority */}
                            <div
                              className={`flex items-center gap-2 ${hoveredFieldId === field.id ? 'visible' : 'invisible'}`}
                            >
                              {!['status', 'priority'].includes(field.name) && (
                                <div className='flex items-center gap-2'>
                                  <span className='text-[13px] text-xyne-gray-900 leading-[18px] tracking-[-0.2px]'>
                                    Required
                                  </span>
                                  <button
                                    onClick={e => {
                                      e.stopPropagation();
                                      setFields(prev =>
                                        prev.map(f =>
                                          f.id === field.id ? { ...f, required: !f.required } : f,
                                        ),
                                      );
                                    }}
                                    className={`w-[28px] h-[18px] rounded-full transition-colors relative flex-shrink-0 ${
                                      field.required ? 'bg-[#6276BE]' : 'bg-xyne-gray-200'
                                    }`}
                                    data-track-category='form'
                                    data-track-name='required-toggle-hover'
                                  >
                                    <span
                                      className={`absolute top-[3px] left-[3px] w-[12px] h-[12px] bg-white rounded-full transition-transform ${
                                        field.required ? 'translate-x-[10px]' : 'translate-x-0'
                                      }`}
                                    />
                                  </button>
                                </div>
                              )}

                              {/* Show delete button only for custom fields */}
                              {!DEFAULT_TICKET_FIELDS.some(f => f.id === field.id) && (
                                <>
                                  <div className='w-[1px] h-[20px] bg-xyne-gray-200 mx-1' />
                                  <Button
                                    onClick={e => {
                                      e.stopPropagation();
                                      setFields(prev => prev.filter(f => f.id !== field.id));
                                    }}
                                    variant='ghost'
                                    size='iconSm'
                                    className='w-6 h-6 text-xyne-gray-400 hover:text-xyne-red-500'
                                    data-track-category='form'
                                    data-track-name='delete-field-hover'
                                  >
                                    <Trash2 size={16} />
                                  </Button>
                                </>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                </div>

                {/* Inline Custom Field Creation */}
                {!editingFieldId && (
                  <div>
                    {isAddingField ? (
                      <div ref={customFieldRef}>
                        <CustomField
                          mode='create'
                          onSave={newField => {
                            const field: TicketField = {
                              ...newField,
                              id: uuidv4(),
                              order: fields.length + 1,
                            };
                            setFields(prev => [...prev, field]);
                            setIsAddingField(false);
                            setNewFieldName('');
                            setNewFieldType('text');
                            setNewFieldRequired(false);
                            setNewFieldOptions([]);
                          }}
                          onCancel={() => {
                            setIsAddingField(false);
                            setNewFieldName('');
                            setNewFieldType('text');
                            setNewFieldRequired(false);
                            setNewFieldOptions([]);
                          }}
                          existingFieldCount={fields.length}
                        />
                      </div>
                    ) : null}

                    {/* + Custom Field button */}
                    <div className='px-4 py-3'>
                      <Button
                        onClick={() => setIsAddingField(true)}
                        variant='ghost'
                        size='sm'
                        className='flex items-center gap-2 text-xyne-primary-600 hover:text-xyne-primary-700 font-medium'
                        data-track-category='form'
                        data-track-name='add-custom-field'
                      >
                        <Plus size={16} />
                        Custom Field
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right Panel - Preview */}
          <TicketPreviewPanel
            onClose={() => {}}
            trackCategory='BOARD_EDIT'
            ticketPreviewContent={
              <TicketPreviewContent
                boardId={boardId || ''}
                ticket={{
                  title: `Sample ticket in ${boardName || 'Board'}`,
                  description:
                    'This is a sample ticket description showing how tickets will look in this board. Users can add detailed descriptions, attachments, and links here.',
                  status: 'Open',
                  statusV2: TicketStatusV2.TODO,
                  priority: TicketPriority.MEDIUM,
                  assignee: 'Neha Joshi',
                  assigneeAvatar: 'NJ',
                  dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toLocaleDateString(
                    'en-US',
                    {
                      day: '2-digit',
                      month: 'short',
                      year: 'numeric',
                    },
                  ),
                  createdBy: 'Neha Joshi',
                  channel: 'Support',
                }}
                fields={mapToPreviewFields(filterFieldsForPreview(fields, ticketFormConfig))}
              />
            }
            createTicketContent={
              <CreateTicketModal
                boardId={boardId || ''}
                fields={mapToCreateModalFields(filterFieldsForPreview(fields, ticketFormConfig))}
              />
            }
          />
        </div>
      </div>
    </div>
  );
};

export default BoardEditScreen;
