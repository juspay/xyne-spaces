import {
  ReactElement,
  type MouseEvent as ReactMouseEvent,
  useState,
  useMemo,
  useCallback,
  useRef,
  useEffect,
} from 'react';
import { GripVertical, Plus, Trash2, Check, ChevronDown, ChevronLeft, Copy } from 'lucide-react';
import { useZero } from '../../../hooks/useZero';
import { queries } from '../../../zero/queries';
import { mutators } from '../../../zero/mutators';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { v4 as uuidv4 } from 'uuid';
import { Button } from '../../../components/ui/Button';
import {
  BoardType,
  FormContextType,
  FormEntityType,
  PRStatusEvent,
  type BoardMetadata,
  type FieldOrderItem,
  type TicketFormConfig,
  type FieldEnumOption,
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
import { getFieldTypeLabel } from './BoardEditScreen.utils';
import { Dialog } from '../../../components/ui/Dialog/Dialog';
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
} from '../../../utils/board';
import { resolveDisplayFormFields } from '../../../utils/board/resolveDisplayFormFields';
import { useConfirmDialog } from '../../../hooks/useConfirmDialog';
import { copyTextToClipboard } from '../../../utils/clipboardUtils';
import Tooltip from '../../ui/Tooltip';

// Type for board data passed to onNext callback
interface BoardData {
  id: string;
  name?: string;
  boardType?: BoardType;
  [key: string]: unknown;
}

interface DuplicateSourceStage {
  id: string;
  name: string;
  eta?: number | null;
  sequenceNumber: number;
  defaultTicketStatusV2?: TicketStatusV2 | null;
  requestApprovalOnEntry?: boolean | null;
  prStatusMappings?: readonly {
    prStatus: PRStatusEvent;
  }[];
  approvers?: readonly {
    userId?: string | null;
  }[];
  formContextMappings?: readonly {
    formId?: string | null;
    form?: {
      id: string;
      formName?: string | null;
    } | null;
    contextType?: string | null;
    entityType?: string | null;
  }[];
}

interface DuplicateSourceBoard {
  id: string;
  name?: string;
  boardType?: BoardType;
  stages?: readonly DuplicateSourceStage[];
}

interface DuplicateSourceTransition {
  id: string;
  fromStageId?: string | null;
  toStageId: string;
  formId?: string | null;
  requiresApproval?: boolean | null;
  bypassApprovalForAutomation?: boolean | null;
  requestApprovalOnEntry?: boolean | null;
  visitSlaMode?: string | null;
  fixedEtaHours?: number | null;
  onReenter?: string | null;
  transitionApprovers?: readonly {
    userId?: string | null;
    roleId?: string | null;
    approverType?: string | null;
  }[];
}

interface ClonedBoardStage {
  id: string;
  name: string;
  eta: number;
  sequenceNumber: number;
  defaultTicketStatusV2: TicketStatusV2;
  requestApprovalOnEntry: boolean;
  prStatusMappings: {
    id: string;
    stageId: string;
    prStatus: PRStatusEvent;
    createdAt: number;
  }[];
  approvers: {
    id: string;
    userId: string;
    stageId: string;
  }[];
  formContextMappings: {
    id: string;
    formId: string;
    contextId: string;
    contextType: FormContextType;
    entityType: FormEntityType;
    form?: {
      id: string;
      formName: string;
    };
  }[];
}

const asDuplicateSourceBoard = (board: unknown): DuplicateSourceBoard | null =>
  board && typeof board === 'object' && 'id' in board ? (board as DuplicateSourceBoard) : null;

const getDuplicateStageFormId = (stage: DuplicateSourceStage): string | undefined =>
  stage.formContextMappings?.find(
    mapping =>
      mapping.formId &&
      String(mapping.contextType) === String(FormContextType.STAGE) &&
      String(mapping.entityType) === String(FormEntityType.TICKET),
  )?.formId ?? undefined;

