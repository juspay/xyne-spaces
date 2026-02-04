import { SelectMenuAlignment, SingleSelect } from '@juspay/blend-design-system';
import { useForm } from '@tanstack/react-form';
import { useStore } from '@tanstack/react-store';
import {
  AttachmentEntityType,
  ChannelScopeType,
  FormContextType,
  FormEntityType,
  FormFieldType,
  TicketPriority,
  TicketStatusV2,
  TicketTag,
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
  User,
  Users,
  WorkflowIcon,
  X,
} from 'lucide-react';
import React, { DragEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { useDragDropFiles } from '../../../contexts/DragDropFileContext';
import { useAuth } from '../../../hooks/useAuth';
import { useAllVisibleChannels } from '../../../hooks/useChannels';
import { useDuplicateTicketCheck } from '../../../hooks/useDuplicateTicketCheck';
import { useTitleGenerator } from '../../../hooks/useTitleGenerator';
import { useUserSearch } from '../../../hooks/useUsers';
import { useWorkflowTypes } from '../../../hooks/useWorkflowTypes';
import { apiInstance } from '../../../services/clients/apiClient';
import { cn } from '../../../utils/classNames';
import { queries } from '../../../zero/queries';
import Avatar from '../../ui/Avatar/Avatar';
import { Button } from '../../ui/Button';
import { Dialog } from '../../ui/Dialog';
import { EntityMultiSelector } from '../../ui/EntitySelector/EntityMultiSelector';
import { EntitySelector } from '../../ui/EntitySelector/EntitySelector';
import { AttachmentPreview } from '../../ui/files/AttachmentPreview';
import Input from '../../ui/Input';
import { ConversationWithTicket } from '../../ui/MessageBubble/MessageBubble.types';
import MultiSelect from '../../ui/MultiSelect';
import RadioGroup, { Radio } from '../../ui/RadioGroup';
import Textarea from '../../ui/Textarea';
import Tooltip from '../../ui/Tooltip';
import { getFilesDimensions } from '../../ui/utils/files';
import { getPriorityOptions, getSourceId, parseAssignee, TAG_COLORS } from './createTicket.utils';
import { InlineCalendar } from './DateSelector';
import { TextShimmer } from './ShimmerText';
import { UserMultiSelect } from './UserMultiSelect';
import { RenderMessageWithHTML } from '../../Chat/RenderMessageWithHTML/RenderMessageWithHTML';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import type { BoardMetadata } from '@xyne/shared';

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
  initialAssignee?: { type: 'assigneeTo' | 'userGroup'; value: string } | null;
  initialEta?: Date | null;
  sourceConversation?: ConversationWithTicket | undefined;
  isFromSubTicket?: boolean;
  isFromAI?: boolean;
  ticketSequence?: { current: number; total: number };
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
}

interface TicketResponse {
  id: string;
  conversationId?: string;
  xyneId?: string;
}

interface FieldErrorProps {
  error?: string | undefined;
}

