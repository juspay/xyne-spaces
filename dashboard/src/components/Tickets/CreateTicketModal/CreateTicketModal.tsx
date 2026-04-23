import { useCallback } from 'react';
import { SelectMenuAlignment, SingleSelect } from '@juspay/blend-design-system';
import { useForm } from '@tanstack/react-form';
import { useStore } from '@tanstack/react-store';
import { useZero } from '../../../hooks/useZero';
import { useShareableOrigin } from '../../../hooks/useShareableOrigin';
import {
  AttachmentEntityType,
  BaseTicketType,
  ChannelScopeType,
  FormContextType,
  FormEntityType,
  FormFieldType,
  LookupType,
  TicketPriority,
  TicketStatusV2,
  TicketTag,
  type User as UserType,
} from '@xyne/shared';
import {
  CircleCheck,
  CircleDashed,
  CircleDot,
  CircleX,
  Copy,
  Ellipsis,
  Hash,
  Link as LinkIcon,
  Loader2,
  Paperclip,
  Signature,
  SquareArrowOutUpRight,
  SquareKanban,
  Tag,
  Ticket,
  Trash2,
  User,
  Users,
  WorkflowIcon,
  X,
} from 'lucide-react';
import React, { DragEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { v4 as uuidv4 } from 'uuid';
import { useAuth } from '../../../hooks/useAuth';
import { useAllVisibleChannels } from '../../../hooks/useChannels';
import { useDuplicateTicketCheck } from '../../../hooks/useDuplicateTicketCheck';
import { useTitleGenerator } from '../../../hooks/useTitleGenerator';
import { useUserSearch, useUsers } from '../../../hooks/useUsers';
import { useUserGroups } from '../../../hooks/useUserGroup';
import { useWorkflowTypes } from '../../../hooks/useWorkflowTypes';
import { useBoardSuggestion } from '../../../hooks/useBoardSuggestion';
import { apiInstance } from '../../../services/clients/apiClient';
import { cn } from '../../../utils/classNames';
import { mutators } from '../../../zero/mutators';
import { queries } from '../../../zero/queries';
import { SubTicketCountIcon } from '../../../assets/icons';
import Avatar from '../../ui/Avatar/Avatar';
import { Button } from '../../ui/Button';
import { Dialog } from '../../ui/Dialog';
import { EntityMultiSelector } from '../../ui/EntitySelector/EntityMultiSelector';
import { EntitySelector } from '../../ui/EntitySelector/EntitySelector';
import { AttachmentPreview } from '../../ui/files/AttachmentPreview';
import type { UploadedFile } from '../../ui/files/Files.types';
import Input from '../../ui/Input';
import { ConversationWithTicket } from '../../ui/MessageBubble/MessageBubble.types';
import MultiSelect from '../../ui/MultiSelect';
import RadioGroup, { Radio } from '../../ui/RadioGroup';
import Textarea from '../../ui/Textarea';
import Tooltip from '../../ui/Tooltip';
import { getFilesDimensions } from '../../ui/utils/files';
import { getPriorityOptions, parseAssignee, TAG_COLORS } from './createTicket.utils';
import { DatePicker } from '../../ui/DatePicker/DatePicker';
import { TextShimmer } from './ShimmerText';
import { SearchUserV2 } from '../../ui/SearchUser/SearchUserV2';
import { RenderMessageWithHTML } from '../../Chat/RenderMessageWithHTML/RenderMessageWithHTML';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import type { BoardMetadata } from '../../Board/BoardTicketFormConfig';
import { isReleaseBoard } from '../../../utils/boardUtils';
import { useDraftAttachments } from '../../../hooks/useDraft';

interface CreateTicketModalProps {
  isOpen: boolean;
  onClose: () => void;
  channelId: string;
  projectId: string;
  defaultStageId?: string | undefined;
  selectedBoardId?: string | null;
  selectedBoardName?: string | undefined;
  initialTitle?: string;
  initialDescription?: string;
  initialSubTickets?: Array<{ title: string; description?: string }>;
  initialAssignee?: { type: 'assigneeTo' | 'userGroup'; value: string } | null;
  initialEta?: Date | null;
  initialPriority?: TicketPriority | null;
  initialTags?: string[];
  sourceConversation?: ConversationWithTicket | undefined;
  isFromSubTicket?: boolean;
  isFromAI?: boolean;
  ticketSequence?: { current: number; total: number };
  parentTicketId?: string;
  onBeforeCreate?: (description: string, files: File[]) => Promise<void>;
  onTicketCreated?: (ticket: {
    id: string;
    conversationId?: string;
    xyneId?: string;
    workflowType?: string;
  }) => void;
}

export interface CreateTicketFormData {
  title: string;
  description: string;
  priority: TicketPriority | null;
  status: TicketStatusV2;
  assignee: { type: 'assigneeTo' | 'userGroup'; value: string } | null;
  eta: Date | null;
  tags: string[];
  boardId: string;
  channelId: string;
  workflowType: string;
  files: File[];
  dynamicFields: Record<string, string | string[]>;
  merchantId?: string;
  ticketType?: string;
}

interface TicketResponse {
  id: string;
  conversationId?: string;
  xyneId?: string;
}

interface FieldErrorProps {
  error?: string | undefined;
}

type SubTicketDraft = {
  title: string;
  description?: string;
};

const EMPTY_TAGS: string[] = [];

const normalizeSubTicketDrafts = (
  value?: Array<{ title: string; description?: string }>,
): SubTicketDraft[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map(item => {
      const title = item?.title?.trim() ?? '';
      const description = item?.description?.trim();
      return description ? { title, description } : { title };
    })
    .filter(item => item.title.length > 0);
};

export const CreateTicketModal: React.FC<CreateTicketModalProps> = ({
  isOpen,
  onClose,
  channelId,
  projectId,
  selectedBoardId,
  initialTitle = '',
  initialDescription = '',
  initialSubTickets,
  initialAssignee = null,
  initialEta = null,
  initialPriority = null,
  initialTags = EMPTY_TAGS,
  isFromSubTicket = false,
  isFromAI = false,
  ticketSequence,
  parentTicketId,
  sourceConversation,
  onBeforeCreate,
  onTicketCreated,
}) => {
  const zero = useZero();
  const shareableOrigin = useShareableOrigin();
  const { user } = useAuth();
  const {
    addDroppedFiles: providerAddDroppedFiles,
    removeDroppedFile: providerRemoveDroppedFile,
    clearDroppedFiles: providerClearDroppedFiles,
    getDroppedFilesForEntity,
  } = useDraftAttachments();

  const [searchParams] = useSearchParams();

  const tab = searchParams.get('tab');

  const displayConversation = useMemo(
    () => (sourceConversation && isOpen ? sourceConversation : undefined),
    [sourceConversation, isOpen],
  );

  // Determine if we're creating from conversation or tickets tab
  const isFromTicketsTab = tab === 'tickets' && !sourceConversation;
  // Fetch existing CHAT attachments from INITIAL MESSAGE ONLY using Zero

  const messageIdForQuery =
    sourceConversation && isOpen && displayConversation?.initialMessageId
      ? displayConversation.initialMessageId
      : undefined;

  const [chatAttachments] = useCachedQuery(
    queries.attachmentsByInitialMessage({ initialMessageId: messageIdForQuery || 'nonexistent' }),
    { enabled: !!messageIdForQuery },
  );

  // Track which chat attachments to exclude from the ticket
  const [excludedChatAttachmentIds, setExcludedChatAttachmentIds] = useState<Set<string>>(
    new Set(),
  );

  // Track assignee search
  const [assigneeSearchValue, setAssigneeSearchValue] = useState('');

  // Track dynamic field errors
  const [dynamicFieldErrors, setDynamicFieldErrors] = useState<Record<string, string>>({});

  const hasPopulatedDeployedCommitId = useRef(false);
  // Prefilled subtickets (used by proactive nudge review flow)
  const [subTickets, setSubTickets] = useState<SubTicketDraft[]>([]);
  const [editingSubTicketIndex, setEditingSubTicketIndex] = useState<number | null>(null);
  const [editingSubTicketTitle, setEditingSubTicketTitle] = useState('');
  const [editingSubTicketDescription, setEditingSubTicketDescription] = useState('');

  // File handling state
  const [isDraggingOverModal, setIsDraggingOverModal] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Dynamic field USER search state
  const [dynamicFieldSearchQueries, setDynamicFieldSearchQueries] = useState<
    Record<string, string>
  >({});
  const [dynamicFieldOpenStates, setDynamicFieldOpenStates] = useState<Record<string, boolean>>({});

  // Local state for files when creating from Tickets tab (no DB storage)
  const [ticketLocalFiles, setTicketLocalFiles] = useState<File[]>([]);

  // Load attachments from DraftProvider (conversation case) or use local state (tickets tab)
  const [attachmentsMap, setAttachmentsMap] = useState<Map<string, File | UploadedFile>>(new Map());

  // Load attachments based on source
  useEffect(() => {
    const loadAttachments = () => {
      if (!isOpen) return;

      if (!isFromTicketsTab) {
        // Load from DraftProvider (DB-backed)
        try {
          const map = getDroppedFilesForEntity(
            channelId,
            sourceConversation?.conversationId ?? null,
          );
          setAttachmentsMap(map);
        } catch (error) {
          console.error('Failed to load attachments:', error);
        }
      } else {
        // For tickets tab, local state only
        setAttachmentsMap(new Map());
      }
    };

    void loadAttachments();
  }, [isOpen, isFromTicketsTab, sourceConversation, channelId, getDroppedFilesForEntity]);

  // Unified add file handler
  const addFile = useCallback(
    async (file: File): Promise<void> => {
      if (!isFromTicketsTab) {
        // Use DraftProvider (DB-backed)
        await providerAddDroppedFiles(file, channelId, sourceConversation?.conversationId);
      } else {
        // Use local state (memory only)
        setTicketLocalFiles(prev => [...prev, file]);
      }
    },
    [isFromTicketsTab, providerAddDroppedFiles, channelId, sourceConversation],
  );

  // Unified remove file handler
  const removeFile = useCallback(
    async (attachmentId: string, _file: File): Promise<void> => {
      if (!isFromTicketsTab) {
        // Use DraftProvider
        await providerRemoveDroppedFile(attachmentId);
      } else {
        // Use local state - note: _file parameter is not used for tickets tab since we filter by attachmentId from DraftProvider
        // For tickets tab, we currently don't use the file param but could implement proper filtering in future
        setTicketLocalFiles(prev => prev.filter(() => false)); // Clear handled differently via clearFiles on close
      }
    },
    [isFromTicketsTab, providerRemoveDroppedFile],
  );

  // Clear all files handler
  const clearFiles = useCallback(async () => {
    if (!isFromTicketsTab) {
      await providerClearDroppedFiles(channelId, sourceConversation?.conversationId ?? null);
    } else {
      setTicketLocalFiles([]);
    }
  }, [isFromTicketsTab, providerClearDroppedFiles, channelId, sourceConversation]);

  const channels = useAllVisibleChannels().filter(c => c.scopeType === ChannelScopeType.DEFAULT);

  // Track if title has been auto-generated for this modal session
  const [hasTitleBeenGenerated, setHasTitleBeenGenerated] = useState(false);

  const [newTags, setNewTags] = useState<string[]>([]);

  // Fetch workflow types using optimized hook
  const { workflowTypes } = useWorkflowTypes();

  // Title generator hook
  const {
    title: generatedTitle,
    ticketType: generatedTicketType,
    isGenerating: isTitleGenerating,
    generateFromDescription,
    cancelGeneration,
  } = useTitleGenerator({
    maxLength: 100,
    onError: error => {
      console.error('Title generation error:', error);
    },
  });

  // Form state
  const form = useForm({
    defaultValues: {
      title: initialTitle,
      description: initialDescription,
      priority: initialPriority,
      status: TicketStatusV2.TODO as TicketStatusV2,
      eta: initialEta,
      tags: initialTags,
      assignee: initialAssignee,
      userGroupId: null,
      boardId: selectedBoardId || '',
      channelId: channelId,
      workflowType: '',
      files: [],
      dynamicFields: {},
      merchantId: '',
      ticketType: BaseTicketType.Fix,
    } as CreateTicketFormData,
    onSubmit: async ({ value }) => {
      if (!user) return;
      await handleCreateTicket(value);
    },
  });

  const formValues = useStore(form.store, state => state.values);
  const selectedChannelId = formValues?.channelId;

  // Find selected channel to get its projectId
  const selectedChannel = useMemo(
    () => channels?.find(c => c.id === selectedChannelId),
    [channels, selectedChannelId],
  );

  // Fetch boards for the selected channel's project (or default projectId)
  const selectedChannelProjectId =
    (isFromSubTicket || isFromAI) && selectedChannel?.projectId
      ? selectedChannel.projectId
      : projectId;
  const [boards] = useCachedQuery(
    queries.boardsListByProject({ projectId: selectedChannelProjectId }),
  );

  // Get selected board's metadata for ticket form configuration
  const selectedBoard = useMemo(
    () => boards?.find(b => b.id === formValues.boardId),
    [boards, formValues.boardId],
  );

  const boardMetadata = selectedBoard?.metadata as BoardMetadata | null;

  const ticketFormConfig = boardMetadata?.ticketFormConfig;

  // Determine which fields to show based on board configuration
  const showUserGroupsOnly = ticketFormConfig?.userGroupsOnly?.enabled ?? false;
  const showAssignee = ticketFormConfig?.assignedTo?.enabled ?? true;
  const showDueDate = ticketFormConfig?.dueDate?.enabled ?? true;
  const showTodo = ticketFormConfig?.todo?.enabled ?? true;
  const showWorkflows = ticketFormConfig?.workflows?.enabled ?? true;
  const showLabels = ticketFormConfig?.labels?.enabled ?? true;
  const showMerchantId = ticketFormConfig?.merchantId?.enabled ?? false;

  // Determine which fields are mandatory
  const mandatoryUserGroupsOnly = ticketFormConfig?.userGroupsOnly?.mandatory ?? false;
  const mandatoryAssignee = ticketFormConfig?.assignedTo?.mandatory ?? false;
  const mandatoryDueDate = ticketFormConfig?.dueDate?.mandatory ?? false;
  const mandatoryTodo = ticketFormConfig?.todo?.mandatory ?? false;
  const mandatoryWorkflows = ticketFormConfig?.workflows?.mandatory ?? false;
  const mandatoryLabels = ticketFormConfig?.labels?.mandatory ?? false;
  const mandatoryMerchantId = ticketFormConfig?.merchantId?.mandatory ?? false;

  // Fetch form mapping for the selected board (TICKET entity type)
  const [formMapping] = useCachedQuery(
    queries.getFormMappingByContextId({
      contextId: formValues.boardId || 'nonexistent',
      contextType: FormContextType.BOARD,
      entityType: FormEntityType.TICKET,
    }),
    { enabled: !!formValues.boardId },
  );

  const titleValue = formValues?.title ?? '';
  const descriptionValue = formValues?.description ?? '';

  // Reset dynamic fields when board changes
  useEffect(() => {
    if (formValues?.boardId) {
      form.setFieldValue('dynamicFields', {});
    }
  }, [formValues?.boardId, form]);

  useEffect(() => {
    if (!selectedBoard) return;

    const ticketType = isReleaseBoard(selectedBoard.boardType)
      ? BaseTicketType.Release
      : BaseTicketType.Fix;
    form.setFieldValue('ticketType', ticketType);
  }, [selectedBoard, form]);

  useEffect(() => {
    if (!isOpen || !formMapping?.formFields) return;
    if (!isReleaseBoard(selectedBoard?.boardType)) return;

    const currentDeployedCommitId = getSingleStringValue(
      formValues?.dynamicFields?.['deployedCommitId'] || '',
    );

    if (currentDeployedCommitId || hasPopulatedDeployedCommitId.current) return;

    const fetchLatestDeployedCommitId = async () => {
      try {
        const response = await apiInstance.get<{ latestCommitId: string }>(
          '/commits/analyze/latest-deployed-commit',
        );

        if (response.data?.latestCommitId) {
          form.setFieldValue('dynamicFields', {
            ...formValues?.dynamicFields,
            deployedCommitId: response.data.latestCommitId,
          });
          hasPopulatedDeployedCommitId.current = true;
        }
      } catch (error) {
        console.error('Failed to fetch latest deployed commit ID:', error);
      }
    };

    void fetchLatestDeployedCommitId();
  }, [isOpen, formMapping?.formFields, selectedBoard, form]);
  const {
    duplicateCheck,
    // duplicateCandidate,
    candidateLinks,
    // duplicateCheckError,
    isCheckingDuplicate,
    // isDuplicateReasonExpanded,
    // setIsDuplicateReasonExpanded,
    // triggerDuplicateCheck,
    resetDuplicateState,
  } = useDuplicateTicketCheck({
    title: titleValue,
    description: descriptionValue,
    projectId: selectedChannelProjectId,
    boardId: formValues?.boardId,
    isOpen,
    debounceMs: 2000,
  });

  const {
    boardSuggestion,
    isCheckingBoard: _isCheckingBoard,
    resetBoardSuggestionState,
  } = useBoardSuggestion({
    title: titleValue,
    description: descriptionValue,
    projectId: selectedChannelProjectId,
    currentBoardId: formValues?.boardId || '',
    isOpen,
    debounceMs: 2000,
  });

  // Query all tickets in the project to extract available tags
  const [projectTickets] = useCachedQuery(
    queries.ticketsByProject({ projectId: selectedChannelProjectId }),
  );

  const userGroupOptions = useUserGroups();

  const [ticketTypeOptions] = useCachedQuery(
    queries.lookupValuesByType({ type: LookupType.TICKET_TYPE }),
  );
  const users = useUserSearch(assigneeSearchValue, 15);

  // Fetch all users for dynamic USER fields
  const allUsers = useUsers();

  // Create a map for O(1) user lookups by ID
  const userMap = useMemo<Map<string, UserType>>(() => {
    if (!allUsers) return new Map();
    return new Map(allUsers.map(user => [user.id, user]));
  }, [allUsers]);

  // Combine chat attachments and newly uploaded files for display
  const allAttachments = useMemo(() => {
    const result: Array<{
      id?: string;
      name?: string;
      originalFilename?: string;
      mimetype?: string;
      size?: number;
      url?: string;
      thumbnailUrl?: string | undefined;
      isFromChat?: boolean;
      file?: File | UploadedFile;
    }> = [];

    // Add chat attachments only if creating from a conversation (draft)
    // Exclude any that the user has chosen to remove
    if (sourceConversation && chatAttachments) {
      const chatAtts = chatAttachments
        .filter(
          a => a.entityType === AttachmentEntityType.CHAT && !excludedChatAttachmentIds.has(a.id),
        )
        .map(a => ({
          id: a.id,
          originalFilename: a.originalFilename,
          mimetype: a.mimetype,
          size: a.size,
          url: a.url,
          thumbnailUrl: a.thumbnailUrl ?? undefined,
          isFromChat: true,
        }));
      result.push(...chatAtts);
    }

    // Add newly uploaded files (from DraftProvider or local state)
    if (!isFromTicketsTab) {
      // From DraftProvider (DB)
      const draftFiles = Array.from(attachmentsMap.entries()).map(([attachmentId, file]) => ({
        attachmentId,
        file,
      }));
      draftFiles.forEach(({ attachmentId, file }) => {
        result.push({
          id: attachmentId,
          name: file instanceof File ? file.name : file.originalName,
          file,
          isFromChat: false,
        });
      });
    } else {
      // From local state (memory only)
      ticketLocalFiles.forEach(file => {
        result.push({
          name: file.name,
          file,
          isFromChat: false,
        });
      });
    }

    return result;
  }, [
    chatAttachments,
    attachmentsMap,
    sourceConversation,
    excludedChatAttachmentIds,
    isFromTicketsTab,
    ticketLocalFiles,
  ]);

  // Reset form when modal opens/closes, and set initial values
  useEffect(() => {
    if (isOpen) {
      form.reset();
      setHasTitleBeenGenerated(false); // Reset flag when modal opens
      hasPopulatedDeployedCommitId.current = false;
      setSubTickets(normalizeSubTicketDrafts(initialSubTickets));
      setEditingSubTicketIndex(null);
      setEditingSubTicketTitle('');
      setEditingSubTicketDescription('');
      // Set initial values after reset to ensure they are applied
      if (initialTitle) {
        form.setFieldValue('title', initialTitle);
      }
      if (initialDescription) {
        form.setFieldValue('description', initialDescription);
      }
      if (initialPriority) {
        form.setFieldValue('priority', initialPriority);
      }
      form.setFieldValue('tags', initialTags);
      if (selectedBoardId) {
        form.setFieldValue('boardId', selectedBoardId);
      }
      resetDuplicateState();
    }
  }, [
    isOpen,
    form,
    initialTitle,
    initialDescription,
    initialPriority,
    initialSubTickets,
    initialTags,
    resetDuplicateState,
    selectedBoardId,
  ]);

  // Auto-select first board if none selected or if selected board doesn't exist in current boards
  useEffect(() => {
    if (boards && boards.length > 0) {
      const currentBoardId = form.getFieldValue('boardId');
      // Auto-select if no board selected OR if current board is not in the list
      if (!currentBoardId || !boards.some(board => board.id === currentBoardId)) {
        form.setFieldValue('boardId', boards[0]!.id);
      }
    }
  }, [boards, form]);

  // Auto-generate title when modal opens with a description but no title
  useEffect(() => {
    if (
      isOpen &&
      initialDescription &&
      !initialTitle &&
      !hasTitleBeenGenerated &&
      !isTitleGenerating
    ) {
      // Generate title from description
      setHasTitleBeenGenerated(true); // Set flag to prevent re-triggering
      void generateFromDescription(initialDescription);
    }

    return () => {
      if (isTitleGenerating) {
        cancelGeneration();
      }
    };
  }, [isOpen, initialDescription, initialTitle, hasTitleBeenGenerated, isTitleGenerating]);

  // Update form title and ticket type when generated values are ready
  useEffect(() => {
    if (generatedTitle && !form.getFieldValue('title')) {
      form.setFieldValue('title', generatedTitle);
    }
    // Only set generated ticket type for non-release boards
    if (generatedTicketType && !isReleaseBoard(selectedBoard?.boardType)) {
      form.setFieldValue('ticketType', generatedTicketType);
    }
  }, [form, generatedTitle, generatedTicketType, selectedBoard?.boardType]);

  // File handling functions
  const handleModalDragOver = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOverModal(true);
  };

  const handleModalDragEnter = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOverModal(true);
  };

  const handleModalDragLeave = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    e.stopPropagation();
    // Only set to false if we're leaving the modal content itself
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX;
    const y = e.clientY;
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
      setIsDraggingOverModal(false);
    }
  };

  const handleModalDrop = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOverModal(false);

    const droppedFiles = Array.from(e.dataTransfer.files);
    droppedFiles.forEach(file => void addFile(file));
  };

  const handlePaperclipClick = (): void => {
    fileInputRef.current?.click();
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const selectedFiles = Array.from(e.target.files || []);
    selectedFiles.forEach(file => void addFile(file));

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handlePreviewFile = (_file: File): void => {
    // File preview handled by Attachments component
  };

  const beginEditSubTicket = (index: number): void => {
    const target = subTickets[index];
    if (!target) return;
    setEditingSubTicketIndex(index);
    setEditingSubTicketTitle(target.title);
    setEditingSubTicketDescription(target.description || '');
  };

  const saveEditedSubTicket = (): void => {
    if (editingSubTicketIndex === null) return;
    const title = editingSubTicketTitle.trim();
    if (!title) {
      toast.error('Sub-ticket title cannot be empty');
      return;
    }

    setSubTickets(prev => {
      const next = [...prev];
      next[editingSubTicketIndex] = {
        title,
        ...(editingSubTicketDescription.trim()
          ? { description: editingSubTicketDescription.trim() }
          : {}),
      };
      return next;
    });
    setEditingSubTicketIndex(null);
    setEditingSubTicketTitle('');
    setEditingSubTicketDescription('');
  };

  const deleteSubTicket = (index: number): void => {
    setSubTickets(prev => prev.filter((_, currentIndex) => currentIndex !== index));
    if (editingSubTicketIndex === index) {
      setEditingSubTicketIndex(null);
      setEditingSubTicketTitle('');
      setEditingSubTicketDescription('');
      return;
    }
    if (editingSubTicketIndex !== null && index < editingSubTicketIndex) {
      setEditingSubTicketIndex(editingSubTicketIndex - 1);
    }
  };

  // Helper function to process ticket creation response
  const processTicketCreationResponse = (
    response: { data?: TicketResponse },
    workflowType: string,
  ): void => {
    if (onTicketCreated && response.data?.id) {
      const ticketData: {
        id: string;
        conversationId: string;
        xyneId?: string;
        workflowType?: string;
      } = {
        id: response.data.id,
        conversationId: response.data.conversationId || '',
        ...(response.data.xyneId && { xyneId: response.data.xyneId }),
      };

      if (workflowType) {
        ticketData.workflowType = workflowType;
      }

      onTicketCreated(ticketData);
    }
  };

  const isFormReadyForSubmit = useMemo(() => {
    if (!form.state.isValid || !form.state.isDirty) return false;
    if (!formValues?.title?.trim()) return false;
    if (!formValues?.description?.trim()) return false;
    if (!formValues?.boardId?.trim()) return false;
    if (boards && !boards.some(board => board.id === formValues.boardId)) return false;

    // Validate dynamic fields if form mapping exists
    if (formMapping?.formFields && formMapping.formFields.length > 0) {
      const hasEmptyRequiredFields = formMapping.formFields.some(field => {
        // Only validate required fields (isOptional must be true to skip, otherwise validate)
        if (field.isOptional === true) return false;

        const fieldName = field.fieldName;
        const value = formValues?.dynamicFields?.[fieldName];

        return !value || (typeof value === 'string' && !value.trim());
      });

      if (hasEmptyRequiredFields) return false;
    }

    // Check assignee mandatory
    if (!showUserGroupsOnly && showAssignee && mandatoryAssignee && !formValues?.assignee?.value)
      return false;
    if (showUserGroupsOnly && mandatoryUserGroupsOnly && !formValues?.assignee?.value) return false;

    // Check if any dynamic fields error
    if (Object.keys(dynamicFieldErrors).length > 0) return false;

    return true;
  }, [
    form.state.isValid,
    form.state.isDirty,
    formMapping,
    formValues,
    dynamicFieldErrors,
    showUserGroupsOnly,
    showAssignee,
    mandatoryAssignee,
    mandatoryUserGroupsOnly,
  ]);

  const handleCreateTicket = async (formData: CreateTicketFormData) => {
    if (!user) return;
    try {
      // Validate mandatory board-configured fields
      const mandatoryFieldErrors: string[] = [];

      if (showUserGroupsOnly && mandatoryUserGroupsOnly && !formData.assignee?.value) {
        mandatoryFieldErrors.push('User Group is required');
      }
      if (!showUserGroupsOnly && showAssignee && mandatoryAssignee && !formData.assignee?.value) {
        mandatoryFieldErrors.push('Assignee is required');
      }
      if (showDueDate && mandatoryDueDate && !formData.eta) {
        mandatoryFieldErrors.push('Due Date is required');
      }
      if (showTodo && mandatoryTodo && !formData.status) {
        mandatoryFieldErrors.push('Todo/Status is required');
      }
      if (showWorkflows && mandatoryWorkflows && !formData.workflowType) {
        mandatoryFieldErrors.push('Workflow is required');
      }
      if (showLabels && mandatoryLabels && (!formData.tags || formData.tags.length === 0)) {
        mandatoryFieldErrors.push('Labels are required');
      }
      if (showMerchantId && mandatoryMerchantId && !formData.merchantId?.trim()) {
        mandatoryFieldErrors.push('Merchant ID is required');
      }

      if (mandatoryFieldErrors.length > 0) {
        toast.error('Missing Required Fields', {
          description: mandatoryFieldErrors.join(', '),
        });
        return;
      }

      // Validate dynamic fields if form mapping exists
      if (formMapping?.formFields && formMapping.formFields.length > 0) {
        const errors: Record<string, string> = {};
        let hasErrors = false;

        for (const field of formMapping.formFields) {
          // Only validate required fields (isOptional must be true to skip, otherwise validate)
          if (field.isOptional === true) continue;

          const fieldName = field.fieldName;
          const value = formData.dynamicFields[fieldName];

          if (
            !value ||
            (typeof value === 'string' && !value.trim()) ||
            (Array.isArray(value) && value.length === 0)
          ) {
            errors[fieldName] = `${fieldName} is required`;
            hasErrors = true;
          }
        }

        if (hasErrors) {
          setDynamicFieldErrors(errors);
          return;
        }
      }

      // Split assignee into assignedTo and userGroupId
      const assignedTo = formData.assignee?.type === 'assigneeTo' ? formData.assignee.value : null;
      const userGroupId = formData.assignee?.type === 'userGroup' ? formData.assignee.value : null;
      let createdTicketResponse: TicketResponse | null = null;

      // 1. EXECUTE MESSAGE SENDING FIRST (if handler provided)
      if (onBeforeCreate) {
        // Send the text description as a message immediately
        // Note: We are passing [] for files here so files are only attached to the ticket
        // Change to `sharedAttachments` if you want files on the message instead
        await onBeforeCreate(formData.description, []);
      }

      // Collect draft attachment IDs from DraftProvider (for conversation case)
      const draftAttachmentIds = !isFromTicketsTab ? Array.from(attachmentsMap.keys()) : [];

      // Get files to send - combine both sources
      const draftFiles = !isFromTicketsTab
        ? Array.from(attachmentsMap.values()).filter((f): f is File => f instanceof File)
        : ticketLocalFiles;

      // 2. PROCEED WITH TICKET CREATION
      let response;
      if (draftFiles.length > 0) {
        const formDataPayload = new FormData();

        // Add text fields
        formDataPayload.append('title', formData.title.trim());
        formDataPayload.append('description', formData.description.trim());
        formDataPayload.append('boardId', formData.boardId);
        // For subtickets or AI-initiated tickets, use the selected channel from form; otherwise use the prop
        formDataPayload.append(
          'channelId',
          isFromSubTicket || isFromAI ? formData.channelId : channelId,
        );
        if (selectedChannelProjectId) {
          formDataPayload.append('projectId', selectedChannelProjectId);
        }

        if (assignedTo) {
          formDataPayload.append('assignedTo', assignedTo);
        }
        if (formData.priority) {
          formDataPayload.append('priority', formData.priority);
        }
        if (userGroupId) {
          formDataPayload.append('userGroupId', userGroupId);
        }
        if (formData.status) {
          formDataPayload.append('statusV2', formData.status);
        }
        if (formData.workflowType) {
          formDataPayload.append('workflowType', formData.workflowType);
        }
        if (formData.eta) {
          formDataPayload.append('eta', formData.eta.toISOString());
        }
        if (formData.tags && formData.tags.length > 0) {
          formData.tags.forEach(tag => {
            formDataPayload.append('tags[]', tag);
          });
        }
        if (formData.merchantId) {
          formDataPayload.append('merchantId', formData.merchantId);
        }
        if (parentTicketId) {
          formDataPayload.append('parentTicketId', parentTicketId);
        }
        if (formData.ticketType) {
          formDataPayload.append('ticketType', formData.ticketType);
        }

        formDataPayload.append('createdBy', user.id);
        formDataPayload.append('updatedBy', user.id);

        // Add draft attachment IDs if creating from conversation
        if (draftAttachmentIds.length > 0) {
          draftAttachmentIds.forEach(id => {
            formDataPayload.append('draftAttachmentIds[]', id);
          });
        }

        if (sourceConversation) {
          formDataPayload.append('sourceConversationId', sourceConversation.conversationId);
          if (excludedChatAttachmentIds.size > 0) {
            excludedChatAttachmentIds.forEach(id => {
              formDataPayload.append('excludedChatAttachmentIds[]', id);
            });
          }
        }

        // Extract dimensions for all files (images/videos only)
        const dimensionsMap = await getFilesDimensions(draftFiles);

        // Build file metadata with dimensions
        const fileMetadata: Array<{
          fileIndex: number;
          hasThumbnail: boolean;
          width?: number;
          height?: number;
        }> = [];

        // Add shared attachments (files added via conversation)
        if (draftFiles.length > 0) {
          draftFiles.forEach((file: File, fileIndex: number) => {
            formDataPayload.append('files', file);

            // Get dimensions for this file (null for non-media files)
            const dimensions = dimensionsMap.get(file);
            fileMetadata.push({
              fileIndex,
              hasThumbnail: false,
              ...(dimensions && { width: dimensions.width, height: dimensions.height }),
            });
          });

          // Add file metadata as JSON
          formDataPayload.append('fileMetadata', JSON.stringify(fileMetadata));
        }

        response = await apiInstance.post<TicketResponse>('/tickets', formDataPayload);
        createdTicketResponse = response.data;
        processTicketCreationResponse(response, formData.workflowType);
      } else {
        // No files, use JSON
        response = await apiInstance.post<TicketResponse>('/tickets', {
          title: formData.title.trim(),
          description: formData.description.trim(),
          priority: formData.priority,
          statusV2: formData.status,
          assignedTo: assignedTo || undefined,
          userGroupId: userGroupId || undefined,
          boardId: formData.boardId,
          // For subtickets or AI-initiated tickets, use the selected channel from form; otherwise use the prop
          channelId: isFromSubTicket || isFromAI ? formData.channelId : channelId,
          ...(selectedChannelProjectId && { projectId: selectedChannelProjectId }),
          createdBy: user.id,
          updatedBy: user.id,
          ticketType: formData.ticketType,
          ...(draftAttachmentIds.length > 0 && { draftAttachmentIds }),
          ...(sourceConversation && { eta: formData.eta?.toISOString() }),
          ...(formData.tags && formData.tags.length > 0 && { tags: formData.tags }),
          ...(sourceConversation && { sourceConversationId: sourceConversation.conversationId }),
          ...(formData.workflowType && { workflowType: formData.workflowType }),
          ...(sourceConversation &&
            excludedChatAttachmentIds.size > 0 && {
              excludedChatAttachmentIds: Array.from(excludedChatAttachmentIds),
            }),
          ...(formData.merchantId && { merchantId: formData.merchantId }),
          ...(parentTicketId && { parentTicketId }),
          // Include dynamic fields
          dynamicFields: formData.dynamicFields,
        });

        createdTicketResponse = response.data;
        processTicketCreationResponse(response, formData.workflowType);
      }
      const subticketsToCreate = normalizeSubTicketDrafts(subTickets);
      if (createdTicketResponse?.id && subticketsToCreate.length > 0) {
        const baseTimestamp = Date.now();
        const masterTicketId = createdTicketResponse.id;
        const masterConversationId = createdTicketResponse.conversationId;
        subticketsToCreate.forEach((subTicket, index) => {
          void zero.mutate(
            mutators.subTicket.create({
              subTicketId: uuidv4(),
              mappingId: uuidv4(),
              timestamp: baseTimestamp + index,
              title: subTicket.title,
              ...(subTicket.description ? { description: subTicket.description } : {}),
              ticketId: masterTicketId,
              ...(masterConversationId ? { conversationId: masterConversationId } : {}),
            }),
          );
        });
      }

      // Don't auto-close if part of a sequence - let the parent handle it
      if (!ticketSequence || ticketSequence.current === ticketSequence.total) {
        onClose();
      }
    } catch (error) {
      // Handle file upload failures and other API errors
      console.error('Failed to create ticket:', error);

      // Show error for file upload failures
      toast.error('Ticket Creation Failed', {
        description: 'Failed to upload attachments or create ticket. Please try again.',
      });
    }
  };

  // Clear attachments when modal closes
  const handleClose = (): void => {
    void clearFiles();
    setExcludedChatAttachmentIds(new Set());
    setEditingSubTicketIndex(null);
    setEditingSubTicketTitle('');
    setEditingSubTicketDescription('');
    resetDuplicateState();
    onClose();
  };

  // Handle duplicate ticket copy link
  const handleDuplicateTicketCopyLink = (link: string): void => {
    const ticketUrl = `${shareableOrigin}${link}`;

    navigator.clipboard
      .writeText(ticketUrl)
      .then(() => {
        toast.success('Link Copied', {
          description: 'The link has been copied to your clipboard.',
          duration: 2000,
        });
      })
      .catch(() => {
        toast.error('Link Copy Failed', {
          description: 'Failed to copy the link to your clipboard.',
          duration: 2000,
        });
      });
  };

  // get unique tags from all project tickets
  const availableTags = useMemo(() => {
    if (!projectTickets) return [];

    const tagSet = new Set<string>();
    projectTickets.forEach(t => {
      // Type guard to safely check for tags property
      if ('tags' in t && Array.isArray(t.tags)) {
        const ticketTags = t.tags as TicketTag[];
        ticketTags.forEach(tag => {
          if (tag?.name) {
            tagSet.add(tag.name);
          }
        });
      }
    });

    return Array.from(tagSet).sort();
  }, [projectTickets]);

  // Helper functions for dynamic field value normalization
  const getSingleStringValue = (value: string | string[]): string => {
    if (Array.isArray(value)) {
      return value[0] || '';
    }
    return value;
  };

  const getStringArrayValue = (value: string | string[]): string[] => {
    if (Array.isArray(value)) {
      return value;
    }
    // Only wrap non-empty strings in array
    if (typeof value === 'string' && value.trim()) {
      return [value];
    }
    return []; // Return empty array for empty/undefined values
  };

  // Get board options and memomize them
  const boardOptions = useMemo(
    () =>
      boards?.map(board => ({
        label: board.name,
        value: board.id,
        icon: (
          <span className='bg-blue-500 text-white text-xs aspect-square size-4 rounded text-center'>
            {board.name.charAt(0)}
          </span>
        ),
      })) ?? [],
    [boards],
  );

  // Get status options and memomize them
  const statusOptions = [
    {
      label: 'Todo',
      value: 'TODO',
      icon: <CircleDashed strokeWidth={2.5} className='size-3.5 text-orange-500' />,
    },
    {
      label: 'Started',
      value: 'STARTED',
      icon: <CircleDot strokeWidth={2.5} className='size-3.5 text-blue-500' />,
    },
    {
      label: 'Paused',
      value: 'PAUSED',
      icon: <Signature strokeWidth={2.5} className='size-3.5 text-teal-500' />,
    },
    {
      label: 'Cancelled',
      value: 'CANCELLED',
      icon: <CircleX strokeWidth={2.5} className='size-3.5 text-red-500' />,
    },
    {
      label: 'Completed',
      value: 'COMPLETED',
      icon: <CircleCheck strokeWidth={2.5} className='size-3.5 text-green-500' />,
    },
  ];

  // Channel options for subticket creation
  const channelOptions = useMemo(
    () =>
      channels?.map(channel => ({
        ...channel,
        label: channel.name,
        value: channel.id,
        icon: <Hash className='size-3.5' strokeWidth={2.33} />,
      })) ?? [],
    [channels],
  );

  const assigneeOptions = useMemo(() => {
    const userOptions =
      users?.map(user => ({
        ...user,
        label: user.name || user.email,
        value: `user:${user.id}`,
        icon: (
          <Avatar
            userId={user.id}
            size={'sm'}
            showActiveStatus={false}
            className='rounded-md size-4 flex items-center justify-center'
          />
        ),
        type: 'user' as const,
      })) || [];

    const filteredGroups = assigneeSearchValue.trim()
      ? userGroupOptions
          ?.filter(group => group.isActive !== false)
          .filter(group => group.name.toLowerCase().includes(assigneeSearchValue.toLowerCase()))
      : userGroupOptions?.filter(group => group.isActive !== false);

    const groupOptions =
      filteredGroups?.map(userGroup => ({
        ...userGroup,
        label: userGroup.name,
        value: `userGroup:${userGroup.id}`,
        icon: <Users className='size-3.5' />,
        type: 'userGroup' as const,
      })) || [];

    // If userGroupsOnly is enabled, only show groups, otherwise show both
    return showUserGroupsOnly
      ? groupOptions.sort((a, b) => a.label.localeCompare(b.label))
      : [...userOptions, ...groupOptions].sort((a, b) => a.label.localeCompare(b.label));
  }, [users, userGroupOptions, assigneeSearchValue, showUserGroupsOnly]);

  // Get tag options
  const tagOptions = useMemo(() => {
    const selectedTags = formValues?.tags ?? [];
    const allTags = [...new Set([...availableTags, ...newTags, ...initialTags, ...selectedTags])];

    return allTags
      .filter(tag => typeof tag === 'string' && tag.trim().length > 0)
      .map((tag, index) => ({
        label: tag,
        value: tag,
        icon: <span className={cn('size-1.5 rounded', TAG_COLORS[index % TAG_COLORS.length])} />,
      }));
  }, [availableTags, newTags, initialTags, formValues?.tags]);

  // Get required dynamic fields
  const requiredDynamicFields = useMemo(
    () => formMapping?.formFields.filter(field => field.isOptional === false) || [],
    [formMapping?.formFields],
  );

  // Field error
  const FieldError: React.FC<FieldErrorProps> = ({ error }) => {
    const errorMessage = typeof error === 'string' ? error : undefined;

    return (
      <div
        id='field-error'
        role='alert'
        aria-live='polite'
        className={cn(
          'overflow-hidden transition-[max-height,opacity] duration-200 ease-out',
          error ? 'max-h-10 opacity-100 mt-1' : 'max-h-0 opacity-0',
        )}
      >
        <p className='text-xs text-red-600'>{errorMessage}</p>
      </div>
    );
  };

  if (!isOpen) {
    return null;
  }

  return (
    <Dialog
      open={isOpen}
      onOpenChange={handleClose}
      title='Create Ticket'
      description='Create and edit ticket details before submitting.'
      data-testid='create-ticket-modal'
      className={cn(
        'w-full max-w-screen-md max-h-1/2 rounded-xl border border-border',
        'top-1/3 !-translate-y-1/3',
      )}
    >
      <div
        onDragOver={handleModalDragOver}
        onDragEnter={handleModalDragEnter}
        onDragLeave={handleModalDragLeave}
        onDrop={handleModalDrop}
        className='relative overflow-y-auto max-h-[80vh]'
      >
        {/* Drag overlay */}
        {isDraggingOverModal && (
          <div className='absolute inset-0 bg-blue-50 bg-opacity-90 rounded-lg flex items-center justify-center z-50 pointer-events-none'>
            <div className='text-center'>
              <Paperclip className='w-12 h-12 text-blue-500 mx-auto mb-2' />
              <p className='text-blue-700 font-medium'>Drop files to attach</p>
            </div>
          </div>
        )}

        <div className='w-full px-4 pt-4 pb-3 flex items-center justify-between'>
          <h2 className='text-sm leading-5 font-medium text-muted-foreground select-none'>
            {ticketSequence
              ? `New Ticket (${ticketSequence.current}/${ticketSequence.total})`
              : 'New Ticket'}
          </h2>
          <Button
            variant='ghost'
            size='icon'
            onClick={onClose}
            disabled={form.state.isSubmitting}
            className='size-6 '
            data-track-category='Tickets'
            data-track-name='CloseCreateTicketModal'
          >
            <X strokeWidth={2.33} className='size-3.5' />
          </Button>
        </div>

        <form
          onSubmit={e => {
            e.preventDefault();
            e.stopPropagation();
            void form.handleSubmit();
          }}
          className='px-4 pt-1.5 space-y-0'
        >
          {/* Title Field */}
          <form.Field
            name='title'
            validators={{
              onChange: ({ value }) => {
                if (!value?.trim()) return 'Title is required';
                if (value.length < 3) return 'Title must be at least 3 characters';
                if (value.length > 100) return 'Title must be 100 characters or less';
                return undefined;
              },
            }}
          >
            {field => (
              <div className='space-y-1'>
                {isTitleGenerating ? (
                  <div className='flex h-8 items-center'>
                    <TextShimmer
                      glassEffect={false}
                      className='text-left leading-tight font-bold text-[20px]'
                    >
                      Adding AI generated title
                    </TextShimmer>
                  </div>
                ) : (
                  <Input
                    value={field.state.value}
                    required={true}
                    onChange={e => {
                      // If user starts typing, cancel the ongoing generation
                      if (isTitleGenerating) {
                        cancelGeneration();
                      }
                      field.handleChange(e.target.value);
                    }}
                    aria-label='Ticket Title'
                    placeholder='Issue'
                    data-testid='ticket-title-input'
                    data-track-category='TICKETS'
                    data-track-name='EDIT_TICKET_TITLE'
                    data-track-metadata={JSON.stringify({ boardId: selectedBoardId, channelId })}
                    className={cn(
                      '!text-xl !leading-tight truncate',
                      'px-0 border-none focus-visible:ring-0',
                      'font-bold text-foreground placeholder:text-xl placeholder:text-muted-foreground',
                      field.state.meta.errors.length > 0 && 'text-red-600',
                    )}
                  />
                )}
                <FieldError error={field.state.meta.errors[0]} />
              </div>
            )}
          </form.Field>

          {/* Description Field */}
          <form.Field
            name='description'
            validators={{
              onChange: ({ value }) => {
                if (!value?.trim()) return 'Description is required';
                if (value.length < 5) return 'Description must be at least 5 characters';
                return undefined;
              },
            }}
          >
            {field => (
              <div className='space-y-1'>
                <Textarea
                  rows={2}
                  required={true}
                  aria-required='true'
                  id='ticket-description'
                  value={field.state.value || ''}
                  aria-invalid={field.state.meta.errors.length > 0}
                  placeholder='Add description ...'
                  aria-label='Ticket Description'
                  data-testid='ticket-description-input'
                  data-track-category='TICKETS'
                  data-track-name='EDIT_TICKET_DESCRIPTION'
                  data-track-metadata={JSON.stringify({ boardId: selectedBoardId, channelId })}
                  onChange={e => {
                    const newValue = e.target.value;
                    field.handleChange(newValue);
                  }}
                  className={cn(
                    'border-none focus-visible:ring-0 focus-visible:border-none rounded-none p-0 min-h-16',
                    'placeholder:text-muted-foreground/80 !text-muted-foreground leading-5 font-semibold',
                    field.state.meta.errors.length > 0 && 'text-red-600',
                  )}
                />
                <FieldError error={field.state.meta.errors[0]} />
              </div>
            )}
          </form.Field>

          {subTickets.length > 0 && (
            <div className='mt-2 rounded-md border border-border bg-muted p-3'>
              <div className='mb-2 flex items-center gap-1.5 text-sm font-semibold text-foreground'>
                <SubTicketCountIcon className='shrink-0 text-foreground' />
                <span>{subTickets.length} Sub-tickets</span>
              </div>
              <div className='space-y-2'>
                {subTickets.map((subTicket, index) => {
                  const isEditing = editingSubTicketIndex === index;
                  return (
                    <div
                      key={`subticket-${index}`}
                      className='rounded-lg border border-border bg-background p-[11px]'
                    >
                      {isEditing ? (
                        <div className='flex flex-col gap-2'>
                          <div className='flex items-center justify-between gap-2'>
                            <div className='flex min-w-0 items-center gap-2'>
                              <span className='font-mono text-[12px] font-medium leading-[1.1] text-muted-foreground'>
                                {index + 1}
                              </span>
                              <Input
                                value={editingSubTicketTitle}
                                onChange={e => setEditingSubTicketTitle(e.target.value)}
                                placeholder='Sub-ticket title'
                                className='h-auto border-none p-0 text-[14px] font-medium leading-[18px] text-foreground focus-visible:ring-0'
                              />
                            </div>
                            <button
                              type='button'
                              onClick={saveEditedSubTicket}
                              className='text-[14px] leading-[18px] text-muted-foreground hover:text-muted-foreground'
                              data-track-category='TICKETS'
                              data-track-name='SaveEditedSubTicket'
                              data-track-metadata={JSON.stringify({ subTicketId: subTicket.title })}
                            >
                              Done
                            </button>
                          </div>
                          <Textarea
                            value={editingSubTicketDescription}
                            onChange={e => setEditingSubTicketDescription(e.target.value)}
                            placeholder='Sub-ticket description (optional)'
                            rows={2}
                            className='min-h-0 resize-none border-none p-0 text-[14px] leading-[18px] text-muted-foreground focus-visible:ring-0'
                          />
                        </div>
                      ) : (
                        <div className='flex items-start justify-between gap-3'>
                          <div className='min-w-0 flex-1'>
                            <div className='flex min-w-0 items-center gap-2'>
                              <span className='font-mono text-[12px] font-medium leading-[1.1] text-muted-foreground'>
                                {index + 1}
                              </span>
                              <div className='truncate text-[14px] font-medium leading-[18px] text-foreground'>
                                {subTicket.title}
                              </div>
                            </div>
                            {subTicket.description && (
                              <div className='mt-1 text-[14px] leading-[18px] text-muted-foreground'>
                                {subTicket.description}
                              </div>
                            )}
                          </div>
                          <div className='flex shrink-0 items-center gap-4'>
                            <button
                              type='button'
                              onClick={() => beginEditSubTicket(index)}
                              className='text-[14px] leading-[18px] text-muted-foreground hover:text-muted-foreground'
                              data-track-category='TICKETS'
                              data-track-name='EditSubTicket'
                              data-track-metadata={JSON.stringify({ subTicketId: subTicket.title })}
                            >
                              Edit
                            </button>
                            <button
                              type='button'
                              onClick={() => deleteSubTicket(index)}
                              aria-label={`Delete subticket ${index + 1}`}
                              className='text-muted-foreground hover:text-muted-foreground'
                              data-track-category='TICKETS'
                              data-track-name='DeleteSubTicket'
                              data-track-metadata={JSON.stringify({ subTicketId: subTicket.title })}
                            >
                              <Trash2 className='size-[14px]' />
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Channel and Board Selection */}
          <div className={cn('flex items-center gap-2.5', subTickets.length > 0 && 'pt-4')}>
            {/* Channel Selection - Only for SubTicket creation */}
            {(isFromSubTicket || isFromAI) && (
              <form.Field
                name='channelId'
                validators={{
                  onChange: ({ value }) => {
                    if (!value?.trim()) return 'Channel is required';
                    return undefined;
                  },
                }}
              >
                {field => (
                  <EntitySelector
                    variant='inline'
                    options={channelOptions}
                    selectedValue={field.state.value || ''}
                    onSelect={(value: string | null) =>
                      field.handleChange(value as CreateTicketFormData['channelId'])
                    }
                    searchPlaceholder='channel'
                    placeholder='channel'
                    inputIcon={<Hash className='size-3.5' strokeWidth={2.33} />}
                  />
                )}
              </form.Field>
            )}

            {/* Board Selection */}
            <form.Field
              name='boardId'
              validators={{
                onChange: ({ value }) => {
                  if (!value?.trim()) return 'Board is required';
                  return undefined;
                },
              }}
            >
              {field => (
                <EntitySelector
                  showSearch={false}
                  options={boardOptions}
                  selectedValue={field.state.value || ''}
                  onSelect={(value: string | null) =>
                    field.handleChange(value as CreateTicketFormData['boardId'])
                  }
                  searchPlaceholder='board'
                  placeholder='board'
                  inputIcon={<SquareKanban className='size-3.5' strokeWidth={2.33} />}
                  inputClassName='!h-8 rounded-md'
                  showIndicator={false}
                  testId='ticket-board-selector'
                />
              )}
            </form.Field>
          </div>

          {/* Board Suggestion */}
          {boardSuggestion?.analysis.suggestedBoardId &&
            boardSuggestion.analysis.suggestedBoardId !== formValues?.boardId && (
              <div className='rounded-lg border border-blue-200 bg-blue-50 p-4 mb-2 transition-all duration-200 ease-out'>
                <div className='space-y-2'>
                  <div className='flex items-center justify-between pb-0.5'>
                    <span className='flex items-center gap-2'>
                      <SquareKanban className='size-3' strokeWidth={2.5} />
                      <p className='text-sm font-medium text-foreground leading-5'>
                        Suggested board
                      </p>
                    </span>
                    <Button
                      variant='ghost'
                      size='icon'
                      onClick={resetBoardSuggestionState}
                      className='size-6 '
                    >
                      <X strokeWidth={2.33} className='size-3.5' />
                    </Button>
                  </div>
                  <div className='border border-blue-100 rounded-lg p-2.5 flex items-center justify-between gap-2 bg-background group'>
                    <span className='flex items-center gap-2 overflow-hidden cursor-default'>
                      <p className='text-foreground text-sm font-medium truncate'>
                        {boardSuggestion.analysis.suggestedBoardName || 'Unknown Board'}
                      </p>
                    </span>
                    <span className='opacity-100 flex items-center gap-1'>
                      <Tooltip
                        content='Apply suggestion'
                        side='top'
                        className='text-[10px] font-semibold leading-3  p-1.5'
                      >
                        <Button
                          type='button'
                          variant='ghost'
                          size='icon'
                          className='size-6'
                          onClick={() => {
                            if (boardSuggestion.analysis.suggestedBoardId) {
                              form.setFieldValue(
                                'boardId',
                                boardSuggestion.analysis.suggestedBoardId,
                              );
                            }
                          }}
                        >
                          <CircleCheck className='size-3.5 text-blue-500' />
                        </Button>
                      </Tooltip>
                    </span>
                  </div>
                </div>
              </div>
            )}

          {/* Dynamic Form Fields */}
          {requiredDynamicFields.length > 0 && (
            <div className='space-y-2'>
              <div className='text-sm font-bold text-foreground pb-2'>Additional Information</div>
              <div className='space-y-2 h-full max-h-56 overflow-scroll -mx-4 px-4'>
                {requiredDynamicFields.map(field => {
                  const fieldName = field.fieldName;
                  const fieldType = field.fieldType;
                  const rawValue = formValues?.dynamicFields?.[fieldName] || '';
                  const error = dynamicFieldErrors[fieldName];
                  const isOptional = field.isOptional === true;

                  // Normalize value based on field type
                  const stringValue = getSingleStringValue(rawValue);
                  const arrayValue = getStringArrayValue(rawValue);

                  return (
                    <div key={field.id} className='mb-1'>
                      {(fieldType === FormFieldType.STRING ||
                        fieldType === FormFieldType.NUMBER) && (
                        <>
                          <label className='text-sm font-medium text-foreground'>{`${fieldName}${!isOptional ? '*' : ''}`}</label>
                          <Input
                            value={stringValue}
                            onChange={e => {
                              const value = e.target.value;
                              form.setFieldValue('dynamicFields', {
                                ...formValues?.dynamicFields,
                                [fieldName]: value,
                              });
                              if (value.trim() && error) {
                                setDynamicFieldErrors(prev => {
                                  const newErrors = { ...prev };
                                  delete newErrors[fieldName];
                                  return newErrors;
                                });
                              }
                            }}
                            type={fieldType === FormFieldType.NUMBER ? 'number' : 'text'}
                            placeholder={`Enter ${fieldName.toLowerCase()}`}
                            className={cn(
                              'px-0 border-none focus-visible:ring-0',
                              'font-semibold text-muted-foreground placeholder:text-muted-foreground/80',
                              error && 'text-red-600',
                            )}
                          />
                          <FieldError error={error} />
                        </>
                      )}
                      {fieldType === FormFieldType.DATE && (
                        <>
                          <label className='text-sm font-medium text-foreground'>
                            {fieldName} *
                          </label>
                          <Input
                            value={stringValue}
                            onChange={e => {
                              const value = e.target.value ?? '';
                              form.setFieldValue('dynamicFields', {
                                ...formValues?.dynamicFields,
                                [fieldName]: value,
                              });
                              if (value && error) {
                                setDynamicFieldErrors(prev => {
                                  const newErrors = { ...prev };
                                  delete newErrors[fieldName];
                                  return newErrors;
                                });
                              }
                            }}
                            type='date'
                            className={cn(
                              'px-0 border-none focus-visible:ring-0',
                              'font-semibold text-muted-foreground',
                              error && 'text-red-600',
                            )}
                          />
                          <FieldError error={error} />
                        </>
                      )}
                      {fieldType === FormFieldType.BOOLEAN && (
                        <RadioGroup
                          label={`${fieldName}${!isOptional ? '*' : ''}`}
                          value={stringValue}
                          className='text-xs'
                          onChange={value => {
                            form.setFieldValue('dynamicFields', {
                              ...formValues?.dynamicFields,
                              [fieldName]: value,
                            });
                            if (value && error) {
                              setDynamicFieldErrors(prev => {
                                const newErrors = { ...prev };
                                delete newErrors[fieldName];
                                return newErrors;
                              });
                            }
                          }}
                        >
                          <div className='flex gap-3'>
                            <Radio value='true'>Yes</Radio>
                            <Radio value='false'>No</Radio>
                          </div>
                        </RadioGroup>
                      )}
                      {fieldType === FormFieldType.SINGLE_SELECT && (
                        <SingleSelect
                          label={`${fieldName}${!isOptional ? ' *' : ''}`}
                          placeholder={`Select ${fieldName.toLowerCase()}`}
                          items={[
                            {
                              items:
                                (field.fieldEnum as string[] | undefined)?.map(opt => ({
                                  label: opt,
                                  value: opt,
                                })) || [],
                            },
                          ]}
                          selected={stringValue}
                          onSelect={selected => {
                            form.setFieldValue('dynamicFields', {
                              ...formValues?.dynamicFields,
                              [fieldName]: selected ?? '',
                            });
                            if (selected && error) {
                              setDynamicFieldErrors(prev => {
                                const newErrors = { ...prev };
                                delete newErrors[fieldName];
                                return newErrors;
                              });
                            }
                          }}
                          alignment={SelectMenuAlignment.START}
                          error={!!error}
                          {...(error && { errorMessage: error })}
                        />
                      )}
                      {fieldType === FormFieldType.MULTI_SELECT && (
                        <MultiSelect
                          label={`${fieldName}${!isOptional ? ' *' : ''}`}
                          placeholder={`Select ${fieldName.toLowerCase()}`}
                          options={
                            (field.fieldEnum as string[] | undefined)?.map(opt => ({
                              label: opt,
                              value: opt,
                            })) || []
                          }
                          selectedValues={arrayValue}
                          onChange={newValues => {
                            const cleanedValues = (newValues ?? []).filter(
                              v => !!v && v.trim().length > 0,
                            );

                            form.setFieldValue('dynamicFields', {
                              ...formValues?.dynamicFields,
                              [fieldName]: cleanedValues,
                            });
                            if (!isOptional && cleanedValues.length === 0) {
                              setDynamicFieldErrors(prev => ({
                                ...prev,
                                [fieldName]: `${fieldName} is required`,
                              }));
                            } else {
                              setDynamicFieldErrors(prev => {
                                const next = { ...prev };
                                delete next[fieldName];
                                return next;
                              });
                            }
                          }}
                          error={error || ''}
                        />
                      )}
                      {fieldType === FormFieldType.USER && (
                        <>
                          <label className='text-sm font-medium text-foreground'>{`${fieldName}${!isOptional ? ' *' : ''}`}</label>
                          <div className='border border-input rounded'>
                            <SearchUserV2
                              options={allUsers || []}
                              selectedUsers={arrayValue
                                .map(userId => userMap.get(userId))
                                .filter((user): user is UserType => user !== undefined)}
                              searchQuery={dynamicFieldSearchQueries[fieldName] || ''}
                              onSearchChange={query => {
                                setDynamicFieldSearchQueries(prev => ({
                                  ...prev,
                                  [fieldName]: query,
                                }));
                              }}
                              onSelect={selectedUsers => {
                                const cleanedValues = selectedUsers
                                  .map(u => u.id)
                                  .filter(v => !!v && v.trim().length > 0);

                                form.setFieldValue('dynamicFields', {
                                  ...formValues?.dynamicFields,
                                  [fieldName]: cleanedValues,
                                });
                                if (!isOptional && cleanedValues.length === 0) {
                                  setDynamicFieldErrors(prev => ({
                                    ...prev,
                                    [fieldName]: `${fieldName} is required`,
                                  }));
                                } else {
                                  setDynamicFieldErrors(prev => {
                                    const next = { ...prev };
                                    delete next[fieldName];
                                    return next;
                                  });
                                }
                              }}
                              isOpen={dynamicFieldOpenStates[fieldName] || false}
                              setIsOpen={isOpen => {
                                setDynamicFieldOpenStates(prev => ({
                                  ...prev,
                                  [fieldName]: isOpen,
                                }));
                              }}
                            />
                          </div>
                          {error && <p className='text-xs text-red-600 mt-1'>{error}</p>}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className='py-2'>
            {isCheckingDuplicate && (
              <div className='flex items-center gap-2 text-sm text-muted-foreground'>
                <Loader2 className='h-4 w-4 animate-spin' />
                <span>Checking for duplicates...</span>
              </div>
            )}
            {(duplicateCheck?.candidates?.length ?? 0) > 0 && (
              <div className='rounded-lg border border-border bg-muted p-4 mb-2 transition-all duration-200 ease-out'>
                <div className='space-y-2'>
                  <div className='flex items-center justify-between pb-0.5'>
                    <span className='flex items-center gap-2'>
                      <Copy className='size-3' strokeWidth={2.5} />
                      <p className='text-sm font-medium text-foreground leading-5'>
                        {duplicateCheck?.analysis?.isDuplicate
                          ? 'Duplicate ticket found'
                          : 'Similar tickets found'}
                      </p>
                    </span>
                    <Button
                      variant='ghost'
                      size='icon'
                      onClick={resetDuplicateState}
                      className='size-6 '
                    >
                      <X strokeWidth={2.33} className='size-3.5' />
                    </Button>
                  </div>
                  {(duplicateCheck?.analysis?.isDuplicate
                    ? duplicateCheck?.candidates?.slice(0, 1)
                    : duplicateCheck?.candidates?.slice(0, 5)
                  )?.map(candidate => {
                    const candidateLink = candidateLinks.get(candidate.id);

                    return (
                      <div
                        key={candidate.id}
                        className='border border-border rounded-lg p-2.5 flex items-center justify-between gap-2 group bg-background'
                      >
                        <span className='flex items-center gap-2 overflow-hidden cursor-default'>
                          <p className='text-foreground text-sm font-medium truncate'>
                            <RenderMessageWithHTML message={candidate.title} />
                          </p>
                        </span>
                        <span className='opacity-0 flex items-center gap-1 group-hover:opacity-100 transition-opacity duration-300 '>
                          {candidateLink && (
                            <Tooltip
                              content='Copy Ticket'
                              side='top'
                              className='text-[10px] font-semibold leading-3  p-1.5'
                            >
                              <Button
                                type='button'
                                variant='ghost'
                                size='icon'
                                className='size-6'
                                onClick={() => {
                                  handleDuplicateTicketCopyLink(candidateLink);
                                }}
                                data-track-category='Tickets'
                                data-track-name='CopyDuplicateTicketLink'
                              >
                                <LinkIcon className='size-3.5' />
                              </Button>
                            </Tooltip>
                          )}
                          {candidateLink && (
                            <Tooltip
                              content='Open in new page'
                              side='top'
                              className='text-[10px] font-semibold leading-3 p-1.5 '
                            >
                              <Link to={candidateLink}>
                                <Button
                                  type='button'
                                  variant='ghost'
                                  size='icon'
                                  className='size-6'
                                >
                                  <SquareArrowOutUpRight className='size-3.5' />
                                </Button>
                              </Link>
                            </Tooltip>
                          )}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {allAttachments.length > 0 && (
            <div
              className={cn(
                allAttachments.length === 1
                  ? 'flex flex-col'
                  : allAttachments.length === 2
                    ? 'flex flex-row'
                    : 'grid grid-cols-2',
                'gap-2 py-3',
              )}
            >
              {allAttachments.map(attachment => {
                if (attachment.isFromChat) {
                  if (!attachment.id) return null;
                  const attachmentId = attachment.id;
                  return (
                    <AttachmentPreview
                      key={`chat-${attachmentId}`}
                      file={{
                        id: attachmentId,
                        originalName: attachment.originalFilename || 'Unknown',
                        fileName: attachment.originalFilename || 'Unknown',
                        fileSize: attachment.size || 0,
                        mimeType: attachment.mimetype || 'application/octet-stream',
                        fileUrl: attachment.url || '',
                        thumbnailUrl: attachment.thumbnailUrl ?? '',
                      }}
                      onRemove={() => {
                        // Exclude this chat attachment from the ticket
                        setExcludedChatAttachmentIds(prev => new Set([...prev, attachmentId]));
                      }}
                      onPreview={() => {}}
                      isUploading={form.state.isSubmitting}
                      variant='detailed'
                    />
                  );
                }

                // Handle new uploaded files (removable)
                if (attachment.file) {
                  const isFileObject = attachment.file instanceof File;
                  let fileKey: string;
                  if (isFileObject) {
                    const fileObj = attachment.file as File;
                    fileKey =
                      attachment.id ||
                      `file-${fileObj.name}-${fileObj.size}-${fileObj.lastModified}`;
                  } else {
                    const uploadedFile = attachment.file as UploadedFile;
                    fileKey =
                      attachment.id ||
                      `file-${uploadedFile.originalName}-${uploadedFile.fileSize}-${Date.now()}`;
                  }
                  const fileId = attachment.id || '';
                  return (
                    <AttachmentPreview
                      key={fileKey}
                      file={attachment.file}
                      onRemove={() => {
                        if (fileId) {
                          void removeFile(fileId, {} as File);
                        }
                      }}
                      onPreview={() => {
                        if (isFileObject) {
                          handlePreviewFile(attachment.file as File);
                        }
                      }}
                      isUploading={form.state.isSubmitting}
                      variant='detailed'
                    />
                  );
                }

                return null;
              })}
            </div>
          )}

          <div className='flex flex-wrap items-center gap-2.5 mt-6'>
            {/* Assignee Selection */}
            <form.Field name='assignee'>
              {field => (
                <EntitySelector
                  variant='inline'
                  options={assigneeOptions}
                  selectedValue={
                    field.state.value
                      ? field.state.value.type === 'assigneeTo'
                        ? `user:${field.state.value.value}`
                        : `${field.state.value.type}:${field.state.value.value}`
                      : null
                  }
                  onSelect={(value: string | null) => {
                    field.handleChange(parseAssignee(value));
                    if (!value) {
                      setAssigneeSearchValue('');
                    }
                  }}
                  onSearchChange={setAssigneeSearchValue}
                  searchPlaceholder={
                    showUserGroupsOnly
                      ? `User Groups${mandatoryUserGroupsOnly ? ' *' : ''}`
                      : `Assignee${mandatoryAssignee ? ' *' : ''}`
                  }
                  placeholder={
                    showUserGroupsOnly
                      ? `User Groups${mandatoryUserGroupsOnly ? ' *' : ''}`
                      : `Assignee${mandatoryAssignee ? ' *' : ''}`
                  }
                  inputIcon={
                    showUserGroupsOnly ? (
                      <Users className='size-3.5' strokeWidth={2.33} />
                    ) : (
                      <User className='size-3.5' strokeWidth={2.33} />
                    )
                  }
                  disableClientFiltering={true}
                  showIndicator={false}
                  testId='ticket-assignee-selector'
                />
              )}
            </form.Field>

            {/* Due Date - conditionally rendered */}
            {showDueDate && (
              <form.Field name='eta'>
                {field => {
                  const yesterday = new Date(new Date().setDate(new Date().getDate() - 1));
                  return (
                    <DatePicker
                      selectedDate={field.state.value}
                      onSelect={date => field.handleChange(date)}
                      placeholder={`Due Date${mandatoryDueDate ? ' *' : ''}`}
                      minDate={yesterday}
                      showClearButton
                    />
                  );
                }}
              </form.Field>
            )}

            {/* Status Selection (Todo) - conditionally rendered */}
            {showTodo && (
              <form.Field name='status'>
                {field => (
                  <EntitySelector
                    showSearch={false}
                    options={statusOptions}
                    selectedValue={field.state.value}
                    onSelect={(value: string | null) =>
                      field.handleChange(value as CreateTicketFormData['status'])
                    }
                    searchPlaceholder={`status${mandatoryTodo ? ' *' : ''}`}
                    placeholder={`status${mandatoryTodo ? ' *' : ''}`}
                    inputIcon={<Ellipsis className='size-3.5' strokeWidth={2.33} />}
                    inputClassName='rounded-md h-7 bg-muted'
                    showClearButton={true}
                    showIndicator={false}
                    testId='ticket-status-selector'
                  />
                )}
              </form.Field>
            )}

            {/* Priority Selection */}
            <form.Field name='priority'>
              {field => {
                return (
                  <EntitySelector
                    showSearch={false}
                    options={getPriorityOptions()}
                    selectedValue={field.state.value}
                    onSelect={(value: string | null) =>
                      field.handleChange(value as CreateTicketFormData['priority'])
                    }
                    searchPlaceholder='priority'
                    placeholder='priority'
                    inputIcon={<Ellipsis className='size-3.5 text-foreground' strokeWidth={2.33} />}
                    inputClassName='rounded-md h-7 bg-muted'
                    showClearButton={true}
                    showIndicator={false}
                    testId='ticket-priority-selector'
                  />
                );
              }}
            </form.Field>

            {/* Workflow Type Selection - conditionally rendered */}
            {showWorkflows && (
              <form.Field name='workflowType'>
                {field => {
                  return (
                    <EntitySelector
                      variant='inline'
                      options={workflowTypes.map(workflowType => ({
                        ...workflowType,
                        value: workflowType.id,
                        icon: null,
                      }))}
                      selectedValue={field.state.value}
                      onSelect={value => {
                        field.handleChange(value as CreateTicketFormData['workflowType']);
                      }}
                      searchPlaceholder={`workflows${mandatoryWorkflows ? ' *' : ''}`}
                      placeholder={`workflows${mandatoryWorkflows ? ' *' : ''}`}
                      inputIcon={
                        <WorkflowIcon strokeWidth={2.33} className='size-[14px] text-foreground' />
                      }
                      showIndicator={false}
                      testId='ticket-workflow-selector'
                    />
                  );
                }}
              </form.Field>
            )}

            {/* Tags Selection - conditionally rendered */}
            {showLabels && (
              <form.Field name='tags'>
                {field => (
                  <EntityMultiSelector
                    options={tagOptions}
                    selectedValues={field.state.value}
                    onMultiSelect={(tags: string[]) => field.handleChange(tags)}
                    allowCreate={true}
                    onCreateOption={(value: string) => {
                      setNewTags(prev => [...prev, value]);
                      field.handleChange([...field.state.value, value]);
                    }}
                    placeholder={`Label${mandatoryLabels ? ' *' : ''}`}
                    searchPlaceholder={`Label${mandatoryLabels ? ' *' : ''}`}
                    inputIcon={<Tag strokeWidth={2.33} className='size-3.5' />}
                    showIndicator={false}
                  />
                )}
              </form.Field>
            )}

            {/* Ticket Type Selection */}
            <form.Field name='ticketType'>
              {field => {
                const typeOptions =
                  ticketTypeOptions?.map(type => ({
                    label: type.value,
                    value: type.value,
                    icon: <Ticket className='size-3.5' strokeWidth={2.33} />,
                  })) ?? [];

                return (
                  <EntitySelector
                    showSearch={false}
                    options={typeOptions}
                    selectedValue={field.state.value || ''}
                    onSelect={(value: string | null) =>
                      field.handleChange(value as CreateTicketFormData['ticketType'])
                    }
                    searchPlaceholder='ticket type'
                    placeholder='ticket type'
                    inputIcon={<Ticket className='size-3.5 text-foreground' strokeWidth={2.33} />}
                    inputClassName='rounded-md h-7 bg-muted'
                    showClearButton={true}
                    showIndicator={false}
                  />
                );
              }}
            </form.Field>

            {/* Merchant ID - conditionally rendered */}
            {showMerchantId && (
              <form.Field name='merchantId'>
                {field => (
                  <Input
                    type='text'
                    value={field.state.value || ''}
                    onChange={e => field.handleChange(e.target.value)}
                    placeholder={`Merchant ID${mandatoryMerchantId ? ' *' : ''}`}
                    className='text-sm'
                  />
                )}
              </form.Field>
            )}
          </div>
          <div className='flex justify-between items-center pt-3 pb-4'>
            <Button
              type='button'
              onClick={handlePaperclipClick}
              variant='ghost'
              size='icon'
              title='Attach files'
              disabled={form.state.isSubmitting}
              className='size-6'
              data-testid='ticket-attachment-button'
              data-track-category='TICKETS'
              data-track-name='ATTACH_FILE'
              data-track-metadata={JSON.stringify({
                boardId: selectedBoardId,
                channelId,
                fileCount: allAttachments.length,
              })}
            >
              <Paperclip strokeWidth={2.33} className='size-3.5 text-muted-foreground' />
            </Button>
            <div className='flex items-center gap-3'>
              <Button
                type='submit'
                loading={form.state.isSubmitting}
                disabled={form.state.isSubmitting || !isFormReadyForSubmit}
                className={cn(
                  'px-3 rounded-lg h-8',
                  'text-gray-50 text-sm font-medium bg-sidebar-badge-accent hover:bg-sidebar-badge-accent/80',
                )}
                data-testid='ticket-submit-button'
                data-track-category='TICKETS'
                data-track-name='SUBMIT_CREATE_TICKET_MODAL'
                data-track-metadata={JSON.stringify({
                  boardId: selectedBoardId,
                  channelId,
                  hasAttachments: allAttachments.length > 0,
                  isFromAI,
                })}
              >
                {form.state.isSubmitting ? 'Creating...' : 'Create Ticket'}
              </Button>
              {/* Hidden file input */}
              <input
                ref={fileInputRef}
                type='file'
                multiple
                onChange={handleFileInputChange}
                className='hidden'
                data-testid='ticket-attachment-input'
              />
            </div>
          </div>
        </form>
      </div>
    </Dialog>
  );
};