const getDuplicateFieldName = (fields: readonly TicketField[]): string | null => {
  const seen = new Set<string>();

  for (const field of fields) {
    const fieldName = field.name.trim();
    if (!fieldName) continue;

    const normalizedName = fieldName.toLowerCase();
    if (seen.has(normalizedName)) {
      return fieldName;
    }
    seen.add(normalizedName);
  }

  return null;
};

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
  const { confirm, ConfirmDialog } = useConfirmDialog();

  const [board] = useCachedQuery(queries.getBoardById({ boardId: boardId || '' }), {
    enabled: !!boardId && mode === 'edit',
  });

  // Fetch source board data when duplicating
  const [sourceBoard] = useCachedQuery(
    queries.boardFullDetailById({ boardId: sourceBoardId || '' }),
    {
      enabled: !!sourceBoardId && mode === 'create',
    },
  );

  const [sourceStageTransitions] = useCachedQuery(
    queries.getStageTransitionsByBoardId({ boardId: sourceBoardId || '' }),
    {
      enabled: !!sourceBoardId && mode === 'create',
    },
  );

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
  const [copiedFieldId, setCopiedFieldId] = useState<string | null>(null);

  // Inline custom field creation state
  const [isAddingField, setIsAddingField] = useState(false);
  const [editingFieldId, setEditingFieldId] = useState<string | null>(null);
  const [editingFieldLabelId, setEditingFieldLabelId] = useState<string | null>(null);
  const [editLabelValue, setEditLabelValue] = useState('');
  const [newFieldName, setNewFieldName] = useState('');
  const [newFieldType, setNewFieldType] = useState<TicketField['type']>('text');
  const [newFieldRequired, setNewFieldRequired] = useState(false);
  const [newFieldOptions, setNewFieldOptions] = useState<FieldEnumOption[]>([]);
  const addFieldBoxRef = useRef<HTMLDivElement>(null);
  const customFieldRef = useRef<HTMLDivElement>(null);

  // Names of branch fields scoped to an option — lets CustomField confirm ambiguous renames.
  const getDependentFieldNames = useCallback(
    (optionId: string): string[] =>
      fields.filter(f => f.parentOptionId === optionId).map(f => f.label),
    [fields],
  );

  // Turns a CustomField "create" save payload into a real TicketField — appended to the
  // end of the list, tagged with a branch option id when added as a branch field.
  const buildNewTicketField = useCallback(
    (
      newField: Omit<TicketField, 'id' | 'order'> & { id?: string },
      parentOptionId?: string,
    ): TicketField => {
      const fieldId = newField.id ?? uuidv4();
      return {
        ...newField,
        id: fieldId,
        membershipId: uuidv4(),
        order: fields.length + 1,
        ...(parentOptionId && { parentOptionId }),
      };
    },
    [fields.length],
  );

  // Waiting on the admin to confirm deleting a branch's fields when their parent (or just
  // one of its options) is removed.
  type PendingCascadeDecision = {
    affectedFieldNames: string[];
    onConfirm: () => void;
  };
  const [pendingCascadeDecision, setPendingCascadeDecision] =
    useState<PendingCascadeDecision | null>(null);

  // Applies immediately if nothing would be orphaned; otherwise pauses for a delete confirmation.
  const resolveCascade = useCallback((affectedFields: TicketField[], onConfirm: () => void) => {
    if (affectedFields.length === 0) {
      onConfirm();
      return;
    }
    setPendingCascadeDecision({
      affectedFieldNames: affectedFields.map(f => f.label),
      onConfirm: () => {
        onConfirm();
        setPendingCascadeDecision(null);
      },
    });
  }, []);

  // Branch fields scoped to a specific option — shown as the option's own chip/panel inside
  // CustomField now, rather than a separate always-visible accordion below the field row.
  const getBranchFields = useCallback(
    (optionId: string): TicketField[] => fields.filter(f => f.parentOptionId === optionId),
    [fields],
  );

  // A branch field never has children of its own; this only updates the branch field itself.
  const handleSaveBranchField = useCallback(
    (
      optionId: string,
      updatedField: Omit<TicketField, 'id' | 'order'> & { id?: string },
      existingFieldId?: string,
    ) => {
      if (existingFieldId) {
        setFields(prev =>
          prev.map(f => {
            if (f.id !== existingFieldId) return f;

            const nextFieldId = updatedField.id ?? uuidv4();
            const identityChanged = nextFieldId !== existingFieldId;
            const nextField: TicketField = {
              ...f,
              ...updatedField,
              id: nextFieldId,
              parentOptionId: optionId,
              ...(identityChanged ? { membershipId: uuidv4() } : {}),
            };

            if (updatedField.options) {
              return nextField;
            }

            const { options: _removed, ...fieldWithoutOptions } = nextField;
            return fieldWithoutOptions;
          }),
        );
      } else {
        setFields(prev => [...prev, buildNewTicketField(updatedField, optionId)]);
      }
    },
    [buildNewTicketField],
  );

  const handleDeleteBranchField = useCallback((fieldId: string) => {
    setFields(prev => prev.filter(f => f.id !== fieldId));
  }, []);

  // Saves an edited top-level field, cascading to any branch fields scoped to an option
  // that was actually removed (a rename alone doesn't orphan anything — options are
  // matched by id).
  const handleSaveEditedField = useCallback(
    (field: TicketField, updatedField: Omit<TicketField, 'id' | 'order'> & { id?: string }) => {
      const oldOptionIds = new Set((field.options ?? []).map(o => o.id));
      const newOptionIds = new Set((updatedField.options ?? []).map(o => o.id));
      const removedOptionIds = new Set([...oldOptionIds].filter(id => !newOptionIds.has(id)));
      const affected = fields.filter(
        f => f.parentOptionId && removedOptionIds.has(f.parentOptionId),
      );

      resolveCascade(affected, () => {
        setFields(prev => {
          const nextFieldId = updatedField.id ?? uuidv4();
          const identityChanged = nextFieldId !== field.id;
          const merged = prev.map(f => {
            if (f.id !== field.id) return f;

            const nextField: TicketField = {
              ...f,
              ...updatedField,
              id: nextFieldId,
              ...(identityChanged ? { membershipId: uuidv4() } : {}),
            };

            if (updatedField.options) {
              return nextField;
            }

            const { options: _removed, ...fieldWithoutOptions } = nextField;
            return fieldWithoutOptions;
          });
          return merged.filter(f => !f.parentOptionId || !removedOptionIds.has(f.parentOptionId));
        });
        setEditingFieldId(null);
        setNewFieldName('');
        setNewFieldType('text');
        setNewFieldRequired(false);
        setNewFieldOptions([]);
      });
    },
    [fields, resolveCascade],
  );

  const handleCancelEditField = useCallback(() => {
    setEditingFieldId(null);
    setNewFieldName('');
    setNewFieldType('text');
    setNewFieldRequired(false);
    setNewFieldOptions([]);
  }, []);

  // Whether any open CustomField editor has an unresolved rename/replace decision — blocks
  // the "Next" board-save button too, since a field's own save-blocking can't reach it.
  const [hasPendingOptionDecision, setHasPendingOptionDecision] = useState(false);

  // Assignee type selection (User or User Group)
  const [assigneeType, setAssigneeType] = useState<'user' | 'userGroup'>('user');

  // Dropdown state management for assignee type and field type selectors
  const [assigneeTypeDropdownOpen, setAssigneeTypeDropdownOpen] = useState(false);
  const assigneeTypeDropdownRef = useRef<HTMLDivElement>(null);

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
  const boardMetadata = useMemo(
    () =>
      (boardData && typeof boardData === 'object' && 'metadata' in boardData
        ? (boardData.metadata as BoardMetadata)
        : {}) || {},
    [boardData],
  );
  const boardTypeFromData = useMemo(
    () =>
      boardData && typeof boardData === 'object' && 'boardType' in boardData
        ? ((boardData as { boardType?: BoardType }).boardType ?? BoardType.DEFAULT)
        : BoardType.DEFAULT,
    [boardData],
  );
  const isNonLinearBoardData = boardTypeFromData === BoardType.NON_LINEAR;
  const [showNextStageFormInTicketDetails, setShowNextStageFormInTicketDetails] = useState(false);

  useEffect(() => {
    setShowNextStageFormInTicketDetails(
      !isNonLinearBoardData && (boardMetadata.showNextStageFormInTicketDetails ?? false),
    );
  }, [boardMetadata.showNextStageFormInTicketDetails, isNonLinearBoardData]);

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

  const customFieldsFormId = activeFormMapping?.formId ?? boardMetadata.customFieldsFormId;
  // Duplicating cannot reuse source form membership ids; those rows belong to another form.
  const isDuplicating = mode === 'create' && !!sourceBoardId;

  const activeResolvedCustomFields = useMemo(() => {
    if (!customFieldsFormId) {
      return [];
    }

    return resolveDisplayFormFields(
      customFieldsFormId,
      activeFormMapping?.formFields ? [...activeFormMapping.formFields] : [],
    );
  }, [activeFormMapping?.formFields, customFieldsFormId]);

  useEffect(() => {
    if (activeResolvedCustomFields.length > 0) {
      const idMap = new Map<string, string>();
      if (isDuplicating) {
        for (const field of activeResolvedCustomFields) {
          idMap.set(field.id, uuidv4());
        }
      }

      const customFields: TicketField[] = activeResolvedCustomFields.map(field => {
        const ticketField: TicketField = {
          id: isDuplicating ? (idMap.get(field.id) ?? field.id) : field.id,
          ...(!isDuplicating && field.membershipId ? { membershipId: field.membershipId } : {}),
          name: field.fieldName,
          type: mapFromFormFieldType(field.fieldType),
          label: field.fieldName,
          required: !field.isOptional,
          order: DEFAULT_TICKET_FIELDS.length + field.sequenceNumber,
          visibleInCreate: true,
        };

        if (field.fieldEnum && field.fieldEnum.length > 0) {
          ticketField.options = field.fieldEnum;
        }

        // No remapping needed: parentOptionId points at an id inside fieldEnum, which is
        // copied verbatim above, so it still resolves correctly on the duplicated field.
        if (field.parentOptionId) {
          ticketField.parentOptionId = field.parentOptionId;
        }

        return ticketField;
      });

      setFields(prev => {
        const customFieldsById = new Map(customFields.map(field => [field.id, field]));

        const updatedFields = prev.map(field => {
          const updatedCustomField = customFieldsById.get(field.id);
          if (!updatedCustomField) return field;

          const mergedField: TicketField = {
            ...field,
            ...updatedCustomField,
            order: field.order,
            visibleInCreate: field.visibleInCreate,
          };

          if (updatedCustomField.options) {
            return mergedField;
          }

          const { options: _removed, ...fieldWithoutOptions } = mergedField;
          return fieldWithoutOptions;
        });

        const existingIds = new Set(updatedFields.map(field => field.id));
        const newFields = customFields.filter(field => !existingIds.has(field.id));
        return [...updatedFields, ...newFields];
      });
    }
  }, [activeResolvedCustomFields, isDuplicating]);

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
          let visibleInCreate = field.visibleInCreate;

          if (isCore && ticketFormConfig) {
            const configKey = getFieldConfigKey(field.name);
            const config = ticketFormConfig[configKey as keyof TicketFormConfig];
            if (config && 'mandatory' in config && typeof config.mandatory === 'boolean') {
              required = config.mandatory;
            }
            if (config && 'enabled' in config && typeof config.enabled === 'boolean') {
              visibleInCreate = config.enabled;
            }
          }
          // For custom fields, read visibleInCreate from board metadata
          if (!isCore) {
            const visibilityMap = boardMetadata?.customFieldVisibility;
            const storedVisibility = visibilityMap?.[field.id];
            if (storedVisibility !== undefined) {
              visibleInCreate = storedVisibility;
            }
          }

          return {
            ...field,
            ...(order !== undefined && { order }),
            required,
            visibleInCreate,
          };
        });
      });
    }
  }, [fieldOrderFromMetadata, ticketFormConfig, boardMetadata]);

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

  const handleCopyFieldId = useCallback((e: ReactMouseEvent, fieldId: string) => {
    e.stopPropagation();
    void copyTextToClipboard(fieldId)
      .then(() => {
        toast.success('Field ID copied to clipboard');
        setCopiedFieldId(fieldId);
        window.setTimeout(() => {
          setCopiedFieldId(current => (current === fieldId ? null : current));
        }, 1500);
      })
      .catch(() => {
        toast.error('Failed to copy field ID');
      });
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
      const membershipId = uuidv4();
      const globalFieldId = uuidv4();
      const newField: TicketField = {
        id: globalFieldId,
        membershipId,
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

  const cloneSourceBoardWorkflow = useCallback(
    async (
      newBoardId: string,
      newBoardName: string,
      metadata: BoardMetadata,
    ): Promise<BoardData | null> => {
      if (!sourceBoardId) return null;

      const duplicateSourceBoard = asDuplicateSourceBoard(sourceBoard);
      if (!duplicateSourceBoard) {
        throw new Error('Source board details are still loading');
      }

      const sourceStages = [...(duplicateSourceBoard.stages ?? [])].sort(
        (a, b) => a.sequenceNumber - b.sequenceNumber,
      );
      const clonedBoardBase: BoardData = {
        id: newBoardId,
        name: newBoardName,
        metadata,
        boardType: duplicateSourceBoard.boardType ?? BoardType.DEFAULT,
      };
      if (sourceStages.length === 0) {
        return { ...clonedBoardBase, stages: [] };
      }

      const sourceTransitions = Array.isArray(sourceStageTransitions)
        ? (sourceStageTransitions as DuplicateSourceTransition[])
        : [];
      const formIdMap = new Map<string, string>();

      const cloneForm = async (sourceFormId: string): Promise<string> => {
        const existing = formIdMap.get(sourceFormId);
        if (existing) return existing;

        const sourceForm = await formService.getFormById(sourceFormId);
        const clonedForm = await formService.createForm({
          formName: `${sourceForm.formName} Copy`,
          ...(sourceForm.formDescription && { formDescription: sourceForm.formDescription }),
          contextType: sourceForm.contextType,
          entityType: sourceForm.entityType,
          projectId,
          fields: sourceForm.fields.map(field => {
            const options = field.fieldOptions ?? field.fieldEnum;
            return {
              fieldName: field.fieldName,
              fieldType: field.fieldType,
              ...(Array.isArray(options) && options.length > 0 && { fieldOptions: options }),
              isOptional: field.isOptional,
              ...(field.parentOptionId !== undefined
                ? { parentOptionId: field.parentOptionId }
                : {}),
            };
          }),
        });
        formIdMap.set(sourceFormId, clonedForm.id);
        return clonedForm.id;
      };

      const formIdsToClone = new Set<string>();
      sourceStages.forEach(stage => {
        const formId = getDuplicateStageFormId(stage);
        if (formId) formIdsToClone.add(formId);
      });
      sourceTransitions.forEach(transition => {
        if (transition.formId) formIdsToClone.add(transition.formId);
      });

      for (const formId of formIdsToClone) {
        await cloneForm(formId);
      }

      const sourceStageIdToNewStageId = new Map<string, string>();
      const stageIds: Record<string, string> = {};
      const prStatusMappingIds: Record<string, string> = {};
      sourceStages.forEach(stage => {
        const newStageId = uuidv4();
        sourceStageIdToNewStageId.set(stage.id, newStageId);
        stageIds[String(stage.sequenceNumber)] = newStageId;
        stage.prStatusMappings?.forEach(mapping => {
          prStatusMappingIds[`${stage.sequenceNumber}-${mapping.prStatus}`] = uuidv4();
        });
      });

      const stagesData = sourceStages.map(stage => {
        const sourceFormId = getDuplicateStageFormId(stage);
        const clonedFormId = sourceFormId ? formIdMap.get(sourceFormId) : undefined;
        const stageId = sourceStageIdToNewStageId.get(stage.id);
        if (!stageId) {
          throw new Error(`Failed to allocate copied stage ID for ${stage.name}`);
        }
        return {
          id: stageId,
          name: stage.name,
          eta: stage.eta ?? 0,
          sequenceNumber: stage.sequenceNumber,
          defaultTicketStatusV2: stage.defaultTicketStatusV2 ?? TicketStatusV2.STARTED,
          prStatuses: (stage.prStatusMappings ?? []).map(mapping => mapping.prStatus),
          approverIds: (stage.approvers ?? [])
            .map(approver => approver.userId)
            .filter((userId): userId is string => Boolean(userId)),
          ...(clonedFormId && { formId: clonedFormId }),
          requestApprovalOnEntry: stage.requestApprovalOnEntry ?? false,
        };
      });

      const clonedStagesForInitialBoard: ClonedBoardStage[] = sourceStages.map(stage => {
        const stageId = sourceStageIdToNewStageId.get(stage.id);
        if (!stageId) {
          throw new Error(`Failed to allocate copied stage ID for ${stage.name}`);
        }
        const sourceFormId = getDuplicateStageFormId(stage);
        const clonedFormId = sourceFormId ? formIdMap.get(sourceFormId) : undefined;
        const sourceFormName = stage.formContextMappings?.find(
          mapping => mapping.formId === sourceFormId,
        )?.form?.formName;
        return {
          id: stageId,
          name: stage.name,
          eta: stage.eta ?? 0,
          sequenceNumber: stage.sequenceNumber,
          defaultTicketStatusV2: stage.defaultTicketStatusV2 ?? TicketStatusV2.STARTED,
          requestApprovalOnEntry: stage.requestApprovalOnEntry ?? false,
          prStatusMappings: (stage.prStatusMappings ?? []).map(mapping => ({
            id: prStatusMappingIds[`${stage.sequenceNumber}-${mapping.prStatus}`] ?? uuidv4(),
            stageId,
            prStatus: mapping.prStatus,
            createdAt: Date.now(),
          })),
          approvers: (stage.approvers ?? [])
            .map(approver => approver.userId)
            .filter((userId): userId is string => Boolean(userId))
            .map(userId => ({
              id: `${stageId}-${userId}`,
              userId,
              stageId,
            })),
          formContextMappings: clonedFormId
            ? [
                {
                  id: `${stageId}-form-mapping`,
                  formId: clonedFormId,
                  contextId: stageId,
                  contextType: FormContextType.STAGE,
                  entityType: FormEntityType.TICKET,
                  ...(sourceFormName && {
                    form: {
                      id: clonedFormId,
                      formName: `${sourceFormName} Copy`,
                    },
                  }),
                },
              ]
            : [],
        };
      });

      const updateResult = zero.mutate(
        mutators.board.update({
          boardId: newBoardId,
          name: newBoardName,
          metadata,
          boardType: duplicateSourceBoard.boardType ?? BoardType.DEFAULT,
          timestamp: Date.now(),
          stageIds,
          stages: stagesData,
          prStatusMappingIds,
        }),
      );
      const updateResponse = await updateResult.server;
      if (updateResponse.type === 'error') {
        throw new Error(updateResponse.error.message || 'Failed to copy board stages');
      }

      const transitionsToCopy = sourceTransitions
        .map(transition => {
          const toStageId = sourceStageIdToNewStageId.get(transition.toStageId);
          if (!toStageId) return null;
          const fromStageId = transition.fromStageId
            ? sourceStageIdToNewStageId.get(transition.fromStageId)
            : null;
          if (transition.fromStageId && !fromStageId) return null;
          const clonedFormId = transition.formId ? formIdMap.get(transition.formId) : undefined;
          return {
            id: uuidv4(),
            ...(fromStageId && { fromStageId }),
            toStageId,
            ...(clonedFormId && { formId: clonedFormId }),
            requiresApproval: transition.requiresApproval ?? false,
            bypassApprovalForAutomation: transition.bypassApprovalForAutomation ?? false,
            requestApprovalOnEntry: transition.requestApprovalOnEntry ?? false,
            ...(transition.visitSlaMode && { visitSlaMode: transition.visitSlaMode }),
            ...(transition.fixedEtaHours !== null &&
              transition.fixedEtaHours !== undefined && {
                fixedEtaHours: transition.fixedEtaHours,
              }),
            ...(transition.onReenter && { onReenter: transition.onReenter }),
            approvers: (transition.transitionApprovers ?? [])
              .map(approver => {
                const approverType = approver.approverType ?? 'USER';
                const approverId = approverType === 'ROLE' ? approver.roleId : approver.userId;
                if (!approverId) return null;
                return {
                  id: uuidv4(),
                  approverId,
                  approverType,
                };
              })
              .filter(
                (approver): approver is { id: string; approverId: string; approverType: string } =>
                  approver !== null,
              ),
          };
        })
        .filter((transition): transition is NonNullable<typeof transition> => transition !== null);

      if (transitionsToCopy.length > 0) {
        const transitionResult = zero.mutate(
          mutators.nonLinear.syncTransitions({
            boardId: newBoardId,
            transitions: transitionsToCopy,
            now: Date.now(),
          }),
        );
        const transitionResponse = await transitionResult.server;
        if (transitionResponse?.type === 'error') {
          throw new Error(transitionResponse.error?.message || 'Failed to copy board transitions');
        }
      }

      return { ...clonedBoardBase, stages: clonedStagesForInitialBoard };
    },
    [projectId, sourceBoard, sourceBoardId, sourceStageTransitions, zero],
  );

  const handleSave = useCallback(async () => {
    if (hasPendingOptionDecision) {
      toast.error('Resolve the pending option change before saving.');
      return;
    }

    const duplicateFieldName = getDuplicateFieldName(fields);
    if (duplicateFieldName) {
      toast.error('Field name already exists', {
        description: `A field named "${duplicateFieldName}" already exists. Field names must be unique.`,
        duration: 5000,
      });
      return;
    }

    // Create mode: create board first
    if (!boardId && mode === 'create') {
      let createdBoardIdForCleanup: string | null = null;
      try {
        if (!boardName.trim()) {
          toast.error('Board name is required');
          return;
        }
        // Create custom fields form if there are any custom fields
        const customFields = fields.filter(f => !DEFAULT_TICKET_FIELDS.some(df => df.id === f.id));
        let customFieldsFormId: string | undefined;

        if (customFields.length > 0) {
          const formResponse = await formService.createForm({
            formName: `${boardName.trim()} Custom Fields`,
            formDescription: `Custom fields for ${boardName.trim()}`,
            contextType: FormContextType.BOARD,
            entityType: FormEntityType.TICKET,
            projectId,
            fields: customFields.map(f => ({
              fieldName: f.name,
              fieldType: mapToFormFieldType(f.type),
              ...(f.options && f.options.length > 0 && { fieldOptions: f.options }),
              isOptional: !f.required,
              ...(f.parentOptionId !== undefined ? { parentOptionId: f.parentOptionId } : {}),
            })),
          });
          customFieldsFormId = formResponse.id;
        }

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
              configKey = 'assignedTo';
              break;
            case 'status':
              configKey = 'todo';
              break;
            case 'tags':
              configKey = 'labels';
              break;
            default:
              configKey = field.name as keyof TicketFormConfig;
          }

          ticketFormConfig[configKey] = {
            enabled:
              configKey === 'userGroupsOnly' ? assigneeType === 'userGroup' : field.visibleInCreate, // userGroupsOnly based on selection, others based on visibleInCreate
            mandatory: field.required,
          };
        });

        const initialMetadataBase: BoardMetadata = { ...boardMetadata };
        delete initialMetadataBase.customFieldsFormId;

        const customFieldVisibility: Record<string, boolean> = {};
        customFields.forEach(f => {
          customFieldVisibility[f.id] = f.visibleInCreate;
        });

        const initialMetadata: BoardMetadata = {
          ...initialMetadataBase,
          fieldOrder,
          ticketFormConfig,
          customFieldVisibility,
          ...(!isNonLinearBoardData && { showNextStageFormInTicketDetails }),
          ...(customFieldsFormId && { customFieldsFormId }),
        };

        const response = await apiInstance.post<{
          board: { id: string; name?: string; [key: string]: unknown };
        }>('/boards', {
          name: boardName.trim(),
          projectId: projectId,
          ...(sourceBoardId &&
            asDuplicateSourceBoard(sourceBoard)?.boardType && {
              boardType: asDuplicateSourceBoard(sourceBoard)?.boardType,
            }),
          metadata: initialMetadata,
        });

        const newBoardId = response.data.board.id;
        createdBoardIdForCleanup = newBoardId;

        if (customFieldsFormId) {
          // Create form context mapping
          const mappingResult = zero.mutate(
            mutators.formContextMapping.upsert({
              contextId: newBoardId,
              contextType: FormContextType.BOARD,
              entityType: FormEntityType.TICKET,
              formId: customFieldsFormId,
              mappingId: uuidv4(),
            }),
          );
          const mappingResponse = await mappingResult.server;
          if (mappingResponse?.type === 'error') {
            throw new Error(mappingResponse.error.message || 'Failed to map board form');
          }
        }

        let clonedBoardForNext: BoardData | null = null;
        if (sourceBoardId) {
          clonedBoardForNext = await cloneSourceBoardWorkflow(
            newBoardId,
            boardName.trim(),
            initialMetadata,
          );
        }

        const boardForNext = clonedBoardForNext ?? { ...response.data.board };
        if (sourceBoardId && !clonedBoardForNext) {
          delete boardForNext['stages'];
        }
        createdBoardIdForCleanup = null;

        toast.success('Board created successfully');
        onSave?.();
        onNext?.(boardForNext);
      } catch (error) {
        const cleanupMessages: string[] = [];
        if (createdBoardIdForCleanup) {
          try {
            const deleteResult = zero.mutate(
              mutators.board.delete({ boardId: createdBoardIdForCleanup }),
            );
            const deleteResponse = await deleteResult.server;
            if (deleteResponse?.type === 'error') {
              cleanupMessages.push(deleteResponse.error.message || 'board cleanup failed');
            }
          } catch (cleanupError) {
            cleanupMessages.push(
              cleanupError instanceof Error ? cleanupError.message : 'board cleanup failed',
            );
          }
        }

        const errorMessage =
          error instanceof Error ? error.message : 'An unexpected error occurred.';
        toast.error('Failed to create board', {
          description:
            cleanupMessages.length > 0
              ? `${errorMessage} Cleanup incomplete: ${cleanupMessages.join('; ')}.`
              : errorMessage,
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
            configKey = 'assignedTo';
            break;
          case 'status':
            configKey = 'todo';
            break;
          case 'tags':
            configKey = 'labels';
            break;
          default:
            configKey = field.name as keyof TicketFormConfig;
        }

        ticketFormConfig[configKey] = {
          enabled:
            configKey === 'userGroupsOnly' ? assigneeType === 'userGroup' : field.visibleInCreate, // userGroupsOnly based on selection, others based on visibleInCreate
          mandatory: field.required,
        };
      });

      // Get custom fields
      const customFields = fields.filter(f => !DEFAULT_TICKET_FIELDS.some(df => df.id === f.id));

      // Get existing metadata
      const existingMetadata = boardMetadata;

      let nextCustomFieldsFormId = customFieldsFormId;
      const existingFormId = customFieldsFormId;

      // Create or update form for custom fields
      // Update if there are custom fields OR if there's an existing form (to handle deletions)
      if (customFields.length > 0 || existingFormId) {
        if (existingFormId) {
          const formUpdateResult = zero.mutate(
            mutators.form.update({
              formId: existingFormId,
              projectId,
              formDescription: `Custom fields for ${boardName || 'board'}`,
              fields: customFields.map(f => ({
                id: f.id ?? uuidv4(),
                membershipId: f.membershipId ?? uuidv4(),
                fieldName: f.name,
                fieldType: mapToFormFieldType(f.type),
                ...(f.options && f.options.length > 0 && { fieldOptions: f.options }),
                isOptional: !f.required,
                // Always sent (not just when truthy) so clearing a previously-set
                // parentOptionId actually persists — the mutator only writes it when the key
                // is present at all, null included.
                parentOptionId: f.parentOptionId ?? null,
              })),
              timestamp: Date.now(),
            }),
          );
          const formUpdateRes = await formUpdateResult.server;
          if (formUpdateRes.type === 'error') {
            toast.error('Failed to update custom fields', {
              description: formUpdateRes.error.message,
              duration: 5000,
            });
            return;
          }
          nextCustomFieldsFormId = existingFormId;
        } else if (customFields.length > 0) {
          // Create new form via API (only if there are fields and no existing form)
          const formResponse = await formService.createForm({
            formName: `${boardName || 'Board'} Custom Fields`,
            formDescription: `Custom fields for ${boardName || 'board'}`,
            contextType: FormContextType.BOARD,
            entityType: FormEntityType.TICKET,
            projectId,
            fields: customFields.map(f => ({
              fieldName: f.name,
              fieldType: mapToFormFieldType(f.type),
              ...(f.options && f.options.length > 0 && { fieldOptions: f.options }),
              isOptional: !f.required,
              ...(f.parentOptionId !== undefined ? { parentOptionId: f.parentOptionId } : {}),
            })),
          });

          nextCustomFieldsFormId = formResponse.id;

          // Create form context mapping
          zero.mutate(
            mutators.formContextMapping.upsert({
              contextId: boardId,
              contextType: FormContextType.BOARD,
              entityType: FormEntityType.TICKET,
              formId: nextCustomFieldsFormId,
              mappingId: uuidv4(),
            }),
          );
        }
      }

      const customFieldVisibility: Record<string, boolean> = {};
      customFields.forEach(f => {
        customFieldVisibility[f.id] = f.visibleInCreate;
      });

      // Update board with metadata
      const newMetadata: BoardMetadata = {
        ...existingMetadata,
        fieldOrder,
        ticketFormConfig,
        customFieldVisibility,
        ...(!isNonLinearBoardData && { showNextStageFormInTicketDetails }),
        ...(nextCustomFieldsFormId && { customFieldsFormId: nextCustomFieldsFormId }),
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
    customFieldsFormId,
    mode,
    projectId,
    boardMetadata,
    isNonLinearBoardData,
    showNextStageFormInTicketDetails,
    sourceBoard,
    sourceBoardId,
    cloneSourceBoardWorkflow,
    hasPendingOptionDecision,
  ]);

  if (!isOpen) return null;

  const loading =
    mode === 'edit'
      ? board === undefined || project === undefined
      : project === undefined ||
        (!!sourceBoardId && (sourceBoard === undefined || sourceStageTransitions === undefined));

  if (loading) {
    return (
      <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/50'>
        <div className='bg-background rounded-lg p-8'>
          <p className='text-muted-foreground'>Loading...</p>
        </div>
      </div>
    );
  }

  if (mode === 'edit' && (!board || !projectId)) {
    return (
      <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/50'>
        <div className='bg-background rounded-lg p-8 text-center'>
          <p className='text-xyne-gray-600 mb-4'>Board not found</p>
          <Button
            onClick={onClose}
            data-track-category='form'
            data-track-name='CLOSE_BOARD_NOT_FOUND'
          >
            Close
          </Button>
        </div>
      </div>
    );
  }

  if (!projectId) {
    return (
      <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/50'>
        <div className='bg-background rounded-lg p-8 text-center'>
          <p className='text-xyne-gray-600 mb-4'>Project not found</p>
          <Button
            onClick={onClose}
            data-track-category='form'
            data-track-name='CLOSE_PROJECT_NOT_FOUND'
          >
            Close
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/50'>
      <div className='bg-background flex flex-col w-[90vw] h-[85vh] rounded-lg shadow-xl overflow-hidden border border-border'>
        <header className='flex items-center justify-between px-[18px] py-4'>
          <div className='flex items-center gap-2'>
            <Button
              onClick={() => (onBack ? onBack() : onClose())}
              variant='ghost'
              size='iconSm'
              className='w-[16px] h-[16px] text-foreground hover:opacity-70'
              data-track-category='board_edit'
              data-track-name='NAVIGATE_BACK'
            >
              <ChevronLeft size={16} />
            </Button>
            <span className='text-[16px] font-semibold text-foreground'>
              Edit Board - {boardData?.name || 'Board'}
            </span>
          </div>
          <div className='flex items-center gap-3'>
            <Button
              variant='secondary'
              onClick={onClose}
              data-track-category='form'
              data-track-name='CANCEL_BOARD_EDIT'
            >
              Cancel
            </Button>
            <Button
              className='bg-[#6276BE] hover:bg-[#5060A0] text-white disabled:opacity-50'
              onClick={() => void handleSave()}
              data-track-category='form'
              data-track-name='SAVE_BOARD_EDIT'
              disabled={hasPendingOptionDecision}
              title={
                hasPendingOptionDecision
                  ? 'Resolve the pending option change before saving'
                  : undefined
              }
            >
              Next
            </Button>
          </div>
        </header>

        <div className='flex-1 flex overflow-hidden'>
          <div className='w-[50%] flex flex-col bg-background overflow-hidden'>
            <div className='p-6 flex-shrink-0'>
              <h2 className='text-[16px] font-semibold text-foreground'>Define Fields</h2>
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
                    boardName ? 'text-foreground' : 'text-xyne-gray-300'
                  } placeholder:text-muted-foreground/50 tracking-[-0.44px]`}
                  placeholder='Enter Board Name'
                  data-track-category='form'
                  data-track-name='board-name-input'
                />
              </div>
              <div className='bg-background rounded-lg'>
                <div className='divide'>
                  {fields
                    .filter(f => !f.parentOptionId)
                    .sort((a, b) => a.order - b.order)
                    .map(field => (
                      <div key={field.id}>
                        {editingFieldId === field.id ? (
                          // Edit mode - use CustomField component
                          <CustomField
                            mode='edit'
                            field={field}
                            projectId={projectId}
                            getDependentFieldNames={getDependentFieldNames}
                            onPendingDecisionChange={setHasPendingOptionDecision}
                            getBranchFields={getBranchFields}
                            onSaveBranchField={handleSaveBranchField}
                            onDeleteBranchField={handleDeleteBranchField}
                            onSave={updatedField => handleSaveEditedField(field, updatedField)}
                            onCancel={handleCancelEditField}
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
                                ? 'bg-muted opacity-50'
                                : hoveredFieldId === field.id
                                  ? 'bg-muted'
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
                                    className='font-medium text-muted-foreground text-[14px] leading-[20px] bg-transparent border-0 p-0 focus:outline-none focus:ring-0'
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
                                  className={`font-medium text-muted-foreground text-[14px] leading-[20px] min-w-[150px] flex-shrink-0 text-left bg-transparent border-0 p-0 ${!DEFAULT_TICKET_FIELDS.some(f => f.id === field.id) ? 'cursor-pointer hover:text-foreground' : ''}`}
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
                                    ? 'bg-muted text-muted-foreground'
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
                                        ? 'bg-muted text-muted-foreground cursor-not-allowed'
                                        : 'bg-background text-foreground cursor-pointer hover:bg-muted'
                                    }`}
                                  >
                                    <span>{getFieldTypeLabel(field.type)}</span>
                                    <ChevronDown className='h-4 w-4 text-muted-foreground' />
                                  </div>
                                )}
                              </button>
                            </div>

                            <div className='relative flex items-center shrink-0'>
                              {field.type === 'select' &&
                                field.options &&
                                hoveredFieldId !== field.id &&
                                ((): ReactElement | null => {
                                  const optionIds = new Set(field.options.map(o => o.id));
                                  const branchCount = fields.filter(
                                    f => f.parentOptionId && optionIds.has(f.parentOptionId),
                                  ).length;
                                  if (branchCount === 0) return null;
                                  return (
                                    <span
                                      className='absolute left-0 text-[11px] font-mono px-2 py-[3px] rounded-full bg-[#6276be]/10 text-[#6276be] whitespace-nowrap'
                                      data-track-category='form'
                                      data-track-name='conditional-fields-badge'
                                    >
                                      {branchCount} nested field{branchCount === 1 ? '' : 's'}
                                    </span>
                                  );
                                })()}

                              {!DEFAULT_TICKET_FIELDS.some(f => f.id === field.id) && (
                                <div
                                  className={`shrink-0 ${hoveredFieldId === field.id ? 'visible' : 'invisible'}`}
                                >
                                  {hoveredFieldId === field.id ? (
                                    <Tooltip
                                      content={
                                        copiedFieldId === field.id
                                          ? 'Field ID copied'
                                          : 'Copy field ID'
                                      }
                                      side='top'
                                      delayDuration={200}
                                    >
                                      <Button
                                        type='button'
                                        variant='ghost'
                                        size='iconSm'
                                        className='h-6 w-6 p-0 text-muted-foreground hover:text-foreground'
                                        onClick={e => handleCopyFieldId(e, field.id)}
                                        data-track-category='board_edit'
                                        data-track-name='copy_field_id'
                                      >
                                        {copiedFieldId === field.id ? (
                                          <Check size={14} />
                                        ) : (
                                          <Copy size={14} />
                                        )}
                                      </Button>
                                    </Tooltip>
                                  ) : (
                                    <Button
                                      type='button'
                                      variant='ghost'
                                      size='iconSm'
                                      className='h-6 w-6 p-0 text-muted-foreground'
                                      tabIndex={-1}
                                      data-track-category='board_edit'
                                      data-track-name='copy_field_id'
                                    >
                                      <Copy size={14} />
                                    </Button>
                                  )}
                                </div>
                              )}

                              {/* Hover controls - Required toggle and Delete button - space always reserved */}
                              {/* Hide Required toggle for mandatory fields: board, project, channel, status, priority */}
                              <div
                                className={`flex items-center gap-2 ${hoveredFieldId === field.id ? 'visible' : 'invisible'}`}
                              >
                                {!['status', 'priority'].includes(field.name) && (
                                  <div className='flex items-center gap-2'>
                                    <span className='text-[13px] text-[#505b62] leading-[18px] tracking-[-0.2px]'>
                                      Required
                                    </span>
                                    <button
                                      onClick={e => {
                                        e.stopPropagation();
                                        setFields(prev =>
                                          prev.map(f => {
                                            if (f.id === field.id) {
                                              return {
                                                ...f,
                                                required: !f.required,
                                                visibleInCreate: !f.required
                                                  ? true
                                                  : f.visibleInCreate,
                                              };
                                            }
                                            return f;
                                          }),
                                        );
                                      }}
                                      className={`w-[28px] h-[18px] rounded-full transition-colors relative flex-shrink-0 ${
                                        field.required ? 'bg-[#6276BE]' : 'bg-gray-600'
                                      }`}
                                      data-track-category='form'
                                      data-track-name='required-toggle-hover'
                                    >
                                      <span
                                        className={`absolute top-[3px] left-[3px] w-[12px] h-[12px] bg-background rounded-full transition-transform ${
                                          field.required ? 'translate-x-[10px]' : 'translate-x-0'
                                        }`}
                                      />
                                    </button>
                                  </div>
                                )}

                                {/* Show in Create toggle - for fields that can be hidden in create modal */}
                                {[
                                  'dueDate',
                                  'assignedTo',
                                  'merchantId',
                                  'tags',
                                  'ticketType',
                                ].includes(field.name) && (
                                  <div className='flex items-center gap-2'>
                                    <span className='text-[13px] text-[#505b62] leading-[18px] tracking-[-0.2px]'>
                                      Show in Create
                                    </span>
                                    <button
                                      onClick={e => {
                                        e.stopPropagation();
                                        setFields(prev =>
                                          prev.map(f => {
                                            if (f.id === field.id) {
                                              const newVisibleInCreate = !f.visibleInCreate;
                                              // If hiding the field, it cannot be required
                                              return {
                                                ...f,
                                                visibleInCreate: newVisibleInCreate,
                                                required: newVisibleInCreate ? f.required : false,
                                              };
                                            }
                                            return f;
                                          }),
                                        );
                                      }}
                                      className={`w-[28px] h-[18px] rounded-full transition-colors relative flex-shrink-0 ${
                                        field.visibleInCreate ? 'bg-[#6276BE]' : 'bg-gray-600'
                                      }`}
                                      data-track-category='form'
                                      data-track-name='show-in-create-toggle'
                                    >
                                      <span
                                        className={`absolute top-[3px] left-[3px] w-[12px] h-[12px] bg-background rounded-full transition-transform ${
                                          field.visibleInCreate
                                            ? 'translate-x-[10px]'
                                            : 'translate-x-0'
                                        }`}
                                      />
                                    </button>
                                  </div>
                                )}

                                {!DEFAULT_TICKET_FIELDS.some(f => f.id === field.id) && (
                                  <div
                                    className='flex items-center gap-2'
                                    title='Shown when creating a ticket; field remains available for stage transition forms'
                                  >
                                    <span className='text-[13px] text-[#505b62] leading-[18px] tracking-[-0.2px]'>
                                      Show in Create
                                    </span>
                                    <button
                                      onClick={e => {
                                        e.stopPropagation();
                                        setFields(prev =>
                                          prev.map(f => {
                                            if (f.id === field.id) {
                                              return {
                                                ...f,
                                                visibleInCreate: !f.visibleInCreate,
                                                required: !f.visibleInCreate ? f.required : false,
                                              };
                                            }
                                            return f;
                                          }),
                                        );
                                      }}
                                      className={`w-[28px] h-[18px] rounded-full transition-colors relative flex-shrink-0 ${
                                        field.visibleInCreate ? 'bg-[#6276BE]' : 'bg-gray-600'
                                      }`}
                                      data-track-category='form'
                                      data-track-name='show-in-create-toggle'
                                    >
                                      <span
                                        className={`absolute top-[3px] left-[3px] w-[12px] h-[12px] bg-background rounded-full transition-transform ${
                                          field.visibleInCreate
                                            ? 'translate-x-[10px]'
                                            : 'translate-x-0'
                                        }`}
                                      />
                                    </button>
                                  </div>
                                )}

                                {/* Show delete button only for custom fields */}
                                {!DEFAULT_TICKET_FIELDS.some(f => f.id === field.id) && (
                                  <>
                                    <div className='w-[1px] h-[20px] bg-muted mx-1' />
                                    <Button
                                      onClick={e => {
                                        e.stopPropagation();
                                        void confirm({
                                          title: 'Delete Board Field',
                                          description: `Delete "${field.label}" from this board?`,
                                          confirmLabel: 'Delete',
                                          variant: 'destructive',
                                        }).then(confirmed => {
                                          if (!confirmed) return;

                                          const ownOptionIds = new Set(
                                            (field.options ?? []).map(o => o.id),
                                          );
                                          const affected = fields.filter(
                                            f =>
                                              f.parentOptionId &&
                                              ownOptionIds.has(f.parentOptionId),
                                          );

                                          resolveCascade(affected, () => {
                                            setFields(prev => {
                                              const withoutField = prev.filter(
                                                f => f.id !== field.id,
                                              );
                                              return withoutField.filter(
                                                f =>
                                                  !f.parentOptionId ||
                                                  !ownOptionIds.has(f.parentOptionId),
                                              );
                                            });
                                          });
                                        });
                                      }}
                                      variant='ghost'
                                      size='iconSm'
                                      className='w-6 h-6 text-muted-foreground hover:text-red-500'
                                      data-track-category='form'
                                      data-track-name='delete-field-hover'
                                    >
                                      <Trash2 size={16} />
                                    </Button>
                                  </>
                                )}
                              </div>
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
                          projectId={projectId}
                          onSave={newField => {
                            setFields(prev => [...prev, buildNewTicketField(newField)]);
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
            trackCategory='board_edit'
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

      <Dialog
        open={!!pendingCascadeDecision}
        onOpenChange={open => {
          if (!open) setPendingCascadeDecision(null);
        }}
        title='Delete dependent fields'
      >
        {pendingCascadeDecision &&
          ((): ReactElement => {
            const isSingle = pendingCascadeDecision.affectedFieldNames.length === 1;
            const subj = isSingle ? 'it' : 'they';
            const obj = isSingle ? 'it' : 'them';

            return (
              <div className='p-6 space-y-4'>
                <p className='text-[14px] text-foreground'>
                  {isSingle ? 'This field depends' : 'These fields depend'} on the option
                  you&apos;re removing:{' '}
                  <span className='font-medium'>
                    {pendingCascadeDecision.affectedFieldNames.join(', ')}
                  </span>
                  . Delete {obj} too? {subj === 'it' ? 'It' : 'They'} can&apos;t be left pointing at
                  an option that no longer exists.
                </p>
                <div className='flex justify-end gap-2'>
                  <Button
                    variant='outline'
                    onClick={() => setPendingCascadeDecision(null)}
                    data-track-category='form'
                    data-track-name='cancel-delete-dependent-fields'
                  >
                    Cancel
                  </Button>
                  <Button
                    variant='default'
                    onClick={() => pendingCascadeDecision.onConfirm()}
                    data-track-category='form'
                    data-track-name='delete-dependent-fields'
                  >
                    Delete
                  </Button>
                </div>
              </div>
            );
          })()}
      </Dialog>
      <ConfirmDialog />
    </div>
  );
};

export default BoardEditScreen;