export const CreateTicketModal: React.FC<CreateTicketModalProps> = ({
  isOpen,
  onClose,
  channelId,
  projectId,
  selectedBoardId,
  initialTitle = '',
  initialDescription = '',
  initialAssignee = null,
  initialEta = null,
  isFromSubTicket = false,
  isFromAI = false,
  ticketSequence,
  sourceConversation,
  onBeforeCreate,
  onTicketCreated,
}) => {
  const { user } = useAuth();
  const {
    droppedFiles: sharedAttachments,
    addDroppedFile: addAttachment,
    removeDroppedFile: removeAttachment,
    clearDroppedFiles: clearAttachments,
  } = useDragDropFiles();

  const [searchParams] = useSearchParams();

  const tab = searchParams.get('tab');

  const sourceId = getSourceId(sourceConversation, tab, channelId);

  const displayConversation = useMemo(
    () => (sourceConversation && isOpen ? sourceConversation : undefined),
    [sourceConversation, isOpen],
  );
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

  // File handling state
  const [isDraggingOverModal, setIsDraggingOverModal] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const channels = useAllVisibleChannels().filter(c => c.scopeType === ChannelScopeType.DEFAULT);

  // Track if title has been auto-generated for this modal session
  const [hasTitleBeenGenerated, setHasTitleBeenGenerated] = useState(false);

  const [newTags, setNewTags] = useState<string[]>([]);

  // Fetch workflow types using optimized hook
  const { workflowTypes } = useWorkflowTypes();

  // Title generator hook
  const {
    title: generatedTitle,
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
      priority: null,
      status: TicketStatusV2.TODO as TicketStatusV2,
      eta: initialEta,
      tags: [],
      assignee: initialAssignee,
      userGroupId: null,
      boardId: selectedBoardId || '',
      channelId: channelId,
      workflowType: '',
      files: [],
      dynamicFields: {},
      merchantId: '',
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
  const selectedProjectId =
    (isFromSubTicket || isFromAI) && selectedChannel?.projectId
      ? selectedChannel.projectId
      : projectId;
  const [boards] = useCachedQuery(queries.boardsByProject({ projectId: selectedProjectId }));

  // Get selected board's metadata for ticket form configuration
  const selectedBoard = useMemo(
    () => boards?.find(b => b.id === formValues.boardId),
    [boards, formValues.boardId],
  );

  const boardMetadata = selectedBoard?.metadata as BoardMetadata | null;

  const ticketFormConfig = boardMetadata?.ticketFormConfig;

  // Determine which fields to show based on board configuration
  const showUserGroupsOnly = ticketFormConfig?.userGroupsOnly?.enabled ?? false;
  const showDueDate = ticketFormConfig?.dueDate?.enabled ?? true;
  const showTodo = ticketFormConfig?.todo?.enabled ?? true;
  const showWorkflows = ticketFormConfig?.workflows?.enabled ?? true;
  const showLabels = ticketFormConfig?.labels?.enabled ?? true;
  const showMerchantId = ticketFormConfig?.merchantId?.enabled ?? false;

  // Determine which fields are mandatory
  const mandatoryUserGroupsOnly = ticketFormConfig?.userGroupsOnly?.mandatory ?? false;
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

  const {
    duplicateCheck,
    // duplicateCandidate,
    duplicateCandidateLink,
    // duplicateCheckError,
    isCheckingDuplicate,
    // isDuplicateReasonExpanded,
    // setIsDuplicateReasonExpanded,
    // triggerDuplicateCheck,
    resetDuplicateState,
  } = useDuplicateTicketCheck({
    title: titleValue,
    description: descriptionValue,
    projectId,
    boardId: formValues?.boardId,
    isOpen,
    debounceMs: 2000,
  });
  // Query all tickets in the project to extract available tags
  const [projectTickets] = useCachedQuery(queries.ticketsByProject({ projectId: projectId }));

  const [userGroupOptions] = useCachedQuery(queries.getAllUserGroups());

  const users = useUserSearch(assigneeSearchValue, 15);

  // Combine chat attachments and shared attachments for display
  // Only show attachments if we have a sourceConversationId (draft conversation)
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
      file?: File;
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

    // Add shared attachments (newly uploaded files)
    const currentSharedFiles = sharedAttachments[sourceId] || [];

    currentSharedFiles.forEach(file => {
      result.push({
        name: file.name,
        file,
        isFromChat: false,
      });
    });

    return result;
  }, [chatAttachments, sharedAttachments, sourceId, sourceConversation, excludedChatAttachmentIds]);

  // Reset form when modal opens/closes, and set initial values
  useEffect(() => {
    if (isOpen) {
      form.reset();
      setHasTitleBeenGenerated(false); // Reset flag when modal opens
      // Set initial values after reset to ensure they are applied
      if (initialTitle) {
        form.setFieldValue('title', initialTitle);
      }
      if (initialDescription) {
        form.setFieldValue('description', initialDescription);
      }
      if (selectedBoardId) {
        form.setFieldValue('boardId', selectedBoardId);
      }
      resetDuplicateState();
    }
  }, [isOpen, form, initialTitle, initialDescription, resetDuplicateState, selectedBoardId]);

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

  // Update form title when generated title is ready
  useEffect(() => {
    if (generatedTitle && !form.getFieldValue('title')) {
      form.setFieldValue('title', generatedTitle);
    }
  }, [form, generatedTitle]);

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
    droppedFiles.forEach(file => addAttachment(sourceId, file));
  };

  const handlePaperclipClick = (): void => {
    fileInputRef.current?.click();
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const selectedFiles = Array.from(e.target.files || []);
    selectedFiles.forEach(file => addAttachment(sourceId, file));

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handlePreviewFile = (_file: File): void => {
    // File preview handled by Attachments component
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

    // Check if any dynamic fields error
    if (Object.keys(dynamicFieldErrors).length > 0) return false;

    return true;
  }, [form.state.isValid, form.state.isDirty, formMapping, formValues, dynamicFieldErrors]);

  const handleCreateTicket = async (formData: CreateTicketFormData): Promise<void> => {
    if (!user) return;
    try {
      // Validate mandatory board-configured fields
      const mandatoryFieldErrors: string[] = [];

      if (showUserGroupsOnly && mandatoryUserGroupsOnly && !formData.assignee?.value) {
        mandatoryFieldErrors.push('User Group is required');
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

      // 1. EXECUTE MESSAGE SENDING FIRST (if handler provided)
      if (onBeforeCreate) {
        // Send the text description as a message immediately
        // Note: We are passing [] for files here so files are only attached to the ticket
        // Change to `sharedAttachments` if you want files on the message instead
        await onBeforeCreate(formData.description, []);
      }

      const attachments = sharedAttachments[sourceId] || [];
      // 2. PROCEED WITH TICKET CREATION
      if (sharedAttachments && attachments.length > 0) {
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
        formDataPayload.append('projectId', projectId);

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

        formDataPayload.append('createdBy', user.id);
        formDataPayload.append('updatedBy', user.id);

        if (sourceConversation) {
          formDataPayload.append('sourceConversationId', sourceConversation.conversationId);
          if (excludedChatAttachmentIds.size > 0) {
            excludedChatAttachmentIds.forEach(id => {
              formDataPayload.append('excludedChatAttachmentIds[]', id);
            });
          }
        }

        // Extract dimensions for all files (images/videos only)
        const dimensionsMap = await getFilesDimensions(attachments);

        // Build file metadata with dimensions
        const fileMetadata: Array<{
          fileIndex: number;
          hasThumbnail: boolean;
          width?: number;
          height?: number;
        }> = [];

        // Add shared attachments (files added via conversation)
        if (attachments.length > 0) {
          attachments.forEach((file: File, fileIndex: number) => {
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

        const response = await apiInstance.post<TicketResponse>('/tickets', formDataPayload);
        processTicketCreationResponse(response, formData.workflowType);
      } else {
        // No files, use JSON
        const response = await apiInstance.post<TicketResponse>('/tickets', {
          title: formData.title.trim(),
          description: formData.description.trim(),
          priority: formData.priority,
          statusV2: formData.status,
          assignedTo: assignedTo || undefined,
          userGroupId: userGroupId || undefined,
          boardId: formData.boardId,
          // For subtickets or AI-initiated tickets, use the selected channel from form; otherwise use the prop
          channelId: isFromSubTicket || isFromAI ? formData.channelId : channelId,
          projectId,
          createdBy: user.id,
          updatedBy: user.id,
          ...(sourceConversation && { eta: formData.eta?.toISOString() }),
          ...(formData.tags && formData.tags.length > 0 && { tags: formData.tags }),
          ...(sourceConversation && { sourceConversationId: sourceConversation.conversationId }),
          ...(formData.workflowType && { workflowType: formData.workflowType }),
          ...(sourceConversation &&
            excludedChatAttachmentIds.size > 0 && {
              excludedChatAttachmentIds: Array.from(excludedChatAttachmentIds),
            }),
          ...(formData.merchantId && { merchantId: formData.merchantId }),
          // Include dynamic fields
          dynamicFields: formData.dynamicFields,
        });

        processTicketCreationResponse(response, formData.workflowType);
      }

      // Clear shared attachments after successful creation
      clearAttachments(sourceId);

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
    if (sourceConversation || tab === 'tickets') clearAttachments(sourceId);
    setExcludedChatAttachmentIds(new Set());
    resetDuplicateState();
    onClose();
  };

  // Handle duplicate ticket copy link
  const handleDuplicateTicketCopyLink = (link: string): void => {
    const ticketUrl = `${window.location.origin}${link}`;

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
      ? userGroupOptions?.filter(group =>
          group.name.toLowerCase().includes(assigneeSearchValue.toLowerCase()),
        )
      : userGroupOptions;

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
    const allTags = [...new Set([...availableTags, ...newTags])];

    return allTags.map((tag, index) => ({
      label: tag,
      value: tag,
      icon: <span className={cn('size-1.5 rounded', TAG_COLORS[index % TAG_COLORS.length])} />,
    }));
  }, [availableTags, newTags]);

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
          <h2 className='text-sm leading-5 font-medium text-gray-400 select-none'>
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
                  <TextShimmer className='leading-5 font-bold text-[20px] text-center h-8'>
                    Adding AI generated title
                  </TextShimmer>
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
                    className={cn(
                      '!text-xl !leading-tight truncate',
                      'px-0 border-none focus-visible:ring-0',
                      'font-bold text-gray-700 placeholder:text-xl placeholder:text-gray-400',
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
                  onChange={e => {
                    const newValue = e.target.value;
                    field.handleChange(newValue);
                  }}
                  className={cn(
                    'border-none focus-visible:ring-0 focus-visible:border-none rounded-none p-0 min-h-16',
                    'placeholder:text-gray-400/80 !text-gray-600 leading-5 font-semibold',
                    field.state.meta.errors.length > 0 && 'text-red-600',
                  )}
                />
                <FieldError error={field.state.meta.errors[0]} />
              </div>
            )}
          </form.Field>

          {/* Channel and Board Selection */}
          <div className='flex items-center gap-2.5'>
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

          {/* Dynamic Form Fields */}
          {requiredDynamicFields.length > 0 && (
            <div className='space-y-2'>
              <div className='text-sm font-bold text-gray-700 pb-2'>Additional Information</div>
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
                          <label className='text-sm font-medium text-gray-700'>{`${fieldName}${!isOptional ? '*' : ''}`}</label>
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
                              'font-semibold text-gray-600 placeholder:text-gray-400/80',
                              error && 'text-red-600',
                            )}
                          />
                          <FieldError error={error} />
                        </>
                      )}
                      {fieldType === FormFieldType.DATE && (
                        <>
                          <label className='text-sm font-medium text-gray-700'>{fieldName} *</label>
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
                              'font-semibold text-gray-600',
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
                            <Radio value='true'>True</Radio>
                            <Radio value='false'>False</Radio>
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
                        <UserMultiSelect
                          label={`${fieldName}${!isOptional ? ' *' : ''}`}
                          placeholder={`Select ${fieldName.toLowerCase()}`}
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
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className='py-2'>
            {isCheckingDuplicate && (
              <div className='flex items-center gap-2 text-sm text-gray-500'>
                <Loader2 className='h-4 w-4 animate-spin' />
                <span>Checking for duplicates...</span>
              </div>
            )}
            {duplicateCheck?.analysis.isDuplicate &&
              duplicateCheck.analysis.duplicateTicketId &&
              duplicateCandidateLink && (
                <div className='rounded-lg border border-gray-200 bg-gray-50 p-4 mb-2 transition-all duration-200 ease-out'>
                  <div className='space-y-2'>
                    <div className='flex items-center justify-between pb-0.5'>
                      <span className='flex items-center gap-2'>
                        <Copy className='size-3' strokeWidth={2.5} />
                        <p className='text-sm font-medium text-gray-800 leading-5'>
                          Duplicate ticket found
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
                    {duplicateCheck?.candidates
                      .filter(
                        candidate => candidate.id === duplicateCheck.analysis.duplicateTicketId,
                      )
                      .map(candidate => (
                        <div
                          key={candidate.id}
                          className='border border-gray-100 rounded-lg p-2.5 flex items-center justify-between gap-2 bg-white group'
                        >
                          <span className='flex items-center gap-2 overflow-hidden cursor-default'>
                            <p className='text-gray-900 text-sm font-medium truncate'>
                              <RenderMessageWithHTML message={candidate.title} />
                            </p>
                          </span>
                          <span className='opacity-0 flex items-center gap-1 group-hover:opacity-100 transition-opacity duration-300 '>
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
                                  handleDuplicateTicketCopyLink(duplicateCandidateLink);
                                }}
                              >
                                <LinkIcon className='size-3.5' />
                              </Button>
                            </Tooltip>
                            <Tooltip
                              content='Open in new page'
                              side='top'
                              className='text-[10px] font-semibold leading-3 p-1.5 '
                            >
                              <Link to={duplicateCandidateLink}>
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
                          </span>
                        </div>
                      ))}
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
                  const fileKey = `file-${attachment.file.name}-${attachment.file.size}-${attachment.file.lastModified}`;
                  return (
                    <AttachmentPreview
                      key={fileKey}
                      file={attachment.file}
                      onRemove={() => {
                        if (attachment.file) {
                          removeAttachment(sourceId, attachment.file);
                        }
                      }}
                      onPreview={() => handlePreviewFile(attachment.file!)}
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
                      : `Assignee${mandatoryUserGroupsOnly ? ' *' : ''}`
                  }
                  placeholder={
                    showUserGroupsOnly
                      ? `User Groups${mandatoryUserGroupsOnly ? ' *' : ''}`
                      : `Assignee${mandatoryUserGroupsOnly ? ' *' : ''}`
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
                    <InlineCalendar
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
                    inputClassName='rounded-md h-7 bg-gray-50'
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
                    inputIcon={<Ellipsis className='size-3.5' strokeWidth={2.33} />}
                    inputClassName='rounded-md h-7 bg-gray-50'
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
                        <WorkflowIcon strokeWidth={2.33} className='size-[14px] text-gray-700' />
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
            >
              <Paperclip strokeWidth={2.33} className='size-3.5 text-gray-500' />
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
